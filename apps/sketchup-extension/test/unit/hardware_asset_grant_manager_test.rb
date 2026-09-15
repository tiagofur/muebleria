# frozen_string_literal: true

require 'digest'
require 'time'
require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_grant_manager'

class HardwareAssetGrantManagerTest < Minitest::Test
  class ControllableClock
    attr_accessor :now

    def initialize(initial_time = Time.at(1_700_000_000))
      @now = initial_time
    end

    def advance(seconds)
      @now += seconds
    end
  end

  class FakeTransport
    attr_reader :requests

    def initialize(responses)
      @responses = responses.dup
      @requests = []
    end

    def request(payload, authorization_header: nil)
      @requests << { 'payload' => payload, 'authorization_header' => authorization_header }
      response = @responses.shift
      response.nil? ? { 'status' => 500, 'body' => {} } : response
    end
  end

  def setup
    @clock = ControllableClock.new(Time.at(1_700_000_000))
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @valid_sha = Digest::SHA256.hexdigest('TEST-DATA')
    @valid_size = 1024
  end

  def test_parse_expiration_returns_nil_when_missing_or_unparseable
    gm = Granete::SketchUpExtension::Assets::HardwareAssetGrantManager.new(
      transport: FakeTransport.new([]), logger: @logger, clock: @clock
    )

    assert_nil gm.parse_expiration({})
    assert_nil gm.parse_expiration({ 'expires_at' => nil })
    assert_nil gm.parse_expiration({ 'expires_at' => '' })
    assert_nil gm.parse_expiration({ 'expires_at' => 'not-a-date' })
    assert_nil gm.parse_expiration({ 'expiresAt' => 'invalid-rfc3339' })
  end

  def test_parse_expiration_parses_canonical_rfc3339_and_camelcase
    gm = Granete::SketchUpExtension::Assets::HardwareAssetGrantManager.new(
      transport: FakeTransport.new([]), logger: @logger, clock: @clock
    )

    t = Time.at(1_700_000_500).utc
    assert_equal 1_700_000_500, gm.parse_expiration({ 'expires_at' => t.iso8601 })
    assert_equal 1_700_000_500, gm.parse_expiration({ 'expiresAt' => t.iso8601 })
  end

  def test_effective_expiration_caps_to_grant_cache_ttl_and_does_not_slide
    gm = Granete::SketchUpExtension::Assets::HardwareAssetGrantManager.new(
      transport: FakeTransport.new([]), logger: @logger, clock: @clock
    )

    # Server gives 3600 seconds (1 hour)
    far_future = (@clock.now + 3600).utc.iso8601
    grant = {
      'representation' => 'skp',
      'sha256' => @valid_sha,
      'size_bytes' => @valid_size,
      'expires_at' => far_future
    }

    # Effective expiration must be capped to clock.now + 300 (GRANT_CACHE_TTL)
    effective = gm.effective_expiration(grant)
    assert_equal 1_700_000_300, effective

    # Advance clock by 100 seconds: effective expiration must NOT slide or extend
    @clock.advance(100)
    grant['_effective_expires_at'] = effective
    assert_equal 1_700_000_300, gm.effective_expiration(grant)
  end

  def test_fetch_grant_rejects_and_does_not_cache_expired_or_missing_expiration
    expired_time = (@clock.now - 30).utc.iso8601
    expired_grant = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => @valid_sha,
        'size_bytes' => @valid_size,
        'url' => '/api/test',
        'expires_at' => expired_time
      }
    }
    transport = FakeTransport.new([expired_grant])
    gm = Granete::SketchUpExtension::Assets::HardwareAssetGrantManager.new(
      transport: transport, logger: @logger, clock: @clock
    )

    result = gm.fetch_grant(
      asset_id: 'a1', revision_id: 'r1', auth_header: 'Bearer tok', org_id: 'org1'
    )
    assert_nil result, 'Expired grant must be rejected by fetch_grant'

    # Same for grant without expires_at
    no_exp_grant = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => @valid_sha,
        'size_bytes' => @valid_size,
        'url' => '/api/test'
      }
    }
    transport2 = FakeTransport.new([no_exp_grant])
    gm2 = Granete::SketchUpExtension::Assets::HardwareAssetGrantManager.new(
      transport: transport2, logger: @logger, clock: @clock
    )

    result2 = gm2.fetch_grant(
      asset_id: 'a1', revision_id: 'r1', auth_header: 'Bearer tok', org_id: 'org1'
    )
    assert_nil result2, 'Grant missing expires_at must be rejected by fetch_grant'
  end

  def test_fetch_grant_caches_valid_grant_and_evicts_when_expired
    valid_exp = (@clock.now + 200).utc.iso8601
    grant_body = {
      'representation' => 'skp',
      'sha256' => @valid_sha,
      'size_bytes' => @valid_size,
      'url' => '/api/test',
      'expires_at' => valid_exp
    }
    transport = FakeTransport.new([{ 'status' => 200, 'body' => grant_body }])
    gm = Granete::SketchUpExtension::Assets::HardwareAssetGrantManager.new(
      transport: transport, logger: @logger, clock: @clock
    )

    # First fetch: hits server
    g1 = gm.fetch_grant(asset_id: 'a1', revision_id: 'r1', auth_header: 'Bearer tok', org_id: 'org1')
    refute_nil g1
    assert_equal 1, transport.requests.length

    # Advance 50 seconds (< 200s): reuses cached grant without server request
    @clock.advance(50)
    g2 = gm.fetch_grant(asset_id: 'a1', revision_id: 'r1', auth_header: 'Bearer tok', org_id: 'org1')
    refute_nil g2
    assert_equal 1, transport.requests.length

    # Advance 160 seconds (total 210s > 200s): cached grant has expired
    @clock.advance(160)
    # Server now returns 401 on refresh
    g3 = gm.fetch_grant(asset_id: 'a1', revision_id: 'r1', auth_header: 'Bearer tok', org_id: 'org1')
    assert_nil g3
    assert_equal 2, transport.requests.length
  end

  def test_validate_and_match_rejects_expired_grant
    gm = Granete::SketchUpExtension::Assets::HardwareAssetGrantManager.new(
      transport: FakeTransport.new([]), logger: @logger, clock: @clock
    )

    # Grant with expires_at in the past
    expired_grant = {
      'representation' => 'skp',
      'sha256' => @valid_sha,
      'size_bytes' => @valid_size,
      'expires_at' => (@clock.now - 10).utc.iso8601
    }
    manifest = gm.validate_and_match(expired_grant, caller_sha: @valid_sha, caller_size: @valid_size)
    assert_nil manifest, 'validate_and_match must reject expired grant'

    # Grant with expires_at in the future
    valid_grant = {
      'representation' => 'skp',
      'sha256' => @valid_sha,
      'size_bytes' => @valid_size,
      'expires_at' => (@clock.now + 100).utc.iso8601
    }
    manifest2 = gm.validate_and_match(valid_grant, caller_sha: @valid_sha, caller_size: @valid_size)
    refute_nil manifest2
    assert_equal @valid_sha, manifest2[:sha256]
    assert_equal @valid_size, manifest2[:size_bytes]
    assert_equal 1_700_000_100, manifest2[:expires_at]
  end
end
