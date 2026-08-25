# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Model
      # Paints groups with namespaced SketchUp materials so the workshop's
      # board choices are visible in the model. No-op when the runtime exposes
      # no materials API (pure stubs) or the layout carries no color.
      module MaterialApplier
        module_function

        def apply(model, group, name, color_hex)
          return unless color_hex.is_a?(String) && color_hex.start_with?('#')
          return unless model.respond_to?(:materials)

          materials = model.materials
          material_name = "Granete · #{name}"
          material = materials[material_name] if materials.respond_to?(:[])
          material ||= materials.add(material_name)
          material.color = color_hex if material.respond_to?(:color=)
          group.material = material if group.respond_to?(:material=)
        end
      end

      # Pure visual adapter and renderer for SketchUp.
      # Consumes resolved component layouts from @muebles/domain or generic slot definitions.
      # Contains ZERO manufacturing rules, zero machining calculation, and zero category-specific logic.
      class FurnitureBuilder
        DEFAULT_THICKNESS_MM = 18.0

        def initialize(metadata_store: nil, asset_loader: nil)
          @metadata_store = metadata_store
          @asset_loader = asset_loader
        end

        def insert_furniture(model, definition, raw_parameters = {}, resolved_layout: nil)
          parameters = normalize_parameters(definition, raw_parameters)
          instance_id = generate_instance_id

          model.start_operation("Insertar Mueble #{definition['name']}", true)
          entities = model.active_entities
          main_group = entities.add_group
          main_group.name = "#{definition['name']} (#{instance_id})"

          counts = render_layout(model, main_group, instance_id, definition, parameters, resolved_layout)
          MetadataWriter.write_furniture(@metadata_store, main_group, instance_id, definition, parameters)

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

        def update_furniture(model, group, definition, raw_parameters = {}, resolved_layout: nil)
          parameters = normalize_parameters(definition, raw_parameters)
          existing_meta = @metadata_store&.read(group)
          instance_id = existing_meta&.dig('identity', 'instanceRef') || generate_instance_id

          model.start_operation("Editar Mueble #{definition['name']}", true)
          group.entities.clear!

          counts = render_layout(model, group, instance_id, definition, parameters, resolved_layout)
          MetadataWriter.write_furniture(@metadata_store, group, instance_id, definition, parameters)

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
          MaterialApplier.apply(model, group, material_name, component['materialColorHex'])
          group
        end

        def render_resolved_hardware(model, main_group, instance_id, placement, index)
          name = placement['name'] || 'Herraje'
          pos = placement.dig('transform', 'translationMm') || [0, 0, 0]
          dims = placement['dimensionsMm'] || [96, 32, 25]

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
          scale = 1.0 / 25.4
          x = x_mm * scale
          y = y_mm * scale
          z = z_mm * scale
          dx = dx_mm * scale
          dy = dy_mm * scale
          dz = dz_mm * scale

          # Min-corner semantics: the face sits at the box bottom (z) and the
          # pull grows upward, so translationMm/pose z is always the AABB min.
          pts = [
            Geom::Point3d.new(x, y, z),
            Geom::Point3d.new(x + dx, y, z),
            Geom::Point3d.new(x + dx, y + dy, z),
            Geom::Point3d.new(x, y + dy, z)
          ]
          face = comp_group.entities.add_face(pts)
          face.pushpull(dz) if face && dz.positive?
        end
      end

      # Writes the semantic metadata dictionaries (furniture + component
      # levels) through the metadata store.
      module MetadataWriter
        module_function

        def write_furniture(store, main_group, instance_id, definition, parameters)
          return unless store

          metadata_payload = {
            'namespace' => 'com.granete.sketchup_extension',
            'metadataVersion' => 1,
            'kind' => 'furnitureInstance',
            'identity' => {
              'instanceRef' => instance_id,
              'projectRef' => 'project-sketchup-active',
              'sourceRevisionRef' => 'rev-1'
            },
            'intent' => {
              'semanticRole' => 'furniture-instance',
              'furnitureDefinitionId' => definition['furniture_definition_id'],
              'parameters' => parameters
            }
          }
          store.write(main_group, metadata_payload)
        end

        def write_component(store, comp_group, comp_id, slot_id)
          return unless store

          comp_meta = {
            'namespace' => 'com.granete.sketchup_extension',
            'metadataVersion' => 1,
            'kind' => 'componentInstance',
            'identity' => { 'instanceRef' => comp_id, 'projectRef' => 'project-sketchup-active' },
            'intent' => { 'semanticRole' => slot_id }
          }
          store.write(comp_group, comp_meta)
        end
      end
    end
  end
end
