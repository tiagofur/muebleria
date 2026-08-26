# frozen_string_literal: true

require 'json'
require 'base64'
require 'fileutils'
require 'time'

module Granete
  module SketchUpExtension
    module Auth
      # Session persisted as a JSON file under the user's application-support
      # directory (outside the RBZ; the RBZ still embeds no credential of any
      # kind). Implements the Auth::Provider port for authenticated requests
      # and owns the login flow against the Granete API.
      #
      # A dedicated file (not SketchUp preferences) is deliberate: the real
      # host's read_default EVALS stored strings that look like containers,
      # which corrupts JSON state. SketchUp/Ruby is explicitly not a security
      # boundary: the stored session is a bearer credential for a read-only
      # extension profile, revocable server-side at any moment.
      class SessionProvider < Provider
        EXTENSION_CLIENT = 'sketchup-extension'
        KEY_SERVER_URL = 'server_url'
        KEY_SESSION_ACCESS = 'session_access'
        KEY_SESSION_STATE = 'session_state'

        # Refresh when the stored session has less than this left to live.
        REFRESH_MARGIN_SECONDS = 2 * 24 * 60 * 60

        attr_reader :transport, :store_path

        def initialize(logger:, transport: nil, store_path: nil)
          super()
          @logger = logger
          @store_path = store_path || default_store_path
          @store = load_store
          @transport = transport || Transport::HttpAdapter.new(base_url: stored_server_url, logger: logger)
        end

        def login(email, password, server_url)
          adapter = @transport
          adapter.base_url = server_url
          response = adapter.request(
            { 'method' => 'POST', 'path' => '/auth/login',
              'body' => { 'email' => email, 'password' => password, 'client' => EXTENSION_CLIENT } }
          )
          handle_login_response(adapter, response)
        rescue Transport::RequestError, Transport::NotConfiguredError => e
          { 'success' => false, 'error' => e.message }
        end

        def logout
          write_value(KEY_SESSION_ACCESS, '')
          write_value(KEY_SESSION_STATE, '')
          @transport.base_url = nil
          nil
        end

        def configured?
          !read_value(KEY_SESSION_ACCESS, '').to_s.empty? && @transport.configured?
        end

        def authorization_header
          access = read_value(KEY_SESSION_ACCESS, '').to_s
          raise NotConfiguredError, 'Authentication is not configured' if access.empty?

          "Bearer #{access}"
        end

        # Best-effort session renewal: the server is the authority, the local
        # expiry is only a hint decoded from the session header.
        def refresh_if_needed
          return false unless configured?

          return false if seconds_until_expiry.nil? || seconds_until_expiry > REFRESH_MARGIN_SECONDS

          response = @transport.request({ 'method' => 'POST', 'path' => '/auth/refresh' },
                                        authorization_header: authorization_header)
          return false unless response['status'] == 200

          body = response['body'].is_a?(Hash) ? response['body'] : {}
          store_session(body)
          true
        rescue Transport::RequestError, NotConfiguredError, JSON::ParserError => e
          @logger&.error('session_refresh_failed', error: e)
          false
        end

        def status
          state = read_value(KEY_SESSION_STATE, nil)
          state = parse_stored_state(state) if state.is_a?(String)
          {
            'state' => configured? ? 'logged_in' : 'logged_out',
            'server_url' => stored_server_url.to_s,
            'user' => state&.dig('user'),
            'license' => state&.dig('license')
          }
        end

        def store_session(login_body)
          write_value(KEY_SESSION_ACCESS, login_body['token'].to_s)
          write_value(KEY_SESSION_STATE,
                      { 'user' => login_body['user'], 'license' => login_body['license'] })
          @transport.base_url = stored_server_url
          status
        end

        private

        def parse_stored_state(raw)
          return raw unless raw.is_a?(String)
          return nil if raw.strip.empty?

          JSON.parse(raw)
        rescue JSON::ParserError
          nil
        end

        def handle_login_response(adapter, response)
          case response['status']
          when 200
            body = response['body'].is_a?(Hash) ? response['body'] : {}
            write_value(KEY_SERVER_URL, adapter.base_url.to_s)
            store_session(body)
            { 'success' => true, 'user' => body['user'], 'license' => body['license'] }
          when 401
            { 'success' => false, 'error' => 'Email o contraseña incorrectos.' }
          when 429
            { 'success' => false, 'error' => 'Demasiados intentos. Esperá un momento y volvé a probar.' }
          else
            { 'success' => false, 'error' => "El servidor rechazó el inicio de sesión (#{response['status']})." }
          end
        end

        def seconds_until_expiry
          payload = decode_session_payload
          exp = payload && payload['exp']
          return nil unless exp.is_a?(Numeric)

          exp - Time.now.to_i
        end

        def decode_session_payload
          access = read_value(KEY_SESSION_ACCESS, '').to_s
          return nil if access.empty?

          segments = access.split('.')
          return nil unless segments.length == 3

          padded = Base64.urlsafe_decode64(segments[1].ljust((segments[1].length + 3) & ~3, '='))
          JSON.parse(padded)
        rescue ArgumentError, JSON::ParserError
          nil
        end

        def stored_server_url
          url = read_value(KEY_SERVER_URL, '').to_s
          url.empty? ? nil : url
        end

        # --- File-backed session store -----------------------------------
        # Real-host read_default EVALS container-looking strings, so session
        # data lives in a plain JSON file owned by the extension.

        def default_store_path
          support = File.join(Dir.home, 'Library', 'Application Support', 'Granete')
          File.join(support, 'sketchup_extension_session.json')
        end

        def load_store
          return {} unless File.exist?(@store_path)

          parsed = JSON.parse(File.read(@store_path))
          parsed.is_a?(Hash) ? parsed : {}
        rescue Errno::EACCES, Errno::ENOENT, JSON::ParserError => e
          @logger&.error('session_store_unreadable', error: e)
          {}
        end

        def read_value(key, default)
          value = @store[key]
          value.nil? ? default : value
        end

        def write_value(key, value)
          @store[key] = value
          dirname = File.dirname(@store_path)
          FileUtils.mkdir_p(dirname, mode: 0o700)
          tmp_path = "#{@store_path}.tmp.#{Process.pid}.#{rand(10_000)}"
          File.open(tmp_path, 'w', 0o600) do |f|
            f.write(JSON.generate(@store))
          end
          File.chmod(0o600, tmp_path)
          File.rename(tmp_path, @store_path)
          true
        rescue SystemCallError, IOError => e
          FileUtils.rm_f(tmp_path) if tmp_path && File.exist?(tmp_path)
          @logger&.error('session_store_write_failed', error: e)
          false
        end
      end
    end
  end
end
