# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Assets
      class AssetLoader
        def initialize(resolver: nil)
          @resolver = resolver || AssetResolver.new
        end

        def load_asset_instance(model, asset_id, target_group, transform_mm = [0, 0, 0])
          skp_path = @resolver.resolve_skp_path(asset_id)
          return false unless skp_path && File.exist?(skp_path)

          definition = model.definitions.load(skp_path)
          return false unless definition

          scale_to_inch = 1.0 / 25.4
          transform = ::Geom::Transformation.translation(
            ::Geom::Vector3d.new(
              transform_mm[0] * scale_to_inch,
              transform_mm[1] * scale_to_inch,
              transform_mm[2] * scale_to_inch
            )
          )

          instance = target_group.entities.add_instance(definition, transform)
          !instance.nil?
        rescue StandardError
          false
        end
      end
    end
  end
end
