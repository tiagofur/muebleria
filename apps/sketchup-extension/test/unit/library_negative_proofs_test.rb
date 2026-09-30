# frozen_string_literal: true

require 'test_helper'
require 'securerandom'
require 'granete_for_sketchup/paths'
require 'granete_for_sketchup/library/library_store'
require 'granete_for_sketchup/library/library_synchronizer'
require 'granete_for_sketchup/library/local_library_resolver'

module Granete
  module SketchUpExtension
    module Library
      class FakeApiClient
        def initialize(manifest: nil, blobs: {})
          @manifest = manifest
          @blobs = blobs
        end

        def fetch_manifest(_release_id)
          @manifest
        end

        def fetch_blob(_release_id, _resource_id, hash)
          clean = hash.to_s.sub(/\Asha256:/, '')
          @blobs[clean]
        end
      end

      # Negative proofs required by Issue #774 (LIB-3)
      class LibraryNegativeProofsTest < Minitest::Test
        def setup
          @tmp_dir = Dir.mktmpdir('negative_proofs_test')
          @store = LibraryStore.new(store_dir: @tmp_dir)
          @org_id = 'org-negative-proof'
        end

        def teardown
          FileUtils.rm_rf(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
        end

        # Negative Proof 1: Productive content must never live in disposable cache
        def test_negative_proof_library_store_is_not_under_disposable_cache
          store_dir = GranetePaths.library_store
          cache_dir = GranetePaths.cache

          refute store_dir.start_with?(cache_dir), 'LibraryStore must not be inside Cache directory'
          refute_equal store_dir, cache_dir
        end

        # Negative Proof 2: A new release NEVER becomes current before all hashes verify
        def test_negative_proof_never_activates_unverified_release
          rel_id = SecureRandom.uuid
          corrupted_hash = '1' * 64

          manifest = {
            'schemaVersion' => 1,
            'resources' => [{ 'id' => SecureRandom.uuid, 'definitionHash' => corrupted_hash }]
          }
          client = FakeApiClient.new(
            manifest: JSON.generate(manifest),
            blobs: { corrupted_hash => 'wrong-data-does-not-match-hash' }
          )
          sync = LibrarySynchronizer.new(store: @store, api_client: client)

          assert_raises(IntegrityError) do
            sync.sync_release(release_id: rel_id, org_id: @org_id)
          end

          assert_nil @store.current_release_id(@org_id), 'Unverified release must never become current'
        end

        # Negative Proof 3: Failed update must never delete or corrupt the previous good library
        def test_negative_proof_failed_update_preserves_previous_current
          initial_rel_id = SecureRandom.uuid
          @store.write_manifest(initial_rel_id, '{"version":"1.0.0"}')
          @store.set_current_release(@org_id, initial_rel_id)

          broken_rel_id = SecureRandom.uuid
          client = FakeApiClient.new(manifest: 'invalid-json')
          sync = LibrarySynchronizer.new(store: @store, api_client: client)

          assert_raises(SyncError) do
            sync.sync_release(release_id: broken_rel_id, org_id: @org_id)
          end

          assert_equal initial_rel_id, @store.current_release_id(@org_id),
                       'Previous good release must remain current after failed update'
        end

        # Negative Proof 4: Opening an old model must never silently map release ID to current
        def test_negative_proof_old_model_pin_preserves_current
          current_rel_id = SecureRandom.uuid
          historical_rel_id = SecureRandom.uuid

          @store.write_manifest(current_rel_id, '{"version":"2.0.0"}')
          @store.write_manifest(historical_rel_id, '{"version":"1.0.0"}')
          @store.set_current_release(@org_id, current_rel_id)

          resolver = LocalLibraryResolver.new(store: @store)
          old_manifest = resolver.resolve_pinned_release(historical_rel_id)

          assert_equal '1.0.0', old_manifest['version']
          assert_equal current_rel_id, @store.current_release_id(@org_id),
                       'Opening an old model must not overwrite organization current pointer'
        end

        # Negative Proof 5: Stale late response from Org A must not activate in Org B
        def test_negative_proof_late_response_rejected_across_orgs
          rel_id = SecureRandom.uuid
          content = '{"name":"chair"}'
          hash = Digest::SHA256.hexdigest(content)

          manifest = {
            'schemaVersion' => 1,
            'resources' => [{ 'id' => SecureRandom.uuid, 'definitionHash' => hash }]
          }
          client = FakeApiClient.new(
            manifest: JSON.generate(manifest),
            blobs: { hash => content }
          )

          active_org = 'org-a'
          checker = -> { active_org }
          sync = LibrarySynchronizer.new(store: @store, api_client: client)

          # User switches to org-b while sync is running
          active_org = 'org-b'

          assert_raises(ContextChangedError) do
            sync.sync_release(release_id: rel_id, org_id: 'org-a', active_org_checker: checker)
          end

          assert_nil @store.current_release_id('org-a')
          assert_nil @store.current_release_id('org-b')
        end

        # Negative Proof 6: Path traversal attempts in sha or org_id must fail closed
        def test_negative_proof_path_traversal_fails_closed
          assert_nil @store.object_path('../../etc/passwd')
          assert_nil @store.object_path('foo/bar')
          assert_nil @store.manifest_path('../../etc/passwd')
          assert_nil @store.current_pointer_path('../org-leak')
        end
      end
    end
  end
end
