# frozen_string_literal: true

# #1137 — Design opening bridge: transport for the Apertura card.
# Ruby transports intent and server-resolved fronts; rejects foreign designs.
# Contract: métodos de instancia incluidos en DialogController.
module Granete
  module SketchUpExtension
    module UserInterface
      module DesignOpeningBridge
        def register_design_opening_callbacks(dialog)
          dialog.add_action_callback('get_design_opening') do |_c, payload|
            handle_get_design_opening(dialog, payload)
          end
          dialog.add_action_callback('apply_design_opening') do |_c, payload|
            handle_apply_design_opening(dialog, payload)
          end
        end

        # Payload {requestId, designId} → onDesignOpening {status,
        # opening?, resolution?, dimsKnown?, capabilities?, profiles?}.
        def handle_get_design_opening(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          request_id = payload['requestId']

          stored, refusal = design_opening_bound_context(payload)
          return execute_bridge(dialog, 'onDesignOpening', refusal) if refusal

          state = design_opening_placer.service.get_design_opening(stored.design_id)
          answer = design_opening_composed_state(stored, state)
          answer['requestId'] = request_id
          execute_bridge(dialog, 'onDesignOpening', answer)
        rescue StandardError => e
          @logger.error('design_opening_failed', error: e)
          execute_bridge(dialog, 'onDesignOpening',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end

        def handle_apply_design_opening(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          request_id = payload['requestId']
          selection = payload['selection'].is_a?(Hash) ? payload['selection'] : {}

          stored, refusal = design_opening_bound_context(payload)
          return execute_bridge(dialog, 'onDesignOpeningApplied', refusal) if refusal

          state = put_opening_auto_advanced(stored, selection, payload['expectedWorkingVersion'].to_s)
          geometry = design_opening_converge_geometry(stored, state)
          execute_bridge(dialog, 'onDesignOpeningApplied', {
                           'requestId' => request_id, 'status' => 'ok',
                           'designId' => stored.design_id, 'state' => state, 'geometry' => geometry
                         })
        rescue ::Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error => e
          execute_bridge(dialog, 'onDesignOpeningApplied', design_opening_apply_error_answer(e, request_id))
        rescue StandardError => e
          @logger.error('design_opening_apply_failed', error: e)
          execute_bridge(dialog, 'onDesignOpeningApplied',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end

        def put_opening_auto_advanced(stored, selection, token)
          design_opening_placer.service.put_design_opening(stored.design_id, selection, expected_working_version: token)
        rescue ::Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error => e
          raise unless e.kind == :conflict

          fresh = design_opening_placer.service.get_working_copy(stored.design_id)
          design_opening_placer.service.put_design_opening(stored.design_id, selection,
                                                           expected_working_version: fresh.updated_at)
        end

        private

        # The binding precondition shared by both commands: the model must
        # be bound and to the REQUESTED design. Returns [stored, refusal].
        def design_opening_bound_context(payload)
          stored = design_opening_binding_store.read
          return [nil, { 'requestId' => payload['requestId'], 'status' => 'unbound' }] if stored.nil?

          if stored.design_id != payload['designId'].to_s
            return [nil, {
              'requestId' => payload['requestId'],
              'status' => 'stale_binding',
              'designId' => stored.design_id
            }]
          end
          [stored, nil]
        end

        # The read answer composes the THREE server reads into one card
        # payload: the design's opening state plus the catalog data the
        # card's filtered options consume.
        def design_opening_composed_state(stored, state)
          capabilities = design_opening_placer.service.fetch_opening_capabilities
          profiles = design_opening_placer.service.fetch_opening_profiles
          {
            'status' => 'ready',
            'designId' => stored.design_id,
            'projectId' => stored.project_id,
            'opening' => state.is_a?(Hash) ? state['opening'] : nil,
            'resolution' => state.is_a?(Hash) ? state['resolution'] : nil,
            'dimsKnown' => state.is_a?(Hash) ? state['dimsKnown'] : false,
            'capabilities' => capabilities.is_a?(Hash) ? capabilities['opening_capabilities'] : nil,
            'profiles' => profiles.is_a?(Array) ? profiles : []
          }
        end

        # Typed transport errors become structured answers: an
        # INVALID_OPENING_CONFIGURATION refusal keeps the card's draft and
        # its persisted selection visible with the server's actionable
        # message; a version conflict is an honest conflict.
        def design_opening_apply_error_answer(error, request_id)
          if error.kind == :invalid_configuration
            return {
              'requestId' => request_id,
              'status' => 'invalid',
              'reason' => error.details['reason'].to_s,
              'message' => error.message
            }
          end
          if error.kind == :conflict
            return { 'requestId' => request_id, 'status' => 'conflict', 'message' => error.message }
          end

          @logger.error('design_opening_apply_failed', error: error)
          { 'requestId' => request_id, 'status' => 'error', 'reason' => error.message }
        end

        def design_opening_placer
          placer = @project_furniture_placer
          raise 'servicio de working copy no disponible' unless placer

          placer
        end

        def design_opening_binding_store
          Connection::ModelBinding::Store.new(active_model)
        end
      end
    end
  end
end
