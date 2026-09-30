# frozen_string_literal: true

require 'digest'
require 'fileutils'
require 'json'
require 'time'
require_relative '../paths'

module Granete
  module SketchUpExtension
    module Library
      class IntegrityError < StandardError; end
      class StoreError < StandardError; end

      # LibraryStore provides content-addressed, verified, disk-backed storage for
      # immutable manufacturing library manifests and JSON definition blobs.
      #
      # Layout:
      #   LibraryStore/
      #     manifests/
      #       <release-id>/manifest.json
      #     objects/
      #       sha256/
      #         ab/<full-hash>.json
      #     current/
      #       <org-id>.json
      class LibraryStore
        HEX_REGEX = /\A[a-fA-F0-9]{64}\z/
        UUID_REGEX = /\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z/

        attr_reader :store_dir

        def initialize(store_dir: nil)
          @store_dir = File.expand_path(store_dir || GranetePaths.library_store)
          ensure_directories!
        end

        # ─── Content Objects (Blobs) ──────────────────────────────────────────

        def object_path(sha256)
          hex = clean_sha(sha256)
          return nil unless hex

          prefix = hex[0..1]
          File.join(@store_dir, 'objects', 'sha256', prefix, "#{hex}.json")
        end

        def object_exist?(sha256)
          path = object_path(sha256)
          path && File.file?(path) && File.size(path).positive?
        end

        def read_object(sha256)
          path = object_path(sha256)
          return nil unless path && File.file?(path)

          File.read(path)
        rescue StandardError
          nil
        end

        def write_object(sha256, raw_bytes)
          expected_hex = clean_sha(sha256)
          raise IntegrityError, "invalid sha256 format: #{sha256}" unless expected_hex

          computed_hex = Digest::SHA256.hexdigest(raw_bytes).downcase
          if computed_hex != expected_hex
            raise IntegrityError, "content sha256 mismatch: expected #{expected_hex}, got #{computed_hex}"
          end

          target_path = object_path(expected_hex)
          return target_path if File.file?(target_path)

          FileUtils.mkdir_p(File.dirname(target_path))
          atomic_write(target_path, raw_bytes)
          target_path
        end

        # ─── Manifests ────────────────────────────────────────────────────────

        def manifest_path(release_id)
          rel_id = release_id.to_s.strip
          return nil unless UUID_REGEX.match?(rel_id)

          File.join(@store_dir, 'manifests', rel_id, 'manifest.json')
        end

        def manifest_exist?(release_id)
          path = manifest_path(release_id)
          path && File.file?(path) && File.size(path).positive?
        end

        def read_manifest(release_id)
          path = manifest_path(release_id)
          return nil unless path && File.file?(path)

          raw = File.read(path)
          JSON.parse(raw)
        rescue StandardError
          nil
        end

        def write_manifest(release_id, raw_bytes, expected_manifest_hash: nil)
          rel_id = release_id.to_s.strip
          raise StoreError, "invalid release_id: #{release_id}" unless UUID_REGEX.match?(rel_id)

          if expected_manifest_hash
            expected_hex = clean_sha(expected_manifest_hash)
            raise IntegrityError, "invalid expected_manifest_hash format: #{expected_manifest_hash}" unless expected_hex

            computed_hex = Digest::SHA256.hexdigest(raw_bytes).downcase
            if computed_hex != expected_hex
              raise IntegrityError, "manifest hash mismatch: expected #{expected_hex}, got #{computed_hex}"
            end
          end

          target_path = manifest_path(rel_id)
          FileUtils.mkdir_p(File.dirname(target_path))
          atomic_write(target_path, raw_bytes)
          target_path
        end

        # ─── Current Organization Pointer ─────────────────────────────────────

        def current_pointer_path(org_id)
          clean_org = org_id.to_s.strip
          return nil if clean_org.empty? || clean_org.include?('/') || clean_org.include?('..')

          File.join(@store_dir, 'current', "#{clean_org}.json")
        end

        def current_release_id(org_id)
          path = current_pointer_path(org_id)
          return nil unless path && File.file?(path)

          data = JSON.parse(File.read(path))
          data['releaseId']
        rescue StandardError
          nil
        end

        def set_current_release(org_id, release_id)
          clean_org = org_id.to_s.strip
          rel_id = release_id.to_s.strip
          raise StoreError, "invalid org_id: #{org_id}" if clean_org.empty?
          raise StoreError, "invalid release_id: #{release_id}" unless UUID_REGEX.match?(rel_id)

          # Manifest must exist before it can become current
          unless manifest_exist?(rel_id)
            raise StoreError, "cannot set release #{rel_id} as current: manifest does not exist in store"
          end

          target_path = current_pointer_path(clean_org)
          payload = JSON.generate(
            'releaseId' => rel_id,
            'organizationId' => clean_org,
            'updatedAt' => Time.now.utc.iso8601
          )

          FileUtils.mkdir_p(File.dirname(target_path))
          atomic_write(target_path, payload)
          rel_id
        end

        # ─── Garbage Collection ───────────────────────────────────────────────

        def gc(retained_shas)
          retained_hexes = retained_shas.map { |s| clean_sha(s) }.compact.to_set
          deleted = 0

          Dir.glob(File.join(@store_dir, 'objects', 'sha256', '*', '*.json')).each do |file|
            basename = File.basename(file, '.json').downcase
            next if retained_hexes.include?(basename)

            FileUtils.rm_f(file)
            deleted += 1
          end

          deleted
        end

        private

        def ensure_directories!
          FileUtils.mkdir_p(File.join(@store_dir, 'manifests'))
          FileUtils.mkdir_p(File.join(@store_dir, 'objects', 'sha256'))
          FileUtils.mkdir_p(File.join(@store_dir, 'current'))
        end

        def clean_sha(sha)
          return nil if sha.nil?

          str = sha.to_s.strip.downcase.sub(/\Asha256:/, '').sub(/\Asha256-/, '')
          HEX_REGEX.match?(str) ? str : nil
        end

        def atomic_write(dest_path, content)
          tmp_path = "#{dest_path}.tmp.#{Process.pid}.#{rand(100_000)}"
          File.binwrite(tmp_path, content)
          File.rename(tmp_path, dest_path)
        rescue StandardError => e
          FileUtils.rm_f(tmp_path)
          raise e
        end
      end
    end
  end
end
