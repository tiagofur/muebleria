# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Model
      # Paints entities with namespaced SketchUp materials so the workshop's
      # board choices and photographic textures are visible in the model. No-op
      # when the runtime exposes no materials API (pure stubs). Rendering only:
      # a material here is never manufacturing truth.
      module MaterialApplier
        DEFAULT_TILE_MM = 600.0
        MM_TO_INCHES = 1.0 / 25.4

        class << self
          def apply(model, target, name, color_hex, texture_path: nil, tile_width_mm: nil, tile_length_mm: nil,
                    grain: nil)
            return unless model.respond_to?(:materials)

            _ = grain
            material = find_or_create_material(model.materials, name)
            return unless material

            apply_color(material, color_hex)
            apply_texture(material, texture_path, tile_width_mm, tile_length_mm)
            target.material = material if target.respond_to?(:material=)
          end

          private

          def find_or_create_material(materials, name)
            return nil unless materials

            material_name = "Granete · #{name}"
            material = materials[material_name] if materials.respond_to?(:[])
            material || (materials.add(material_name) if materials.respond_to?(:add))
          end

          def apply_color(material, color_hex)
            return unless color_hex.is_a?(String) && color_hex.start_with?('#') && material.respond_to?(:color=)

            material.color = color_hex
          end

          def apply_texture(material, texture_path, tile_width_mm, tile_length_mm)
            return unless texture_path && File.file?(texture_path) && material.respond_to?(:texture=)

            material.texture = texture_path
            apply_texture_dimensions(material.texture, tile_width_mm, tile_length_mm) if material.respond_to?(:texture)
          rescue StandardError
            # Fall back to color if SketchUp fails to load texture format
            nil
          end

          def apply_texture_dimensions(texture, tile_width_mm, tile_length_mm)
            return unless texture

            w_mm = tile_width_mm&.to_f&.positive? ? tile_width_mm.to_f : DEFAULT_TILE_MM
            l_mm = tile_length_mm&.to_f&.positive? ? tile_length_mm.to_f : DEFAULT_TILE_MM
            w_in = w_mm * MM_TO_INCHES
            l_in = l_mm * MM_TO_INCHES

            if texture.respond_to?(:size=)
              texture.size = [w_in, l_in]
            elsif texture.respond_to?(:width=) && texture.respond_to?(:height=)
              texture.width = w_in
              texture.height = l_in
            end
          end
        end
      end

      # Local solid geometry + authoritative transform application (#414 →
      # #415). Pure host mechanics: build the definition-local box at origin
      # and turn the contract basis/translation into a Geom::Transformation.
      # Never world/AABB coordinates, never a mirror, never a scale.
      module LocalGeometry
        MM_TO_INCHES = 1.0 / 25.4

        module_function

        # furniture_point = translationMm + basis · local_point. The basis is
        # orthonormal right-handed (parser-validated), so this is a pure
        # rigid placement — mirrors and non-uniform scale are impossible here.
        def axes_transform(translation_mm, basis)
          Geom::Transformation.axes(
            Geom::Point3d.new(translation_mm[0] * MM_TO_INCHES,
                              translation_mm[1] * MM_TO_INCHES,
                              translation_mm[2] * MM_TO_INCHES),
            Geom::Vector3d.new(basis['x'][0], basis['x'][1], basis['x'][2]),
            Geom::Vector3d.new(basis['y'][0], basis['y'][1], basis['y'][2]),
            Geom::Vector3d.new(basis['z'][0], basis['z'][1], basis['z'][2])
          )
        end

        def translation_only(translation_mm)
          Geom::Transformation.translation(
            Geom::Vector3d.new(translation_mm[0] * MM_TO_INCHES,
                               translation_mm[1] * MM_TO_INCHES,
                               translation_mm[2] * MM_TO_INCHES)
          )
        end

        # Builds the LOCAL solid box at the definition origin: the local box
        # spans [0,width]×[0,thickness]×[0,length] on X/Y/Z (engine
        # convention the #414 basis maps onto the furniture frame). World/AABB
        # coordinates are never baked into definition geometry.
        def build_local_box(definition, width_mm, thickness_mm, length_mm)
          w = width_mm * MM_TO_INCHES
          t = thickness_mm * MM_TO_INCHES
          l = length_mm * MM_TO_INCHES

          pts = [
            Geom::Point3d.new(0, 0, 0), Geom::Point3d.new(w, 0, 0),
            Geom::Point3d.new(w, t, 0), Geom::Point3d.new(0, t, 0)
          ]
          face = definition.entities.add_face(pts)
          return unless face

          face.reverse! if face.respond_to?(:normal) && face.normal.respond_to?(:z) && face.normal.z.negative?
          face.pushpull(l) if l.positive?
        end
      end

      # Generic authoring fallback for catalogs that cannot resolve layouts
      # (offline/static): locally authored axis-aligned boards with identity
      # basis by construction — not an orientation guess — still rendered as
      # native ComponentInstances.
      module GenericAuthoringRenderer
        DEFAULT_THICKNESS_MM = 18.0
        PART_DEFINITION_PREFIX = 'Granete · Parte · '

        def render_generic_parametric_layout(model, furniture_definition, instance_id, _definition, parameters)
          width_mm = (parameters['widthMm'] || parameters['lengthMm'] || 600.0).to_f
          height_mm = (parameters['heightMm'] || 720.0).to_f
          depth_mm = (parameters['depthMm'] || 590.0).to_f
          thickness_mm = DEFAULT_THICKNESS_MM
          count = 2

          create_generic_component(model, furniture_definition, instance_id, 'left_side', 'Lateral Izquierdo',
                                   [0, 0, 0], [thickness_mm, depth_mm, height_mm])
          create_generic_component(model, furniture_definition, instance_id, 'right_side', 'Lateral Derecho',
                                   [width_mm - thickness_mm, 0, 0], [thickness_mm, depth_mm, height_mm])

          count += render_generic_shelves(model, furniture_definition, instance_id, parameters,
                                          width_mm, height_mm, depth_mm, thickness_mm)
          count += render_generic_doors(model, furniture_definition, instance_id, parameters,
                                        width_mm, height_mm, depth_mm, thickness_mm)
          count
        end

        private

        def render_generic_shelves(model, furniture_definition, instance_id, parameters,
                                   width_mm, height_mm, depth_mm, thickness_mm)
          shelf_count = (parameters['shelfCount'] || 0).to_i
          return 0 if shelf_count <= 0

          spacing = height_mm / (shelf_count + 1)
          (1..shelf_count).each do |i|
            create_generic_component(model, furniture_definition, instance_id, "shelf_#{i}", "Entrepaño #{i}",
                                     [thickness_mm, 0, spacing * i],
                                     [width_mm - (2 * thickness_mm), depth_mm, thickness_mm])
          end
          shelf_count
        end

        def render_generic_doors(model, furniture_definition, instance_id, parameters,
                                 width_mm, height_mm, depth_mm, thickness_mm)
          door_count = (parameters['doorCount'] || 0).to_i
          return 0 if door_count <= 0

          create_generic_component(model, furniture_definition, instance_id, 'door_1', 'Puerta',
                                   [0, depth_mm, 0], [width_mm, thickness_mm, height_mm])
          1
        end

        def create_generic_component(model, parent_definition, furniture_instance_id, slot_id, name, pos_mm, dims_mm)
          comp_id = "comp-#{furniture_instance_id}-#{slot_id}"
          component_definition = model.definitions.add("#{PART_DEFINITION_PREFIX}#{name} · #{comp_id}")
          LocalGeometry.build_local_box(component_definition, dims_mm[0], dims_mm[1], dims_mm[2])
          instance = parent_definition.entities.add_instance(component_definition,
                                                             LocalGeometry.translation_only(pos_mm))
          instance.name = name
          ChildMetadataWriter.write_part(@metadata_store, instance, comp_id, slot_id,
                                         furniture_ref: furniture_instance_id)
          instance
        end
      end

      # Normalizes editable furniture intent without resolving manufacturing
      # geometry. Material choices are merged as role-keyed authoring intent;
      # only Granete's NativeLayout may supply their physical consequences.
      module FurnitureIntent
        private

        def normalize_parameters(definition, raw_parameters)
          (definition['parameters'] || []).each_with_object({}) do |parameter, params|
            name = parameter['name']
            if raw_parameters.key?(name)
              params[name] = raw_parameters[name]
            elsif parameter.key?('defaultValue')
              params[name] = parameter['defaultValue']
            end
          end
        end

        def merge_material_choices(existing_meta, incoming_choices)
          existing = existing_meta&.dig('intent', 'materialChoices')
          existing = {} unless existing.is_a?(Hash)
          return existing.dup unless incoming_choices.is_a?(Hash)

          existing.merge(incoming_choices)
        end

        def material_choices_changed?(existing_meta, merged_choices)
          existing = existing_meta&.dig('intent', 'materialChoices')
          existing = {} unless existing.is_a?(Hash)
          merged_choices != existing
        end
      end

      # #389 / DT-5 — Place EXISTING project FurnitureInstance. Extracted
      # from FurnitureBuilder to keep the class within its length budget; it
      # shares the builder's private helpers and metadata writer.
      module ProjectPlacement
        # Renders the same native hierarchy as insert_furniture but stamps
        # the BACKEND's furnitureInstanceId as the authoritative business
        # identity. The ID arrives from the server (project furniture list)
        # and is never generated, derived from a definition/name/position or
        # reused from any local ref. Returns the placed entity handle so the
        # caller can read the final transform and sync the design working
        # copy; on any host error the operation aborts leaving no partial
        # hierarchy. relationships follows the MetadataWriter tri-state.
        # rubocop:disable-next Metrics/ParameterLists
        def place_existing_furniture(model, furniture_instance_id:, definition:, parameters: {},
                                     resolved_layout: nil, material_choices: nil,
                                     project_id: nil, design_id: nil, relationships: nil,
                                     transformation: nil, prepare: true, preserve_parameters: false,
                                     transaction: true)
          unless furniture_instance_id.is_a?(String) && !furniture_instance_id.strip.empty?
            return { 'success' => false,
                     'error' => 'Se requiere la identidad (furnitureInstanceId) del mueble del proyecto' }
          end

          params = if preserve_parameters
                     JSON.parse(JSON.generate(parameters || {}))
                   else
                     normalize_parameters(definition, parameters)
                   end
          prefetch_visual_assets(model, resolved_layout)
          prep_err = insertion_preflight_error
          return { 'success' => false, 'error' => prep_err } if prep_err

          host_transform = transformation || Geom::Transformation.new
          model.start_operation("Colocar Mueble del Proyecto #{definition['name']}", true) if transaction
          begin
            furniture_definition = create_furniture_definition(model, definition, furniture_instance_id)
            # FurnitureInstance roots are TOP-LEVEL (native entity model
            # §5/§12 + ManagedFurniture locator): insert into model.entities
            # regardless of any open editing context, so the unit can never
            # land nested inside another group/component and become
            # untraceable.
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            furniture = model.entities.add_instance(furniture_definition,
                                                    host_transform)
            furniture.name = "#{definition['name']} (#{furniture_instance_id})"
            counts = render_layout(model, furniture_definition, furniture_instance_id, definition,
                                   params, resolved_layout)
            MetadataWriter.write_furniture(@metadata_store, furniture, furniture_instance_id,
                                           definition, params,
                                           material_choices: material_choices,
                                           identity: { server: true, project_id: project_id,
                                                       design_id: design_id },
                                           relationships: relationships)
            model.commit_operation if transaction
          rescue StandardError => e
            model.abort_operation if transaction
            return { 'success' => false, 'error' => e.message }
          end

          prepare_placement(model, furniture) if prepare
          { 'entity' => furniture }.merge(build_result(furniture_instance_id, definition, params, counts))
        end

        # Placement assist after commit: the furniture spawns at the
        # workshop-frame origin, so keep it selected and hand the user the
        # Move tool to land it where intended (interim step toward north-star
        # drag/placement). Never fails the reported operation: selection and
        # tool activation are UI state, not model geometry.
        def prepare_placement(model, furniture)
          selection = model.respond_to?(:selection) ? model.selection : nil
          return unless selection

          selection.clear
          selection.add(furniture)
          ::Sketchup.send_action('selectMoveTool:') if defined?(::Sketchup) && ::Sketchup.respond_to?(:send_action)
        rescue StandardError
          nil
        end

        # Reverts a JUST-placed furniture when the backend working-copy sync
        # failed (#389 failure atomicity): the insertion was new and its
        # generated definitions are isolated, so erasing the top-level entity
        # plus purging orphan Granete definitions restores the pre-place
        # state. Only ever call this with an entity this builder just created
        # in this session — never with user-authored or adopted geometry.
        def rollback_placement(model, furniture)
          model.start_operation('Revertir Colocación', true)
          begin
            # Destroy the managed children first so their part definitions
            # lose the last live instance and the scoped purge below can
            # remove them (same order update_furniture uses). The root is
            # erased from the model root — where place_existing_furniture
            # inserted it.
            furniture.definition.entities.clear! if furniture.respond_to?(:definition)
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            model.entities.erase_entities([furniture])
            purge_orphan_generated_definitions(model)
            model.commit_operation
            true
          rescue StandardError
            model.abort_operation
            false
          end
        end
      end

      # Legacy Group → native migration build (#416 / SU-ENT-3). Extracted
      # from FurnitureBuilder to keep the class within its length budget;
      # it shares the builder's private helpers and metadata writer.
      module LegacyMigrationBuild
        # Builds the native ComponentInstance replacement for a legacy Group
        # furniture (#416 / SU-ENT-3) INSIDE the caller's undoable operation.
        # The migration migrator owns the single SketchUp operation: this
        # method must never start/commit its own (nested operations invalidate
        # Ruby entity references on the real host — Metadata::Store rule).
        #
        # Identity is preserved verbatim through existing_metadata (same
        # instanceRef/projectRef — a representation change NEVER allocates new
        # business identity); the world transform comes from the legacy Group;
        # the layout must be an authoritative NativeLayout, never a local
        # guess. The legacy source is NOT erased here — the migrator erases it
        # only after the replacement validates.
        def build_migrated_furniture(model, legacy_group, definition, parameters, resolved_layout,
                                     existing_metadata, material_choices: nil)
          instance_id = existing_metadata&.dig('identity', 'instanceRef')
          unless instance_id.is_a?(String) && !instance_id.strip.empty?
            raise ArgumentError, 'el mueble anterior no tiene instanceRef preservable'
          end
          unless resolved_layout.is_a?(Library::NativeLayout)
            raise ArgumentError, 'la migración requiere un layout resuelto autoritativo (NativeLayout)'
          end

          furniture_definition = create_furniture_definition(model, definition, instance_id)
          furniture = model.active_entities.add_instance(furniture_definition, legacy_group.transformation)
          furniture.name = "#{definition['name']} (#{instance_id})"
          counts = render_layout(model, furniture_definition, instance_id, definition, parameters,
                                 resolved_layout)
          purge_orphan_generated_definitions(model)
          MetadataWriter.write_furniture(
            @metadata_store, furniture, instance_id, definition, parameters,
            material_choices: material_choices, existing_metadata: existing_metadata,
            migrated_from: MetadataWriter::PROVENANCE_FROM_LEGACY_GROUP
          )
          validate_migrated_replacement(furniture, instance_id, counts)
          furniture
        end

        # Post-build validation gate (#416 step 5): the migrator may only
        # erase the legacy source after this passes. Raises on any mismatch so
        # the caller aborts the operation and the legacy Group survives.
        def validate_migrated_replacement(furniture, instance_id, counts)
          unless furniture.is_a?(::Sketchup::ComponentInstance)
            raise 'migración: el reemplazo no es una ComponentInstance nativa'
          end
          raise 'migración: el layout resuelto no produjo componentes' if counts['total'].to_i <= 0

          replaced_metadata = @metadata_store&.read(furniture)
          unless replaced_metadata&.dig('identity', 'instanceRef') == instance_id
            raise 'migración: la identidad preservada no sobrevivió al reemplazo'
          end

          provenance = replaced_metadata&.dig('provenance', 'representationMigration')
          unless provenance&.dig('from') == MetadataWriter::PROVENANCE_FROM_LEGACY_GROUP
            raise 'migración: falta el marcador de provenance de representación'
          end

          nil
        end
      end

      # Hardware rendering for Library::NativeLayout (#414 / #668).
      module NativeHardwareRenderer # rubocop:disable Metrics/ModuleLength
        # Prefetches visual assets, passing model so AssetLoader can probe
        # R2 SKP loadability before any destructive rebuild (R1/R2, #668-C1 / #670-D).
        def prefetch_visual_assets(model, resolved_layout)
          return unless resolved_layout.is_a?(Library::NativeLayout)
          return unless @asset_loader.respond_to?(:prefetch_hardware_assets)

          @asset_loader.clear_diagnostics if @asset_loader.respond_to?(:clear_diagnostics)
          placements = resolved_layout.hardware.dup
          if resolved_layout.respond_to?(:assemblies) && resolved_layout.assemblies
            resolved_layout.assemblies.each do |assembly|
              placements.concat(assembly.rigid_members) if assembly.respond_to?(:rigid_members)
            end
          end
          @asset_loader.prefetch_hardware_assets(placements, model: model)
        end

        # Returns a typed error message when any prefetched placement is
        # :missing (download/loadability failure) or :invalid (bad MountFrame).
        # Falls back to the original asset_preparation_invalid scan when the
        # loader does not support rebuild_preflight_ok? (backward-compatible).
        def rebuild_preflight_error
          if @asset_loader.respond_to?(:rebuild_preflight_ok?)
            ok, msg = @asset_loader.rebuild_preflight_ok?
            return msg unless ok

            return nil
          end

          # Fallback: original behavior for loaders without preflight support.
          return nil unless @asset_loader.respond_to?(:diagnostics)

          diag = @asset_loader.diagnostics.find { |d| d['code'] == 'asset_preparation_invalid' }
          diag ? "Preparación de herraje inválida: #{diag['reason']}" : nil
        end

        # Policy B (insertion fallback, R4): returns a typed error only when
        # preparation is :invalid. Placements that are :missing (download failure
        # or loadability failure) return nil here so new furniture insertion
        # (insert_furniture / place_existing_furniture) falls back to parametric
        # proxy geometry without blocking the designer workflow.
        def insertion_preflight_error
          if @asset_loader.respond_to?(:insertion_preflight_ok?)
            ok, msg = @asset_loader.insertion_preflight_ok?
            return msg unless ok

            return nil
          end

          return nil unless @asset_loader.respond_to?(:diagnostics)

          diag = @asset_loader.diagnostics.find { |d| d['code'] == 'asset_preparation_invalid' }
          diag ? "Preparación de herraje inválida: #{diag['reason']}" : nil
        end

        def render_native_hardware(model, parent_definition, furniture_instance_id, placement,
                                   placement_transform: nil)
          name = placement.name || 'Herraje'
          pos = placement_transform || placement.local_translation || placement.translation || [0.0, 0.0, 0.0]

          instance = try_load_hardware_asset(model, parent_definition, placement, pos)
          return attach_hardware_metadata(instance, placement, name, furniture_instance_id, exact: true) if instance
          return nil if invalid_hardware_preparation?(placement.placement_id)

          fallback = build_fallback_hardware(model, parent_definition, name, placement, pos)
          attach_hardware_metadata(fallback, placement, name, furniture_instance_id, exact: false)
        end

        private

        def try_load_hardware_asset(model, parent_definition, placement, pos)
          asset_id = placement.asset_id || placement.hardware_id
          return nil unless @asset_loader && asset_id

          @asset_loader.load_asset_instance(
            model, asset_id, parent_definition, pos,
            basis: placement.basis,
            revision_id: placement.asset_revision_id,
            sha256: placement.sha256,
            expected_bytes: placement.expected_bytes,
            mount_frame: placement.respond_to?(:mount_frame) ? placement.mount_frame : nil,
            preparation_state: placement.respond_to?(:preparation_state) ? placement.preparation_state : nil,
            placement_id: placement.placement_id
          )
        end

        def invalid_hardware_preparation?(placement_id)
          return false unless @asset_loader.respond_to?(:diagnostics)

          @asset_loader.diagnostics.any? do |d|
            d['code'] == 'asset_preparation_invalid' && d['placementId'] == placement_id
          end
        end

        def build_fallback_hardware(model, parent_definition, name, placement, pos)
          dims = placement.dimensions || FurnitureBuilder::DEFAULT_HARDWARE_DIMS_MM
          hardware_definition = model.definitions.add(
            "#{FurnitureBuilder::HARDWARE_DEFINITION_PREFIX}#{name} · #{placement.placement_id}"
          )
          LocalGeometry.build_local_box(hardware_definition, dims[0], dims[1], dims[2])
          transform = if defined?(::Geom::Transformation) && pos.is_a?(::Geom::Transformation)
                        pos
                      elsif placement.basis
                        LocalGeometry.axes_transform(pos, placement.basis)
                      else
                        LocalGeometry.translation_only(pos)
                      end
          instance = parent_definition.entities.add_instance(hardware_definition, transform)
          instance.name = name
          MaterialApplier.apply(model, instance, name, placement.color_hex)
          instance
        end

        def attach_hardware_metadata(instance, placement, name, furniture_instance_id, exact: true)
          instance.name = name
          rep = exact ? (placement.representation || 'exact') : 'proxy'
          ChildMetadataWriter.write_hardware(
            @metadata_store, instance, placement.placement_id,
            furniture_ref: furniture_instance_id,
            hardware_definition_id: placement.hardware_id,
            host_component_instance_id: placement.host_component_instance_id,
            placement_kind: placement.placement_kind,
            anchor_face: placement.anchor_face,
            offset_mm: placement.offset_mm,
            asset_id: placement.asset_id,
            asset_revision_id: placement.asset_revision_id,
            representation: rep,
            preparation_state: placement.respond_to?(:preparation_state) ? placement.preparation_state : nil,
            assembly_instance_id: placement.respond_to?(:assembly_instance_id) ? placement.assembly_instance_id : nil,
            agregado_id: placement.respond_to?(:agregado_id) ? placement.agregado_id : nil,
            member_id: placement.respond_to?(:member_id) ? placement.member_id : nil,
            recipe_revision: placement.respond_to?(:recipe_revision) ? placement.recipe_revision : nil,
            snapshot_id: placement.respond_to?(:snapshot_id) ? placement.snapshot_id : nil,
            is_historical: placement.respond_to?(:historical?) ? placement.historical? : false
          )
          instance
        end
      end

      # Renders resolved Library::NativeLayout composition (#414 contract / #670-D).
      # Extracted from FurnitureBuilder to keep the class within its length budget.
      module NativeLayoutRenderer # rubocop:disable Metrics/ModuleLength
        def render_native_layout(model, furniture_definition, instance_id, native_layout)
          native_layout.boards.each do |board|
            render_native_board(model, furniture_definition, instance_id, board)
          end
          native_layout.hardware.each do |placement|
            render_native_hardware(model, furniture_definition, instance_id, placement)
          end
          assembly_counts = render_native_assemblies(model, furniture_definition, instance_id, native_layout)
          total_boards = native_layout.boards.length + assembly_counts['boards']
          total_hardware = native_layout.hardware.length + assembly_counts['hardware']
          {
            'total' => total_boards + total_hardware,
            'boards' => total_boards,
            'hardware' => total_hardware,
            'assemblies' => assembly_counts['assemblies']
          }
        end

        def render_native_assemblies(model, furniture_definition, instance_id, native_layout)
          boards_count = 0
          hardware_count = 0
          assemblies_count = 0
          if native_layout.respond_to?(:assemblies) && native_layout.assemblies
            native_layout.assemblies.each do |assembly|
              counts = render_native_assembly(model, furniture_definition, instance_id, assembly)
              boards_count += counts['boards']
              hardware_count += counts['hardware']
              assemblies_count += 1
            end
          end
          { 'boards' => boards_count, 'hardware' => hardware_count, 'assemblies' => assemblies_count }
        end

        def render_native_assembly(model, furniture_definition, instance_id, assembly)
          t_assembly = LocalGeometry.axes_transform(assembly.translation, assembly.basis)
          boards = render_assembly_fabricated_components(model, furniture_definition, instance_id,
                                                         assembly, t_assembly)
          hardware = render_assembly_rigid_members(model, furniture_definition, instance_id,
                                                   assembly, t_assembly)
          { 'boards' => boards, 'hardware' => hardware }
        end

        def render_assembly_fabricated_components(model, furniture_definition, instance_id, assembly, t_assembly)
          count = 0
          assembly.fabricated_components.each do |comp|
            t_comp = LocalGeometry.axes_transform(comp.translation, comp.basis)
            t_furniture = t_assembly * t_comp
            render_native_board(
              model, furniture_definition, instance_id, comp,
              placement_transform: t_furniture,
              assembly_instance_id: assembly.assembly_instance_id,
              agregado_id: assembly.agregado_id,
              component_id: comp.component_id,
              recipe_revision: assembly.recipe_revision,
              snapshot_id: assembly.snapshot_id,
              is_historical: assembly.historical?
            )
            count += 1
          end
          count
        end

        def render_assembly_rigid_members(model, furniture_definition, instance_id, assembly, t_assembly)
          count = 0
          assembly.rigid_members.each do |member|
            t_member = LocalGeometry.axes_transform(member.translation, member.basis)
            t_furniture = t_assembly * t_member
            render_native_hardware(
              model, furniture_definition, instance_id, member,
              placement_transform: t_furniture
            )
            count += 1
          end
          count
        end

        # rubocop:disable-next Metrics/ParameterLists
        def render_native_board(model, parent_definition, furniture_instance_id, board,
                                placement_transform: nil, assembly_instance_id: nil,
                                agregado_id: nil, component_id: nil,
                                recipe_revision: nil, snapshot_id: nil, is_historical: false)
          name = board.name || board.slot_id || board.component_instance_id
          board_definition = model.definitions.add(
            "#{FurnitureBuilder::PART_DEFINITION_PREFIX}#{name} · #{board.component_instance_id}"
          )
          LocalGeometry.build_local_box(board_definition, board.width_mm, board.thickness_mm, board.length_mm)

          transform = placement_transform || LocalGeometry.axes_transform(board.translation, board.basis)
          instance = parent_definition.entities.add_instance(board_definition, transform)
          instance.name = name

          paint_board(model, instance, board)
          ChildMetadataWriter.write_part(
            @metadata_store, instance, board.component_instance_id, board.slot_id,
            component_definition_id: board.component_definition_id,
            catalog_component_id: board.catalog_component_id,
            furniture_ref: furniture_instance_id,
            role: board.role,
            material_binding_role: board.option_role,
            assembly_translation_mm: board.translation,
            authoring_capability: board.authoring_capability,
            assembly_instance_id: assembly_instance_id,
            agregado_id: agregado_id,
            component_id: component_id,
            recipe_revision: recipe_revision,
            snapshot_id: snapshot_id,
            is_historical: is_historical
          )
          instance
        end

        def paint_board(model, instance, board)
          material_name = board.material_name || board.option_role || board.slot_id || 'Tablero'
          texture_url = board.material_texture_url || board.material_image_url
          texture_path = @texture_cache&.resolve_texture(texture_url)
          MaterialApplier.apply(
            model, instance, material_name, board.material_color_hex,
            texture_path: texture_path,
            tile_width_mm: board.material_texture_tile_width_mm,
            tile_length_mm: board.material_texture_tile_length_mm,
            grain: board.material_grain
          )
        end
      end

      # Native SketchUp renderer (#415 / ADR-0004). Every managed furniture is
      # a top-level Sketchup::ComponentInstance with an isolated generated
      # ComponentDefinition; every managed board/hardware is a nested
      # ComponentInstance whose definition holds LOCAL geometry at origin and
      # whose transform is the authoritative #414 local→furniture placement.
      #
      # Pure visual adapter: zero manufacturing rules/thickness calculation,
      # zero orientation inference, zero world-AABB baking and zero
      # non-uniform scaling. Granete IDs never derive from host IDs.
      class FurnitureBuilder
        include GenericAuthoringRenderer
        include FurnitureIntent
        include ProjectPlacement
        include LegacyMigrationBuild
        include NativeHardwareRenderer
        include NativeLayoutRenderer

        MM_TO_INCHES = 1.0 / 25.4
        DEFAULT_HARDWARE_DIMS_MM = [96.0, 32.0, 25.0].freeze

        FURNITURE_DEFINITION_PREFIX = 'Granete · Mueble · '
        PART_DEFINITION_PREFIX = 'Granete · Parte · '
        HARDWARE_DEFINITION_PREFIX = 'Granete · Herraje · '
        LEGACY_REPRESENTATION_ERROR =
          'El mueble usa una representación anterior del plugin (Group) que aún no fue ' \
          'migrada a ComponentInstance nativo. Usá Granete → Migrar modelos ' \
          'anteriores para actualizarlo.'
        MATERIAL_RESOLUTION_REQUIRED_ERROR =
          'El cambio de material requiere una composición nativa resuelta por Granete; ' \
          'el mueble anterior no fue modificado.'

        def initialize(metadata_store: nil, asset_loader: nil, texture_cache: nil)
          @metadata_store = metadata_store
          @asset_loader = asset_loader
          @texture_cache = texture_cache
        end

        def insert_furniture(model, definition, raw_parameters = {}, resolved_layout: nil, material_choices: nil)
          parameters = normalize_parameters(definition, raw_parameters)
          instance_id = generate_instance_id

          prefetch_visual_assets(model, resolved_layout)
          prep_err = insertion_preflight_error
          return { 'success' => false, 'error' => prep_err } if prep_err

          model.start_operation("Insertar Mueble #{definition['name']}", true)
          begin
            furniture_definition = create_furniture_definition(model, definition, instance_id)
            # Transformation.new IS the identity transform on the real host
            # (there is no Transformation.identity constructor).
            furniture = model.active_entities.add_instance(furniture_definition,
                                                           Geom::Transformation.new)
            furniture.name = "#{definition['name']} (#{instance_id})"
            counts = render_layout(model, furniture_definition, instance_id, definition, parameters,
                                   resolved_layout)
            MetadataWriter.write_furniture(@metadata_store, furniture, instance_id, definition, parameters,
                                           material_choices: material_choices)
            model.commit_operation
          rescue StandardError => e
            model.abort_operation
            return { 'success' => false, 'error' => e.message }
          end

          prepare_placement(model, furniture)
          build_result(instance_id, definition, parameters, counts)
        end

        # Rebuilds the furniture INSIDE its existing isolated host definition:
        # the top-level instance (identity + world transform) is never
        # replaced, only its definition's children are regenerated. Child
        # persistent_ids may change; Granete contract IDs are the durable link.
        def update_furniture(model, furniture, definition, raw_parameters = {}, resolved_layout: nil,
                             material_choices: nil, transaction: true, relationships: nil)
          # Host-accurate native check: in SketchUp a Group ALSO responds to
          # #definition, so entity type — not duck typing — is the only safe
          # discriminator. Legacy Group representations fail closed: use the
          # migration workflow (Granete → Migrar modelos anteriores).
          unless furniture.is_a?(::Sketchup::ComponentInstance)
            return { 'success' => false, 'error' => LEGACY_REPRESENTATION_ERROR }
          end

          parameters = normalize_parameters(definition, raw_parameters)
          existing_meta = @metadata_store&.read(furniture)
          instance_id = existing_meta&.dig('identity', 'instanceRef') || generate_instance_id
          merged_material_choices = merge_material_choices(existing_meta, material_choices)

          if material_choices_changed?(existing_meta, merged_material_choices) &&
             !resolved_layout.is_a?(Library::NativeLayout)
            return { 'success' => false, 'error' => MATERIAL_RESOLUTION_REQUIRED_ERROR }
          end

          prefetch_visual_assets(model, resolved_layout)
          prep_err = rebuild_preflight_error
          return { 'success' => false, 'error' => prep_err } if prep_err

          model.start_operation("Editar Mueble #{definition['name']}", true) if transaction
          begin
            # A native copy/paste can temporarily leave two top-level furniture
            # instances sharing one host definition. Isolate the target before
            # touching its children so FI-A can never mutate FI-B. make_unique
            # returns this same instance and preserves its world transform.
            furniture.make_unique if furniture.definition.instances.length > 1
            furniture_definition = furniture.definition
            furniture_definition.entities.clear!
            counts = render_layout(model, furniture_definition, instance_id, definition, parameters,
                                   resolved_layout)
            purge_orphan_generated_definitions(model)
            MetadataWriter.write_furniture(
              @metadata_store, furniture, instance_id, definition, parameters,
              material_choices: merged_material_choices, existing_metadata: existing_meta,
              relationships: relationships
            )
            model.commit_operation if transaction
          rescue StandardError => e
            if transaction
              model.abort_operation
              return { 'success' => false, 'error' => e.message }
            end
            raise
          end

          build_result(instance_id, definition, parameters, counts)
        end

        private

        def generate_instance_id
          "inst-#{rand(0x1000..0xffff).to_s(16)}#{rand(0x1000..0xffff).to_s(16)}"
        end

        def build_result(instance_id, definition, parameters, counts)
          res = {
            'success' => true,
            'instance_id' => instance_id,
            'name' => definition['name'],
            'component_count' => counts['total'],
            'board_count' => counts['boards'],
            'hardware_count' => counts['hardware'],
            'parameters' => parameters
          }
          res['assembly_count'] = counts['assemblies'] if counts['assemblies']
          if @asset_loader.respond_to?(:diagnostics) && !@asset_loader.diagnostics.empty?
            res['diagnostics'] = @asset_loader.diagnostics.dup
          end
          res
        end

        # The top-level host definition is isolated per FurnitureInstance
        # (ADR-0004 §6): two units of the same Granete FurnitureDefinition
        # each get their own generated definition, so a rebuild of FI-A can
        # never mutate FI-B through a shared definition.
        def create_furniture_definition(model, definition, instance_id)
          model.definitions.add("#{FURNITURE_DEFINITION_PREFIX}#{definition['name']} · #{instance_id}")
        end

        def render_layout(model, furniture_definition, instance_id, definition, parameters, resolved_layout)
          case resolved_layout
          when Library::NativeLayout
            render_native_layout(model, furniture_definition, instance_id, resolved_layout)
          when nil
            count = render_generic_parametric_layout(model, furniture_definition, instance_id,
                                                     definition, parameters)
            { 'total' => count, 'boards' => count, 'hardware' => 0 }
          else
            raise ArgumentError,
                  'resolved_layout debe ser un Library::NativeLayout parseado vía LayoutContract.parse! ' \
                  '(contrato granete.local-basis.v1); el renderer no consume bodies crudos ni infiere AABBs'
          end
        end

        # Scoped generated-definition cleanup (ADR-0004 §22): only Granete
        # BOARD/HARDWARE definitions with zero live instances are removed after
        # a rebuild. Never a broad purge — user/third-party definitions stay.
        def purge_orphan_generated_definitions(model)
          definitions = model.respond_to?(:definitions) ? model.definitions : nil
          return unless definitions.respond_to?(:each) && definitions.respond_to?(:remove)

          orphans = definitions.select do |definition|
            (definition.name.to_s.start_with?(PART_DEFINITION_PREFIX) ||
             definition.name.to_s.start_with?(HARDWARE_DEFINITION_PREFIX)) &&
              definition.respond_to?(:instances) && definition.instances.empty?
          end
          orphans.each { |definition| definitions.remove(definition) }
        end
      end

      # Managed child (part/hardware) metadata writer, extracted to keep
      # MetadataWriter within its length budget. Same store, same envelope.
      module ChildMetadataWriter
        module_function

        # write_part: managed physical part/aggregate occurrence.
        # component_definition_id is the #346 stable authoring-definition ID
        # (Granete-owned); catalog_component_id is a separate optional
        # catalog reference namespace that never aliases it. placement,
        # assembly_translation_mm and authoring_capability carry the
        # server-resolved state of the occurrence (#467): display/affordance
        # seeds only — the authoring resolve re-reads the fresh authoritative
        # layout before mutating.
        # rubocop:disable-next Metrics/ParameterLists
        def write_part(store, entity, comp_id, slot_id, component_definition_id: nil,
                       catalog_component_id: nil, furniture_ref: nil, role: nil,
                       material_binding_role: nil, entity_class: 'part',
                       assembly_translation_mm: nil, authoring_capability: nil,
                       assembly_instance_id: nil, agregado_id: nil, component_id: nil,
                       recipe_revision: nil, snapshot_id: nil, is_historical: false)
          return unless store

          identity = child_identity(store, comp_id, furniture_ref)
          identity['componentDefinitionId'] = component_definition_id if component_definition_id
          identity['catalogComponentId'] = catalog_component_id if catalog_component_id
          apply_assembly_metadata(identity, assembly_instance_id, agregado_id, component_id, 'componentId',
                                  recipe_revision: recipe_revision, snapshot_id: snapshot_id,
                                  is_historical: is_historical)

          intent = { 'entityClass' => entity_class }
          intent['semanticRole'] = slot_id if slot_id
          intent['placement'] = slot_id if slot_id
          intent['role'] = role if role
          intent['materialBindingRole'] = material_binding_role if material_binding_role
          intent['assemblyTranslationMm'] = assembly_translation_mm if assembly_translation_mm
          intent['authoringCapability'] = authoring_capability if authoring_capability
          apply_assembly_metadata(intent, assembly_instance_id, agregado_id, component_id, 'componentId',
                                  recipe_revision: recipe_revision, snapshot_id: snapshot_id,
                                  is_historical: is_historical)

          write_child(store, entity, identity, intent)
        end

        # write_hardware: managed hardware placement occurrence (#476 / #670-D).
        # rubocop:disable-next Metrics/ParameterLists
        def write_hardware(store, entity, placement_id, furniture_ref:,
                           hardware_definition_id: nil, host_component_instance_id: nil,
                           placement_kind: nil, anchor_face: nil, offset_mm: nil,
                           asset_id: nil, asset_revision_id: nil, representation: nil,
                           preparation_state: nil,
                           assembly_instance_id: nil, agregado_id: nil, member_id: nil,
                           recipe_revision: nil, snapshot_id: nil, is_historical: false)
          return unless store

          proj_ref = store.respond_to?(:project_ref) ? store.project_ref : 'project-sketchup-active'
          identity = {
            'instanceRef' => placement_id,
            'hardwarePlacementId' => placement_id,
            'projectRef' => proj_ref
          }
          identity['furnitureInstanceRef'] = furniture_ref if furniture_ref
          apply_assembly_metadata(identity, assembly_instance_id, agregado_id, member_id, 'memberId',
                                  recipe_revision: recipe_revision, snapshot_id: snapshot_id,
                                  is_historical: is_historical)

          intent = { 'entityClass' => 'hardware' }
          intent['semanticRole'] = "hardware_#{placement_id}"
          intent['hardwareDefinitionId'] = hardware_definition_id if hardware_definition_id
          intent['hostComponentInstanceId'] = host_component_instance_id if host_component_instance_id
          # Only the contract's #350 provenance is stored; a missing/legacy
          # value stays absent so the resolver reports 'unknown' fail-closed.
          intent['placementKind'] = placement_kind if placement_kind
          intent['anchorFace'] = anchor_face if anchor_face
          intent['offsetMm'] = offset_mm if offset_mm
          intent['assetId'] = asset_id if asset_id
          intent['assetRevisionId'] = asset_revision_id if asset_revision_id
          intent['representation'] = representation if representation
          intent['preparationState'] = preparation_state if preparation_state
          apply_assembly_metadata(intent, assembly_instance_id, agregado_id, member_id, 'memberId',
                                  recipe_revision: recipe_revision, snapshot_id: snapshot_id,
                                  is_historical: is_historical)

          write_child(store, entity, identity, intent)
        end

        def apply_assembly_metadata(hash, assembly_instance_id, agregado_id, item_id, item_key,
                                    recipe_revision: nil, snapshot_id: nil, is_historical: false)
          return unless assembly_instance_id

          hash['assemblyInstanceId'] = assembly_instance_id
          hash['agregadoId'] = agregado_id if agregado_id
          hash[item_key] = item_id if item_id
          hash['recipeRevision'] = recipe_revision if recipe_revision
          hash['snapshotId'] = snapshot_id if snapshot_id
          hash['isHistorical'] = true if is_historical
        end

        def child_identity(store, comp_id, furniture_ref)
          proj_ref = store.respond_to?(:project_ref) ? store.project_ref : 'project-sketchup-active'
          identity = {
            'instanceRef' => comp_id,
            'componentInstanceId' => comp_id,
            'projectRef' => proj_ref
          }
          identity['furnitureInstanceRef'] = furniture_ref if furniture_ref
          identity
        end

        def write_child(store, entity, identity, intent)
          store.write(entity, {
                        'namespace' => 'com.granete.sketchup_extension',
                        'metadataVersion' => 1,
                        'kind' => 'componentInstance',
                        'identity' => identity,
                        'intent' => intent
                      })
        end
      end

      # Writes the semantic metadata dictionaries (furniture + component
      # levels) through the metadata store. Granete contract IDs are
      # namespaced authoring identity: host GUID/persistent_id/name are never
      # stored as business identity and rename never mutates them. Piezas y
      # herrajes keep SEPARATE occurrence namespaces (componentInstanceId vs
      # hardwarePlacementId) that never alias each other.
      module MetadataWriter
        module_function

        # #416 representation-migration provenance source (marker, never
        # identity): rebuilt from the legacy Group model.
        PROVENANCE_FROM_LEGACY_GROUP = 'legacy-group'

        # identity (optional, #389): { server: true, project_id:, design_id: }
        # marks a placement whose instance_id IS the backend
        # furnitureInstanceId; a copied existing_metadata keeps a previously
        # stored server identity through rebuilds with no flag.
        def write_furniture(store, furniture, instance_id, definition, parameters,
                            material_choices: nil, existing_metadata: nil, migrated_from: nil,
                            identity: nil, relationships: nil)
          return unless store

          proj_ref = store.respond_to?(:project_ref) ? store.project_ref : 'project-sketchup-active'
          rev_ref = definition['revisionId'] || definition['version'] || 'rev-1'
          metadata_payload = json_copy(existing_metadata.is_a?(Hash) ? existing_metadata : {})
          write_envelope(metadata_payload)
          metadata_payload['identity'] = furniture_identity(metadata_payload, instance_id, proj_ref,
                                                            rev_ref, identity: identity)
          metadata_payload['intent'] = furniture_intent(metadata_payload, definition, parameters, material_choices)
          metadata_payload['provenance'] = representation_migration(migrated_from) if migrated_from
          apply_relationship_state(metadata_payload, relationships)
          store.write(furniture, metadata_payload)
        end

        # Relationship persistence is tri-state (#558): nil means the caller
        # supplied NO relationship state and the existing metadata must survive
        # verbatim; [] is the authoritative empty set and clears; a non-empty
        # Array replaces with the authoritative resolve output. Anything else
        # is a programming error, never a silent guess.
        def apply_relationship_state(payload, relationships)
          case relationships
          when nil
            nil
          when Array
            if relationships.empty?
              payload.delete('relationships')
            else
              payload['relationships'] = relationships
            end
          else
            raise ArgumentError, 'relationships debe ser nil o un Array de relaciones resueltas'
          end
        end

        # #389 identity convergence: with a server identity the
        # furnitureInstanceId is the authority and instanceRef aliases the
        # SAME value — a compat locator, never a second business identity.
        # Local insertions keep a local ref until #390; rebuilds preserve
        # whatever the copied identity already carries.
        def furniture_identity(payload, instance_id, project_ref, revision_ref, identity: nil)
          identity_hash = payload['identity'].is_a?(Hash) ? payload['identity'] : {}
          if identity.is_a?(Hash) && identity[:server]
            identity_hash['furnitureInstanceId'] = instance_id
            identity_hash['instanceRef'] = instance_id
          else
            identity_hash['instanceRef'] ||= instance_id
          end
          project_id = identity.is_a?(Hash) ? identity[:project_id] : nil
          design_id = identity.is_a?(Hash) ? identity[:design_id] : nil
          identity_hash['projectId'] = project_id if project_id && !project_id.to_s.strip.empty?
          identity_hash['designId'] = design_id if design_id && !design_id.to_s.strip.empty?
          identity_hash['projectRef'] ||= project_ref
          identity_hash['sourceRevisionRef'] = revision_ref
          identity_hash
        end

        # Provenance marker retained after a successful migration (#416 step
        # 6): historical fact, so later edits keep it; only the migration
        # itself sets it.
        def representation_migration(from)
          { 'representationMigration' => { 'from' => from, 'markerVersion' => 1 } }
        end

        def json_copy(value)
          JSON.parse(JSON.generate(value))
        end

        def write_envelope(payload)
          payload['namespace'] = 'com.granete.sketchup_extension'
          payload['metadataVersion'] = 1
          payload['kind'] = 'furnitureInstance'
        end

        def furniture_intent(payload, definition, parameters, material_choices)
          intent = payload['intent'].is_a?(Hash) ? payload['intent'] : {}
          intent['semanticRole'] ||= 'furniture-instance'
          intent['furnitureDefinitionId'] = definition['furniture_definition_id']
          version = definition['definition_version'] || definition['definitionVersion'] || definition['version']
          intent['definitionVersion'] = version unless version.nil?
          intent['parameters'] = parameters
          intent['materialChoices'] = material_choices if material_choices.is_a?(Hash) && !material_choices.empty?
          intent
        end
      end
    end
  end
end
