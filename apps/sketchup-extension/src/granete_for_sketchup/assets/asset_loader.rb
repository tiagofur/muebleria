# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Assets
      # Loads a hardware .skp asset as a native ComponentInstance nested in
      # the given container (the furniture's isolated definition). Returns the
      # created Sketchup::ComponentInstance, or nil when the asset cannot be
      # resolved/loaded so the caller falls back to generated geometry.
      class AssetLoader
        def initialize(resolver: nil)
          @resolver = resolver || AssetResolver.new
        end

        def load_asset_instance(model, asset_id, target_container, transform_mm = [0, 0, 0])
          skp_path = @resolver.resolve_skp_path(asset_id)
          return nil unless skp_path && File.exist?(skp_path)

          definition = model.definitions.load(skp_path)
          return nil unless definition

          scale_to_inch = 1.0 / 25.4
          transform = ::Geom::Transformation.translation(
            ::Geom::Vector3d.new(
              transform_mm[0] * scale_to_inch,
              transform_mm[1] * scale_to_inch,
              transform_mm[2] * scale_to_inch
            )
          )

          target_container.entities.add_instance(definition, transform)
        rescue StandardError
          nil
        end
      end
    end
  end
end
