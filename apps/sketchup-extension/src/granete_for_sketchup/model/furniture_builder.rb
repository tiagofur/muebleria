# frozen_string_literal: true

require "securerandom"
require "json"

module Granete
  module SketchUpExtension
    module Model
      # Pure visual adapter and renderer for SketchUp.
      # Consumes resolved component layouts from @muebles/domain or generic slot definitions.
      # Contains ZERO manufacturing rules, zero drilling calculation, and zero category-specific logic.
      class FurnitureBuilder
        DEFAULT_THICKNESS_MM = 18.0

        def initialize(metadata_store: nil, asset_loader: nil)
          @metadata_store = metadata_store
          @asset_loader = asset_loader
        end

        # Inserts a new furniture instance into the model.
        # Accepts optional resolved_layout (from @muebles/domain resolveFurnitureLayout).
        def insert_furniture(model, definition, raw_parameters = {}, resolved_layout: nil)
          parameters = normalize_parameters(definition, raw_parameters)
          instance_id = "inst-#{SecureRandom.hex(4)}"

          model.start_operation("Insertar Mueble #{definition['name']}", true)
          entities = model.active_entities
          main_group = entities.add_group
          main_group.name = "#{definition['name']} (#{instance_id})"

          component_count = render_layout(main_group, instance_id, definition, parameters, resolved_layout)

          write_furniture_metadata(main_group, instance_id, definition, parameters)

          model.commit_operation

          {
            "success" => true,
            "instance_id" => instance_id,
            "name" => definition["name"],
            "component_count" => component_count,
            "parameters" => parameters
          }
        rescue StandardError => e
          model.abort_operation
          {
            "success" => false,
            "error" => e.message
          }
        end

        # In-Place MVP Update: clears inner entities and rebuilds layout preserving group transform and identity.
        # Future non-MVP architecture will perform differential component reconciliation (diff/patch).
        def update_furniture(model, group, definition, raw_parameters = {}, resolved_layout: nil)
          parameters = normalize_parameters(definition, raw_parameters)

          existing_meta = @metadata_store ? @metadata_store.read(group) : nil
          instance_id = existing_meta&.dig("identity", "instanceRef") || "inst-#{SecureRandom.hex(4)}"

          model.start_operation("Editar Mueble #{definition['name']}", true)

          # MVP strategy: Clear sub-entities inside group, preserving group.transformation in the model
          group.entities.clear!

          component_count = render_layout(group, instance_id, definition, parameters, resolved_layout)

          write_furniture_metadata(group, instance_id, definition, parameters)

          model.commit_operation

          {
            "success" => true,
            "instance_id" => instance_id,
            "name" => definition["name"],
            "component_count" => component_count,
            "parameters" => parameters
          }
        rescue StandardError => e
          model.abort_operation
          {
            "success" => false,
            "error" => e.message
          }
        end

        private

        def normalize_parameters(definition, raw_parameters)
          params = {}
          (definition["parameters"] || []).each do |p|
            name = p["name"]
            val = raw_parameters[name] || p["defaultValue"]
            params[name] = val
          end
          params
        end

        # Renders the layout. If a resolved layout is provided (from @muebles/domain),
        # it renders the exact resolved components without any parametric math.
        # Otherwise, falls back to generic slot bounding boxes.
        def render_layout(main_group, instance_id, definition, parameters, resolved_layout)
          if resolved_layout && resolved_layout["components"]
            render_resolved_components(main_group, instance_id, resolved_layout["components"])
          else
            render_generic_parametric_layout(main_group, instance_id, definition, parameters)
          end
        end

        def render_resolved_components(main_group, instance_id, components)
          components.each do |c|
            slot_id = c["slotId"] || c["role"] || "slot"
            name = c["name"] || slot_id
            pos = c.dig("transform", "translationMm") || [0, 0, 0]
            dims = c["dimensionsMm"] || [100, 100, 18]

            create_hierarchical_component(
              main_group,
              instance_id,
              slot_id,
              name,
              pos[0], pos[1], pos[2],
              dims[0], dims[1], dims[2]
            )
          end
          components.length
        end

        # Generic fallback layout generator that uses slots rather than hardcoded categories
        def render_generic_parametric_layout(main_group, instance_id, definition, parameters)
          width_mm = (parameters["widthMm"] || parameters["lengthMm"] || 600.0).to_f
          height_mm = (parameters["heightMm"] || 720.0).to_f
          depth_mm = (parameters["depthMm"] || 590.0).to_f
          thickness_mm = DEFAULT_THICKNESS_MM
          count = 0

          # Structural side panels
          create_hierarchical_component(main_group, instance_id, "left_side", "Lateral Izquierdo", 0, 0, 0, thickness_mm, depth_mm, height_mm)
          create_hierarchical_component(main_group, instance_id, "right_side", "Lateral Derecho", width_mm - thickness_mm, 0, 0, thickness_mm, depth_mm, height_mm)
          count += 2

          # Optional dynamic shelves
          shelf_count = (parameters["shelfCount"] || 0).to_i
          if shelf_count > 0
            spacing = height_mm / (shelf_count + 1)
            (1..shelf_count).each do |i|
              create_hierarchical_component(main_group, instance_id, "shelf_#{i}", "Entrepaño #{i}", thickness_mm, 0, spacing * i, width_mm - (2 * thickness_mm), depth_mm, thickness_mm)
              count += 1
            end
          end

          # Optional dynamic door
          door_count = (parameters["doorCount"] || 0).to_i
          if door_count == 1
            create_hierarchical_component(main_group, instance_id, "door_1", "Puerta", 0, depth_mm, 0, width_mm, thickness_mm, height_mm)
            count += 1
          end

          count
        end

        def create_hierarchical_component(main_group, furniture_instance_id, slot_id, name, x_mm, y_mm, z_mm, dx_mm, dy_mm, dz_mm)
          comp_group = main_group.entities.add_group
          comp_group.name = name
          comp_id = "comp-#{furniture_instance_id}-#{slot_id}"

          if @metadata_store
            comp_meta = {
              "namespace" => "com.granete.sketchup_extension",
              "metadataVersion" => 1,
              "kind" => "componentInstance",
              "identity" => {
                "instanceRef" => comp_id,
                "projectRef" => "project-sketchup-active"
              },
              "intent" => {
                "semanticRole" => slot_id
              }
            }
            @metadata_store.write(comp_group, comp_meta)
          end

          # Render 3D Part faces
          scale_to_inch = 1.0 / 25.4
          x = x_mm * scale_to_inch
          y = y_mm * scale_to_inch
          z = z_mm * scale_to_inch
          dx = dx_mm * scale_to_inch
          dy = dy_mm * scale_to_inch
          dz = dz_mm * scale_to_inch

          pts = [
            [x, y, z],
            [x + dx, y, z],
            [x + dx, y + dy, z],
            [x, y + dy, z]
          ]

          face = comp_group.entities.add_face(pts)
          face.pushpull(-dz) if face && dz > 0
          comp_group
        end

        def write_furniture_metadata(main_group, instance_id, definition, parameters)
          return unless @metadata_store

          metadata_payload = {
            "namespace" => "com.granete.sketchup_extension",
            "metadataVersion" => 1,
            "kind" => "furnitureInstance",
            "identity" => {
              "instanceRef" => instance_id,
              "projectRef" => "project-sketchup-active",
              "sourceRevisionRef" => "rev-1"
            },
            "intent" => {
              "semanticRole" => "furniture-instance",
              "furnitureDefinitionId" => definition["furniture_definition_id"],
              "parameters" => parameters
            }
          }
          @metadata_store.write(main_group, metadata_payload)
        end
      end
    end
  end
end
