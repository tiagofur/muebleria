# frozen_string_literal: true

# #784 R1 — Design Inspector READ bridge: the durable Design authoring
# defaults lane. The ONLY backend surface this bridge touches is the
# authoritative working-copy GET; it never writes (no working-copy PUT, no
# host operation, no metadata write). The model binding store is the local
# authority for WHICH design may be read: a request naming a design the
# model is not bound to is refused as stale instead of fetching foreign
# state. Ruby transports and fails honestly; the HtmlDialog renders.
# Contract: métodos de instancia incluidos en DialogController
# (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module DesignInspectorBridge
        def register_design_inspector_callbacks(dialog)
          dialog.add_action_callback('get_design_defaults') do |_c, payload|
            handle_get_design_defaults(dialog, payload)
          end
        end

        # Payload entrante: { requestId, designId }. Respuesta via
        # onDesignDefaults: { requestId, status: ready|unbound|stale_binding|error,
        # designId?, projectId?, workingVersion?, authoringDefaults?, reason? }.
        # requestId/designId viajan de vuelta para que el diálogo descarte
        # respuestas tardías de un diseño anterior (#784 R1 design switch).
        def handle_get_design_defaults(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          request_id = payload['requestId']
          requested_design_id = payload['designId'].to_s

          stored = design_inspector_binding_store.read
          if stored.nil?
            execute_bridge(dialog, 'onDesignDefaults', { 'requestId' => request_id, 'status' => 'unbound' })
          elsif stored.design_id != requested_design_id
            execute_bridge(dialog, 'onDesignDefaults',
                           { 'requestId' => request_id, 'status' => 'stale_binding', 'designId' => stored.design_id })
          else
            working = design_inspector_working_copy(stored.design_id)
            execute_bridge(dialog, 'onDesignDefaults', {
                             'requestId' => request_id,
                             'status' => 'ready',
                             'designId' => stored.design_id,
                             'projectId' => stored.project_id,
                             # verbatim server string — the canonical #810
                             # workingVersion token.
                             'workingVersion' => working.updated_at,
                             'authoringDefaults' => { 'materialChoices' => working.authoring_defaults }
                           })
          end
        rescue StandardError => e
          @logger.error('design_defaults_failed', error: e)
          execute_bridge(dialog, 'onDesignDefaults',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end

        private

        def design_inspector_binding_store
          Connection::ModelBinding::Store.new(active_model)
        end

        def design_inspector_working_copy(design_id)
          placer = @project_furniture_placer
          raise 'servicio de working copy no disponible' unless placer

          placer.service.get_working_copy(design_id)
        end
      end
    end
  end
end
