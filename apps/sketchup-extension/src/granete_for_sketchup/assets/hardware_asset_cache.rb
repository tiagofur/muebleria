# frozen_string_literal: true

require 'digest'
require 'fileutils'

module Granete
  module SketchUpExtension
    module Assets
      # HardwareAssetCache provides an isolated, disk-backed cache for downloaded
      # hardware .skp files organized by organization, asset ID, revision, and sha256 digest.
      # Cached files are verified against exact size and sha256 before being returned.
      class HardwareAssetCache
        attr_reader :cache_dir

        def initialize(cache_dir: nil)
          @cache_dir = cache_dir || default_cache_dir
          FileUtils.mkdir_p(@cache_dir) unless File.directory?(@cache_dir)
        end

        def path_for(asset_id:, revision_id:, sha256: nil, org_id: nil)
          org_segment = org_id.to_s.strip.empty? ? '_shared' : org_id.to_s.strip
          asset_segment = asset_id.to_s.strip
          revision_segment = revision_id.to_s.strip
          filename = sha256.to_s.strip.empty? ? 'asset.skp' : "#{sanitize_sha(sha256)}.skp"

          File.join(@cache_dir, org_segment, asset_segment, revision_segment, filename)
        end

        def get(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
          path = path_for(asset_id: asset_id, revision_id: revision_id, sha256: sha256, org_id: org_id)
          return nil unless File.file?(path)

          if expected_bytes.is_a?(Numeric) && expected_bytes.positive? && File.size(path) != expected_bytes.to_i
            FileUtils.rm_f(path)
            return nil
          end

          if sha256 && !sha256.to_s.strip.empty?
            computed_sha = Digest::SHA256.file(path).hexdigest
            expected_hex = sanitize_sha(sha256)
            if computed_sha.downcase != expected_hex.downcase
              FileUtils.rm_f(path)
              return nil
            end
          end

          path
        rescue StandardError
          nil
        end

        def put(asset_id:, revision_id:, data: nil, source_path: nil, sha256: nil, expected_bytes: nil, org_id: nil)
          target_path = path_for(asset_id: asset_id, revision_id: revision_id, sha256: sha256, org_id: org_id)
          dir = File.dirname(target_path)
          FileUtils.mkdir_p(dir) unless File.directory?(dir)

          tmp_path = "#{target_path}.tmp.#{Process.pid}.#{rand(100_000)}"
          if data
            File.binwrite(tmp_path, data)
          elsif source_path && File.file?(source_path)
            FileUtils.cp(source_path, tmp_path)
          else
            return nil
          end

          if expected_bytes.is_a?(Numeric) && expected_bytes.positive? && File.size(tmp_path) != expected_bytes.to_i
            FileUtils.rm_f(tmp_path)
            return nil
          end

          if sha256 && !sha256.to_s.strip.empty?
            computed_sha = Digest::SHA256.file(tmp_path).hexdigest
            expected_hex = sanitize_sha(sha256)
            if computed_sha.downcase != expected_hex.downcase
              FileUtils.rm_f(tmp_path)
              return nil
            end
          end

          File.rename(tmp_path, target_path)
          target_path
        rescue StandardError
          FileUtils.rm_f(tmp_path) if tmp_path && File.exist?(tmp_path)
          nil
        end

        def clear_revision(asset_id:, revision_id:, org_id: nil)
          org_segment = org_id.to_s.strip.empty? ? '_shared' : org_id.to_s.strip
          revision_dir = File.join(@cache_dir, org_segment, asset_id.to_s.strip, revision_id.to_s.strip)
          FileUtils.rm_rf(revision_dir) if File.directory?(revision_dir)
        end

        private

        def sanitize_sha(sha)
          sha.to_s.strip.sub(/\Asha256-/, '')
        end

        def default_cache_dir
          base = if defined?(::Sketchup) && ::Sketchup.respond_to?(:temp_dir)
                   ::Sketchup.temp_dir
                 else
                   ENV['TMPDIR'] || '/tmp'
                 end
          File.join(base, 'granete_hardware_cache')
        end
      end
    end
  end
end
