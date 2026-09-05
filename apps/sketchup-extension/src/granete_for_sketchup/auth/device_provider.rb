# frozen_string_literal: true

require 'json'
require 'base64'
require 'fileutils'
require 'time'

module Granete
  module SketchUpExtension
    module Auth
      # Secure device-secret storage (#460 SEC-6). The device secret is the
      # ONLY persisted credential: it lives in the OS credential store
      # (macOS Keychain, Windows Credential Manager vault). There is NO
      # plaintext file fallback — on any other platform the provider fails
      # closed and enrollment is refused there.
      module SecretStorage
        SECRET_KEY = 'granete_sketchup_device_secret'
        SERVICE_NAME = 'granete_sketchup'

        # Raised when the platform has no secure store. Callers must fail
        # closed: never downgrade the secret to a plain file.
        class SecureStorageUnavailableError < StandardError; end

        def secure_store_secret(secret)
          case secure_backend
          when :keychain then store_mac_keychain(secret)
          when :windows_vault then store_windows_vault(secret)
          else
            raise SecureStorageUnavailableError,
                  'No hay almacenamiento seguro disponible en este sistema.'
          end
        end

        def secure_read_secret
          case secure_backend
          when :keychain then read_mac_keychain
          when :windows_vault then read_windows_vault
          end
        end

        def secure_delete_secret
          case secure_backend
          when :keychain then delete_mac_keychain
          when :windows_vault then delete_windows_vault
          end
        end

        private

        def secure_backend
          if RUBY_PLATFORM.include?('darwin')
            :keychain
          elsif RUBY_PLATFORM.match?(/mswin|mingw|cygwin|win/)
            :windows_vault
          else
            :unavailable
          end
        end

        def store_mac_keychain(secret)
          if secret.nil? || secret.empty?
            `security delete-generic-password -s "#{SECRET_KEY}" -a "#{SERVICE_NAME}" 2>/dev/null`
          else
            `security add-generic-password -U -s "#{SECRET_KEY}" -a "#{SERVICE_NAME}" -w "#{secret}"`
          end
        end

        def read_mac_keychain
          out = `security find-generic-password -s "#{SECRET_KEY}" -a "#{SERVICE_NAME}" -w 2>/dev/null`
          out.strip
        end

        def delete_mac_keychain
          `security delete-generic-password -s "#{SECRET_KEY}" -a "#{SERVICE_NAME}" 2>/dev/null`
          nil
        end
      end

      # Windows Credential Manager vault adapter (WinRT PasswordVault via
      # Windows PowerShell). The secret travels over stdin — never on the
      # powershell command line, where process listings would expose it.
      module WindowsVaultStorage
        VAULT_RESOURCE = 'granete_sketchup'
        VAULT_USER = 'granete_sketchup'

        private

        def store_windows_vault(secret)
          run_powershell(windows_vault_store_script, stdin: secret)
          nil
        end

        def read_windows_vault
          run_powershell(windows_vault_read_script).to_s.strip
        end

        def delete_windows_vault
          run_powershell(windows_vault_delete_script)
          nil
        end

        def windows_vault_store_script
          <<~POWERSHELL
            [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] | Out-Null
            $vault = New-Object Windows.Security.Credentials.PasswordVault
            $secret = [Console]::In.ReadToEnd()
            $credential = New-Object Windows.Security.Credentials.PasswordCredential('#{VAULT_RESOURCE}', '#{VAULT_USER}', $secret)
            $vault.Add($credential)
          POWERSHELL
        end

        def windows_vault_read_script
          <<~POWERSHELL
            [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] | Out-Null
            $vault = New-Object Windows.Security.Credentials.PasswordVault
            try {
              $credential = $vault.Retrieve('#{VAULT_RESOURCE}', '#{VAULT_USER}')
              Write-Output $credential.Password
            } catch {
              Write-Output ''
            }
          POWERSHELL
        end

        def windows_vault_delete_script
          <<~POWERSHELL
            [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] | Out-Null
            $vault = New-Object Windows.Security.Credentials.PasswordVault
            try {
              $credential = $vault.Retrieve('#{VAULT_RESOURCE}', '#{VAULT_USER}')
              $vault.Remove($credential)
            } catch {
            }
          POWERSHELL
        end

        def run_powershell(script, stdin: nil)
          IO.popen(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], 'w+') do |io|
            io.write(stdin) if stdin
            io.close_write
            io.read
          end
        end
      end

      # File-backed session store for non-sensitive data (server URL, cached
      # state label). The access bearer is deliberately NOT part of this
      # store: it lives only in memory and is re-minted from the device
      # secret on every SketchUp start.
      module SessionStore
        private

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
          persist_store
        end

        def delete_value(key)
          @store.delete(key)
          persist_store
        end

        def persist_store
          dirname = File.dirname(@store_path)
          FileUtils.mkdir_p(dirname, mode: 0o700)
          tmp_path = "#{@store_path}.tmp.#{Process.pid}.#{rand(10_000)}"
          File.open(tmp_path, 'w', 0o600) { |f| f.write(JSON.generate(@store)) }
          File.chmod(0o600, tmp_path)
          File.rename(tmp_path, @store_path)
          true
        rescue SystemCallError, IOError => e
          FileUtils.rm_f(tmp_path) if tmp_path && File.exist?(tmp_path)
          @logger&.error('session_store_write_failed', error: e)
          false
        end
      end

      # DeviceProvider implements the Auth::Provider interface using the SEC-6
      # device credential flow. It stores a revocable device secret securely
      # and exchanges it for short-lived access tokens.
      class DeviceProvider < Provider
        include SecretStorage
        include WindowsVaultStorage
        include SessionStore

        AUTH_TRANSPORT = 'sketchup'
        KEY_SERVER_URL = 'server_url'
        KEY_SESSION_STATE = 'session_state'
        # Pre-review builds persisted the access bearer in the session file;
        # boot scrubs it so the on-disk contract holds everywhere.
        LEGACY_KEY_SESSION_ACCESS = 'session_access'

        # The backend issues 15-minute bearers; re-mint only near expiry so a
        # normal request never pays a token round-trip.
        REFRESH_MARGIN_SECONDS = 2 * 60

        attr_reader :transport, :store_path

        def initialize(logger:, transport: nil, store_path: nil)
          super()
          @logger = logger
          @store_path = store_path || default_store_path
          @store = load_store
          # #460 SEC-6 review: the access bearer is MEMORY-ONLY. Restarting
          # SketchUp re-mints it from the device secret.
          @access_token = nil
          delete_value(LEGACY_KEY_SESSION_ACCESS) if @store.key?(LEGACY_KEY_SESSION_ACCESS)
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
          body = response['body'].is_a?(Hash) ? response['body'] : {}
          if response['status'] == 200
            { 'success' => true, 'status' => body['status'] }
          else
            { 'success' => false, 'http_status' => response['status'], 'error' => "Error al consultar estado (#{response['status']})." }
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
            begin
              secure_store_secret(body['device_secret'])
            rescue SecureStorageUnavailableError => e
              # Fail closed: never keep the secret in memory-only or plain
              # storage when the OS has no secure store.
              return { 'success' => false, 'error' => e.message }
            end
            fetch_token(body['device_secret'])
          else
            { 'success' => false, 'error' => "Error al intercambiar credencial (#{response['status']})." }
          end
        rescue Transport::RequestError, Transport::NotConfiguredError => e
          { 'success' => false, 'error' => e.message }
        end

        def logout
          @access_token = nil
          write_value(KEY_SESSION_STATE, '')
          secure_delete_secret
          @transport.base_url = nil
          nil
        end

        def configured?
          secret = secure_read_secret
          !secret.nil? && !secret.empty? && @transport.configured?
        end

        def authorization_header
          access = @access_token.to_s
          if access.empty? || access_token_expired?
            refresh_if_needed
            access = @access_token.to_s
          end
          raise NotConfiguredError, 'Authentication is not configured' if access.empty?

          "Bearer #{access}"
        end

        def refresh_if_needed
          return false unless configured?
          return false if !access_token_expired? && seconds_until_expiry > REFRESH_MARGIN_SECONDS

          secret = secure_read_secret
          return false if secret.nil? || secret.empty?

          fetch_token(secret)['success']
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
            @access_token = body['access_token'].to_s
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
          access = @access_token.to_s
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
      end
    end
  end
end
