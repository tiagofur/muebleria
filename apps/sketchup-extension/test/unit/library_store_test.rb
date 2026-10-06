# frozen_string_literal: true

require 'test_helper'
require 'securerandom'
require_relative '../../src/granete_for_sketchup/library/library_store'

module Granete
  module SketchUpExtension
    module Library
      class LibraryStoreTest < Minitest::Test
        def setup
          @tmp_dir = Dir.mktmpdir('library_store_test')
          @store = LibraryStore.new(store_dir: @tmp_dir)
        end

        def teardown
          FileUtils.rm_rf(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
        end

        def test_write_and_read_object_with_hash_verification
          content = '{"id":"furniture-1","name":"Base 60"}'
          expected_sha = Digest::SHA256.hexdigest(content)

          path = @store.write_object(expected_sha, content)
          assert File.file?(path)
          assert @store.object_exist?(expected_sha)
          assert @store.object_exist?("sha256:#{expected_sha}")

          # Path format: .../objects/sha256/xx/<full_hash>.json
          prefix = expected_sha[0..1]
          assert path.include?("/objects/sha256/#{prefix}/#{expected_sha}.json")

          read_back = @store.read_object(expected_sha)
          assert_equal content, read_back
        end

        def test_write_object_hash_mismatch_raises_integrity_error
          content = '{"id":"furniture-1"}'
          tampered_sha = 'a' * 64

          assert_raises(IntegrityError) do
            @store.write_object(tampered_sha, content)
          end

          refute @store.object_exist?(tampered_sha)
          # Ensure no leftover files
          assert_empty Dir.glob(File.join(@tmp_dir, 'objects', 'sha256', '*', '*.json'))
        end

        def test_write_and_read_manifest
          rel_id = SecureRandom.uuid
          manifest = {
            'schemaVersion' => 1,
            'libraryVersion' => '1.0.0',
            'manifestHash' => 'sha256:11112222',
            'resources' => []
          }
          manifest_json = JSON.generate(manifest)

          # #1164: the store keeps the exact served bytes; manifest
          # integrity is the synchronizer's parity-verification job, so
          # write_manifest carries no digest argument anymore.
          path = @store.write_manifest(rel_id, manifest_json)
          assert File.file?(path)
          assert @store.manifest_exist?(rel_id)

          read_back = @store.read_manifest(rel_id)
          assert_equal 1, read_back['schemaVersion']
          assert_equal '1.0.0', read_back['libraryVersion']
        end

        def test_set_current_release_requires_manifest_to_exist
          org_id = 'org-taller-1'
          uninstalled_rel_id = SecureRandom.uuid

          err = assert_raises(StoreError) do
            @store.set_current_release(org_id, uninstalled_rel_id)
          end
          assert_includes err.message, 'manifest does not exist'
          assert_nil @store.current_release_id(org_id)
        end

        def test_organization_pointer_isolation
          org_a = 'org-alpha'
          org_b = 'org-beta'
          rel_a = SecureRandom.uuid
          rel_b = SecureRandom.uuid

          # Install both manifests
          @store.write_manifest(rel_a, '{"version":"1.0.0"}')
          @store.write_manifest(rel_b, '{"version":"2.0.0"}')

          @store.set_current_release(org_a, rel_a)
          @store.set_current_release(org_b, rel_b)

          assert_equal rel_a, @store.current_release_id(org_a)
          assert_equal rel_b, @store.current_release_id(org_b)
        end

        def test_gc_deletes_only_unreferenced_objects
          obj1 = '{"item":1}'
          obj2 = '{"item":2}'
          obj3 = '{"item":3}'

          sha1 = Digest::SHA256.hexdigest(obj1)
          sha2 = Digest::SHA256.hexdigest(obj2)
          sha3 = Digest::SHA256.hexdigest(obj3)

          @store.write_object(sha1, obj1)
          @store.write_object(sha2, obj2)
          @store.write_object(sha3, obj3)

          assert @store.object_exist?(sha1)
          assert @store.object_exist?(sha2)
          assert @store.object_exist?(sha3)

          # Retain only sha1 and sha2
          deleted = @store.gc([sha1, sha2])
          assert_equal 1, deleted

          assert @store.object_exist?(sha1)
          assert @store.object_exist?(sha2)
          refute @store.object_exist?(sha3), 'Unreferenced object must be deleted by GC'
        end
      end
    end
  end
end
