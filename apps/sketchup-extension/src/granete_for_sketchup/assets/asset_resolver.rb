# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Assets
      class AssetResolver
        def initialize(bundle_dir: nil, cache_dir: nil)
          dir = __dir__.dup
          dir.force_encoding('UTF-8')
          @bundle_dir = bundle_dir || File.expand_path('../../resources/assets', dir)
          @cache_dir = cache_dir || File.expand_path('../../resources/cache', dir)
        end

        def resolve_skp_path(asset_id)
          bundled_file = File.join(@bundle_dir, "#{asset_id}.skp")
          return bundled_file if File.exist?(bundled_file)

          cached_file = File.join(@cache_dir, "#{asset_id}.skp")
          return cached_file if File.exist?(cached_file)

          nil
        end

        def available_assets
          (Dir.glob(File.join(@bundle_dir, '*.skp')) + Dir.glob(File.join(@cache_dir, '*.skp'))).map do |p|
            File.basename(p, '.skp')
          end.uniq
        end
      end
    end
  end
end
