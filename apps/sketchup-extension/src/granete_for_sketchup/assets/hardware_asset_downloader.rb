# frozen_string_literal: true

require 'net/http' # rubocop:disable SketchupPerformance/OpenSSL
require 'uri'

module Granete
  module SketchUpExtension
    module Assets
      # HardwareAssetDownloader coordinates the authorized retrieval of hardware .skp assets.
      # It requests short-lived signed grants via the Granete API using the session token,
      # downloads the binary asset using only the signed URL grant (never sending bearer credentials
      # to storage endpoints), verifies sha256/size, and caches the result via HardwareAssetCache.
      class HardwareAssetDownloader
        attr_reader :cache

        MAX_ASSET_BYTES = 50 * 1024 * 1024 # 50 MB max geometry file size

        def initialize(transport:, auth_provider:, cache: nil, logger: nil, http_fetcher: nil)
          @transport = transport
          @auth_provider = auth_provider
          @cache = cache || HardwareAssetCache.new
          @logger = logger
          @http_fetcher = http_fetcher || method(:default_http_fetch)
          @lock_master = Mutex.new
          @key_locks = {}
        end

        def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
          return nil if asset_id.to_s.strip.empty? || revision_id.to_s.strip.empty?

          effective_org = org_id || current_org_id
          return nil if effective_org.to_s.strip.empty?

          cached = @cache.get(
            asset_id: asset_id, revision_id: revision_id, sha256: sha256,
            expected_bytes: expected_bytes, org_id: effective_org
          )
          return cached if cached

          key = "#{effective_org}/#{asset_id}/#{revision_id}"
          lock_for(key).synchronize do
            cached = @cache.get(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              expected_bytes: expected_bytes, org_id: effective_org
            )
            return cached if cached

            perform_download(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              expected_bytes: expected_bytes, org_id: effective_org
            )
          end
        rescue StandardError => e
          @logger&.error('hardware_asset_download_failed', error: e, asset_id: asset_id, revision_id: revision_id)
          nil
        end

        private

        def current_org_id
          return @auth_provider.current_organization_id if @auth_provider.respond_to?(:current_organization_id)

          nil
        end

        def lock_for(key)
          @lock_master.synchronize { @key_locks[key] ||= Mutex.new }
        end

        def configured?
          @transport.respond_to?(:configured?) && @transport.configured? &&
            @auth_provider.respond_to?(:configured?) && @auth_provider.configured?
        end

        def media_origin
          @transport.base_url.to_s.sub(%r{/api\z}, '').sub(%r{/+\z}, '')
        end

        def authorize_revision(asset_id, revision_id)
          return nil unless configured?

          path = "/hardware-assets/#{asset_id}/revisions/#{revision_id}:authorize"
          response = @transport.request(
            { 'method' => 'POST', 'path' => path, 'body' => {} },
            authorization_header: @auth_provider.authorization_header
          )

          return nil unless response['status'] == 200

          response['body']
        rescue StandardError => e
          @logger&.error('hardware_asset_authorize_failed', error: e, asset_id: asset_id, revision_id: revision_id)
          nil
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

        def perform_download(asset_id:, revision_id:, sha256:, expected_bytes:, org_id:)
          attempts = 0
          max_attempts = 2

          while attempts < max_attempts
            attempts += 1
            grant = authorize_revision(asset_id, revision_id)
            return nil unless grant.is_a?(Hash)

            if grant['representation'] && grant['representation'].to_s.downcase != 'skp'
              @logger&.warn('hardware_asset_invalid_representation', representation: grant['representation'])
              return nil
            end

            raw_url = grant['url']
            url = resolve_grant_url(raw_url)
            return nil unless url

            grant_sha = grant['sha256'] || sha256
            grant_size = grant['size_bytes'] || grant['sizeBytes'] || expected_bytes

            status, data = @http_fetcher.call(url)
            if status == 200 && data && !data.empty?
              return @cache.put(
                asset_id: asset_id, revision_id: revision_id, data: data,
                sha256: grant_sha, expected_bytes: grant_size, org_id: org_id
              )
            end

            next if [401, 403].include?(status) && attempts < max_attempts

            return nil
          end

          nil
        end

        def default_http_fetch(url)
          uri = URI.parse(url)
          http = Net::HTTP.new(uri.host, uri.port)
          http.use_ssl = (uri.scheme == 'https')
          http.open_timeout = 15
          http.read_timeout = 30

          req = Net::HTTP::Get.new(uri.request_uri)
          # Exact contract: NEVER send Authorization header for signed asset files
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
