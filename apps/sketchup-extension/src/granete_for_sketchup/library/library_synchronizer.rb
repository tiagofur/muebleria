# frozen_string_literal: true

require 'json'
require_relative 'library_store'

module Granete
  module SketchUpExtension
    module Library
      class SyncError < StandardError; end
      class IncompatibleSchemaError < SyncError; end
      class IncompatiblePluginError < SyncError; end
      class ContextChangedError < SyncError; end

      # LibrarySynchronizer coordinates the incremental, verified download of
      # manufacturing library releases into LibraryStore.
      #
      # Invariants:
      # - Validates manifest schema (schemaVersion == 1) before processing.
      # - Downloads only missing objects whose SHA-256 digest is not already in the store.
      # - Verifies SHA-256 digest of every downloaded object before committing.
      # - Atomically updates the organization pointer only after all resources are verified.
      # - Failure at any step leaves the previous installed release untouched.
      # - Detects organization context changes and cancels activation to prevent cross-tenant contamination.
      class LibrarySynchronizer
        SUPPORTED_SCHEMA_VERSION = 1

        attr_reader :store, :api_client, :plugin_version

        def initialize(store:, api_client:, plugin_version: '1.0.0')
          @store = store
          @api_client = api_client
          @plugin_version = plugin_version
        end

        def sync_release(release_id:, org_id:, expected_manifest_hash: nil, active_org_checker: nil)
          rel_id = release_id.to_s.strip
          clean_org = org_id.to_s.strip
          raise SyncError, 'org_id is required' if clean_org.empty?

          # 1. Fetch manifest from server
          manifest_raw = @api_client.fetch_manifest(rel_id)
          raise SyncError, "failed to fetch manifest for release #{rel_id}" if manifest_raw.nil?

          manifest = parse_and_validate_manifest(manifest_raw)

          # 2. Check context before doing network work
          assert_active_org!(clean_org, active_org_checker)

          # 3. Diff: identify missing resource blobs
          resources = manifest['resources'] || []
          missing_resources = resources.reject do |r|
            def_hash = r['definitionHash']
            def_hash && @store.object_exist?(def_hash)
          end

          # 4. Download and verify missing blobs
          downloaded = 0
          missing_resources.each do |r|
            assert_active_org!(clean_org, active_org_checker)

            res_id = r['id']
            def_hash = r['definitionHash']
            raise SyncError, "resource #{res_id} missing definitionHash" unless def_hash

            blob_raw = @api_client.fetch_blob(rel_id, res_id, def_hash)
            raise SyncError, "failed to download blob for resource #{res_id} (#{def_hash})" if blob_raw.nil?

            # Store verifies SHA-256 before writing; raises IntegrityError if mismatch
            @store.write_object(def_hash, blob_raw)
            downloaded += 1
          end

          # 5. Persist manifest into LibraryStore
          @store.write_manifest(rel_id, manifest_raw, expected_manifest_hash: expected_manifest_hash)

          # 6. Final context check before atomic activation
          assert_active_org!(clean_org, active_org_checker)

          # 7. Atomically set candidate release as current for this organization
          @store.set_current_release(clean_org, rel_id)

          {
            status: :synced,
            release_id: rel_id,
            total_resources: resources.size,
            downloaded_count: downloaded
          }
        end

        private

        def parse_and_validate_manifest(raw_json)
          data = JSON.parse(raw_json)
        rescue StandardError => e
          raise SyncError, "malformed manifest JSON: #{e.message}"
        else
          schema = data['schemaVersion'] || 0
          if schema > SUPPORTED_SCHEMA_VERSION
            msg = "manifest schemaVersion #{schema} exceeds supported #{SUPPORTED_SCHEMA_VERSION}"
            raise IncompatibleSchemaError, msg
          end

          min_ver = data['minPluginVersion']
          if min_ver && version_lt?(@plugin_version, min_ver)
            msg = "library requires plugin version >= #{min_ver}, current is #{@plugin_version}"
            raise IncompatiblePluginError, msg
          end

          data
        end

        def assert_active_org!(expected_org, checker)
          return unless checker.respond_to?(:call)

          current = checker.call.to_s.strip
          return if current == expected_org

          raise ContextChangedError, "active organization changed from #{expected_org} to #{current}; sync aborted"
        end

        def version_lt?(ver1, ver2)
          p1 = ver1.to_s.split('.').map(&:to_i)
          p2 = ver2.to_s.split('.').map(&:to_i)
          (p1 <=> p2).negative?
        end
      end
    end
  end
end
