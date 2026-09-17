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
      class AssetLoader # rubocop:disable Metrics/ClassLength
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

        # Staged preflight (R1/R2/R3, #668-C1):
        # Stage 1: Download/cache all assets (pure I/O, zero model mutation).
        # Stage 2: Validate MountFrame basis and math (in-memory, zero model mutation).
        # Stage 3: Probe SketchUp loadability only when stages 1 & 2 succeed.
        #          If any placement fails loadability, newly loaded definitions are
        #          reverted so DefinitionList is restored with zero orphan definitions.
        def prefetch_hardware_assets(hardware_placements, model: nil, org_id: nil)
          return unless hardware_placements.is_a?(Array)

          placements = filter_hardware_placements(hardware_placements)
          return if placements.empty?

          effective_org = org_id || default_org_id
          paths_by_pid = stage_download_assets(placements, effective_org)
          candidates = stage_validate_preparations(placements, paths_by_pid)
          return if preflight_failed?

          run_loadability_probe(model, candidates)
        end

        # rubocop:disable Naming/PredicateMethod

        # Returns [true, nil] when all prefetched placements are :ready or
        # :unprepared (unprepared falls back to legacy, not a blocker).
        # Under Policy B (rebuild), returns [false, message] for the first :missing
        # or :invalid placement. Rebuild of existing geometry never degrades a real handle.
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

        # Policy B (insertion fallback, R4):
        # New furniture insertion (insert_furniture / place_existing_furniture)
        # allows missing assets to fall back to proxy boxes so designers are
        # not blocked by network or missing 3D assets.
        # However, invalid MountFrame preparation fails closed to protect data integrity.
        def insertion_preflight_ok?
          if @prefetch_results.empty?
            err = legacy_invalid_asset_preparation_error
            return err ? [false, err] : [true, nil]
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
        # rubocop:enable Naming/PredicateMethod

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

        def filter_hardware_placements(hardware_placements)
          hardware_placements.select do |p|
            p.respond_to?(:asset_id) && p.asset_id &&
              p.respond_to?(:asset_revision_id) && p.asset_revision_id
          end
        end

        def stage_download_assets(placements, org_id)
          paths = {}
          placements.each do |placement|
            pid = placement.respond_to?(:placement_id) ? placement.placement_id : nil
            next unless pid

            path = prefetch_single(placement, org_id: org_id)
            if path && File.file?(path)
              paths[pid] = path
            else
              @prefetch_results[pid] = :missing
            end
          end
          paths
        end

        def stage_validate_preparations(placements, paths_by_pid)
          candidates = []
          placements.each do |placement|
            pid = placement.respond_to?(:placement_id) ? placement.placement_id : nil
            next unless pid
            next if @prefetch_results[pid] == :missing

            prep_state = placement.respond_to?(:preparation_state) ? placement.preparation_state : nil
            if prep_state != 'prepared'
              @prefetch_results[pid] = :unprepared
            elsif prevalidate_preparation(placement)
              candidates << [placement, paths_by_pid[pid]]
            else
              @prefetch_results[pid] = :invalid
            end
          end
          mark_remaining_ready(candidates) if preflight_failed?
          candidates
        end

        def mark_remaining_ready(candidates)
          candidates.each do |(p, _)|
            pid = p.respond_to?(:placement_id) ? p.placement_id : nil
            @prefetch_results[pid] = :ready if pid
          end
        end

        def preflight_failed?
          @prefetch_results.values.intersect?(%i[missing invalid])
        end

        # R3: probes loadability in SketchUp with reversibility cleanup.
        # If any placement fails to load, newly loaded definitions are removed.
        def run_loadability_probe(model, candidates)
          unless model.respond_to?(:definitions)
            mark_remaining_ready(candidates)
            return
          end

          initial_definitions = snapshot_definitions(model)
          newly_loaded = []
          probe_failed = false

          candidates.each do |(placement, path)|
            pid = placement.respond_to?(:placement_id) ? placement.placement_id : nil
            defn = probe_loadability(model, path)
            if defn
              @prefetch_results[pid] = :ready if pid
              newly_loaded << defn if !initial_definitions.include?(defn) && !newly_loaded.include?(defn)
            else
              @prefetch_results[pid] = :missing if pid
              probe_failed = true
            end
          end

          revert_definitions(model, newly_loaded) if probe_failed
        end

        def snapshot_definitions(model)
          if model.definitions.respond_to?(:to_a)
            model.definitions.to_a
          elsif model.definitions.respond_to?(:map)
            model.definitions.map { |d| d }
          else
            []
          end
        end

        def revert_definitions(model, definitions)
          return unless model.respond_to?(:definitions) && model.definitions.respond_to?(:remove)

          definitions.each do |defn|
            model.definitions.remove(defn)
          rescue StandardError => e
            @logger&.warn('preflight_definition_revert_failed', error: e)
          end
          definitions.clear
        end

        def probe_loadability(model, skp_path)
          return nil unless model.respond_to?(:definitions)

          model.definitions.load(skp_path)
        rescue StandardError => e
          @logger&.warn('preflight_probe_loadability_failed', error: e, path: skp_path)
          nil
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

          is_hist = placement.respond_to?(:historical?) && placement.historical?
          diag_code = is_hist ? 'historical_asset_missing' : 'hardware_asset_missing'
          record_diagnostic(
            'code' => diag_code,
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

        # Builds a placement transformation.
        #
        # NOTE (R4, #670-D): When transform_mm is already an instance of
        # Geom::Transformation, it is ALREADY expressed in SketchUp internal units
        # (inches) and MUST NOT be reconverted. Passing an existing Geom::Transformation
        # returns it directly, preserving exact scale [1, 1, 1] and determinant +1.0.
        def build_transform(transform_mm, basis)
          return transform_mm if defined?(::Geom::Transformation) && transform_mm.is_a?(::Geom::Transformation)

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
