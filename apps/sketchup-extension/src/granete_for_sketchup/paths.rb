# frozen_string_literal: true

require 'fileutils'

module Granete
  module SketchUpExtension
    # GranetePaths provides unified, platform-correct path resolution separating
    # persistent installed data (LibraryStore) from disposable/regenerable cache (Cache).
    #
    # Target locations:
    # Windows: %LOCALAPPDATA%\Granete\LibraryStore and %LOCALAPPDATA%\Granete\Cache
    # macOS:   ~/Library/Application Support/Granete/LibraryStore and ~/Library/Caches/Granete
    # Linux:   $XDG_DATA_HOME/Granete/LibraryStore and $XDG_CACHE_HOME/Granete
    module GranetePaths
      class << self
        attr_writer :custom_root, :custom_cache_root

        def library_store
          dir = if @custom_root
                  File.join(@custom_root, 'LibraryStore')
                elsif windows?
                  File.join(windows_local_appdata, 'Granete', 'LibraryStore')
                elsif macos?
                  File.join(Dir.home, 'Library', 'Application Support', 'Granete', 'LibraryStore')
                else
                  File.join(xdg_data_home, 'Granete', 'LibraryStore')
                end
          FileUtils.mkdir_p(dir) unless File.directory?(dir)
          File.expand_path(dir)
        end

        def cache
          dir = if @custom_cache_root
                  File.join(@custom_cache_root, 'Cache')
                elsif @custom_root
                  File.join(@custom_root, 'Cache')
                elsif windows?
                  File.join(windows_local_appdata, 'Granete', 'Cache')
                elsif macos?
                  File.join(Dir.home, 'Library', 'Caches', 'Granete')
                else
                  File.join(xdg_cache_home, 'Granete')
                end
          FileUtils.mkdir_p(dir) unless File.directory?(dir)
          File.expand_path(dir)
        end

        def temp
          dir = File.join(cache, 'temp')
          FileUtils.mkdir_p(dir) unless File.directory?(dir)
          File.expand_path(dir)
        end

        def with_roots(root: nil, cache_root: nil)
          prev_root = @custom_root
          prev_cache = @custom_cache_root
          @custom_root = root
          @custom_cache_root = cache_root
          yield
        ensure
          @custom_root = prev_root
          @custom_cache_root = prev_cache
        end

        def reset!
          @custom_root = nil
          @custom_cache_root = nil
        end

        private

        def windows?
          (/cygwin|mswin|mingw|bccwin|wince|emx/ =~ RUBY_PLATFORM) != nil
        end

        def macos?
          (/darwin/ =~ RUBY_PLATFORM) != nil
        end

        def windows_local_appdata
          ENV['LOCALAPPDATA'] || ENV['APPDATA'] || Dir.home
        end

        def xdg_data_home
          ENV['XDG_DATA_HOME'] || File.join(Dir.home, '.local', 'share')
        end

        def xdg_cache_home
          ENV['XDG_CACHE_HOME'] || File.join(Dir.home, '.cache')
        end
      end
    end
  end
end
