# frozen_string_literal: true

require 'test_helper'
require_relative '../../src/granete_for_sketchup/paths'

module Granete
  module SketchUpExtension
    class PathsTest < Minitest::Test
      def setup
        GranetePaths.reset!
        @tmp_dir = Dir.mktmpdir('granete_paths_test')
      end

      def teardown
        GranetePaths.reset!
        FileUtils.rm_rf(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
      end

      def test_with_roots_isolation
        custom_root = File.join(@tmp_dir, 'appdata')
        custom_cache = File.join(@tmp_dir, 'cache')

        GranetePaths.with_roots(root: custom_root, cache_root: custom_cache) do
          store_dir = GranetePaths.library_store
          cache_dir = GranetePaths.cache
          temp_dir = GranetePaths.temp

          assert File.directory?(store_dir)
          assert File.directory?(cache_dir)
          assert File.directory?(temp_dir)

          assert_equal File.join(custom_root, 'LibraryStore'), store_dir
          assert_equal File.join(custom_cache, 'Cache'), cache_dir
          assert_equal File.join(custom_cache, 'Cache', 'temp'), temp_dir
        end

        # After block, reset to previous
        assert_nil GranetePaths.instance_variable_get(:@custom_root)
      end

      def test_cache_clearing_does_not_affect_library_store
        custom_root = File.join(@tmp_dir, 'appdata')
        custom_cache = File.join(@tmp_dir, 'cache')

        GranetePaths.with_roots(root: custom_root, cache_root: custom_cache) do
          store_file = File.join(GranetePaths.library_store, 'test_manifest.json')
          File.write(store_file, '{"content":"important"}')

          cache_file = File.join(GranetePaths.cache, 'temp_asset.tmp')
          File.write(cache_file, 'temporary')

          # Simulate OS / user cleaning disposable cache
          FileUtils.rm_rf(GranetePaths.cache)

          # LibraryStore remains 100% intact
          assert File.exist?(store_file), 'LibraryStore must not be affected by cache deletion'
          assert_equal '{"content":"important"}', File.read(store_file)
        end
      end
    end
  end
end
