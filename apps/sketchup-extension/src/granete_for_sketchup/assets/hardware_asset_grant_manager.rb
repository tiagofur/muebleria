# frozen_string_literal: true

require 'time'

module Granete
  module SketchUpExtension
    module Assets
      # HardwareAssetGrantManager requests, validates, and caches short-lived
      # download grants for hardware asset revisions. It enforces representation 'skp',
      # exact SHA-256 digests, and positive byte sizes within explicit limits.
      class HardwareAssetGrantManager
        GRANT_CACHE_TTL = 300 # 5 minutes max in-memory grant validity
        MAX_ASSET_BYTES = 50 * 1024 * 1024 # 50 MB max geometry file size
        VALID_SHA = /\A[a-fA-F0-9]{64}\z/

        def initialize(transport:, logger: nil)
          @transport = transport
          @logger = logger
          @grant_cache = {}
          @grant_cache_mutex = Mutex.new
        end

        def fetch_grant(asset_id:, revision_id:, auth_header:, org_id:)
          cached_grant = get_cached_grant(auth_header, org_id, asset_id, revision_id)
          return cached_grant if cached_grant

          grant = request_authorization(asset_id, revision_id, auth_header)
          put_cached_grant(auth_header, org_id, asset_id, revision_id, grant) if grant
          grant
        end

        def invalidate_grant(auth_header:, org_id:, asset_id:, revision_id:)
          key = cache_key(auth_header, org_id, asset_id, revision_id)
          @grant_cache_mutex.synchronize { @grant_cache.delete(key) }
        end

        def clear_cache
          @grant_cache_mutex.synchronize { @grant_cache.clear }
        end

        def validate_and_match(grant, caller_sha:, caller_size:)
          return nil unless grant.is_a?(Hash)

          rep = grant['representation'].to_s.strip.downcase
          return nil unless rep == 'skp'

          grant_sha = sanitize_sha(grant['sha256'])
          return nil unless grant_sha

          raw_size = grant['size_bytes'] || grant['sizeBytes']
          return nil unless raw_size.is_a?(Numeric) && raw_size.positive? && raw_size <= MAX_ASSET_BYTES

          grant_size = raw_size.to_i
          return nil unless match_pins?(grant_sha, grant_size, caller_sha, caller_size)

          { sha256: grant_sha, size_bytes: grant_size }
        end

        def sanitize_sha(sha)
          return nil if sha.nil?

          hex = sha.to_s.strip.sub(/\Asha256-/, '')
          return nil unless VALID_SHA.match?(hex)

          hex.downcase
        end

        private

        def cache_key(auth, org, asset_id, revision_id)
          "#{auth}/#{org}/#{asset_id}/#{revision_id}"
        end

        def get_cached_grant(auth, org, asset_id, revision_id)
          key = cache_key(auth, org, asset_id, revision_id)
          @grant_cache_mutex.synchronize do
            entry = @grant_cache[key]
            if entry && entry[:expires_at] > Time.now.to_i
              entry[:grant]
            else
              @grant_cache.delete(key)
              nil
            end
          end
        end

        def put_cached_grant(auth, org, asset_id, revision_id, grant)
          key = cache_key(auth, org, asset_id, revision_id)
          exp_sec = parse_expiration(grant)
          @grant_cache_mutex.synchronize do
            @grant_cache[key] = { grant: grant, expires_at: exp_sec }
          end
        end

        def parse_expiration(grant)
          raw = grant['expiresAt'] || grant['expires_at']
          if raw
            Time.parse(raw.to_s).to_i
          else
            Time.now.to_i + GRANT_CACHE_TTL
          end
        rescue StandardError
          Time.now.to_i + GRANT_CACHE_TTL
        end

        def request_authorization(asset_id, revision_id, auth_header)
          path = "/hardware-assets/#{asset_id}/revisions/#{revision_id}:authorize"
          response = @transport.request(
            { 'method' => 'POST', 'path' => path, 'body' => {} },
            authorization_header: auth_header
          )

          return nil unless response['status'] == 200

          response['body']
        rescue StandardError => e
          @logger&.error('hardware_asset_authorize_failed', error: e, asset_id: asset_id, revision_id: revision_id)
          nil
        end

        def match_pins?(grant_sha, grant_size, caller_sha, caller_size)
          if caller_sha && !caller_sha.to_s.strip.empty?
            norm = sanitize_sha(caller_sha)
            if norm.nil? || norm != grant_sha
              @logger&.error('hardware_asset_sha_mismatch', caller_sha: norm, grant_sha: grant_sha)
              return false
            end
          end

          if caller_size.is_a?(Numeric) && caller_size.positive? && caller_size.to_i != grant_size
            @logger&.error('hardware_asset_size_mismatch', caller_size: caller_size, grant_size: grant_size)
            return false
          end

          true
        end
      end
    end
  end
end
