# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      module ProjectFurniture
        # Derives the panel rows from the authoritative instance list plus
        # the current working copy: placed = furnitureInstanceId present in
        # the working items (per unit, never per definition). Quantity > 1
        # stays N individually traceable rows; identical units get "Unidad n"
        # labels so the workshop can tell them apart without internal noise.
        module PanelState
          module_function

          def build(instances, working_copy, definition_names: {})
            placed_ids = Set.new
            (working_copy&.items || []).each do |item|
              placed_ids << item.furniture_instance_id
            end

            counter = Hash.new(0)
            totals = Hash.new(0)
            instances.each do |instance|
              totals[instance.furniture_definition_id || "origin:#{instance.origin}"] += 1
            end

            rows = instances.map do |instance|
              group = instance.furniture_definition_id || "origin:#{instance.origin}"
              counter[group] += 1
              row(instance, placed_ids.include?(instance.id), counter[group], totals[group], definition_names)
            end

            {
              'items' => rows,
              'pending' => rows.count { |row| !row['placed'] },
              'placed' => rows.count { |row| row['placed'] }
            }
          end

          # Flags rows whose unit has a local root but no working item yet:
          # the honest 'confirm your final position' state.
          def mark_pending_confirmation(rows)
            rows.each do |row|
              next if row['placed'] || row['terminal']

              located = yield(row['id'])
              row['pendingConfirm'] = !located.fetch('entity', nil).nil?
            end
            rows
          end

          def definition_names(catalog_provider)
            names = {}
            if catalog_provider.respond_to?(:all_definitions)
              (catalog_provider.all_definitions || []).each do |definition|
                names[definition['furniture_definition_id']] = definition['name']
              end
            end
            names
          end

          def error_state(error)
            case error.kind
            when :unauthenticated then 'unauthenticated'
            when :unauthorized then 'unauthorized'
            when :unreachable then 'unreachable'
            else 'error'
            end
          end

          def row(instance, placed, unit_index, unit_total, definition_names)
            name = instance.display_name ||
                   definition_names[instance.furniture_definition_id] ||
                   'Mueble del proyecto'
            dims = instance.display_dimensions
            {
              'id' => instance.id,
              'name' => name,
              'dimensions' => dims,
              'dimensions_label' => dims ? "#{dims[0]} × #{dims[1]} × #{dims[2]} mm" : nil,
              'definitionId' => instance.furniture_definition_id,
              'origin' => instance.origin,
              'terminal' => instance.lifecycle_status != 'active',
              'placed' => placed,
              'unitIndex' => unit_index,
              'unitTotal' => unit_total
            }
          end
        end
      end
    end
  end
end
