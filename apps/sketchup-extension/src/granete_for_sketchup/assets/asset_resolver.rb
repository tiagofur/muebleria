# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Assets
      class AssetResolver
        def initialize(bundle_dir: nil, cache_dir: nil)
          @bundle_dir = bundle_dir || File.expand_path("../../resources/assets", __dir__)
          @cache_dir = cache_dir || File.expand_path("../../resources/cache", __dir__)
        end

        def resolve_skp_path(asset_id)
          return nil if asset_id.nil? || asset_id.to_s.strip.empty?

          bundled = File.join(@bundle_dir, "#{asset_id}.skp")
          return bundled if File.exist?(bundled)

          cached = File.join(@cache_dir, "#{asset_id}.skp")
          return cached if File.exist?(cached)

          nil
        end
      end
    end
  end
end
