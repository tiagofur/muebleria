# frozen_string_literal: true

# #784 R3 — Design inheritance READ bridge: the server-side projection
# (material-provenance read model) is the ONLY authority for the
# Diseño/Personalizado badges. Same read family as the design defaults
# bridge: binding guard, requestId correlation, read-only. The helpers it
# consumes (binding store, working-copy service, execute_bridge) are the
# DesignInspectorBridge's — both modules mix into the same controller.
module Granete
  module SketchUpExtension
    module UserInterface
      module DesignInheritanceBridge
        def register_design_inheritance_callbacks(dialog)
          dialog.add_action_callback('get_design_inheritance') do |_c, payload|
            handle_get_design_inheritance(dialog, payload)
          end
        end

        def handle_get_design_inheritance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          request_id = payload['requestId']
          requested_design_id = payload['designId'].to_s

          stored = design_inspector_binding_store.read
          if stored.nil?
            return execute_bridge(dialog, 'onDesignInheritance',
                                  { 'requestId' => request_id, 'status' => 'unbound' })
          end
          if stored.design_id != requested_design_id
            return execute_bridge(dialog, 'onDesignInheritance',
                                  { 'requestId' => request_id, 'status' => 'stale_binding',
                                    'designId' => stored.design_id })
          end

          projection = design_inspector_placer.service.get_design_inheritance(stored.design_id)
          execute_bridge(dialog, 'onDesignInheritance', {
                           'requestId' => request_id,
                           'status' => 'ready',
                           'designId' => stored.design_id,
                           'items' => projection.items.map do |item|
                             {
                               'furnitureInstanceId' => item.furniture_instance_id,
                               'roles' => item.inheritance.map do |entry|
                                 {
                                   'role' => entry.role,
                                   'mode' => entry.mode,
                                   'appliedMaterialId' => entry.applied_material_id,
                                   'designDefaultMaterialId' => entry.design_default_material_id,
                                   'needsRollout' => entry.needs_rollout
                                 }
                               end
                             }
                           end
                         })
        rescue StandardError => e
          @logger.error('design_inheritance_failed', error: e)
          execute_bridge(dialog, 'onDesignInheritance',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end
      end
    end
  end
end
