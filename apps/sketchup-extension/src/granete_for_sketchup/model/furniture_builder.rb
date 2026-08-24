# frozen_string_literal: true

require "securerandom"
require "json"

module Granete
  module SketchUpExtension
    module Model
      class FurnitureBuilder
        DEFAULT_THICKNESS_MM = 18.0

        def initialize(metadata_store: nil)
          @metadata_store = metadata_store
        end

        def insert_furniture(model, definition, raw_parameters = {})
          parameters = normalize_parameters(definition, raw_parameters)
          instance_id = "inst-#{SecureRandom.hex(4)}"
          component_count = 0

          model.start_operation("Insertar Mueble #{definition[name]}", true)
          entities = model.active_entities
          main_group = entities.add_group
          main_group.name = "#{definition[name]} (#{instance_id})"

          width_mm = (parameters["widthMm"] || 600.0).to_f
          height_mm = (parameters["heightMm"] || 720.0).to_f
          depth_mm = (parameters["depthMm"] || 590.0).to_f
          thickness_mm = DEFAULT_THICKNESS_MM

          category = definition["category"]

          if %w[kitchen_base kitchen_wall closet].include?(category)
            # Left panel
            create_panel_box(main_group, "Lateral Izquierdo", 0, 0, 0, thickness_mm, depth_mm, height_mm)
            component_count += 1

            # Right panel
            create_panel_box(main_group, "Lateral Derecho", width_mm - thickness_mm, 0, 0, thickness_mm, depth_mm, height_mm)
            component_count += 1

            # Shelves
            shelf_count = (parameters["shelfCount"] || 0).to_i
            if shelf_count > 0
              spacing = height_mm / (shelf_count + 1)
              (1..shelf_count).each do |i|
                shelf_z = spacing * i
                create_panel_box(main_group, "Entrepaño #{i}", thickness_mm, 0, shelf_z, width_mm - (2 * thickness_mm), depth_mm, thickness_mm)
                component_count += 1
              end
            end

            # Door
            door_count = (parameters["doorCount"] || 0).to_i
            if door_count == 1
              create_panel_box(main_group, "Puerta", 0, depth_mm, 0, width_mm, thickness_mm, height_mm)
              component_count += 1
            end
          elsif category == "desk"
            # Worktop
            create_panel_box(main_group, "Cubierta", 0, 0, height_mm - thickness_mm, width_mm, depth_mm, thickness_mm)
            component_count += 1

            # Legs
            create_panel_box(main_group, "Pata Izquierda", 0, 0, 0, thickness_mm, depth_mm, height_mm - thickness_mm)
            create_panel_box(main_group, "Pata Derecha", width_mm - thickness_mm, 0, 0, thickness_mm, depth_mm, height_mm - thickness_mm)
            component_count += 2
          else
            # Generic bounding box
            create_panel_box(main_group, "Cuerpo", 0, 0, 0, width_mm, depth_mm, height_mm)
            component_count += 1
          end

          if @metadata_store
            metadata_payload = {
              "namespace" => "com.granete.sketchup_extension",
              "metadataVersion" => 1,
              "kind" => "bootstrapIntent",
              "nonManufacturable" => true,
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

        def create_panel_box(parent_group, name, x_mm, y_mm, z_mm, dx_mm, dy_mm, dz_mm)
          sub_group = parent_group.entities.add_group
          sub_group.name = name

          # In SketchUp internal units are inches (1 inch = 25.4 mm)
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

          face = sub_group.entities.add_face(pts)
          face.pushpull(-dz) if face && dz > 0
          sub_group
        end
      end
    end
  end
end
