# frozen_string_literal: true

require 'net/http' # rubocop:disable SketchupPerformance/OpenSSL
require 'uri'

module Granete
  module SketchUpExtension
    module Assets
      # HardwareAssetDownloader coordinates the authorized retrieval of hardware .skp assets.
      # It requests short-lived signed grants via HardwareAssetGrantManager using the active session token,
      # downloads binary assets using only the signed URL grant (never sending bearer credentials
      # to storage endpoints), validates the exact manifest pins, and caches the result via HardwareAssetCache.
      # Cached assets are served only with an active authorization grant from the server.
      class HardwareAssetDownloader
        attr_reader :cache, :grant_manager, :clock

        MAX_ASSET_BYTES = 50 * 1024 * 1024 # 50 MB max geometry file size

        def initialize(transport:, auth_provider:, cache: nil, logger: nil,
                       http_fetcher: nil, grant_manager: nil, clock: nil)
          @transport = transport
          @auth_provider = auth_provider
          @cache = cache || HardwareAssetCache.new
          @logger = logger
          @clock = clock || (grant_manager.respond_to?(:clock) ? grant_manager.clock : Time)
          @grant_manager = grant_manager || HardwareAssetGrantManager.new(
            transport: transport, logger: logger, clock: @clock
          )
          @http_fetcher = http_fetcher || method(:default_http_fetch)
          @lock_master = Mutex.new
          @key_locks = {}
        end

        def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
          return nil if asset_id.to_s.strip.empty? || revision_id.to_s.strip.empty?

          active_org = current_org_id
          active_auth = current_authorization_header
          return nil if active_org.to_s.strip.empty? || active_auth.to_s.strip.empty?
          return nil if org_id && org_id.to_s.strip != active_org

          key = "#{active_org}/#{asset_id}/#{revision_id}"
          lock_for(key).synchronize do
            resolve_and_fetch_asset(
              asset_id: asset_id, revision_id: revision_id,
              sha256: sha256, expected_bytes: expected_bytes,
              active_org: active_org, active_auth: active_auth
            )
          end
        rescue StandardError => e
          @logger&.error('hardware_asset_download_failed', error: e, asset_id: asset_id, revision_id: revision_id)
          nil
        end

        def clear_grant_cache
          @grant_manager.clear_cache
        end

        private

        def current_time
          @grant_manager.respond_to?(:current_time) ? @grant_manager.current_time : @clock.now
        end

        def grant_valid?(grant)
          return false unless grant.is_a?(Hash)

          @grant_manager.respond_to?(:grant_valid?) ? @grant_manager.grant_valid?(grant) : false
        end

        def current_org_id
          return @auth_provider.current_organization_id if @auth_provider.respond_to?(:current_organization_id)

          nil
        end

        def current_authorization_header
          return nil unless @auth_provider.respond_to?(:authorization_header)

          @auth_provider.authorization_header
        rescue StandardError
          nil
        end

        def lock_for(key)
          @lock_master.synchronize { @key_locks[key] ||= Mutex.new }
        end

        def configured?
          @transport.respond_to?(:configured?) && @transport.configured? &&
            @auth_provider.respond_to?(:configured?) && @auth_provider.configured?
        end

        def context_changed?(active_org, active_auth)
          current_org_id != active_org || current_authorization_header != active_auth
        end

        def resolve_and_fetch_asset(asset_id:, revision_id:, sha256:, expected_bytes:, active_org:, active_auth:)
          return nil if context_changed?(active_org, active_auth)

          grant = @grant_manager.fetch_grant(
            asset_id: asset_id, revision_id: revision_id, auth_header: active_auth, org_id: active_org
          )
          return nil unless grant.is_a?(Hash) && !context_changed?(active_org, active_auth)

          manifest = @grant_manager.validate_and_match(
            grant, caller_sha: sha256, caller_size: expected_bytes, current_time: current_time
          )
          return nil unless manifest

          target_sha = manifest[:sha256]
          target_size = manifest[:size_bytes]

          cached = @cache.get(
            asset_id: asset_id, revision_id: revision_id, sha256: target_sha,
            expected_bytes: target_size, org_id: active_org
          )
          if cached
            return nil if context_changed?(active_org, active_auth)
            return cached if grant_valid?(grant)

            return renew_and_deliver_cached(
              asset_id: asset_id, revision_id: revision_id, target_sha: target_sha,
              target_size: target_size, active_org: active_org, active_auth: active_auth,
              cached_path: cached
            )
          end

          fetch_and_cache_asset(
            asset_id: asset_id, revision_id: revision_id, grant: grant,
            target_sha: target_sha, target_size: target_size,
            active_org: active_org, active_auth: active_auth
          )
        end

        def request_fresh_grant(asset_id, revision_id, target_sha, target_size, active_org, active_auth)
          @grant_manager.invalidate_grant(
            auth_header: active_auth, org_id: active_org, asset_id: asset_id, revision_id: revision_id
          )
          fresh = @grant_manager.fetch_grant(
            asset_id: asset_id, revision_id: revision_id, auth_header: active_auth, org_id: active_org
          )
          return nil unless fresh.is_a?(Hash) && !context_changed?(active_org, active_auth)
          return nil unless @grant_manager.validate_and_match(
            fresh, caller_sha: target_sha, caller_size: target_size, current_time: current_time
          )

          fresh
        end

        def renew_and_deliver_cached(asset_id:, revision_id:, target_sha:, target_size:, active_org:,
                                     active_auth:, cached_path:)
          return nil if context_changed?(active_org, active_auth)

          fresh = request_fresh_grant(asset_id, revision_id, target_sha, target_size, active_org, active_auth)
          return nil unless fresh && grant_valid?(fresh)

          cached_path
        end

        def fetch_and_cache_asset(asset_id:, revision_id:, grant:, target_sha:, target_size:, active_org:, active_auth:)
          url = resolve_grant_url(grant['url'])
          return nil unless url

          status, data = @http_fetcher.call(url)
          current_grant = grant
          if [401, 403].include?(status)
            status, data, current_grant = retry_fetch_on_expired_grant(
              asset_id, revision_id, target_sha, target_size, active_org, active_auth
            )
          end

          return nil unless status == 200 && data && data.bytesize == target_size
          return nil if context_changed?(active_org, active_auth)

          cached_path = @cache.put(
            asset_id: asset_id, revision_id: revision_id, data: data,
            sha256: target_sha, expected_bytes: target_size, org_id: active_org
          )
          return nil unless cached_path
          return nil if context_changed?(active_org, active_auth)
          return cached_path if grant_valid?(current_grant)

          renew_and_deliver_cached(
            asset_id: asset_id, revision_id: revision_id, target_sha: target_sha,
            target_size: target_size, active_org: active_org, active_auth: active_auth,
            cached_path: cached_path
          )
        end

        def retry_fetch_on_expired_grant(asset_id, revision_id, target_sha, target_size, active_org, active_auth)
          fresh = request_fresh_grant(asset_id, revision_id, target_sha, target_size, active_org, active_auth)
          return [0, nil, nil] unless fresh

          url = resolve_grant_url(fresh['url'])
          return [0, nil, nil] unless url

          status, data = @http_fetcher.call(url)
          [status, data, fresh]
        end

        def resolve_grant_url(raw_url)
          return nil if raw_url.to_s.strip.empty?

          if raw_url.start_with?('http://', 'https://')
            raw_url
          else
            clean_path = raw_url.start_with?('/') ? raw_url : "/#{raw_url}"
            "#{media_origin}#{clean_path}"
          end
        end

        def media_origin
          @transport.base_url.to_s.sub(%r{/api\z}, '').sub(%r{/+\z}, '')
        end

        def default_http_fetch(url)
          uri = URI.parse(url)
          http = Net::HTTP.new(uri.host, uri.port)
          http.use_ssl = (uri.scheme == 'https')
          http.open_timeout = 15
          http.read_timeout = 30

          req = Net::HTTP::Get.new(uri.request_uri)
          # Exact contract: NEVER send Authorization header for signed asset files
          # Receives chunks and accumulates body up to MAX_ASSET_BYTES limit (50 MiB)
          data = String.new(encoding: Encoding::BINARY)
          status = 0

          http.request(req) do |res|
            status = res.code.to_i
            return [status, nil] unless status == 200

            res.read_body do |chunk|
              data << chunk
              return [413, nil] if data.bytesize > MAX_ASSET_BYTES
            end
          end

          [status, data]
        rescue StandardError => e
          sanitized_url = sanitize_log_url(uri)
          @logger&.error('hardware_asset_http_fetch_failed', error: e, url: sanitized_url)
          [0, nil]
        end

        def sanitize_log_url(uri)
          return 'url' unless uri.is_a?(URI::Generic)

          "#{uri.scheme}://#{uri.host}:#{uri.port}#{uri.path}"
        rescue StandardError
          'url'
        end
      end
    end
  end
end
