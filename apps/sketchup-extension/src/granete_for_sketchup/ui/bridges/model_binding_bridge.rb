# frozen_string_literal: true

# Vinculación modelo↔proyecto/diseño (#388): estado, conexión manual, pairing, adopt.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module ModelBindingBridge
        # Registers the binding action callbacks. Kept in the bridge so the
        # controller class body stays within its length budget and every
        # binding concern lives in one place.
        def register_model_binding_callbacks(dialog)
          # #388 / DT-4: model ↔ Project/Design binding surface. The dialog
          # only ever sees connector results — never raw business identity.
          dialog.add_action_callback('get_model_binding') { handle_get_model_binding(dialog) }
          dialog.add_action_callback('list_binding_projects') { handle_list_binding_projects(dialog) }
          dialog.add_action_callback('list_binding_designs') { |_c, p| handle_list_binding_designs(dialog, p) }
          dialog.add_action_callback('connect_model') { |_c, p| handle_connect_model(dialog, p) }
          # #499 Slice 3: one-time pairing code receive — the normal
          # Web→SketchUp handoff path. Converges into the same #388 binding.
          dialog.add_action_callback('connect_with_code') { |_c, p| handle_connect_with_code(dialog, p) }
          dialog.add_action_callback('refresh_model_binding') { handle_refresh_model_binding(dialog) }
          dialog.add_action_callback('adopt_binding_base') { handle_adopt_binding_base(dialog) }
        end

        def handle_get_model_binding(dialog)
          execute_bridge(dialog, 'onModelBindingStatus', model_binding_connector.status)
          # A binding change changes the #392 publication scope: refresh the
          # design-wide publish gate projection with it (#466).
          push_preflight_state(dialog)
        rescue StandardError => e
          @logger.error('model_binding_status_failed', error: e)
          execute_bridge(dialog, 'onModelBindingStatus', { 'state' => 'invalid', 'reason' => e.message })
        end

        # Pushes the current binding status when a visible dialog exists —
        # used at dialog ready and on active-document switches (#388: the
        # binding follows whichever model is open).
        def refresh_binding_status
          handle_get_model_binding(@dialog) if @dialog&.visible?
        end

        def handle_list_binding_projects(dialog)
          result = model_binding_service_list(:list_projects)
          execute_bridge(dialog, 'onBindingProjects', result)
        end

        def handle_list_binding_designs(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = model_binding_service_list(:list_designs, payload['projectId'])
          execute_bridge(dialog, 'onBindingDesigns', result)
        rescue StandardError => e
          @logger.error('model_binding_list_failed', error: e)
          execute_bridge(dialog, 'onBindingDesigns', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Connect/rebind the active model. confirmRebind rides the explicit
        # reviewed switch flow: without it, a different target answers
        # rebind_required and NOTHING is written.
        def handle_connect_model(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = model_binding_connector.bind(
            project_id: payload['projectId'].to_s,
            design_id: payload['designId'].to_s,
            confirm_rebind: payload['confirmRebind'] == true
          )
          execute_bridge(dialog, 'onModelBindingResult', result)
          refresh_after_binding_mutation(dialog, result)
        rescue StandardError => e
          @logger.error('model_binding_connect_failed', error: e)
          execute_bridge(dialog, 'onModelBindingResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #499 Slice 3: consume a one-time pairing code. The connector is
        # the only binding writer; the raw code never reaches the model.
        def handle_connect_with_code(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = model_binding_connector.connect_with_code(payload['code'].to_s)
          execute_bridge(dialog, 'onModelBindingResult', result)
          push_preflight_state(dialog)
          refresh_after_binding_mutation(dialog, result)
        rescue StandardError => e
          @logger.error('pairing_connect_failed', error: e)
          execute_bridge(dialog, 'onModelBindingResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Revalidate the stored binding (drift/archived/valid refresh).
        def handle_refresh_model_binding(dialog)
          execute_bridge(dialog, 'onModelBindingStatus', model_binding_connector.status)
          handle_get_project_furniture(dialog) if @project_furniture_placer
          push_host_save_awareness(dialog)
        rescue StandardError => e
          @logger.error('model_binding_refresh_failed', error: e)
          execute_bridge(dialog, 'onModelBindingStatus', { 'state' => 'unreachable', 'reason' => e.message })
        end

        # Explicit base-drift remediation: adopt the authoritative working base.
        def handle_adopt_binding_base(dialog)
          result = model_binding_connector.adopt_authoritative_base
          execute_bridge(dialog, 'onModelBindingResult', result)
          refresh_after_binding_mutation(dialog, result)
        rescue StandardError => e
          @logger.error('model_binding_adopt_failed', error: e)
          execute_bridge(dialog, 'onModelBindingResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        private

        def refresh_after_binding_mutation(dialog, result)
          return unless result['ok']

          handle_get_model_binding(dialog)
          handle_get_project_furniture(dialog) if @project_furniture_placer
          push_host_save_awareness(dialog)
        end

        def model_binding_service_list(method, argument = nil)
          entries = if argument
                      model_binding_service.public_send(method,
                                                        argument)
                    else
                      model_binding_service.public_send(method)
                    end
          { 'ok' => true, 'entries' => entries }
        rescue Connection::ModelBinding::Service::Error => e
          { 'ok' => false, 'code' => e.kind.to_s, 'reason' => e.message }
        end

        def model_binding_connector
          @model_binding_connector
        end

        def model_binding_service
          @model_binding_connector&.service
        end
      end

      # #642 -> #677: credential-safe projection bridge. The HtmlDialog sends
      # only correlation metadata; Ruby resolves Project/Design exclusively
      # from the canonical binding before calling the backend.
    end
  end
end
