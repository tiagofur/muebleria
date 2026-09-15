# frozen_string_literal: true

require 'digest'
require 'tmpdir'
require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_downloader'

class HardwareAssetDownloaderTest < Minitest::Test
  class FakeTransport
    attr_reader :requests

    def initialize(responses)
      @responses = responses.dup
      @requests = []
    end

    def configured?
      true
    end

    def base_url
      'http://taller.local:8080/api'
    end

    def request(payload, authorization_header: nil)
      @requests << { 'payload' => payload, 'authorization_header' => authorization_header }
      response = @responses.shift
      response.nil? ? { 'status' => 500, 'body' => {} } : response
    end
  end

  class FakeAuth
    attr_accessor :current_organization_id, :authorization_header_value

    def initialize(org_id: 'org-test', auth_header: 'Bearer session-jwt-test')
      @current_organization_id = org_id
      @authorization_header_value = auth_header
    end

    def configured?
      !@current_organization_id.nil? && !@authorization_header_value.nil?
    end

    def authorization_header
      @authorization_header_value
    end

    def logout
      @current_organization_id = nil
      @authorization_header_value = nil
    end
  end

  def setup
    @tmp_dir = Dir.mktmpdir('hw_downloader_test')
    @cache = Granete::SketchUpExtension::Assets::HardwareAssetCache.new(cache_dir: @tmp_dir)
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model_data = "FAKE SKP MODEL DATA #{rand(1000)}"
    @model_sha = Digest::SHA256.hexdigest(@model_data)
    @model_size = @model_data.bytesize
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
  end

  def test_reuses_cached_file_with_valid_authorization_without_byte_download
    # Seed cache
    cached_path = @cache.put(
      asset_id: 'ast-1',
      revision_id: 'rev-1',
      data: @model_data,
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )

    grant_response = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => @model_sha,
        'size_bytes' => @model_size,
        'url' => '/api/hardware-assets/files/storage-key?grant=signed-grant-token',
        'expiresAt' => (Time.now + 300).utc.iso8601
      }
    }
    transport = FakeTransport.new([grant_response])
    http_called = false
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: @logger,
      http_fetcher: lambda do |_url|
        http_called = true
        [200, @model_data]
      end
    )

    path = downloader.download_asset(
      asset_id: 'ast-1',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )

    assert_equal cached_path, path
    assert_equal 1, transport.requests.length
    refute http_called

    # Repetition: in-memory grant cache reuses authorization without new HTTP request
    second_path = downloader.download_asset(
      asset_id: 'ast-1',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )
    assert_equal cached_path, second_path
    assert_equal 1, transport.requests.length
    refute http_called
  end

  def test_retries_with_fresh_grant_when_download_returns_unauthorized
    initial_grant = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'url' => '/api/hardware-assets/files/key?grant=expired-grant',
        'sha256' => @model_sha,
        'sizeBytes' => @model_size
      }
    }
    fresh_grant = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'url' => '/api/hardware-assets/files/key?grant=fresh-grant',
        'sha256' => @model_sha,
        'sizeBytes' => @model_size
      }
    }
    transport = FakeTransport.new([initial_grant, fresh_grant])

    fetch_attempts = 0
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: @logger,
      http_fetcher: lambda do |url|
        fetch_attempts += 1
        if url.include?('expired-grant')
          [401, 'Unauthorized']
        else
          [200, @model_data]
        end
      end
    )

    path = downloader.download_asset(
      asset_id: 'ast-1',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )

    refute_nil path
    assert_equal 2, transport.requests.length
    assert_equal 2, fetch_attempts
  end

  def test_handles_terminal_error_gracefully
    transport = FakeTransport.new([{ 'status' => 404, 'body' => { 'error' => 'not found' } }])
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: @logger
    )

    path = downloader.download_asset(
      asset_id: 'ast-missing',
      revision_id: 'rev-missing',
      sha256: @model_sha,
      expected_bytes: @model_size
    )

    assert_nil path
  end

  def test_authorizes_and_downloads_with_snake_case_size_bytes
    grant_response = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => @model_sha,
        'size_bytes' => @model_size,
        'url' => '/api/hardware-assets/files/storage-key?grant=signed-grant-token'
      }
    }
    transport = FakeTransport.new([grant_response])
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: @logger,
      http_fetcher: lambda do |_url|
        [200, @model_data]
      end
    )

    path = downloader.download_asset(
      asset_id: 'ast-snake',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size
    )

    refute_nil path
    assert File.file?(path)
    assert_equal @model_data, File.binread(path)
  end

  def test_rejects_non_skp_representation
    grant_response = {
      'status' => 200,
      'body' => {
        'representation' => 'obj',
        'sha256' => @model_sha,
        'size_bytes' => @model_size,
        'url' => '/api/hardware-assets/files/storage-key?grant=signed-grant-token'
      }
    }
    transport = FakeTransport.new([grant_response])
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: @logger,
      http_fetcher: lambda do |_url|
        [200, @model_data]
      end
    )

    path = downloader.download_asset(
      asset_id: 'ast-obj',
      revision_id: 'rev-1',
      sha256: @model_sha
    )

    assert_nil path
  end

  def test_fails_closed_when_no_organization_available
    auth = FakeAuth.new(org_id: nil)
    auth.current_organization_id = nil
    transport = FakeTransport.new([])
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: auth,
      cache: @cache,
      logger: @logger
    )

    path = downloader.download_asset(
      asset_id: 'ast-no-org',
      revision_id: 'rev-1',
      sha256: @model_sha,
      org_id: nil
    )

    assert_nil path
    assert_empty transport.requests
  end

  def test_default_http_fetch_redacts_signed_grant_query_in_error_logs
    log_sink = StringIO.new
    logger = Granete::SketchUpExtension::SafeLogger.new(sink: log_sink)
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: FakeTransport.new([]),
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: logger
    )

    # Calling default_http_fetch on an invalid port/host will raise and trigger log error
    downloader.send(:default_http_fetch, 'http://127.0.0.1:1/file.skp?grant=SECRET_TOKEN_VALUE')
    log_output = log_sink.string

    refute_includes log_output, 'SECRET_TOKEN_VALUE'
    refute_includes log_output, 'grant='
  end

  def test_rejects_cross_tenant_cache_access_when_caller_org_differs_from_session
    @cache.put(
      asset_id: 'ast-cross',
      revision_id: 'rev-1',
      data: @model_data,
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-a'
    )

    transport = FakeTransport.new([])
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new(org_id: 'org-b'),
      cache: @cache,
      logger: @logger
    )

    path = downloader.download_asset(
      asset_id: 'ast-cross',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-a'
    )

    assert_nil path
    assert_empty transport.requests
  end

  def test_refuses_cached_file_when_session_expired_or_revoked
    @cache.put(
      asset_id: 'ast-revoked',
      revision_id: 'rev-1',
      data: @model_data,
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )

    revoked_response = { 'status' => 401, 'body' => { 'error' => 'session_revoked' } }
    transport = FakeTransport.new([revoked_response])
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new(org_id: 'org-test'),
      cache: @cache,
      logger: @logger
    )

    path = downloader.download_asset(
      asset_id: 'ast-revoked',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )

    assert_nil path
    assert_equal 1, transport.requests.length
  end

  def test_refuses_to_deliver_asset_if_session_logs_out_during_operation
    grant_response = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => @model_sha,
        'size_bytes' => @model_size,
        'url' => '/api/hardware-assets/files/storage-key?grant=signed-grant-token'
      }
    }
    transport = FakeTransport.new([grant_response])
    auth = FakeAuth.new(org_id: 'org-test')
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: auth,
      cache: @cache,
      logger: @logger,
      http_fetcher: lambda do |_url|
        auth.logout
        [200, @model_data]
      end
    )

    path = downloader.download_asset(
      asset_id: 'ast-logout',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )

    assert_nil path
  end

  def test_rejects_when_grant_sha_differs_from_caller_sha_pin
    caller_sha = Digest::SHA256.hexdigest('CALLER EXPECTED DATA')
    grant_sha = Digest::SHA256.hexdigest('GRANT OTHER DATA')
    grant_response = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => grant_sha,
        'size_bytes' => 100,
        'url' => '/api/hardware-assets/files/key?grant=token'
      }
    }
    transport = FakeTransport.new([grant_response])
    http_called = false
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: @logger,
      http_fetcher: lambda do |_url|
        http_called = true
        [200, 'GRANT OTHER DATA']
      end
    )

    path = downloader.download_asset(
      asset_id: 'ast-mismatch',
      revision_id: 'rev-1',
      sha256: caller_sha,
      expected_bytes: 100,
      org_id: 'org-test'
    )

    assert_nil path
    refute http_called
  end

  def test_rejects_when_grant_size_differs_from_caller_size_pin
    grant_response = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => @model_sha,
        'size_bytes' => @model_size + 50,
        'url' => '/api/hardware-assets/files/key?grant=token'
      }
    }
    transport = FakeTransport.new([grant_response])
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: @logger
    )

    path = downloader.download_asset(
      asset_id: 'ast-size-mismatch',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )

    assert_nil path
  end

  def test_rejects_grant_missing_mandatory_representation_or_digest_or_size
    invalid_grants = [
      { 'sha256' => @model_sha, 'size_bytes' => 100, 'url' => '/k' },
      { 'representation' => 'glb', 'sha256' => @model_sha, 'size_bytes' => 100, 'url' => '/k' },
      { 'representation' => 'skp', 'size_bytes' => 100, 'url' => '/k' },
      { 'representation' => 'skp', 'sha256' => 'invalid_short_sha', 'size_bytes' => 100, 'url' => '/k' },
      { 'representation' => 'skp', 'sha256' => @model_sha, 'url' => '/k' },
      { 'representation' => 'skp', 'sha256' => @model_sha, 'size_bytes' => 0, 'url' => '/k' },
      { 'representation' => 'skp', 'sha256' => @model_sha, 'size_bytes' => 60 * 1024 * 1024, 'url' => '/k' }
    ]

    invalid_grants.each_with_index do |bad_grant, idx|
      transport = FakeTransport.new([{ 'status' => 200, 'body' => bad_grant }])
      downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
        transport: transport,
        auth_provider: FakeAuth.new,
        cache: @cache,
        logger: @logger
      )

      path = downloader.download_asset(
        asset_id: "ast-bad-#{idx}",
        revision_id: 'rev-1'
      )
      assert_nil path, "Expected rejection for grant case #{idx}: #{bad_grant.inspect}"
    end
  end

  def test_rejects_corrupt_downloaded_bytes_and_cleans_temporary_file
    grant_response = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => @model_sha,
        'size_bytes' => @model_size,
        'url' => '/api/hardware-assets/files/storage-key?grant=signed-grant-token'
      }
    }
    transport = FakeTransport.new([grant_response])
    downloader = Granete::SketchUpExtension::Assets::HardwareAssetDownloader.new(
      transport: transport,
      auth_provider: FakeAuth.new,
      cache: @cache,
      logger: @logger,
      http_fetcher: lambda do |_url|
        [200, 'CORRUPTED BYTES']
      end
    )

    path = downloader.download_asset(
      asset_id: 'ast-corrupt',
      revision_id: 'rev-1',
      sha256: @model_sha,
      expected_bytes: @model_size,
      org_id: 'org-test'
    )

    assert_nil path
    expected_cache_file = @cache.path_for(
      asset_id: 'ast-corrupt', revision_id: 'rev-1', sha256: @model_sha, org_id: 'org-test'
    )
    refute File.exist?(expected_cache_file)
    temp_files = Dir.glob(File.join(@tmp_dir, '**', '*.tmp.*'))
    assert_empty temp_files
  end
end
