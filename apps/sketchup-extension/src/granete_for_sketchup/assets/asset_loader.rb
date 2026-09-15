# frozen_string_literal: true

require_relative 'asset_resolver'
require_relative 'hardware_asset_cache'
require_relative 'hardware_asset_downloader'

module Granete
  module SketchUpExtension
    module Assets
      # Loads a hardware .skp asset as a native ComponentInstance nested in
      # the given container (the furniture's isolated definition). Returns the
      # created Sketchup::ComponentInstance, or nil when the asset cannot be
      # resolved/loaded so the caller falls back to generated geometry.
      class AssetLoader
        attr_reader :diagnostics

        def initialize(resolver: nil, downloader: nil, cache: nil, logger: nil)
          @resolver = resolver || AssetResolver.new
          @downloader = downloader
          @cache = cache || @downloader&.cache
          @logger = logger
          @diagnostics = []
        end

        def clear_diagnostics
          @diagnostics.clear
        end

        def prefetch_hardware_assets(hardware_placements, org_id: nil)
          return unless hardware_placements.is_a?(Array)

          hardware_placements.each do |placement|
            next unless placement.respond_to?(:asset_id) && placement.asset_id
            next unless placement.respond_to?(:asset_revision_id) && placement.asset_revision_id

            prefetch_single(placement, org_id: org_id)
          end
        end

        def load_asset_instance(model, asset_id, target_container, transform_mm = [0, 0, 0],
                                basis: nil, revision_id: nil, sha256: nil, expected_bytes: nil, org_id: nil)
          skp_path = resolve_asset_file(
            asset_id: asset_id, revision_id: revision_id, sha256: sha256,
            expected_bytes: expected_bytes, org_id: org_id
          )
          return nil unless skp_path && File.file?(skp_path)

          definition = model.definitions.load(skp_path)
          return nil unless definition

          transform = build_transform(transform_mm, basis)
          target_container.entities.add_instance(definition, transform)
        rescue StandardError => e
          @logger&.error('asset_loader_instance_failed', error: e, asset_id: asset_id)
          nil
        end

        private

        def prefetch_single(placement, org_id: nil)
          asset_id = placement.asset_id
          revision_id = placement.asset_revision_id
          sha256 = placement.sha256
          expected_bytes = placement.expected_bytes

          cached = @cache&.get(
            asset_id: asset_id, revision_id: revision_id, sha256: sha256,
            expected_bytes: expected_bytes, org_id: org_id
          )
          return cached if cached

          if @downloader
            path = @downloader.download_asset(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              expected_bytes: expected_bytes, org_id: org_id
            )
            return path if path
          end

          record_diagnostic(
            'code' => 'hardware_asset_missing',
            'placementId' => placement.placement_id,
            'hardwareId' => placement.hardware_id,
            'assetId' => asset_id,
            'assetRevisionId' => revision_id,
            'reason' => 'No se pudo descargar o verificar la geometría 3D del herraje'
          )
          nil
        end

        def resolve_asset_file(asset_id:, revision_id:, sha256:, expected_bytes:, org_id:)
          if revision_id && @cache
            cached = @cache.get(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              expected_bytes: expected_bytes, org_id: org_id
            )
            return cached if cached
          end

          if revision_id && @downloader
            downloaded = @downloader.download_asset(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              expected_bytes: expected_bytes, org_id: org_id
            )
            return downloaded if downloaded
          end

          @resolver&.resolve_skp_path(asset_id)
        end

        def build_transform(transform_mm, basis)
          scale = 1.0 / 25.4
          pts = transform_mm.map { |v| v * scale }

          if basis.is_a?(Hash) && basis['x'] && basis['y'] && basis['z'] && defined?(::Geom::Transformation.axes)
            axes_transform(pts, basis)
          else
            ::Geom::Transformation.translation(::Geom::Vector3d.new(*pts))
          end
        end

        def axes_transform(pts, basis)
          ::Geom::Transformation.axes(
            ::Geom::Point3d.new(*pts),
            ::Geom::Vector3d.new(*basis['x']),
            ::Geom::Vector3d.new(*basis['y']),
            ::Geom::Vector3d.new(*basis['z'])
          )
        end

        def record_diagnostic(diag)
          @diagnostics << diag
          @logger&.warn('hardware_asset_diagnostic', diag)
        end
      end
    end
  end
end
