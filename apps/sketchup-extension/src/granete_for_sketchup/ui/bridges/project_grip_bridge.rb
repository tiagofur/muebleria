# frozen_string_literal: true

# #1535 — Project grip bridge (ADR-0009 Amendment 1 A2.3): transport for the
# «Agarre del proyecto» section (no selection), the per-furniture «Agarre»
# card and the batch exception. The plugin sends INTENT (style id / overrides)
# and paints what the server returns — it never resolves. Every write takes
# the project's grip_version as If-Match; a stale version answers 412 and the
# UI asks for a reload. Undo/redo re-send the previous/next SESSION intention
# as a server write (the server is the truth; SketchUp operations do not
# revert remote writes). State lives keyed by project: a late answer for
# another project is dropped without rendering.
# Contract: métodos de instancia incluidos en DialogController.
module Granete
  module SketchUpExtension
    module UserInterface
      # Session intention state for the project grip (#1535), keyed by
      # project: the undo/redo stacks and the last If-Match version per
      # project. Included by ProjectGripBridge.
      module ProjectGripSessionState
        def project_grip_undo_stack
          @project_grip_undo_stack ||= {}
        end

        def project_grip_redo_stack
          @project_grip_redo_stack ||= {}
        end

        def project_grip_versions
          @project_grip_versions ||= {}
        end

        def project_grip_version_for(project_id)
          project_grip_versions[project_id]
        end

        def project_grip_remember_version(project_id, grip)
          version = grip.is_a?(Hash) ? grip['gripVersion'] : nil
          project_grip_versions[project_id] = version if version.is_a?(Integer) && version >= 1
        end

        def project_grip_push_undo(project_id, intention)
          (project_grip_undo_stack[project_id] ||= []).push(intention)
          project_grip_redo_stack[project_id] = []
        end

        def project_grip_push_intention(project_id, direction, intention)
          return if intention.nil?

          (direction == :undo ? project_grip_undo_stack : project_grip_redo_stack)[project_id] ||= []
          (direction == :undo ? project_grip_undo_stack : project_grip_redo_stack)[project_id].push(intention)
        end

        def project_grip_pop_undo(project_id)
          (project_grip_undo_stack[project_id] ||= []).pop
        end

        def project_grip_pop_redo(project_id)
          (project_grip_redo_stack[project_id] ||= []).pop
        end

        def project_grip_can_undo?(project_id)
          !(project_grip_undo_stack[project_id] || []).empty?
        end

        def project_grip_can_redo?(project_id)
          !(project_grip_redo_stack[project_id] || []).empty?
        end
      end

      # rubocop:disable Metrics/ModuleLength
      # (same allowance as DesignOpeningGeometryBridge: five transport
      # callbacks for the Agarre surfaces; the session state lives in its own
      # module above)
      module ProjectGripBridge
        include ProjectGripSessionState

        def register_project_grip_callbacks(dialog)
          dialog.add_action_callback('get_project_grip') do |_c, payload|
            handle_get_project_grip(dialog, payload)
          end
          dialog.add_action_callback('apply_project_grip_style') do |_c, payload|
            handle_apply_project_grip_style(dialog, payload)
          end
          dialog.add_action_callback('apply_project_grip_furniture') do |_c, payload|
            handle_apply_project_grip_furniture(dialog, payload)
          end
          dialog.add_action_callback('undo_project_grip') do |_c, payload|
            handle_undo_project_grip(dialog, payload)
          end
          dialog.add_action_callback('redo_project_grip') do |_c, payload|
            handle_redo_project_grip(dialog, payload)
          end
        end

        # Payload {requestId, projectId} → onProjectGrip {requestId, status,
        # projectId, grip?, styles?}. Only answers for the BOUND project.
        def handle_get_project_grip(dialog, payload_json)
          payload = parse_bridge_payload(payload_json)
          request_id = payload['requestId']
          stored, refusal = project_grip_bound_context(payload)
          return execute_bridge(dialog, 'onProjectGrip', refusal.merge('requestId' => request_id)) if refusal

          answer = {
            'requestId' => request_id,
            'status' => 'ok',
            'projectId' => stored,
            'grip' => project_grip_service.get_project_grip(stored),
            'styles' => project_grip_service.fetch_grip_styles
          }
          project_grip_remember_version(stored, answer['grip'])
          execute_bridge(dialog, 'onProjectGrip', answer)
        rescue ::Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error => e
          execute_bridge(dialog, 'onProjectGrip', project_grip_error_answer(e, request_id, stored))
        rescue StandardError => e
          @logger.error('project_grip_get_failed', error: e)
          execute_bridge(dialog, 'onProjectGrip',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end

        # Payload {requestId, projectId, gripStyleId} → onProjectGripApplied.
        # Undoable: the previous style rides the session intention stack.
        def handle_apply_project_grip_style(dialog, payload_json)
          payload = parse_bridge_payload(payload_json)
          request_id = payload['requestId']
          stored, refusal = project_grip_bound_context(payload)
          return execute_bridge(dialog, 'onProjectGripApplied', refusal.merge('requestId' => request_id)) if refusal

          style_id = payload['gripStyleId']
          style_id = nil if style_id.to_s.strip.empty?
          previous = payload['previousStyleId']
          previous = nil if previous.to_s.strip.empty?
          version = project_grip_version_for(stored)
          grip = project_grip_service.put_project_grip_style(stored, style_id, expected_version: version)
          project_grip_remember_version(stored, grip)
          # Undo re-applies the style in force BEFORE this pick; redo
          # re-applies the one it replaced (the revert travels with the
          # intention).
          project_grip_push_undo(stored, { 'kind' => 'style', 'styleId' => previous,
                                           'revert' => { 'kind' => 'style', 'styleId' => style_id } })
          execute_bridge(dialog, 'onProjectGripApplied', {
                           'requestId' => request_id, 'status' => 'ok',
                           'projectId' => stored, 'grip' => grip,
                           'canUndo' => project_grip_can_undo?(stored)
                         })
        rescue ::Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error => e
          execute_bridge(dialog, 'onProjectGripApplied', project_grip_error_answer(e, request_id, stored))
        rescue StandardError => e
          @logger.error('project_grip_style_failed', error: e)
          execute_bridge(dialog, 'onProjectGripApplied',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end

        # Payload {requestId, projectId, overrides:[{furnitureInstanceId,
        # gripStyleId|null}]} → onProjectGripApplied. N furniture in ONE
        # server operation (batch exception).
        def handle_apply_project_grip_furniture(dialog, payload_json)
          payload = parse_bridge_payload(payload_json)
          request_id = payload['requestId']
          stored, refusal = project_grip_bound_context(payload)
          return execute_bridge(dialog, 'onProjectGripApplied', refusal.merge('requestId' => request_id)) if refusal

          overrides = payload['overrides'].is_a?(Array) ? payload['overrides'] : []
          version = project_grip_version_for(stored)
          grip = project_grip_service.put_project_grip_furniture(stored, overrides, expected_version: version)
          project_grip_remember_version(stored, grip)
          execute_bridge(dialog, 'onProjectGripApplied', {
                           'requestId' => request_id, 'status' => 'ok',
                           'projectId' => stored, 'grip' => grip,
                           'canUndo' => project_grip_can_undo?(stored)
                         })
        rescue ::Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error => e
          execute_bridge(dialog, 'onProjectGripApplied', project_grip_error_answer(e, request_id, stored))
        rescue StandardError => e
          @logger.error('project_grip_furniture_failed', error: e)
          execute_bridge(dialog, 'onProjectGripApplied',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end

        # Undo = the previous session intention re-sent as a server write
        # (style only; furniture overrides converge through a new style pick
        # or «Volver al del proyecto»). Redo = the intention the undo
        # replaced. Both carry the fresh If-Match from the last response.
        def handle_undo_project_grip(dialog, payload_json)
          project_grip_replay_intention(dialog, payload_json, :undo)
        end

        def handle_redo_project_grip(dialog, payload_json)
          project_grip_replay_intention(dialog, payload_json, :redo)
        end

        private

        def project_grip_replay_intention(dialog, payload_json, direction)
          payload = parse_bridge_payload(payload_json)
          request_id = payload['requestId']
          stored, refusal = project_grip_bound_context(payload)
          callback = direction == :undo ? 'onProjectGripUndone' : 'onProjectGripRedone'
          return execute_bridge(dialog, callback, refusal.merge('requestId' => request_id)) if refusal

          intention = direction == :undo ? project_grip_pop_undo(stored) : project_grip_pop_redo(stored)
          if intention.nil?
            return execute_bridge(dialog, callback,
                                  { 'requestId' => request_id, 'status' => 'noop', 'projectId' => stored })
          end

          version = project_grip_version_for(stored)
          grip = project_grip_service.put_project_grip_style(stored, intention['styleId'], expected_version: version)
          project_grip_remember_version(stored, grip)
          opposite = direction == :undo ? :redo : :undo
          project_grip_push_intention(stored, opposite, intention['revert'])
          execute_bridge(dialog, callback, {
                           'requestId' => request_id, 'status' => 'ok',
                           'projectId' => stored, 'grip' => grip,
                           'canUndo' => project_grip_can_undo?(stored),
                           'canRedo' => project_grip_can_redo?(stored)
                         })
        rescue ::Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error => e
          # The replay re-arms the intention it could not apply so another
          # attempt stays possible after a reload.
          project_grip_push_intention(stored, direction, intention)
          execute_bridge(dialog, callback, project_grip_error_answer(e, request_id, stored))
        rescue StandardError => e
          @logger.error('project_grip_replay_failed', error: e)
          execute_bridge(dialog, callback,
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end

        # The bound project is the ONLY project this dialog answers for.
        def project_grip_bound_context(payload)
          binding = Connection::ModelBinding::Store.new(active_model).read
          unless binding && binding.project_id.to_s != ''
            return [nil, { 'status' => 'unbound', 'reason' => 'conectá este modelo a un proyecto primero' }]
          end

          bound_project = binding.project_id.to_s
          requested = payload['projectId'].to_s
          if requested != '' && requested != bound_project
            return [nil, { 'status' => 'stale_binding', 'reason' => 'el proyecto cambió; recargá el inspector',
                           'projectId' => bound_project }]
          end

          [bound_project, nil]
        end

        def project_grip_service
          placer = @project_furniture_placer
          raise 'servicio de working copy no disponible' unless placer

          placer.service
        end

        def parse_bridge_payload(payload_json)
          payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
        end

        def project_grip_error_answer(error, request_id, project_id)
          {
            'requestId' => request_id,
            'status' => 'error',
            'projectId' => project_id,
            'reason' => error.message,
            'reasonCode' => error.respond_to?(:details) && error.details.is_a?(Hash) ? error.details['reason'] : nil,
            'httpStatus' => error.respond_to?(:status) ? error.status : nil
          }
        end
      end
      # rubocop:enable Metrics/ModuleLength
    end
  end
end
