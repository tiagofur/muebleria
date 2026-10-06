# frozen_string_literal: true

require 'test_helper'
require 'securerandom'
require_relative '../../src/granete_for_sketchup/library/library_store'
require_relative '../../src/granete_for_sketchup/library/library_synchronizer'
require_relative '../../src/granete_for_sketchup/library/manifest_hash'

module Granete
  module SketchUpExtension
    module Library
      class MockApiClient
        attr_reader :blob_fetch_counts

        def initialize(manifest_json: nil, blobs_by_hash: {})
          @manifest_json = manifest_json
          @blobs_by_hash = blobs_by_hash
          @blob_fetch_counts = Hash.new(0)
        end

        def fetch_manifest(_release_id)
          @manifest_json
        end

        def fetch_blob(_release_id, _resource_id, hash)
          clean = hash.to_s.sub(/\Asha256:/, '')
          @blob_fetch_counts[clean] += 1
          @blobs_by_hash[clean]
        end
      end

      class LibrarySynchronizerTest < Minitest::Test
        def setup
          @tmp_dir = Dir.mktmpdir('synchronizer_test')
          @store = LibraryStore.new(store_dir: @tmp_dir)
          @org_id = 'org-taller-1'
        end

        def teardown
          FileUtils.rm_rf(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
        end

        def test_fresh_sync_downloads_all_resources_and_sets_current
          rel_id = SecureRandom.uuid
          res1_content = '{"id":"cab-1","name":"Gabinete 60"}'
          res2_content = '{"id":"cab-2","name":"Gabinete 80"}'
          hash1 = Digest::SHA256.hexdigest(res1_content)
          hash2 = Digest::SHA256.hexdigest(res2_content)

          manifest = {
            'schemaVersion' => 1,
            'libraryVersion' => '1.0.0',
            'manifestHash' => 'sha256:manifest1',
            'resources' => [
              { 'id' => SecureRandom.uuid, 'definitionHash' => "sha256:#{hash1}" },
              { 'id' => SecureRandom.uuid, 'definitionHash' => "sha256:#{hash2}" }
            ]
          }
          manifest_json = JSON.generate(manifest)

          client = MockApiClient.new(
            manifest_json: manifest_json,
            blobs_by_hash: { hash1 => res1_content, hash2 => res2_content }
          )

          sync = LibrarySynchronizer.new(store: @store, api_client: client)
          res = sync.sync_release(release_id: rel_id, org_id: @org_id)

          assert_equal :synced, res[:status]
          assert_equal 2, res[:downloaded_count]
          assert_equal rel_id, @store.current_release_id(@org_id)
          assert @store.object_exist?(hash1)
          assert @store.object_exist?(hash2)
          assert_equal 1, client.blob_fetch_counts[hash1]
          assert_equal 1, client.blob_fetch_counts[hash2]
        end

        def test_incremental_sync_skips_already_downloaded_hashes
          rel_id = SecureRandom.uuid
          res1_content = '{"id":"shared-1"}'
          res2_content = '{"id":"new-2"}'
          hash1 = Digest::SHA256.hexdigest(res1_content)
          hash2 = Digest::SHA256.hexdigest(res2_content)

          # Pre-populate hash1 (already in store from another release or free package)
          @store.write_object(hash1, res1_content)
          assert @store.object_exist?(hash1)

          manifest = {
            'schemaVersion' => 1,
            'libraryVersion' => '1.1.0',
            'manifestHash' => 'sha256:manifest11',
            'resources' => [
              { 'id' => SecureRandom.uuid, 'definitionHash' => hash1 },
              { 'id' => SecureRandom.uuid, 'definitionHash' => hash2 }
            ]
          }
          manifest_json = JSON.generate(manifest)

          client = MockApiClient.new(
            manifest_json: manifest_json,
            blobs_by_hash: { hash1 => res1_content, hash2 => res2_content }
          )

          sync = LibrarySynchronizer.new(store: @store, api_client: client)
          res = sync.sync_release(release_id: rel_id, org_id: @org_id)

          assert_equal :synced, res[:status]
          # Only hash2 was missing, so downloaded_count must be 1
          assert_equal 1, res[:downloaded_count]
          assert_equal 0, client.blob_fetch_counts[hash1], 'Existing hash1 must NOT be re-fetched'
          assert_equal 1, client.blob_fetch_counts[hash2]
        end

        def test_corrupt_blob_fails_sync_and_preserves_previous_current_pointer
          previous_rel_id = SecureRandom.uuid
          @store.write_manifest(previous_rel_id, '{"version":"0.9.0"}')
          @store.set_current_release(@org_id, previous_rel_id)
          assert_equal previous_rel_id, @store.current_release_id(@org_id)

          new_rel_id = SecureRandom.uuid
          good_content = '{"valid":true}'
          good_hash = Digest::SHA256.hexdigest(good_content)

          manifest = {
            'schemaVersion' => 1,
            'libraryVersion' => '2.0.0',
            'resources' => [
              { 'id' => SecureRandom.uuid, 'definitionHash' => good_hash }
            ]
          }
          manifest_json = JSON.generate(manifest)

          # Corrupted server response: returns bad bytes for good_hash
          client = MockApiClient.new(
            manifest_json: manifest_json,
            blobs_by_hash: { good_hash => 'corrupted-payload' }
          )

          sync = LibrarySynchronizer.new(store: @store, api_client: client)

          assert_raises(IntegrityError) do
            sync.sync_release(release_id: new_rel_id, org_id: @org_id)
          end

          # Invariant: failed update leaves previous release current and usable
          assert_equal previous_rel_id, @store.current_release_id(@org_id)
          refute @store.object_exist?(good_hash)
        end

        def test_incompatible_schema_version_rejected
          manifest = { 'schemaVersion' => 2 }
          client = MockApiClient.new(manifest_json: JSON.generate(manifest))
          sync = LibrarySynchronizer.new(store: @store, api_client: client)

          err = assert_raises(IncompatibleSchemaError) do
            sync.sync_release(release_id: SecureRandom.uuid, org_id: @org_id)
          end
          assert_includes err.message, 'exceeds supported'
        end

        def test_incompatible_plugin_version_rejected
          manifest = { 'schemaVersion' => 1, 'minPluginVersion' => '2.5.0' }
          client = MockApiClient.new(manifest_json: JSON.generate(manifest))
          sync = LibrarySynchronizer.new(store: @store, api_client: client, plugin_version: '1.2.0')

          err = assert_raises(IncompatiblePluginError) do
            sync.sync_release(release_id: SecureRandom.uuid, org_id: @org_id)
          end
          assert_includes err.message, 'requires plugin version >= 2.5.0'
        end

        def test_manifest_hash_mismatch_fails_closed_and_installs_nothing
          manifest = { 'schemaVersion' => 1, 'libraryVersion' => '3.0.0', 'resources' => [] }
          client = MockApiClient.new(manifest_json: JSON.generate(manifest))
          sync = LibrarySynchronizer.new(store: @store, api_client: client)

          err = assert_raises(SyncError) do
            sync.sync_release(
              release_id: SecureRandom.uuid,
              org_id: @org_id,
              expected_manifest_hash: "sha256:#{'0' * 64}"
            )
          end
          assert_includes err.message, 'manifest hash mismatch'
          assert_nil @store.current_release_id(@org_id), 'a failed verification installs nothing'
        end

        def test_manifest_hash_verification_uses_parity_not_served_bytes
          # #1164 regression: the backend records the parity digest of the
          # pre-hash payload, NOT the sha256 of the served bytes — jsonb
          # re-serialization guarantees the two differ (here: destroyed key
          # order and whitespace). Verifying served bytes could never pass;
          # verifying the parity digest must.
          rel_id = SecureRandom.uuid
          raw = <<-JSON
            { "resources": [], "effectiveReleaseId": "#{rel_id}", "libraryVersion": "3.0.0", "schemaVersion": 1 }
          JSON
          expected = ManifestHash.compute(JSON.parse(raw))
          refute_equal Digest::SHA256.hexdigest(raw.strip), ManifestHash.normalize(expected),
                       'the served-bytes hash and the parity digest are different by construction'

          client = MockApiClient.new(manifest_json: raw)
          sync = LibrarySynchronizer.new(store: @store, api_client: client)

          res = sync.sync_release(release_id: rel_id, org_id: @org_id, expected_manifest_hash: expected)
          assert_equal :synced, res[:status]
          assert_equal rel_id, @store.current_release_id(@org_id)
        end

        def test_context_change_during_sync_aborts_and_prevents_leak
          rel_id = SecureRandom.uuid
          content = '{"id":"item"}'
          hash = Digest::SHA256.hexdigest(content)

          manifest = {
            'schemaVersion' => 1,
            'resources' => [{ 'id' => SecureRandom.uuid, 'definitionHash' => hash }]
          }
          client = MockApiClient.new(
            manifest_json: JSON.generate(manifest),
            blobs_by_hash: { hash => content }
          )

          current_org = 'org-taller-1'
          active_checker = -> { current_org }

          sync = LibrarySynchronizer.new(store: @store, api_client: client)

          # Simulate user switching to another organization in SketchUp during sync
          current_org = 'org-taller-2'

          err = assert_raises(ContextChangedError) do
            sync.sync_release(release_id: rel_id, org_id: 'org-taller-1', active_org_checker: active_checker)
          end
          assert_includes err.message, 'active organization changed'
          assert_nil @store.current_release_id('org-taller-1')
          assert_nil @store.current_release_id('org-taller-2')
        end
      end
    end
  end
end
