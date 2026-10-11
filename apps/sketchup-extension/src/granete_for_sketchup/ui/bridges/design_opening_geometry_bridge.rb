# frozen_string_literal: true

# #1264 — Design opening geometry convergence: after a valid apply, the
# design's PLACED furniture rebuilds to the fresh opening truth (ONE batch,
# single undo); failures keep the previous geometry with an honest outcome.
# Contract: métodos de instancia incluidos en DialogController.
module Granete
  module SketchUpExtension
    module UserInterface
      module DesignOpeningGeometryBridge # rubocop:disable Metrics/ModuleLength
        # Converges the design's placed furniture to the fresh opening truth
        # (server-born rebuild; pilot scope = the first module's units).
        def design_opening_converge_geometry(stored, state)
          targets = design_opening_convergence_targets(stored, state)
          return targets if targets.is_a?(Hash)

          channel_spec = design_opening_channel_spec(state)
          channel_results = []
          commands = targets.filter_map do |target|
            design_opening_rebuild_command(target[:root], target[:definition], stored.design_id,
                                           channel_spec, channel_results)
          end
          return { 'status' => 'unchanged', 'reason' => 'muebles no colocados' } if commands.empty?

          outcome = mutation_coordinator.execute_batch(commands)
          if outcome.outcome == 'committed'
            answer = { 'status' => 'converged', 'units' => commands.length }
            channel = design_opening_channel_summary(channel_spec, channel_results)
            answer['channel'] = channel if channel
            answer
          else
            { 'status' => 'failed', 'reason' => outcome.reason.to_s }
          end
        rescue StandardError => e
          @logger.error('design_opening_geometry_convergence_failed', error: e)
          { 'status' => 'failed', 'reason' => e.message }
        end

        # Finds all placed units in the active model belonging to the design (#1261).
        def design_opening_convergence_targets(stored, state)
          resolved = state.is_a?(Hash) && state['dimsKnown'] &&
                     state['resolution'].is_a?(Hash) && state['resolution']['state'] == 'resolved'
          return { 'status' => 'skipped' } unless resolved
          return { 'status' => 'skipped' } unless active_model.respond_to?(:entities)

          items = Array(design_opening_placer.service.get_working_copy(stored.design_id)&.items)
          return { 'status' => 'skipped', 'reason' => 'diseño sin muebles' } if items.empty?

          targets, matched, skipped_definition = collect_placed_design_targets(active_model, items)
          if targets.empty? && skipped_definition.positive?
            reason = "la definición del mueble no está en el catálogo local (#{skipped_definition})"
            return { 'status' => 'unchanged', 'reason' => reason }
          end
          if targets.empty? && matched.zero?
            return { 'status' => 'unchanged', 'reason' => 'mueble no colocado en el modelo' }
          end

          targets
        end

        def collect_placed_design_targets(model, items)
          items_by_id = items.to_h { |i| [i.furniture_instance_id, i] }
          store = @metadata_store_factory.call(model)
          placed = Connection::ProjectFurniture::ManagedFurniture.index(model, store)[:by_id]
          targets = []
          matched = 0
          skipped_definition = 0
          placed.each do |fi_id, entries|
            item = items_by_id[fi_id]
            next unless item

            matched += entries.length
            entries.each do |e|
              # #1272: a pre-fix working item may carry a NULL definition while
              # its placed root still holds the placement's persisted intent —
              # the root's own intent is the fallback, never a name guess.
              intent = e[:metadata].is_a?(Hash) ? (e[:metadata]['intent'] || {}) : {}
              definition_id = item.furniture_definition_id || intent['furnitureDefinitionId']
              defn = definition_id && @catalog_provider&.find_definition(definition_id)
              if defn
                targets << { root: e[:entity], definition: defn }
              else
                skipped_definition += 1
              end
            end
          end
          [targets, matched, skipped_definition]
        end

        # One coordinated rebuild command for a placed unit: design-pinned
        # resolve, server-born rebuild (no authoring_dirty), freshest-identity
        # context guard (#498).
        def design_opening_rebuild_command(root, definition, design_id, channel_spec = nil,
                                           channel_results = nil)
          metadata = @metadata_store_factory.call(active_model).read(root)
          identity = metadata&.dig('identity') || {}
          intent = metadata&.dig('intent') || {}
          instance_ref = identity['instanceRef'].to_s
          return nil if instance_ref.empty?

          target = { 'furnitureInstanceRef' => instance_ref }
          server_id = identity['furnitureInstanceId'].to_s
          target['furnitureInstanceId'] = server_id unless server_id.empty?

          context_guard = lambda {
            model = active_model
            current = @metadata_store_factory.call(model).read(root)
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            current&.dig('identity', 'instanceRef') == instance_ref && model.entities.to_a.include?(root)
          }

          Host::MutationCommand.new(
            name: 'update_furniture',
            operation_name: "Aplicar Apertura · #{definition['name']}",
            semantic_target: target,
            resolve: design_opening_rebuild_resolve(definition, intent, design_id),
            context_valid: context_guard,
            apply: design_opening_rebuild_apply(root, definition, intent, channel_spec, channel_results)
          )
        end

        def design_opening_rebuild_resolve(definition, intent, design_id)
          parameters = intent['parameters'] || {}
          choices = intent['materialChoices'] || {}
          lambda { |ctx|
            layout = @catalog_provider.resolved_native_layout(
              definition['furniture_definition_id'], parameters, choices, design_id
            )
            # Fail-closed: never rebuild to a generic preview.
            if layout.nil?
              raise Library::LayoutResolutionError,
                    'el canal de resolución de autoría no está disponible para actualizar la apertura'
            end

            Host::LayoutResolveResult.new(layout: layout, message_id: ctx[:message_id],
                                          idempotency_key: ctx[:idempotency_key])
          }
        end

        def design_opening_rebuild_apply(root, definition, intent, channel_spec = nil, channel_results = nil)
          parameters = intent['parameters'] || {}
          choices = intent['materialChoices'] || {}
          lambda { |result, _host_context|
            outcome = furniture_builder_for(active_model).update_furniture(
              active_model, root, definition, parameters,
              resolved_layout: result.layout, material_choices: choices,
              transaction: false, authoring_dirty: false
            )
            raise Host::MutationCommand::ApplyRefused, outcome['error'].to_s unless outcome['success'] == true

            # The channel placeholder is auxiliary visualization (#1272): it
            # never fails the rebuild that already committed — an honest
            # skip rides the outcome instead.
            if channel_spec
              channel = design_opening_draw_channel_placeholder(active_model, root, channel_spec)
              channel_results << channel if channel_results
            end
          }
        end
      end
    end
  end
end
