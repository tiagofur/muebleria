# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      module ProjectFurniture
        # Presentation adapter for the host reconciliation projection. It does
        # not derive presence itself: one shared projection owns the exact
        # Project + WorkingCopy + top-level host scan.
        module PanelState
          module_function

          def build_panel_payload(reconciliation:, catalog_provider:)
            projection = reconciliation.projection
            return projection unless projection['state'] == 'connected'

            names = definition_names(catalog_provider)
            items = decorate_rows(projection['items'], names)
            projection.merge(
              'items' => items,
              'placed' => items.count { |row| row['reconciliationState'] == 'present_synced' },
              'pending' => items.count { |row| !row['terminal'] && !row['placed'] },
              'attention' => items.count { |row| row['blocking'] },
              # #810 sync surface: local edits the working copy has not
              # confirmed yet — placements/moves to confirm, deletions to
              # apply, authoring edits awaiting their fields.
              'dirty' => items.count do |row|
                row['pendingConfirm'] || row['reconciliationState'] == 'missing_local' || row['authoringDirty']
              end
            )
          end

          def decorate_rows(items, definition_names)
            counters = Hash.new(0)
            totals = items.each_with_object(Hash.new(0)) do |item, counts|
              counts[group_key(item)] += 1 if item['id']
            end

            items.map do |item|
              group = group_key(item)
              counters[group] += 1 if item['id']
              row(item, definition_names, counters[group], totals[group])
            end
          end

          def group_key(item)
            item['definitionId'] || "origin:#{item['origin']}"
          end

          def row(item, definition_names, unit_index, unit_total)
            dims = item['displayDimensions']
            state = item['reconciliationState']
            {
              'id' => item['id'],
              'name' => item['displayName'] || definition_names[item['definitionId']] || fallback_name(state),
              'dimensions' => dims,
              'dimensions_label' => dims ? "#{dims[0]} × #{dims[1]} × #{dims[2]} mm" : nil,
              'definitionId' => item['definitionId'],
              'origin' => item['origin'],
              'terminal' => state == 'terminal',
              'placed' => state == 'present_synced',
              'pendingConfirm' => state == 'pending_confirmation',
              'authoringDirty' => item['authoringDirty'] == true,
              'reconciliationState' => state,
              'blocking' => item['blocking'],
              'reason' => item['reason'],
              'localMatchCount' => item['localMatchCount'],
              'workingCopyMatchCount' => item['workingCopyMatchCount'],
              'unitIndex' => unit_index,
              'unitTotal' => unit_total
            }
          end

          def fallback_name(state)
            state == 'unknown' ? 'Entidad local no verificable' : 'Mueble del proyecto'
          end

          def definition_names(catalog_provider)
            return {} unless catalog_provider.respond_to?(:all_definitions)

            (catalog_provider.all_definitions || []).to_h do |definition|
              [definition['furniture_definition_id'], definition['name']]
            end
          end
        end
      end
    end
  end
end
