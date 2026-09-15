# frozen_string_literal: true

require 'time'

module Granete
  module SketchUpExtension
    module Assets
      # HardwareAssetGrantManager requests, validates, and caches short-lived
      # download grants for hardware asset revisions. It enforces representation 'skp',
      # exact SHA-256 digests, and positive byte sizes within explicit limits.
      class HardwareAssetGrantManager
        attr_reader :clock

        GRANT_CACHE_TTL = 300 # 5 minutes max in-memory grant validity
        MAX_ASSET_BYTES = 50 * 1024 * 1024 # 50 MB max geometry file size
        VALID_SHA = /\A[a-fA-F0-9]{64}\z/

        def initialize(transport:, logger: nil, clock: Time)
          @transport = transport
          @logger = logger
          @clock = clock
          @grant_cache = {}
          @grant_cache_mutex = Mutex.new
        end

        def current_time
          @clock.now
        end

        def fetch_grant(asset_id:, revision_id:, auth_header:, org_id:)
          cached_grant = get_cached_grant(auth_header, org_id, asset_id, revision_id)
          return cached_grant if cached_grant && grant_valid?(cached_grant)

          grant = request_authorization(asset_id, revision_id, auth_header)
          return nil unless grant.is_a?(Hash)
          return nil unless grant_valid?(grant)

          effective_exp = effective_expiration(grant)
          grant['_effective_expires_at'] = effective_exp
          put_cached_grant(auth_header, org_id, asset_id, revision_id, grant, effective_exp)
          grant
        end

        def invalidate_grant(auth_header:, org_id:, asset_id:, revision_id:)
          key = cache_key(auth_header, org_id, asset_id, revision_id)
          @grant_cache_mutex.synchronize { @grant_cache.delete(key) }
        end

        def clear_cache
          @grant_cache_mutex.synchronize { @grant_cache.clear }
        end

        def grant_valid?(grant, current_time: nil)
          return false unless grant.is_a?(Hash)

          now_sec = (current_time || self.current_time).to_i
          exp = effective_expiration(grant, current_time: now_sec)
          return false if exp.nil?

          exp > now_sec
        end

        def effective_expiration(grant, current_time: nil)
          return nil unless grant.is_a?(Hash)
          return grant['_effective_expires_at'].to_i if grant['_effective_expires_at'].is_a?(Numeric)

          server_exp = parse_expiration(grant)
          return nil if server_exp.nil?

          now_sec = (current_time || self.current_time).to_i
          [server_exp, now_sec + GRANT_CACHE_TTL].min
        end

        def parse_expiration(grant)
          return nil unless grant.is_a?(Hash)

          raw = grant['expires_at'] || grant['expiresAt']
          return nil if raw.nil? || raw.to_s.strip.empty?

          if raw.is_a?(Numeric)
            raw.to_i
          else
            Time.parse(raw.to_s).to_i
          end
        rescue StandardError
          nil
        end

        def validate_and_match(grant, caller_sha:, caller_size:, current_time: nil)
          return nil unless grant.is_a?(Hash)
          return nil unless grant_valid?(grant, current_time: current_time)

          rep = grant['representation'].to_s.strip.downcase
          return nil unless rep == 'skp'

          grant_sha = sanitize_sha(grant['sha256'])
          return nil unless grant_sha

          raw_size = grant['size_bytes'] || grant['sizeBytes']
          return nil unless raw_size.is_a?(Numeric) && raw_size.positive? && raw_size <= MAX_ASSET_BYTES

          grant_size = raw_size.to_i
          return nil unless match_pins?(grant_sha, grant_size, caller_sha, caller_size)

          {
            sha256: grant_sha,
            size_bytes: grant_size,
            expires_at: effective_expiration(grant, current_time: current_time)
          }
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
          now_sec = current_time.to_i
          @grant_cache_mutex.synchronize do
            entry = @grant_cache[key]
            if entry && entry[:expires_at] > now_sec
              entry[:grant]
            else
              @grant_cache.delete(key)
              nil
            end
          end
        end

        def put_cached_grant(auth, org, asset_id, revision_id, grant, expires_at)
          key = cache_key(auth, org, asset_id, revision_id)
          @grant_cache_mutex.synchronize do
            @grant_cache[key] = { grant: grant, expires_at: expires_at }
          end
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
