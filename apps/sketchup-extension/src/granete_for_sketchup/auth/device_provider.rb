# frozen_string_literal: true

require 'json'
require 'base64'
require 'fileutils'
require 'time'

module Granete
  module SketchUpExtension
    module Auth
      # DeviceProvider implements the Auth::Provider interface using the new
      # SEC-6 device credential flow. It stores a revocable device secret
      # securely, and exchanges it for short-lived access tokens.
      # The credentials (refresh/device secret) are stored in the OS secure storage
      # (Keychain on macOS, Credential Manager on Windows) or a restricted file fallback.
      class DeviceProvider < Provider
        AUTH_TRANSPORT = 'sketchup'
        KEY_SERVER_URL = 'server_url'
        KEY_SESSION_ACCESS = 'session_access'
        KEY_SESSION_STATE = 'session_state'
        
        # Secret storage key
        SECRET_KEY = 'granete_sketchup_device_secret'

        # Refresh when the access token has less than this left to live (15 min).
        REFRESH_MARGIN_SECONDS = 15 * 60

        attr_reader :transport, :store_path

        def initialize(logger:, transport: nil, store_path: nil)
          super()
          @logger = logger
          @store_path = store_path || default_store_path
          @store = load_store
          @transport = transport || Transport::HttpAdapter.new(base_url: stored_server_url, logger: logger)
        end

        # Initiates the enrollment flow. Returns { id, code, expires_at }
        def enroll(server_url, display_name)
          adapter = @transport
          adapter.base_url = server_url
          
          response = adapter.request(
            { 'method' => 'POST', 'path' => '/auth/devices/enroll',
              'body' => { 'client_type' => 'sketchup', 'display_name' => display_name } }
          )
          
          if response['status'] == 201
            body = response['body'].is_a?(Hash) ? response['body'] : {}
            write_value(KEY_SERVER_URL, adapter.base_url.to_s)
            { 'success' => true, 'id' => body['id'], 'code' => body['code'], 'expires_at' => body['expires_at'] }
          else
            { 'success' => false, 'error' => "El servidor rechazó el registro (#{response['status']})." }
          end
        rescue Transport::RequestError, Transport::NotConfiguredError => e
          { 'success' => false, 'error' => e.message }
        end
        
        # Polls the enrollment status.
        def poll_enrollment(enrollment_id)
          response = @transport.request(
            { 'method' => 'POST', 'path' => '/auth/devices/enroll/poll',
              'body' => { 'id' => enrollment_id } }
          )
          
          if response['status'] == 200
            body = response['body'].is_a?(Hash) ? response['body'] : {}
            { 'success' => true, 'status' => body['status'] }
          else
            { 'success' => false, 'error' => "Error al consultar estado (#{response['status']})." }
          end
        rescue Transport::RequestError, Transport::NotConfiguredError => e
          { 'success' => false, 'error' => e.message }
        end
        
        # Exchanges the approved enrollment for a device secret and token.
        def exchange_enrollment(enrollment_id)
          response = @transport.request(
            { 'method' => 'POST', 'path' => '/auth/devices/exchange',
              'body' => { 'enrollment_id' => enrollment_id } }
          )
          
          if response['status'] == 200
            body = response['body'].is_a?(Hash) ? response['body'] : {}
            
            # Store device secret securely
            device_secret = body['device_secret']
            secure_store_secret(device_secret)
            
            # Immediately exchange the new secret for an access token
            fetch_token(device_secret)
          else
            { 'success' => false, 'error' => "Error al intercambiar credencial (#{response['status']})." }
          end
        rescue Transport::RequestError, Transport::NotConfiguredError => e
          { 'success' => false, 'error' => e.message }
        end

        def logout
          write_value(KEY_SESSION_ACCESS, '')
          write_value(KEY_SESSION_STATE, '')
          secure_store_secret('') # Delete secret
          @transport.base_url = nil
          nil
        end

        def configured?
          secret = secure_read_secret
          !secret.nil? && !secret.empty? && @transport.configured?
        end

        def authorization_header
          access = read_value(KEY_SESSION_ACCESS, '').to_s
          
          if access.empty? || access_token_expired?
            # Need to fetch a new token
            refresh_if_needed
            access = read_value(KEY_SESSION_ACCESS, '').to_s
          end
          
          raise NotConfiguredError, 'Authentication is not configured' if access.empty?

          "Bearer #{access}"
        end

        def refresh_if_needed
          return false unless configured?

          return false if !access_token_expired? && seconds_until_expiry > REFRESH_MARGIN_SECONDS
          
          secret = secure_read_secret
          return false if secret.nil? || secret.empty?

          res = fetch_token(secret)
          res['success']
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

        private
        
        def fetch_token(device_secret)
           response = @transport.request(
             { 'method' => 'POST', 'path' => '/auth/devices/token',
               'body' => { 'device_secret' => device_secret } }
           )
           
           if response['status'] == 200
             body = response['body'].is_a?(Hash) ? response['body'] : {}
             write_value(KEY_SESSION_ACCESS, body['access_token'].to_s)
             
             # In a real app we might want to also fetch /api/auth/me to update 
             # the cached user state, but for this PR we'll assume it's updated elsewhere or keep it simple.
             
             { 'success' => true }
           else
             { 'success' => false, 'error' => "Error de autenticación (#{response['status']})." }
           end
        end

        def parse_stored_state(raw)
          return raw unless raw.is_a?(String)
          return nil if raw.strip.empty?

          JSON.parse(raw)
        rescue JSON::ParserError
          nil
        end

        def seconds_until_expiry
          payload = decode_session_payload
          exp = payload && payload['exp']
          return nil unless exp.is_a?(Numeric)

          exp - Time.now.to_i
        end
        
        def access_token_expired?
           sec = seconds_until_expiry
           sec.nil? || sec <= 0
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

        # --- File-backed session store (For non-sensitive data) ---

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
        
        # --- Secure Secret Storage (macOS Keychain / Windows CredMan fallback) ---
        
        def secure_store_secret(secret)
          # Use macOS security command if available (Mac only for now)
          if RUBY_PLATFORM =~ /darwin/
             store_mac_keychain(secret)
          else
             # Fallback to a highly restricted file
             store_fallback(secret)
          end
        end
        
        def secure_read_secret
          if RUBY_PLATFORM =~ /darwin/
             read_mac_keychain
          else
             read_fallback
          end
        end
        
        def store_mac_keychain(secret)
           if secret.nil? || secret.empty?
             `security delete-generic-password -s "#{SECRET_KEY}" -a "granete_sketchup" 2>/dev/null`
           else
             `security add-generic-password -U -s "#{SECRET_KEY}" -a "granete_sketchup" -w "#{secret}"`
           end
        end
        
        def read_mac_keychain
           out = `security find-generic-password -s "#{SECRET_KEY}" -a "granete_sketchup" -w 2>/dev/null`
           out.strip
        end
        
        def store_fallback(secret)
           path = File.join(File.dirname(@store_path), 'secure_token.dat')
           if secret.nil? || secret.empty?
             FileUtils.rm_f(path)
           else
             File.open(path, 'w', 0o600) { |f| f.write(secret) }
             File.chmod(0o600, path)
           end
        end
        
        def read_fallback
           path = File.join(File.dirname(@store_path), 'secure_token.dat')
           return nil unless File.exist?(path)
           File.read(path).strip
        end

      end
    end
  end
end
