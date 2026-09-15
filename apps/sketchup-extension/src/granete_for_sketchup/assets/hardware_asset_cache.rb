# frozen_string_literal: true

require 'digest'
require 'fileutils'

module Granete
  module SketchUpExtension
    module Assets
      # HardwareAssetCache provides an isolated, disk-backed cache for downloaded
      # hardware .skp files organized strictly by organization, asset ID, revision, and sha256 digest.
      # Cached files are verified against exact size and sha256 before being returned.
      # All path segments are strictly validated to prevent path traversal attacks, and
      # un-scoped or foreign access fails closed.
      class HardwareAssetCache
        attr_reader :cache_dir

        VALID_SEGMENT = /\A[a-zA-Z0-9_-]+\z/
        VALID_SHA = /\A[a-fA-F0-9]{64}\z/

        def initialize(cache_dir: nil)
          @cache_dir = File.expand_path(cache_dir || default_cache_dir)
          FileUtils.mkdir_p(@cache_dir) unless File.directory?(@cache_dir)
        end

        def path_for(asset_id:, revision_id:, sha256: nil, org_id: nil)
          return nil unless valid_segment?(org_id)
          return nil unless valid_segment?(asset_id)
          return nil unless valid_segment?(revision_id)

          clean_sha = sanitize_sha(sha256)
          return nil unless clean_sha

          filename = "#{clean_sha}.skp"
          target = File.expand_path(
            File.join(@cache_dir, org_id.to_s.strip, asset_id.to_s.strip, revision_id.to_s.strip, filename)
          )
          return nil unless target.start_with?("#{@cache_dir}#{File::SEPARATOR}")

          target
        end

        def get(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
          path = path_for(asset_id: asset_id, revision_id: revision_id, sha256: sha256, org_id: org_id)
          return nil unless path && File.file?(path)
          return nil unless verify_integrity?(path, sha256: sha256, expected_bytes: expected_bytes)

          path
        rescue StandardError
          nil
        end

        def put(asset_id:, revision_id:, data: nil, source_path: nil, sha256: nil, expected_bytes: nil, org_id: nil)
          target_path = path_for(asset_id: asset_id, revision_id: revision_id, sha256: sha256, org_id: org_id)
          return nil unless target_path

          dir = File.dirname(target_path)
          FileUtils.mkdir_p(dir) unless File.directory?(dir)

          tmp_path = "#{target_path}.tmp.#{Process.pid}.#{rand(100_000)}"
          return nil unless write_content?(tmp_path, data: data, source_path: source_path)
          return nil unless verify_integrity?(tmp_path, sha256: sha256, expected_bytes: expected_bytes)

          File.rename(tmp_path, target_path)
          target_path
        rescue StandardError
          FileUtils.rm_f(tmp_path) if tmp_path && File.exist?(tmp_path)
          nil
        end

        def clear_revision(asset_id:, revision_id:, org_id: nil)
          return unless valid_segment?(org_id) && valid_segment?(asset_id) && valid_segment?(revision_id)

          revision_dir = File.expand_path(
            File.join(@cache_dir, org_id.to_s.strip, asset_id.to_s.strip, revision_id.to_s.strip)
          )
          return unless revision_dir.start_with?("#{@cache_dir}#{File::SEPARATOR}")

          FileUtils.rm_rf(revision_dir) if File.directory?(revision_dir)
        end

        private

        def write_content?(dest_path, data:, source_path:)
          if data
            File.binwrite(dest_path, data)
            true
          elsif source_path && File.file?(source_path)
            FileUtils.cp(source_path, dest_path)
            true
          else
            false
          end
        end

        def verify_integrity?(file_path, sha256:, expected_bytes:)
          unless expected_bytes.is_a?(Numeric) && expected_bytes.positive? &&
                 File.size(file_path) == expected_bytes.to_i
            FileUtils.rm_f(file_path)
            return false
          end

          expected_hex = sanitize_sha(sha256)
          unless expected_hex
            FileUtils.rm_f(file_path)
            return false
          end

          computed_sha = Digest::SHA256.file(file_path).hexdigest
          if computed_sha.downcase != expected_hex.downcase
            FileUtils.rm_f(file_path)
            return false
          end

          true
        end

        def valid_segment?(segment)
          str = segment.to_s.strip
          !str.empty? && VALID_SEGMENT.match?(str)
        end

        def sanitize_sha(sha)
          return nil if sha.nil?

          hex = sha.to_s.strip.sub(/\Asha256-/, '')
          return nil unless VALID_SHA.match?(hex)

          hex.downcase
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
