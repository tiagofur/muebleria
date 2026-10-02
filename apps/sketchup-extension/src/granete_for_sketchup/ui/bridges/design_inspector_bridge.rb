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
          # #784 R3: the inheritance read bridge mixes into the same
          # controller; its registration rides here so bind_callbacks stays
          # within its complexity budget.
          register_design_inheritance_callbacks(dialog)
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
          draft_base = payload['draftBase'].is_a?(Hash) ? payload['draftBase'] : nil

          refusal, stored, working, write_token =
            design_inspector_apply_context(payload['designId'].to_s, token, draft_base)
          return execute_bridge(dialog, 'onDesignDefaultsApplied', refusal.merge('requestId' => request_id)) if refusal

          updated = design_inspector_placer.service.update_working_copy(
            stored.design_id,
            items: working.items,
            expected_working_version: write_token,
            authoring_defaults: { 'materialChoices' => merged['materialChoices'] || {} }
          )
          execute_bridge(dialog, 'onDesignDefaultsApplied', {
                           'requestId' => request_id,
                           'status' => 'ok',
                           'designId' => stored.design_id,
                           'projectId' => stored.project_id,
                           'workingVersion' => updated.updated_at,
                           # #969d: the write rode a fresher version than the
                           # draft's base (background auto-sync advanced it);
                           # the applied defaults are the seen ones verbatim.
                           'autoAdvanced' => write_token != token,
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
        # write).
        # #969d (owner decision: the apply lands on the FIRST click): the
        # background auto-sync advances the working copy without any user
        # edit, so a token mismatch AUTO-ADVANCES the write to the fresh
        # version when the server's CURRENT authoring defaults are exactly
        # the ones the draft was based on — nothing unseen is clobbered (the
        # defaults the user saw are unchanged, and the items already travel
        # verbatim from this fresh read). A real defaults drift keeps the
        # explicit path: the refusal carries the fresh version for the
        # dialog's "Actualizar y aplicar". Returns
        # [refusal_or_nil, stored_or_nil, working_or_nil, write_token_or_nil].
        def design_inspector_apply_context(requested_design_id, token, draft_base = nil)
          stored = design_inspector_binding_store.read
          return [{ 'status' => 'unbound' }, nil, nil, nil] if stored.nil?
          if stored.design_id != requested_design_id
            return [{ 'status' => 'stale_binding', 'designId' => stored.design_id }, nil, nil, nil]
          end
          return [{ 'status' => 'conflict', 'reason' => 'token ausente' }, nil, nil, nil] if token.strip.empty?

          working = design_inspector_working_copy(stored.design_id)
          if working.updated_at != token
            unless draft_base && design_inspector_defaults_unchanged?(working, draft_base)
              return [{ 'status' => 'conflict', 'reason' => 'el diseño cambió en el servidor',
                        'workingVersion' => working.updated_at }, stored, working, nil]
            end
            token = working.updated_at
          end

          [nil, stored, working, token]
        end

        private

        # The draft's seen defaults are provably the server's current ones —
        # role → material id, order-insensitive deep equality. Absent blocks
        # normalize to the canonical empty map both sides use.
        def design_inspector_defaults_unchanged?(working, draft_base)
          fresh = working.authoring_defaults.is_a?(Hash) ? working.authoring_defaults : {}
          base = draft_base['defaults'].is_a?(Hash) ? draft_base['defaults'] : {}
          fresh == base
        end

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
