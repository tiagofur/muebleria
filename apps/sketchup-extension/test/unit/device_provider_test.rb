# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/auth/device_provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'

# #460 SEC-6: the DeviceProvider owns the enrollment → exchange → token flow.
# These tests run hermetically: the secure secret storage is overridden (the
# real one touches the macOS Keychain / a restricted file) and every HTTP call
# answers from an in-memory transport double that records the requests.
class DeviceProviderTest < Minitest::Test
  class FakeTransport
    attr_reader :requests
    attr_accessor :base_url

    def initialize
      @requests = []
      @responses = {}
      @base_url = 'http://taller.local:8080/api'
    end

    def configured?
      !@base_url.nil?
    end

    # Registers the response for a request path.
    def respond_with(path, status, body = {})
      @responses[path] = { 'status' => status, 'body' => body }
    end

    def request(command)
      @requests << command
      response = @responses[command['path']]
      return { 'status' => 500, 'body' => {} } unless response

      response.merge('body' => response['body'].is_a?(Hash) ? response['body'].dup : response['body'])
    end
  end

  # Hermetic provider: the secure storage becomes an instance variable so the
  # tests never touch the host Keychain or the fallback file.
  class HermeticProvider < Granete::SketchUpExtension::Auth::DeviceProvider
    attr_accessor :stored_secret
    attr_reader :deleted

    def secure_store_secret(secret)
      @stored_secret = secret.to_s
    end

    def secure_read_secret
      @stored_secret.to_s.empty? ? nil : @stored_secret
    end

    def secure_delete_secret
      @deleted = true
      @stored_secret = ''
    end
  end

  def setup
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @transport = FakeTransport.new
    @store_path = File.join(Dir.mktmpdir('granete-device-test'), 'session.json')
    @provider = HermeticProvider.new(logger: @logger, transport: @transport, store_path: @store_path)
  end

  def teardown
    FileUtils.remove_entry(File.dirname(@store_path)) if File.directory?(File.dirname(@store_path))
  end

  def test_enroll_returns_code_and_persists_server_url
    @transport.respond_with('/auth/devices/enroll', 201,
                            'id' => 'enr-1', 'code' => 'K7M2QP', 'expires_at' => '2026-09-02T05:00:00Z')

    result = @provider.enroll('http://taller.local:8080/api', 'Mac del taller')

    assert_equal true, result['success']
    assert_equal 'K7M2QP', result['code']
    assert_equal 'enr-1', result['id']
    enroll_request = @transport.requests.find { |r| r['path'] == '/auth/devices/enroll' }
    refute_nil enroll_request
    assert_equal 'sketchup', enroll_request['body']['client_type']
    assert_equal 'Mac del taller', enroll_request['body']['display_name']
    assert_equal 'http://taller.local:8080/api', @transport.base_url
    assert_equal 'http://taller.local:8080/api', @provider.status['server_url']
  end

  def test_enroll_server_rejection_reports_spanish_error
    @transport.respond_with('/auth/devices/enroll', 503)

    result = @provider.enroll('http://taller.local:8080/api', 'Mac')

    assert_equal false, result['success']
    assert_includes result['error'], 'rechazó el registro'
  end

  def test_enroll_forwards_display_name_unchanged
    @transport.respond_with('/auth/devices/enroll', 201, 'id' => 'enr-1', 'code' => 'AAAAAA')

    @provider.enroll('http://taller.local:8080/api', 'SketchUp')

    enroll_request = @transport.requests.find { |r| r['path'] == '/auth/devices/enroll' }
    assert_equal 'SketchUp', enroll_request['body']['display_name']
  end

  def test_poll_reports_pending_and_approved
    @transport.respond_with('/auth/devices/enroll/poll', 200, 'status' => 'pending')

    pending = @provider.poll_enrollment('enr-1')
    assert_equal true, pending['success']
    assert_equal 'pending', pending['status']

    @transport.respond_with('/auth/devices/enroll/poll', 200, 'status' => 'approved')
    approved = @provider.poll_enrollment('enr-1')
    assert_equal 'approved', approved['status']
    poll_request = @transport.requests.find { |r| r['path'] == '/auth/devices/enroll/poll' }
    assert_equal 'enr-1', poll_request['body']['id']
  end

  def test_exchange_stores_secret_and_first_token
    @transport.respond_with('/auth/devices/exchange', 200, 'device_secret' => "dev-1:#{'a1' * 32}")
    @transport.respond_with('/auth/devices/token', 200, 'access_token' => 'token-1')

    result = @provider.exchange_enrollment('enr-1')

    assert_equal true, result['success']
    assert_equal "dev-1:#{'a1' * 32}", @provider.stored_secret
    # The first access token is minted in the same exchange call.
    token_request = @transport.requests.find { |r| r['path'] == '/auth/devices/token' }
    refute_nil token_request
    assert_equal "dev-1:#{'a1' * 32}", token_request['body']['device_secret']
    assert @provider.configured?
    assert_equal 'Bearer token-1', @provider.authorization_header
  end

  def test_exchange_error_does_not_store_anything
    @transport.respond_with('/auth/devices/exchange', 409, 'error' => 'conflict')

    result = @provider.exchange_enrollment('enr-1')

    assert_equal false, result['success']
    assert_nil @provider.stored_secret
    refute @provider.configured?
  end

  def test_authorization_header_raises_without_configuration
    assert_raises(Granete::SketchUpExtension::Auth::NotConfiguredError) do
      @provider.authorization_header
    end
  end

  def test_expired_token_refreshes_from_stored_secret_without_password
    @transport.respond_with('/auth/devices/exchange', 200, 'device_secret' => "dev-1:#{'a1' * 32}")
    @transport.respond_with('/auth/devices/token', 200, 'access_token' => expired_jwt)
    @provider.exchange_enrollment('enr-1')

    @transport.respond_with('/auth/devices/token', 200, 'access_token' => valid_jwt)

    header = @provider.authorization_header

    assert_equal "Bearer #{valid_jwt}", header
    token_requests = @transport.requests.select { |r| r['path'] == '/auth/devices/token' }
    assert_equal 2, token_requests.length, 'expired access token must re-mint from the device secret'
  end

  def test_logout_clears_secret_and_access
    @transport.respond_with('/auth/devices/exchange', 200, 'device_secret' => "dev-1:#{'a1' * 32}")
    @transport.respond_with('/auth/devices/token', 200, 'access_token' => valid_jwt)
    @provider.exchange_enrollment('enr-1')

    @provider.logout

    assert_equal '', @provider.stored_secret
    refute @provider.configured?
    assert_raises(Granete::SketchUpExtension::Auth::NotConfiguredError) do
      @provider.authorization_header
    end
  end

  # #460 SEC-6 review: the access bearer is MEMORY-ONLY — the on-disk
  # session file must never contain it, restart must re-mint from the
  # device secret, and legacy persisted bearers are scrubbed on boot.
  def test_access_token_never_persists_to_disk
    @transport.respond_with('/auth/devices/exchange', 200, 'device_secret' => "dev-1:#{'a1' * 32}")
    @transport.respond_with('/auth/devices/token', 200, 'access_token' => valid_jwt)
    @provider.exchange_enrollment('enr-1')
    @provider.authorization_header

    on_disk = File.exist?(@store_path) ? File.read(@store_path) : ''
    refute_includes on_disk, 'session_access', 'access bearer must not live in the session file'
    refute_includes on_disk, valid_jwt
  end

  def test_restart_re_mints_access_from_device_secret
    @transport.respond_with('/auth/devices/exchange', 200, 'device_secret' => "dev-1:#{'a1' * 32}")
    @transport.respond_with('/auth/devices/token', 200, 'access_token' => valid_jwt)
    @provider.exchange_enrollment('enr-1')

    rebooted_transport = FakeTransport.new
    rebooted_transport.base_url = @transport.base_url
    rebooted_transport.respond_with('/auth/devices/token', 200, 'access_token' => valid_jwt)
    rebooted = HermeticProvider.new(
      logger: @logger, transport: rebooted_transport, store_path: @store_path
    )
    rebooted.stored_secret = @provider.stored_secret

    header = rebooted.authorization_header

    assert_equal "Bearer #{valid_jwt}", header
    mints = rebooted_transport.requests.select { |r| r['path'] == '/auth/devices/token' }
    assert_equal 1, mints.length, 'restart must re-mint the access bearer from the secret'
  end

  def test_boot_scrubs_legacy_persisted_access_token
    legacy_dir = File.dirname(@store_path)
    File.write(@store_path, JSON.generate('session_access' => 'legacy-bearer', 'server_url' => 'http://x'))

    scrubbed = HermeticProvider.new(logger: @logger, transport: FakeTransport.new, store_path: @store_path)

    on_disk = File.read(@store_path)
    refute_includes on_disk, 'legacy-bearer'
    assert_equal 'http://x', scrubbed.status['server_url'], 'non-sensitive state must survive the scrub'
    FileUtils.remove_entry(legacy_dir)
  end

  # Fail closed: without a secure OS store the exchange refuses to complete
  # and nothing (memory or disk) keeps the secret. These dispatch tests stub
  # the backend branches, NOT the public secure_* methods: the dispatch and
  # its fail-closed arm are the code under test.
  def test_exchange_fails_closed_without_secure_storage
    unavailable = Class.new(Granete::SketchUpExtension::Auth::DeviceProvider) do
      define_method(:secure_backend) { :unavailable }
    end
    provider = unavailable.new(logger: @logger, transport: @transport, store_path: @store_path)
    @transport.respond_with('/auth/devices/exchange', 200, 'device_secret' => "dev-1:#{'a1' * 32}")

    result = provider.exchange_enrollment('enr-1')

    assert_equal false, result['success']
    assert_includes result['error'], 'almacenamiento seguro'
    assert provider.send(:secure_read_secret).nil?
    refute provider.configured?
  end

  # Windows: the secret travels through stdin into the Credential Manager
  # vault — never on the powershell command line.
  def test_windows_vault_stores_secret_via_stdin
    captured = []
    windows = Class.new(Granete::SketchUpExtension::Auth::DeviceProvider) do
      define_method(:secure_backend) { :windows_vault }
      define_method(:run_powershell) do |script, stdin: nil|
        captured << { script: script, stdin: stdin }
        ''
      end
    end
    provider = windows.new(logger: @logger, transport: @transport, store_path: @store_path)

    provider.send(:secure_store_secret, 'dev-1:supersecret')

    store_call = captured.first
    assert_includes store_call[:script], 'PasswordVault'
    assert_equal 'dev-1:supersecret', store_call[:stdin]
    # The secret rides stdin; the script (and therefore the powershell argv)
    # is a fixed template that must not embed it.
    refute_includes store_call[:script], 'dev-1:supersecret'
  end

  def test_keychain_backend_dispatches_to_security_cli
    dispatched = []
    keychain = Class.new(Granete::SketchUpExtension::Auth::DeviceProvider) do
      define_method(:secure_backend) { :keychain }
      define_method(:store_mac_keychain) do |secret|
        dispatched << [:store, secret]
      end
      define_method(:read_mac_keychain) do
        dispatched << [:read]
        'stored-secret'
      end
      define_method(:delete_mac_keychain) do
        dispatched << [:delete]
      end
    end
    provider = keychain.new(logger: @logger, transport: @transport, store_path: @store_path)

    provider.send(:secure_store_secret, 'dev-1:xyz')
    assert_equal [:store, 'dev-1:xyz'], dispatched.first
    assert_equal 'stored-secret', provider.send(:secure_read_secret)
    provider.send(:secure_delete_secret)
    assert_includes dispatched, [:delete]
  end

  private

  # Minimal JWT shapes: only the exp claim matters to the provider.
  def expired_jwt
    payload = Base64.urlsafe_encode64(JSON.generate(exp: Time.now.to_i - 3600)).delete('=')
    ['header', payload, 'sig'].join('.')
  end

  def valid_jwt
    payload = Base64.urlsafe_encode64(JSON.generate(exp: Time.now.to_i + 3600)).delete('=')
    ['header', payload, 'sig'].join('.')
  end
end
