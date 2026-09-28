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
          dialog.add_action_callback('apply_design_defaults') do |_c, payload|
            handle_apply_design_defaults(dialog, payload)
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

        # #784 R2 — the ONE write of the Design defaults slice. The mandated
        # flow: the dialog edits a LOCAL draft; this command takes the client
        # token (the workingVersion it last saw), re-reads the authoritative
        # working copy (freshness gate — a newer server state answers
        # conflict WITHOUT writing), and issues exactly ONE PUT carrying the
        # merged authoring_defaults plus the CURRENT items VERBATIM and
        # WITHOUT modes (the backend preserves the persisted lineage for
        # unchanged values). Changing a default NEVER mutates existing
        # items and NEVER touches the host: zero SketchUp operations.
        def handle_apply_design_defaults(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          request_id = payload['requestId']
          token = payload['expectedWorkingVersion'].to_s
          merged = payload['authoringDefaults'] || {}

          refusal, stored, working = design_inspector_apply_context(payload['designId'].to_s, token)
          return execute_bridge(dialog, 'onDesignDefaultsApplied', refusal.merge('requestId' => request_id)) if refusal

          updated = design_inspector_placer.service.put_working_copy(
            stored.design_id,
            items: working.items,
            expected_working_version: token,
            authoring_defaults: { 'materialChoices' => merged['materialChoices'] || {} }
          )
          execute_bridge(dialog, 'onDesignDefaultsApplied', {
                           'requestId' => request_id,
                           'status' => 'ok',
                           'designId' => stored.design_id,
                           'projectId' => stored.project_id,
                           'workingVersion' => updated.updated_at,
                           'authoringDefaults' => { 'materialChoices' => updated.authoring_defaults }
                         })
        rescue StandardError => e
          @logger.error('design_defaults_apply_failed', error: e)
          execute_bridge(dialog, 'onDesignDefaultsApplied',
                         { 'requestId' => request_id, 'status' => 'error', 'reason' => e.message })
        end

        # Fail-closed preconditions of the ONE write: the model must be bound
        # to the requested design and the client token must still be the
        # authoritative working version (ONE authoritative read gates the
        # write) — a refusal answers WITHOUT writing. Returns
        # [refusal_or_nil, stored_or_nil, working_or_nil].
        def design_inspector_apply_context(requested_design_id, token)
          stored = design_inspector_binding_store.read
          return [{ 'status' => 'unbound' }] if stored.nil?
          if stored.design_id != requested_design_id
            return [{ 'status' => 'stale_binding', 'designId' => stored.design_id }]
          end
          return [{ 'status' => 'conflict', 'reason' => 'token ausente' }] if token.strip.empty?

          working = design_inspector_working_copy(stored.design_id)
          unless working.updated_at == token
            return [{ 'status' => 'conflict', 'reason' => 'el diseño cambió en el servidor' }, stored, working]
          end

          [nil, stored, working]
        end

        private

        def design_inspector_placer
          placer = @project_furniture_placer
          raise 'servicio de working copy no disponible' unless placer

          placer
        end

        def design_inspector_binding_store
          Connection::ModelBinding::Store.new(active_model)
        end

        def design_inspector_working_copy(design_id)
          design_inspector_placer.service.get_working_copy(design_id)
        end
      end
    end
  end
end
