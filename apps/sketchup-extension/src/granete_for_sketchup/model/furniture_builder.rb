# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Model
      # Paints groups with namespaced SketchUp materials so the workshop's
      # board choices and photographic textures are visible in the model. No-op
      # when the runtime exposes no materials API (pure stubs).
      module MaterialApplier
        DEFAULT_TILE_MM = 600.0
        MM_TO_INCHES = 1.0 / 25.4

        class << self
          def apply(model, group, name, color_hex, texture_path: nil, tile_width_mm: nil, tile_length_mm: nil,
                    grain: nil)
            return unless model.respond_to?(:materials)

            _ = grain
            material = find_or_create_material(model.materials, name)
            return unless material

            apply_color(material, color_hex)
            apply_texture(material, texture_path, tile_width_mm, tile_length_mm)
            group.material = material if group.respond_to?(:material=)
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

      # Pure visual adapter and renderer for SketchUp.
      # Consumes resolved component layouts from @muebles/domain or generic slot definitions.
      # Contains ZERO manufacturing rules, zero machining calculation, and zero category-specific logic.
      class FurnitureBuilder
        DEFAULT_THICKNESS_MM = 18.0

        def initialize(metadata_store: nil, asset_loader: nil, texture_cache: nil)
          @metadata_store = metadata_store
          @asset_loader = asset_loader
          @texture_cache = texture_cache
        end

        def insert_furniture(model, definition, raw_parameters = {}, resolved_layout: nil, material_choices: nil)
          parameters = normalize_parameters(definition, raw_parameters)
          instance_id = generate_instance_id

          model.start_operation("Insertar Mueble #{definition['name']}", true)
          entities = model.active_entities
          main_group = entities.add_group
          main_group.name = "#{definition['name']} (#{instance_id})"

          counts = render_layout(model, main_group, instance_id, definition, parameters, resolved_layout)
          MetadataWriter.write_furniture(@metadata_store, main_group, instance_id, definition, parameters,
                                         material_choices: material_choices)

          model.commit_operation
          prepare_placement(model, main_group)

          {
            'success' => true,
            'instance_id' => instance_id,
            'name' => definition['name'],
            'component_count' => counts['total'],
            'board_count' => counts['boards'],
            'hardware_count' => counts['hardware'],
            'parameters' => parameters
          }
        rescue StandardError => e
          model.abort_operation
          { 'success' => false, 'error' => e.message }
        end

        def update_furniture(model, group, definition, raw_parameters = {}, resolved_layout: nil,
                             material_choices: nil)
          parameters = normalize_parameters(definition, raw_parameters)
          existing_meta = @metadata_store&.read(group)
          instance_id = existing_meta&.dig('identity', 'instanceRef') || generate_instance_id

          model.start_operation("Editar Mueble #{definition['name']}", true)
          group.entities.clear!

          counts = render_layout(model, group, instance_id, definition, parameters, resolved_layout)
          MetadataWriter.write_furniture(@metadata_store, group, instance_id, definition, parameters,
                                         material_choices: material_choices)

          model.commit_operation

          {
            'success' => true,
            'instance_id' => instance_id,
            'name' => definition['name'],
            'component_count' => counts['total'],
            'board_count' => counts['boards'],
            'hardware_count' => counts['hardware'],
            'parameters' => parameters
          }
        rescue StandardError => e
          model.abort_operation
          { 'success' => false, 'error' => e.message }
        end

        private

        # Placement assist after commit: the group spawns at the workshop-frame
        # origin, so keep it selected and hand the user the Move tool to land it
        # where intended (interim step toward north-star drag/placement).
        # Never fails the reported insertion: selection and tool activation are
        # UI state, not model geometry.
        def prepare_placement(model, group)
          selection = model.respond_to?(:selection) ? model.selection : nil
          return unless selection

          selection.clear
          selection.add(group)
          ::Sketchup.send_action('selectMoveTool:') if defined?(::Sketchup) && ::Sketchup.respond_to?(:send_action)
        rescue StandardError
          nil
        end

        def generate_instance_id
          "inst-#{rand(0x1000..0xffff).to_s(16)}#{rand(0x1000..0xffff).to_s(16)}"
        end

        def normalize_parameters(definition, raw_parameters)
          params = {}
          (definition['parameters'] || []).each do |p|
            name = p['name']
            val = raw_parameters[name] || p['defaultValue']
            params[name] = val
          end
          params
        end

        def render_layout(model, main_group, instance_id, definition, parameters, resolved_layout)
          if resolved_layout && resolved_layout['components']
            render_resolved_components(model, main_group, instance_id, resolved_layout['components'],
                                       resolved_layout['hardware'] || [])
          else
            count = render_generic_parametric_layout(main_group, instance_id, definition, parameters)
            { 'total' => count, 'boards' => count, 'hardware' => 0 }
          end
        end

        # Renders the server-resolved composition. Each board and each visible
        # hardware placement arrives as a pre-baked AABB (translationMm is the
        # min corner in workshop space) — no composition math happens here.
        # Components are painted with SketchUp materials when the layout
        # carries a color (real board choice or role palette).
        def render_resolved_components(model, main_group, instance_id, components, hardware)
          components.each do |c|
            render_resolved_board(model, main_group, instance_id, c)
          end

          hardware.each_with_index do |h, index|
            render_resolved_hardware(model, main_group, instance_id, h, index)
          end

          { 'total' => components.length + hardware.length,
            'boards' => components.length,
            'hardware' => hardware.length }
        end

        def render_resolved_board(model, main_group, instance_id, component)
          slot_id = component['slotId'] || component['role'] || 'slot'
          name = component['name'] || slot_id
          pos = component.dig('transform', 'translationMm') || [0, 0, 0]
          dims = component['dimensionsMm'] || [100, 100, 18]

          group = create_hierarchical_component(
            main_group, instance_id, slot_id, name,
            pos[0], pos[1], pos[2], dims[0], dims[1], dims[2]
          )
          material_name = component['materialName'] || component['optionRole'] || slot_id
          texture_url = component['materialTextureUrl'] || component['materialImageUrl']
          texture_path = @texture_cache&.resolve_texture(texture_url)
          MaterialApplier.apply(
            model, group, material_name, component['materialColorHex'],
            texture_path: texture_path,
            tile_width_mm: component['materialTextureTileWidthMm'],
            tile_length_mm: component['materialTextureTileLengthMm'],
            grain: component['materialGrain']
          )
          group
        end

        def render_resolved_hardware(model, main_group, instance_id, placement, index)
          name = placement['name'] || 'Herraje'
          pos = placement.dig('transform', 'translationMm') || [0, 0, 0]
          dims = placement['dimensionsMm'] || [96, 32, 25]

          asset_id = placement['assetId'] || placement['hardwareId'] || placement['code']
          return if @asset_loader && asset_id && @asset_loader.load_asset_instance(model, asset_id, main_group, pos)

          group = create_hierarchical_component(
            main_group, instance_id, "hardware_#{placement['placementId'] || index}", name,
            pos[0], pos[1], pos[2], dims[0], dims[1], dims[2]
          )
          MaterialApplier.apply(model, group, name, placement['colorHex'])
          group
        end

        def render_generic_parametric_layout(main_group, instance_id, _definition, parameters)
          width_mm = (parameters['widthMm'] || parameters['lengthMm'] || 600.0).to_f
          height_mm = (parameters['heightMm'] || 720.0).to_f
          depth_mm = (parameters['depthMm'] || 590.0).to_f
          thickness_mm = DEFAULT_THICKNESS_MM
          count = 2

          create_hierarchical_component(
            main_group, instance_id, 'left_side', 'Lateral Izquierdo',
            0, 0, 0, thickness_mm, depth_mm, height_mm
          )
          create_hierarchical_component(
            main_group, instance_id, 'right_side', 'Lateral Derecho',
            width_mm - thickness_mm, 0, 0, thickness_mm, depth_mm, height_mm
          )

          count += render_generic_shelves(main_group, instance_id, parameters, width_mm, height_mm, depth_mm,
                                          thickness_mm)
          count += render_generic_doors(main_group, instance_id, parameters, width_mm, height_mm, depth_mm,
                                        thickness_mm)
          count
        end

        def render_generic_shelves(main_group, instance_id, parameters, width_mm, height_mm, depth_mm, thickness_mm)
          shelf_count = (parameters['shelfCount'] || 0).to_i
          return 0 if shelf_count <= 0

          spacing = height_mm / (shelf_count + 1)
          (1..shelf_count).each do |i|
            create_hierarchical_component(
              main_group, instance_id, "shelf_#{i}", "Entrepaño #{i}",
              thickness_mm, 0, spacing * i, width_mm - (2 * thickness_mm), depth_mm, thickness_mm
            )
          end
          shelf_count
        end

        def render_generic_doors(main_group, instance_id, parameters, width_mm, height_mm, depth_mm, thickness_mm)
          door_count = (parameters['doorCount'] || 0).to_i
          return 0 if door_count <= 0

          create_hierarchical_component(
            main_group, instance_id, 'door_1', 'Puerta',
            0, depth_mm, 0, width_mm, thickness_mm, height_mm
          )
          1
        end

        def create_hierarchical_component(main_group, furniture_instance_id, slot_id, name, x_mm, y_mm, z_mm, dx_mm,
                                          dy_mm, dz_mm)
          comp_group = main_group.entities.add_group
          comp_group.name = name
          comp_id = "comp-#{furniture_instance_id}-#{slot_id}"

          MetadataWriter.write_component(@metadata_store, comp_group, comp_id, slot_id)
          build_box_geometry(comp_group, x_mm, y_mm, z_mm, dx_mm, dy_mm, dz_mm)
          comp_group
        end

        def build_box_geometry(comp_group, x_mm, y_mm, z_mm, dx_mm, dy_mm, dz_mm)
          s = 1.0 / 25.4
          x = x_mm * s
          y = y_mm * s
          z = z_mm * s
          dx = dx_mm * s
          dy = dy_mm * s
          dz = dz_mm * s

          pts = [
            Geom::Point3d.new(x, y, z), Geom::Point3d.new(x + dx, y, z),
            Geom::Point3d.new(x + dx, y + dy, z), Geom::Point3d.new(x, y + dy, z)
          ]
          face = comp_group.entities.add_face(pts)
          return unless face

          face.reverse! if face.respond_to?(:normal) && face.normal.respond_to?(:z) && face.normal.z.negative?
          face.pushpull(dz) if dz.positive?
        end
      end

      # Writes the semantic metadata dictionaries (furniture + component
      # levels) through the metadata store.
      module MetadataWriter
        module_function

        def write_furniture(store, main_group, instance_id, definition, parameters, material_choices: nil)
          return unless store

          proj_ref = store.respond_to?(:project_ref) ? store.project_ref : 'project-sketchup-active'
          rev_ref = definition['revisionId'] || definition['version'] || 'rev-1'

          metadata_payload = {
            'namespace' => 'com.granete.sketchup_extension',
            'metadataVersion' => 1,
            'kind' => 'furnitureInstance',
            'identity' => {
              'instanceRef' => instance_id,
              'projectRef' => proj_ref,
              'sourceRevisionRef' => rev_ref
            },
            'intent' => {
              'semanticRole' => 'furniture-instance',
              'furnitureDefinitionId' => definition['furniture_definition_id'],
              'parameters' => parameters
            }
          }
          if material_choices.is_a?(Hash) && !material_choices.empty?
            metadata_payload['intent']['materialChoices'] = material_choices
          end
          store.write(main_group, metadata_payload)
        end

        def write_component(store, comp_group, comp_id, slot_id)
          return unless store

          proj_ref = store.respond_to?(:project_ref) ? store.project_ref : 'project-sketchup-active'

          comp_meta = {
            'namespace' => 'com.granete.sketchup_extension',
            'metadataVersion' => 1,
            'kind' => 'componentInstance',
            'identity' => { 'instanceRef' => comp_id, 'projectRef' => proj_ref },
            'intent' => { 'semanticRole' => slot_id }
          }
          store.write(comp_group, comp_meta)
        end
      end
    end
  end
end
