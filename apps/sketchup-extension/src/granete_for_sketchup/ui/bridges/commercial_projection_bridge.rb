# frozen_string_literal: true

# Proyección comercial (#642): callbacks del panel de proyección.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module CommercialProjectionBridge
        def register_commercial_projection_callbacks(dialog)
          dialog.add_action_callback('get_commercial_projection') do |_context, payload|
            handle_commercial_projection(dialog, payload)
          end
        end

        def handle_commercial_projection(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          request_id = payload['requestId'].to_s
          status = model_binding_connector.status
          result = commercial_projection_response(request_id, status)
          execute_bridge(dialog, 'onCommercialProjection', result)
        rescue Connection::CommercialProjection::Service::Error => e
          @logger.error('commercial_projection_failed', error: e)
          execute_bridge(dialog, 'onCommercialProjection', {
                           'requestId' => request_id, 'state' => e.kind.to_s, 'error' => e.message
                         })
        rescue StandardError => e
          @logger.error('commercial_projection_bridge_failed', error: e)
          error = 'no se pudo actualizar el presupuesto'
          execute_bridge(dialog, 'onCommercialProjection', {
                           'requestId' => request_id, 'state' => 'unavailable', 'error' => error
                         })
        end

        def commercial_projection_response(request_id, status)
          unless status['state'] == 'connected' && status['binding'].is_a?(Hash)
            error = 'el modelo debe estar conectado y actualizado para calcular el presupuesto'
            return { 'requestId' => request_id, 'state' => status['state'] || 'unavailable', 'error' => error }
          end

          binding = status['binding']
          project_id = binding['projectId']
          design_id = binding['designId']
          started_work = commercial_projection_local_work(project_id, design_id)
          if started_work['localChangesPending']
            return commercial_projection_stale_response(
              request_id, project_id, design_id, started_work,
              'hay cambios locales que todavía no están sincronizados'
            )
          end

          projection = @commercial_projection_service.fetch(project_id, design_id)
          finished_work = commercial_projection_local_work(project_id, design_id)
          if finished_work['localChangesPending'] ||
             finished_work['generation'] != started_work['generation'] ||
             finished_work['matchConfirmed'] != started_work['matchConfirmed']
            return commercial_projection_stale_response(
              request_id, project_id, design_id, finished_work,
              'el modelo cambió mientras se calculaba el presupuesto'
            )
          end

          { 'requestId' => request_id, 'projectId' => project_id, 'designId' => design_id,
            'state' => projection['status'], 'projection' => projection, 'workState' => finished_work }
        end

        def commercial_projection_stale_response(request_id, project_id, design_id, work_state, error)
          { 'requestId' => request_id, 'projectId' => project_id, 'designId' => design_id,
            'state' => 'stale', 'workState' => work_state, 'error' => error }
        end

        def commercial_projection_local_work(project_id, design_id)
          Connection::CommercialProjection::LocalWorkState.new(active_model).snapshot(
            project_id: project_id, design_id: design_id
          )
        end

        def mark_commercial_projection_local_work
          binding = commercial_projection_binding
          return nil unless binding

          Connection::CommercialProjection::LocalWorkState.new(active_model).mark_pending!(
            project_id: binding.project_id, design_id: binding.design_id
          )
        end

        def notify_commercial_projection_synchronization(scope = :partial)
          binding = commercial_projection_binding
          return nil unless binding

          state = Connection::CommercialProjection::LocalWorkState.new(active_model).record_sync!(
            project_id: binding.project_id, design_id: binding.design_id, scope: scope
          )
          execute_bridge(@dialog, 'onCommercialProjectionSynchronization', state) if @dialog&.visible?
          mark_host_save_pending
          state
        end

        def mark_host_save_pending
          return unless @save_awareness && active_model

          payload = @save_awareness.mark_synced(active_model)
          execute_bridge(@dialog, 'onHostSaveAwareness', payload) if @dialog&.visible?
          payload
        end

        private

        def commercial_projection_binding
          model = active_model
          return nil unless model

          Connection::ModelBinding::Store.new(model).read
        end
      end

      # #718 — bounded SketchUp-first commercial entry. Ruby owns binding,
      # local-work checks, credentials and the final server refetch; the
      # HtmlDialog receives presentation data only.
    end
  end
end
