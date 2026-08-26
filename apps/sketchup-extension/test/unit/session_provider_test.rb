# frozen_string_literal: true

require 'stringio'
require 'json'
require 'base64'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/auth/session_provider'

class SessionProviderTest < Minitest::Test
  class FakeHttpAdapter < Granete::SketchUpExtension::Transport::HttpAdapter
    attr_accessor :response, :captured_payload, :captured_header

    def initialize(*)
      super()
      @response = { 'status' => 200, 'body' => {} }
    end

    def request(payload, authorization_header: nil)
      @captured_payload = payload
      @captured_header = authorization_header
      @response
    end
  end

  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @transport = FakeHttpAdapter.new(base_url: 'http://taller.local:8080/api')
    @store_path = File.join(Dir.mktmpdir('granete-session-test'), 'session.json')
    @provider = Granete::SketchUpExtension::Auth::SessionProvider.new(
      logger: @logger, transport: @transport, store_path: @store_path
    )
  end

  def test_login_success_persists_session_in_preferences
    @transport.response = {
      'status' => 200,
      'body' => {
        'token' => session_header(exp: Time.now.to_i + 86_400),
        'user' => { 'name' => 'Ana', 'email' => 'ana@taller.com' },
        'license' => { 'plan' => 'pro', 'status' => 'active' }
      }
    }

    result = @provider.login('ana@taller.com', 'secret123', 'http://taller.local:8080/api')

    assert result['success']
    assert_equal 'pro', @provider.status.dig('license', 'plan')
    assert_equal 'logged_in', @provider.status['state']
    assert @provider.configured?
    assert_match(/^Bearer /, @provider.authorization_header)
    # Login body carries the extension client marker, never persisted passwords.
    assert_equal 'sketchup-extension', @transport.captured_payload.dig('body', 'client')
  end

  def test_login_rejects_wrong_credentials_with_spanish_error
    @transport.response = { 'status' => 401, 'body' => { 'error' => 'invalid email or password' } }

    result = @provider.login('ana@taller.com', 'wrong', 'http://taller.local:8080/api')

    refute result['success']
    assert_equal 'Email o contraseña incorrectos.', result['error']
    refute @provider.configured?
  end

  def test_logout_clears_session
    @transport.response = { 'status' => 200, 'body' => { 'token' => session_header, 'user' => {}, 'license' => {} } }
    @provider.login('a@b.c', 'secret123', 'http://taller.local:8080/api')

    @provider.logout

    assert_equal 'logged_out', @provider.status['state']
    refute @provider.configured?
    assert_raises(Granete::SketchUpExtension::Auth::NotConfiguredError) do
      @provider.authorization_header
    end
  end

  def test_refresh_skipped_when_session_is_recent
    far_expiry = Time.now.to_i + (7 * 86_400)
    @transport.response = { 'status' => 200, 'body' => { 'token' => session_header(exp: far_expiry) } }
    @provider.login('a@b.c', 'secret123', 'http://taller.local:8080/api')
    @transport.captured_payload = nil

    refute @provider.refresh_if_needed
    assert_nil @transport.captured_payload
  end

  def test_session_survives_reboot_via_preferences
    body = { 'token' => session_header, 'user' => { 'name' => 'Ana' }, 'license' => {} }
    @transport.response = { 'status' => 200, 'body' => body }
    @provider.login('a@b.c', 'secret123', 'http://taller.local:8080/api')

    rebooted = Granete::SketchUpExtension::Auth::SessionProvider.new(
      logger: @logger, store_path: @store_path
    )

    assert rebooted.configured?
    assert_equal 'logged_in', rebooted.status['state']
    assert_equal 'Ana', rebooted.status.dig('user', 'name')
    assert_equal 'http://taller.local:8080/api', rebooted.status['server_url']
  end

  def test_session_file_is_written_atomically_with_secure_permissions
    body = { 'token' => session_header, 'user' => { 'name' => 'Ana' }, 'license' => {} }
    @transport.response = { 'status' => 200, 'body' => body }
    @provider.login('a@b.c', 'secret123', 'http://taller.local:8080/api')

    assert File.exist?(@store_path)
    mode = File.stat(@store_path).mode & 0o777
    assert_equal 0o600, mode, 'Stored session file must be chmod 0600 (owner only)'
  end

  private

  # Unsigned JWT-shaped header: the provider only decodes the payload locally
  # as an expiry hint; the server validates the real signature.
  def session_header(exp: Time.now.to_i + 86_400)
    header = Base64.urlsafe_encode64('{"alg":"HS256","typ":"JWT"}').tr('+/', '-_')
    payload = Base64.urlsafe_encode64(JSON.generate({ 'exp' => exp })).tr('+/', '-_')
    "#{header}.#{payload}.sig"
  end
end
