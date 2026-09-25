# frozen_string_literal: true

# Panel Proyecto (#389): unidades del proyecto — lista, colocar, crear, restaurar,
# seleccionar, sincronización observada e inventario de host.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module ProjectFurnitureBridge # rubocop:disable Metrics/ModuleLength
        def register_project_furniture_callbacks(dialog)
          dialog.add_action_callback('get_project_furniture') { handle_get_project_furniture(dialog) }
          dialog.add_action_callback('place_furniture_instance') { |_c, p| handle_place_furniture_instance(dialog, p) }
          dialog.add_action_callback('create_project_furniture') { |_c, p| handle_create_project_furniture(dialog, p) }
          dialog.add_action_callback('confirm_placement_instance') do |_c, p|
            handle_confirm_placement_instance(dialog, p)
          end
          dialog.add_action_callback('cancel_placement_instance') do |_c, p|
            handle_cancel_placement_instance(dialog, p)
          end
          dialog.add_action_callback('restore_furniture_instance') do |_c, p|
            handle_restore_furniture_instance(dialog, p)
          end
          dialog.add_action_callback('select_project_furniture') { |_c, p| handle_select_project_furniture(p) }
          dialog.add_action_callback('validate_managed_furniture_identity') do
            handle_validate_managed_furniture_identity(dialog)
          end
          dialog.add_action_callback('rescan_duplicates') do
            handle_rescan_duplicates(dialog)
          end
          dialog.add_action_callback('synchronize_design') do
            handle_synchronize_design(dialog)
          end
        end

        # Panel payload: binding-aware reconciliation per furnitureInstanceId.
        def handle_get_project_furniture(dialog)
          result = project_furniture_placer.panel
          execute_bridge(dialog, 'onProjectFurniture', result)
        rescue StandardError => e
          @logger.error('project_furniture_panel_failed', error: e)
          execute_bridge(dialog, 'onProjectFurniture', { 'state' => 'error', 'reason' => e.message })
        end

        # #810 — the explicit "Sincronizar diseño" operation: one conscious
        # add/update/delete sync through the conflict-safe frontier, verified
        # by authoritative readback. Success refreshes the panel and marks the
        # commercial projection synchronized; the HtmlDialog refetches the
        # confirmed total from the backend (no local price math).
        def handle_synchronize_design(dialog)
          result = design_sync_synchronizer.synchronize_design
          execute_bridge(dialog, 'onSynchronizeDesignResult', result)
          if result['ok']
            notify_commercial_projection_synchronization(:full)
            handle_get_project_furniture(dialog)
            push_preflight_state(dialog)
            mark_host_save_pending
          end
        rescue StandardError => e
          @logger.error('design_sync_handler_failed', error: e)
          execute_bridge(dialog, 'onSynchronizeDesignResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Place EXISTING FurnitureInstance: identity arrives from the server
        # list; the placer guarantees no new business object is created and
        # the working copy keeps every other item.
        def handle_place_furniture_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          fi_id = payload['furnitureInstanceId'].to_s
          result = project_furniture_placer.place(fi_id)
          result['instanceId'] ||= fi_id
          if result['ok'] && @position_sync_coordinator
            model = active_model
            binding = Connection::ModelBinding::Store.new(model).read
            if binding
              preflight_review_session
              converged = @position_sync_coordinator.converge_inserted_unit(model, binding, fi_id)
              result = converged if converged['ok']
            end
          end
          result['instanceId'] ||= fi_id
          execute_bridge(dialog, 'onPlaceFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => fi_id })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_place_failed', error: e)
          execute_bridge(dialog, 'onPlaceFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'instanceId' => fi_id,
                           'reason' => 'No se pudo colocar el mueble (error interno de SketchUp).' })
        end

        # #390 / DT-6: Create and place from Catalog in design-first flow.
        def handle_create_project_furniture(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = project_furniture_placer.create_and_place(
            definition_id: payload['definitionId'].to_s,
            parameters: payload['parameters'] || {},
            material_choices: payload['materialChoices'] || {},
            idempotency_key: payload['idempotencyKey']
          )
          if result['ok'] && result['instanceId'] && @position_sync_coordinator
            model = active_model
            binding = Connection::ModelBinding::Store.new(model).read
            if binding
              preflight_review_session
              converged = @position_sync_coordinator.converge_inserted_unit(model, binding, result['instanceId'])
              result = converged if converged['ok']
            end
          end
          execute_bridge(dialog, 'onCreateProjectFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok'] && result['instanceId']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => result['instanceId'] })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_create_failed', error: e)
          execute_bridge(dialog, 'onCreateProjectFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def handle_confirm_placement_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          fi_id = payload['furnitureInstanceId'].to_s
          result = project_furniture_placer.confirm_placement(fi_id)
          execute_bridge(dialog, 'onConfirmPlacementResult', result)
          notify_commercial_projection_synchronization(:partial) if result['ok']
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => fi_id })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_confirm_failed', error: e)
          execute_bridge(dialog, 'onConfirmPlacementResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def handle_cancel_placement_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = project_furniture_placer.cancel_placement(payload['furnitureInstanceId'].to_s)
          execute_bridge(dialog, 'onCancelPlacementResult', result)
          handle_get_project_furniture(dialog) if result['ok']
        rescue StandardError => e
          @logger.error('project_furniture_cancel_failed', error: e)
          execute_bridge(dialog, 'onCancelPlacementResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def handle_restore_furniture_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          furniture_instance_id = payload['furnitureInstanceId'].to_s
          result = if mutation_coordinator.busy?
                     {
                       'ok' => false, 'code' => 'action_in_progress',
                       'reason' => 'hay otra modificación del modelo en curso',
                       'instanceId' => furniture_instance_id
                     }
                   else
                     project_furniture_placer.restore(furniture_instance_id)
                   end
          execute_bridge(dialog, 'onRestoreFurnitureResult', result)
          mark_host_save_pending if result['ok'] && result['restored'] == true
          handle_get_project_furniture(dialog)
        rescue StandardError => e
          @logger.error('project_furniture_restore_failed', error: e)
          execute_bridge(dialog, 'onRestoreFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Focus an already-placed unit: pure viewport selection state.
        def handle_select_project_furniture(raw_payload = nil)
          payload = if raw_payload.is_a?(String) && !raw_payload.strip.empty?
                      JSON.parse(raw_payload)
                    else
                      raw_payload || {}
                    end
          fi_id = payload['furnitureInstanceId'].to_s
          return if fi_id.empty?

          model = active_model
          located = Connection::ProjectFurniture::ManagedFurniture.locate(
            model, @metadata_store_factory.call(model), fi_id
          )
          if located['entity'] && model.respond_to?(:selection)
            model.selection.clear
            model.selection.add(located['entity'])
            @logger.info('project_furniture_selected', furniture_instance_id: fi_id)
          else
            @logger.warn('project_furniture_select_rejected', furniture_instance_id: fi_id)
          end
        rescue StandardError => e
          @logger.error('project_furniture_select_failed', error: e)
        end

        # Pushes a fresh panel payload when a visible dialog exists — used at
        # dialog ready and on active-document switches (the panel follows the
        # binding of whichever model is open).
        def refresh_project_furniture
          handle_get_project_furniture(@dialog) if @dialog&.visible?
        end

        def handle_observed_working_copy_commit
          notify_commercial_projection_synchronization(:partial)
          refresh_project_furniture
        end

        def handle_observed_position_sync_outcome(outcome = nil, **kwargs)
          return unless @dialog&.visible?

          outcome = kwargs if outcome.nil? || !outcome.is_a?(Hash)
          return unless outcome.is_a?(Hash)

          current = active_model
          return unless current
          return if outcome[:model] && !current.equal?(outcome[:model])
          return unless sync_outcome_binding_matches?(current, outcome[:binding])

          handle_get_project_furniture(@dialog)

          return unless outcome[:status] == :success

          push_preflight_state(@dialog)
          mark_host_save_pending
        end

        def sync_outcome_binding_matches?(current_model, outcome_binding)
          return true unless outcome_binding

          current_binding = if defined?(Connection::ModelBinding::Store)
                              Connection::ModelBinding::Store.new(current_model).read
                            end
          if current_binding
            return current_binding.project_id == outcome_binding.project_id &&
                   current_binding.design_id == outcome_binding.design_id &&
                   current_binding.base_revision_id == outcome_binding.base_revision_id
          end

          return true unless @model_binding_connector.respond_to?(:status)

          status = @model_binding_connector.status
          return true unless status.is_a?(Hash) && status['binding'].is_a?(Hash)

          b = status['binding']
          b['projectId'] == outcome_binding.project_id &&
            b['designId'] == outcome_binding.design_id &&
            b['baseRevisionId'] == outcome_binding.base_revision_id
        end

        def handle_observed_position_sync_complete(_event, _ids)
          return unless @dialog&.visible?

          handle_get_project_furniture(@dialog)
          push_preflight_state(@dialog)
          mark_host_save_pending
        end

        def handle_host_inventory_change
          refresh_project_furniture
        end

        # #391 / DT-7: Publish precheck for managed furniture identity.
        def handle_validate_managed_furniture_identity(dialog)
          result = if duplicate_resolver
                     duplicate_resolver.validate_model(active_model)
                   else
                     { 'valid' => true, 'code' => 'valid' }
                   end
          execute_bridge(dialog, 'onValidateFurnitureIdentityResult', result)
        rescue StandardError => e
          @logger.error('validate_managed_furniture_identity_failed', error: e)
          execute_bridge(dialog, 'onValidateFurnitureIdentityResult',
                         { 'valid' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #391 / DT-7: Rescan and resolve all duplicate identities in the model.
        def handle_rescan_duplicates(dialog)
          result = if duplicate_resolver
                     duplicate_resolver.rescan_and_resolve(active_model)
                   else
                     { 'ok' => false, 'code' => 'resolver_unavailable' }
                   end
          execute_bridge(dialog, 'onRescanDuplicatesResult', result)
          handle_get_project_furniture(dialog)
        rescue StandardError => e
          @logger.error('rescan_duplicates_failed', error: e)
          execute_bridge(dialog, 'onRescanDuplicatesResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        private

        def project_furniture_placer
          @project_furniture_placer
        end

        def duplicate_resolver
          @duplicate_resolver
        end
      end
    end
  end
end
