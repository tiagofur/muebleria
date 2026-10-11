# frozen_string_literal: true

# #1264 — Design opening geometry convergence: after a valid apply, the
# design's PLACED furniture rebuilds to the fresh opening truth (ONE batch,
# single undo); failures keep the previous geometry with an honest outcome.
# Contract: métodos de instancia incluidos en DialogController.
module Granete
  module SketchUpExtension
    module UserInterface
      module DesignOpeningGeometryBridge
        # Converges the design's placed furniture to the fresh opening truth
        # (server-born rebuild; pilot scope = the first module's units).
        def design_opening_converge_geometry(stored, state)
          target = design_opening_convergence_target(stored, state)
          return target if target.is_a?(Hash)

          definition, roots = target
          commands = roots.filter_map do |root|
            design_opening_rebuild_command(root, definition, stored.design_id)
          end
          return { 'status' => 'unchanged' } if commands.empty?

          outcome = mutation_coordinator.execute_batch(commands)
          if outcome.outcome == 'committed'
            { 'status' => 'converged', 'units' => commands.length }
          else
            { 'status' => 'failed', 'reason' => outcome.reason.to_s }
          end
        rescue StandardError => e
          @logger.error('design_opening_geometry_convergence_failed', error: e)
          { 'status' => 'failed', 'reason' => e.message }
        end

        # Preconditions + target discovery: a Hash return is the honest
        # outcome (skipped/unchanged/failed reason); [definition, roots] is
        # the converge target (the pilot module's placed units, #1261).
        def design_opening_convergence_target(stored, state)
          resolved = state.is_a?(Hash) && state['dimsKnown'] &&
                     state['resolution'].is_a?(Hash) && state['resolution']['state'] == 'resolved'
          return { 'status' => 'skipped' } unless resolved

          model = active_model
          return { 'status' => 'skipped' } unless model.respond_to?(:entities)

          first = design_opening_first_working_item(stored, model)
          return first if first.is_a?(Hash)

          definition = @catalog_provider&.find_definition(first.furniture_definition_id)
          if definition.nil?
            return { 'status' => 'skipped', 'reason' => 'la definición del mueble no está en el catálogo' }
          end

          metadata_store = @metadata_store_factory.call(model)
          roots = Connection::ProjectFurniture::ManagedFurniture
                  .index(model, metadata_store)[:by_id][first.furniture_instance_id]
                  .map { |entry| entry[:entity] }
          return { 'status' => 'unchanged' } if roots.empty?

          [definition, roots]
        end

        # The opening's pilot unit (#1261): first item with a definition.
        def design_opening_first_working_item(stored, _model)
          items = Array(design_opening_placer.service.get_working_copy(stored.design_id)&.items)
          return { 'status' => 'skipped', 'reason' => 'diseño sin muebles' } if items.empty?

          items.find { |i| !i.furniture_definition_id.to_s.strip.empty? } ||
            { 'status' => 'skipped', 'reason' => 'ninguna unidad del diseño tiene definición de mueble' }
        end

        # One coordinated rebuild command for a placed unit: design-pinned
        # resolve, server-born rebuild (no authoring_dirty), freshest-identity
        # context guard (#498).
        def design_opening_rebuild_command(root, definition, design_id)
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
            apply: design_opening_rebuild_apply(root, definition, intent)
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

        def design_opening_rebuild_apply(root, definition, intent)
          parameters = intent['parameters'] || {}
          choices = intent['materialChoices'] || {}
          lambda { |result, _host_context|
            outcome = furniture_builder_for(active_model).update_furniture(
              active_model, root, definition, parameters,
              resolved_layout: result.layout, material_choices: choices,
              transaction: false, authoring_dirty: false
            )
            raise Host::MutationCommand::ApplyRefused, outcome['error'].to_s unless outcome['success'] == true
          }
        end
      end
    end
  end
end
