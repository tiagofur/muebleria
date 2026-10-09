# frozen_string_literal: true

# #1252 — Design hardware-groups READ bridge: the server-side projection of
# consumed hardware option groups (por-grupo demand) is the ONLY authority
# for the "Herrajes del diseño" card. Same read family as the inheritance
# bridge: binding guard, requestId correlation, read-only. The helpers it
# consumes (binding store, execute_bridge) are the DesignInspectorBridge's —
# all these modules mix into the same controller.
module Granete
  module SketchUpExtension
    module UserInterface
      module DesignHardwareGroupsBridge
        def register_design_hardware_groups_callbacks(dialog)
          dialog.add_action_callback('get_hardware_groups') do |_c, payload|
            handle_get_hardware_groups(dialog, payload)
          end
        end

        def handle_get_hardware_groups(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          request_id = payload['requestId']
          requested_design_id = payload['designId'].to_s

          stored = design_inspector_binding_store.read
          if stored.nil?
            return execute_bridge(dialog, 'onHardwareGroups',
                                  { 'requestId' => request_id, 'status' => 'unbound' })
          end
          if stored.design_id != requested_design_id
            return execute_bridge(dialog, 'onHardwareGroups',
                                  { 'requestId' => request_id, 'status' => 'stale_binding',
                                    'designId' => stored.design_id })
          end

          groups = design_inspector_placer.service.get_design_hardware_option_groups(stored.design_id)
          execute_bridge(dialog, 'onHardwareGroups', {
                           'requestId' => request_id,
                           'status' => 'ready',
                           'designId' => stored.design_id,
                           'projectId' => groups.project_id,
                           'scope' => groups.scope,
                           'groups' => groups.groups.map do |group|
                             {
                               'code' => group.code,
                               'name' => group.name,
                               'optionIds' => group.option_ids,
                               'chosenHardwareId' => group.chosen_hardware_id,
                               'consumedBy' => group.consumed_by
                             }
                           end
                         })
        rescue StandardError => e
          @logger.error('design_hardware_groups_failed', error: e)
          execute_bridge(dialog, 'onHardwareGroups',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end
      end
    end
  end
end
