# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Assets
      # Loads a hardware .skp asset as a native ComponentInstance nested in
      # the given container (the furniture's isolated definition). Returns the
      # created Sketchup::ComponentInstance, or nil when the asset cannot be
      # resolved/loaded so the caller falls back to generated geometry.
      #
      # Preflight (R1/R2, #668-C1): before any destructive rebuild,
      # prefetch_hardware_assets populates @prefetch_results with a typed
      # per-placement state (:ready | :missing | :invalid | :unprepared).
      # rebuild_preflight_ok? surfaces :missing/:invalid as a typed error so
      # update_furniture can fail-before-mutate on download failure, loadability
      # failure, or invalid MountFrame — not only on invalid preparation.
      class AssetLoader
        attr_reader :diagnostics

        def initialize(resolver: nil, downloader: nil, cache: nil, logger: nil)
          _ = cache
          @resolver = resolver || AssetResolver.new
          @downloader = downloader
          @logger = logger
          @diagnostics = []
          @prefetch_results = {}
        end

        def clear_diagnostics
          @diagnostics.clear
          @prefetch_results.clear
        end

        # Prefetches all hardware placements, populating @prefetch_results with
        # a typed state per placement_id. When model is provided, R2 loadability
        # is probed (definitions.load without inserting a productive instance).
        def prefetch_hardware_assets(hardware_placements, model: nil, org_id: nil)
          return unless hardware_placements.is_a?(Array)

          effective_org = org_id || default_org_id
          hardware_placements.each do |placement|
            next unless placement.respond_to?(:asset_id) && placement.asset_id
            next unless placement.respond_to?(:asset_revision_id) && placement.asset_revision_id

            pid = placement.respond_to?(:placement_id) ? placement.placement_id : nil
            state = prefetch_result_for_rebuild(model, placement, org_id: effective_org)
            @prefetch_results[pid] = state if pid
          end
        end

        # Returns [true, nil] when all prefetched placements are :ready or
        # :unprepared (unprepared falls back to legacy, not a blocker).
        # Returns [false, message] for the first :missing or :invalid placement.
        # Falls back to the original diagnostics scan when no prefetch ran
        # (backward-compatible with callers that never supply model:).
        def rebuild_preflight_ok?
          if @prefetch_results.empty?
            err = legacy_invalid_asset_preparation_error
            return err ? [false, err] : [true, nil]
          end

          missing_pid, = @prefetch_results.find { |_, s| s == :missing }
          if missing_pid
            return [false,
                    "No se pudo descargar o cargar la geometría 3D del herraje (placement: #{missing_pid})"]
          end

          invalid_pid, = @prefetch_results.find { |_, s| s == :invalid }
          if invalid_pid
            diag = @diagnostics.find do |d|
              d['code'] == 'asset_preparation_invalid' && d['placementId'] == invalid_pid
            end
            reason = diag ? diag['reason'] : 'Preparación de herraje inválida'
            return [false, "Preparación de herraje inválida: #{reason}"]
          end

          [true, nil]
        end

        # rubocop:disable-next Metrics/ParameterLists
        def load_asset_instance(model, asset_id, target_container, transform_mm = [0, 0, 0],
                                basis: nil, revision_id: nil, sha256: nil, expected_bytes: nil, org_id: nil,
                                mount_frame: nil, preparation_state: nil, placement_id: nil)
          effective_org = org_id || default_org_id
          skp_path = resolve_asset_file(
            asset_id: asset_id, revision_id: revision_id, sha256: sha256,
            expected_bytes: expected_bytes, org_id: effective_org
          )
          return nil unless skp_path && File.file?(skp_path)

          definition = model.definitions.load(skp_path)
          return nil unless definition

          transform = if preparation_state == 'prepared'
                        compute_prepared_transform(transform_mm, basis, mount_frame, asset_id, placement_id)
                      else
                        record_unprepared_if_applicable(preparation_state, asset_id, placement_id)
                        build_transform(transform_mm, basis)
                      end
          return nil unless transform

          target_container.entities.add_instance(definition, transform)
        rescue StandardError => e
          @logger&.error('asset_loader_instance_failed', error: e, asset_id: asset_id)
          nil
        end

        private

        def default_org_id
          @downloader.respond_to?(:current_org_id, true) ? @downloader.send(:current_org_id) : nil
        end

        # R1: derive typed preflight state for a single placement.
        # Step 1: download; Step 2: loadability (R2); Step 3: preparation validity.
        def prefetch_result_for_rebuild(model, placement, org_id:)
          path = prefetch_single(placement, org_id: org_id)
          return :missing unless path && File.file?(path)

          # R2: probe that the SKP can be loaded without inserting a productive instance.
          return :missing if model && !probe_loadability(model, path)

          prep_state = placement.respond_to?(:preparation_state) ? placement.preparation_state : nil
          return :unprepared unless prep_state == 'prepared'

          # prevalidate_preparation records diagnostic and returns false on invalid MountFrame.
          prevalidate_preparation(placement) ? :ready : :invalid
        end

        # R2: calls model.definitions.load without adding a ComponentInstance.
        # Returns true when SketchUp can load the file (or when model is unavailable).
        # definitions.load returns the cached definition if already loaded — safe,
        # no allocation, no geometry mutation. Never inserts a productive instance.
        def probe_loadability(model, skp_path)
          return true unless model.respond_to?(:definitions)

          defn = model.definitions.load(skp_path)
          !defn.nil?
        rescue StandardError
          false
        end

        def prefetch_single(placement, org_id: nil)
          asset_id = placement.asset_id
          revision_id = placement.asset_revision_id
          sha256 = placement.sha256
          expected_bytes = placement.expected_bytes

          path = nil
          if @downloader
            path = @downloader.download_asset(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              expected_bytes: expected_bytes, org_id: org_id
            )
          end
          return path if path

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
          if revision_id
            return nil unless @downloader

            return @downloader.download_asset(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              expected_bytes: expected_bytes, org_id: org_id
            )
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

        def compute_prepared_transform(transform_mm, basis, mount_frame, asset_id, placement_id)
          unless mount_frame
            record_diagnostic(
              'code' => 'asset_preparation_invalid',
              'placementId' => placement_id,
              'assetId' => asset_id,
              'reason' => 'Herraje marcado como prepared sin marco de montaje'
            )
            return nil
          end

          MountFrame.validate_basis!(mount_frame.basis, 'mount_frame.basis')
          norm = MountFrame.derive_normalization(mount_frame)
          t_norm = norm.to_sketchup_transformation
          raise 'No se pudo generar transformación de normalización' unless t_norm

          t_placement = build_transform(transform_mm, basis)
          # Exact productive composition:
          #   T_instance = T_placement * T_norm
          #   (T_norm = inverse(T_mountFrame))
          t_placement * t_norm
        rescue StandardError => e
          record_diagnostic(
            'code' => 'asset_preparation_invalid',
            'placementId' => placement_id,
            'assetId' => asset_id,
            'reason' => "Preparación inválida: #{e.message}"
          )
          nil
        end

        def record_unprepared_if_applicable(preparation_state, asset_id, placement_id)
          return unless preparation_state == 'unprepared'

          record_diagnostic(
            'code' => 'hardware_asset_unprepared',
            'placementId' => placement_id,
            'assetId' => asset_id,
            'reason' => 'Herraje con geometría visual sin marco de montaje preparado; usando colocación legacy'
          )
        end

        # Validates MountFrame basis for a prepared placement.
        # Records an asset_preparation_invalid diagnostic on failure.
        # Returns true when valid, false when invalid, nil when not applicable.
        def prevalidate_preparation(placement)
          return nil unless placement.respond_to?(:preparation_state) && placement.preparation_state == 'prepared'

          mf = placement.respond_to?(:mount_frame) ? placement.mount_frame : nil
          pid = placement.respond_to?(:placement_id) ? placement.placement_id : nil
          unless mf
            record_diagnostic(
              'code' => 'asset_preparation_invalid',
              'placementId' => pid,
              'assetId' => placement.asset_id,
              'reason' => 'Herraje marcado como prepared sin marco de montaje'
            )
            return false
          end

          begin
            MountFrame.validate_basis!(mf.basis, 'mount_frame.basis')
            MountFrame.derive_normalization(mf)
            true
          rescue StandardError => e
            record_diagnostic(
              'code' => 'asset_preparation_invalid',
              'placementId' => pid,
              'assetId' => placement.asset_id,
              'reason' => "Preparación inválida: #{e.message}"
            )
            false
          end
        end

        # Backward-compatible fallback: scan diagnostics for the original code.
        # Used by rebuild_preflight_ok? when prefetch ran without model (no R2).
        def legacy_invalid_asset_preparation_error
          diag = @diagnostics.find { |d| d['code'] == 'asset_preparation_invalid' }
          diag ? "Preparación de herraje inválida: #{diag['reason']}" : nil
        end

        def record_diagnostic(diag)
          @diagnostics << diag
          @logger&.warn('hardware_asset_diagnostic', diag)
        end
      end
    end
  end
end
