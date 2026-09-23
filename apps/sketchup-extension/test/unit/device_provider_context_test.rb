# frozen_string_literal: true

require 'stringio'
require 'base64'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/auth/device_provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'

# #469 R4 — the REAL DeviceProvider's session_context_id, hermetic (the
# same secure-storage override and in-memory transport the #460 suite
# uses): no Keychain, no real credentials, no network, no owner models.
# Claims mirror the Go issuer (Authority.issueToken): every mint renews
# jti/nbf/exp/iat; sid, auth_started_at, org/membership and the transport
# boundary define the context and survive a technical refresh.
class DeviceProviderContextTest < Minitest::Test
  Auth = Granete::SketchUpExtension::Auth

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

  class HermeticProvider < Auth::DeviceProvider
    attr_accessor :stored_secret

    def secure_store_secret(secret)
      @stored_secret = secret.to_s
    end

    def secure_read_secret
      @stored_secret.to_s.empty? ? nil : @stored_secret
    end

    def secure_delete_secret
      @stored_secret = ''
    end

    # The session store helpers are private in the provider; tests drive
    # them through the same public surface the flows use.
    def store_server_url(url)
      write_value('server_url', url)
    end
  end

  def setup
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @transport = FakeTransport.new
    @store_path = File.join(Dir.mktmpdir('granete-device-ctx'), 'session.json')
    @provider = HermeticProvider.new(logger: @logger, transport: @transport, store_path: @store_path)
    @provider.stored_secret = 'hermetic-device-secret'
    @provider.store_server_url('http://taller.local:8080/api')
  end

  def teardown
    FileUtils.remove_entry(File.dirname(@store_path)) if File.directory?(File.dirname(@store_path))
  end

  # Go-shaped device token. Unsigned: the provider decodes the payload
  # without verifying (signature validation is the server's authority).
  def token_for(overrides = {})
    payload = {
      'user_id' => 'u-1', 'sub' => 'u-1', 'email' => 'ana@taller.local',
      'role' => 'owner', 'roles' => ['owner'],
      'org_id' => 'org-1', 'membership_id' => 'm-1',
      'membership_credential_version' => 3, 'organization_credential_version' => 7,
      'auth_started_at' => 1_790_000_000, 'sid' => 'sess-1',
      'typ' => 'device_sketchup', 'transport' => 'sketchup', 'client' => 'sketchup',
      'ver' => 5, 'aud' => ['sketchup'], 'iss' => 'granete-test',
      'jti' => 'jti-1', 'nbf' => 1_790_100_000, 'iat' => 1_790_100_000,
      'exp' => Time.now.to_i + 600
    }.merge(overrides)
    encode_jwt(payload)
  end

  def encode_jwt(payload)
    segment = Base64.urlsafe_encode64(JSON.generate(payload), padding: false)
    "header.#{segment}.signature"
  end

  def context_with_token(token)
    @provider.instance_variable_set(:@access_token, token)
    @provider.session_context_id
  end

  # Same session, EVERY renewed claim differs (jti, nbf, iat, exp):
  # a technical refresh keeps the identity.
  def test_technical_refresh_renewing_jti_nbf_iat_exp_keeps_identity
    first = context_with_token(token_for)
    refute_nil first

    refreshed = context_with_token(
      token_for('jti' => 'jti-2', 'nbf' => 1_790_200_000, 'iat' => 1_790_200_000,
                'exp' => Time.now.to_i + 900)
    )

    assert_equal first, refreshed,
                 'renewed mint claims must not change the context identity'
  end

  def test_jti_only_change_keeps_identity
    first = context_with_token(token_for)
    assert_equal first, context_with_token(token_for('jti' => 'another-jti'))
  end

  def test_nbf_only_change_keeps_identity
    first = context_with_token(token_for)
    assert_equal first, context_with_token(token_for('nbf' => 1_790_300_000))
  end

  def test_new_session_changes_identity
    first = context_with_token(token_for)
    renewed = context_with_token(
      token_for('sid' => 'sess-2', 'auth_started_at' => 1_790_500_000)
    )
    refute_nil renewed
    refute_equal first, renewed, 'a different session is a different context'
  end

  def test_new_organization_or_membership_changes_identity
    base = context_with_token(token_for)
    other_org = context_with_token(token_for('org_id' => 'org-2', 'membership_id' => 'm-2'))
    other_epoch = context_with_token(token_for('organization_credential_version' => 8))
    refute_equal base, other_org
    refute_equal base, other_epoch, 'a revocation epoch is an authorization change'
  end

  def test_logout_yields_no_usable_context
    context_with_token(token_for)
    @provider.logout

    assert_nil @provider.session_context_id, 'logout leaves no context identity'
  end

  # Expired token whose refresh FAILS (server error): never a usable
  # context — recovery is the only path back.
  def test_expired_token_without_recovery_is_not_a_context
    @transport.respond_with('/auth/devices/token', 500)
    expired = token_for('exp' => Time.now.to_i - 60)

    assert_nil context_with_token(expired)
  end

  def test_expired_token_recovers_through_the_transport
    recovered = token_for
    @transport.respond_with('/auth/devices/token', 200, 'access_token' => recovered)
    expired = token_for('exp' => Time.now.to_i - 60)

    id = context_with_token(expired)
    refute_nil id, 'a successful refresh restores the context'
    assert_equal context_with_token(recovered), id
  end

  def test_empty_payload_is_not_a_context
    @transport.respond_with('/auth/devices/token', 500)
    assert_nil context_with_token(encode_jwt({}))
  end

  # A decodable payload WITHOUT the essential identity fields (user +
  # transport boundary) is not a valid identity.
  def test_missing_essential_claims_is_not_a_context
    only_expiry = encode_jwt('exp' => Time.now.to_i + 600)
    assert_nil context_with_token(only_expiry)

    no_boundary = encode_jwt('sub' => 'u-1', 'exp' => Time.now.to_i + 600)
    assert_nil context_with_token(no_boundary)

    no_user = encode_jwt('transport' => 'sketchup', 'exp' => Time.now.to_i + 600)
    assert_nil context_with_token(no_user)
  end

  def test_backend_endpoint_is_part_of_the_identity
    first = context_with_token(token_for)
    @provider.store_server_url('http://otro-taller.local:9090/api')
    other = context_with_token(token_for)

    refute_equal first, other, 'the same token against another backend is another context'
  end
end
