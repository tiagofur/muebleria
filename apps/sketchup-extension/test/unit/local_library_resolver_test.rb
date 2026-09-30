# frozen_string_literal: true

require 'test_helper'
require 'securerandom'
require_relative '../../src/granete_for_sketchup/library/library_store'
require_relative '../../src/granete_for_sketchup/library/local_library_resolver'

module Granete
  module SketchUpExtension
    module Library
      class LocalLibraryResolverTest < Minitest::Test
        def setup
          @tmp_dir = Dir.mktmpdir('resolver_test')
          @store = LibraryStore.new(store_dir: @tmp_dir)
          @resolver = LocalLibraryResolver.new(store: @store)
          @org_id = 'org-test-taller'
        end

        def teardown
          FileUtils.rm_rf(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
        end

        def test_available_offline
          refute @resolver.available_offline?(@org_id)

          rel_id = SecureRandom.uuid
          @store.write_manifest(rel_id, '{"version":"1.0.0"}')
          @store.set_current_release(@org_id, rel_id)

          assert @resolver.available_offline?(@org_id)
        end

        def test_resolve_effective_release_success
          rel_id = SecureRandom.uuid
          manifest_data = { 'libraryVersion' => '1.0.0', 'resources' => [] }
          @store.write_manifest(rel_id, JSON.generate(manifest_data))
          @store.set_current_release(@org_id, rel_id)

          resolved = @resolver.resolve_effective_release(@org_id)
          assert_equal '1.0.0', resolved['libraryVersion']
        end

        def test_resolve_effective_release_fails_if_none_installed
          assert_raises(ResolutionError) do
            @resolver.resolve_effective_release('nonexistent-org')
          end
        end

        def test_resolve_pinned_release_does_not_mutate_current_organization_pointer
          current_rel_id = SecureRandom.uuid
          pinned_rel_id = SecureRandom.uuid

          @store.write_manifest(current_rel_id, '{"libraryVersion":"2.0.0"}')
          @store.write_manifest(pinned_rel_id, '{"libraryVersion":"1.0.0-legacy"}')
          @store.set_current_release(@org_id, current_rel_id)

          # Open older pinned project
          pinned_manifest = @resolver.resolve_pinned_release(pinned_rel_id)
          assert_equal '1.0.0-legacy', pinned_manifest['libraryVersion']

          # Organization current release must NOT be silently overwritten
          assert_equal current_rel_id, @store.current_release_id(@org_id)
        end

        def test_resolve_furniture_definition_and_list
          rel_id = SecureRandom.uuid
          res_id = SecureRandom.uuid
          def_content = { 'name' => 'Bajo Mesada 60', 'width' => 600 }
          def_json = JSON.generate(def_content)
          def_hash = Digest::SHA256.hexdigest(def_json)

          @store.write_object(def_hash, def_json)

          manifest_data = {
            'libraryVersion' => '1.0.0',
            'resources' => [
              {
                'id' => res_id,
                'kind' => 'furniture_definition',
                'revision' => 'rev-1',
                'packageKind' => 'free',
                'definitionHash' => def_hash
              }
            ]
          }
          @store.write_manifest(rel_id, JSON.generate(manifest_data))

          # 1. Resolve individual furniture
          furniture = @resolver.resolve_furniture_definition(rel_id, res_id)
          assert_equal 'Bajo Mesada 60', furniture['name']
          assert_equal 600, furniture['width']

          # 2. List furniture definitions
          list = @resolver.list_furniture_definitions(rel_id)
          assert_equal 1, list.size
          assert_equal res_id, list.first['id']
          assert_equal 'Bajo Mesada 60', list.first['definition']['name']
        end
      end
    end
  end
end
