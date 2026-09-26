# frozen_string_literal: true

# Lanes de placement preview (#469): begin/commit/cancel por lane (proyecto, catálogo
# conectado y local), sesión, reentrada y tool. Host::PlacementEnvironment owns geometry discovery.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module PlacementPreviewBridge # rubocop:disable Metrics/ModuleLength
        # Host::PlacementEnvironment owns geometric tolerance and discovery.

        include Host::PlacementEnvironment

        # #469 — shared transient placement preview (Project + Library consume
        # the same FurniturePlacementTool; only identity provenance differs at
        # commit).
        def register_placement_preview_callbacks(dialog)
          dialog.add_action_callback('begin_placement_preview') do |_c, p|
            handle_begin_placement_preview(dialog, p)
          end
          dialog.add_action_callback('begin_catalog_placement_preview') do |_c, p|
            handle_begin_catalog_placement_preview(dialog, p)
          end
        end

        # #469 — Proyecto: activate the shared transient placement tool for a
        # pending FurnitureInstance. All server resolution happens HERE,
        # outside the cursor loop; the tool itself holds no service. The
        # click revalidates everything through the canonical #place command
        # against the EXACT gesture context captured here (model, binding,
        # gesture id, composition fingerprint).
        def handle_begin_placement_preview(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          fi_id = payload['furnitureInstanceId'].to_s
          return if respond_placement_preview_busy(dialog, 'instanceId' => fi_id)

          model = active_model
          prepared = project_furniture_placer.prepare_placement_preview(fi_id)
          prepared = prepare_preview_extents(prepared, fi_id, 'instanceId') if prepared['ok']
          unless prepared['ok']
            prepared['instanceId'] ||= fi_id
            execute_bridge(dialog, 'onPlacementPreviewStarted', prepared)
            return
          end

          return unless placement_preview_auth_available?(dialog, 'instanceId' => fi_id)

          session = placement_preview_session('project', fi_id, model, prepared)
          tool = build_placement_preview_tool(
            label: prepared['definition']['name'], extents_mm: prepared['extents'],
            on_commit: lambda { |transform|
              handle_commit_placement_preview(dialog, fi_id, session['gesture_id'], transform)
            },
            on_cancel: lambda { |reason|
              handle_placement_preview_cancelled(dialog, fi_id, 'instanceId',
                                                 session['gesture_id'], reason)
            },
            model: model
          )
          return unless activate_placement_preview(dialog, session, tool, 'instanceId' => fi_id)

          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => true, 'code' => 'preview_active', 'instanceId' => fi_id })
        rescue StandardError => e
          @logger.error('placement_preview_begin_failed', error: e)
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'error', 'instanceId' => fi_id,
                           'reason' => e.message })
        end

        # #469 — Biblioteca (connected #390 lane): same shared tool; NO
        # backend identity is minted here — the FurnitureInstance is created
        # canonically only inside the commit gesture.
        # Increment 4: an UNBOUND model takes the LOCAL lane through this
        # same entry point — the connection determines identity/persistence,
        # never the placement interaction. A bound model in a non-connected
        # state still fails closed through the connected lane (a
        # project-bound model never silently receives local furniture).
        def handle_begin_catalog_placement_preview(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          definition_id = payload['definitionId'].to_s
          return if respond_placement_preview_busy(dialog, 'definitionId' => definition_id)

          model = active_model
          if placement_binding_triple(model).nil?
            return begin_local_catalog_placement_preview(dialog, payload, definition_id, model)
          end

          prepared = begin_catalog_preview_preparation(payload, definition_id)
          unless prepared['ok']
            execute_bridge(dialog, 'onPlacementPreviewStarted', prepared)
            return
          end

          return unless placement_preview_auth_available?(dialog, 'definitionId' => definition_id)

          session = placement_preview_session('catalog', definition_id, model, prepared)
          session['idempotency_key'] = payload['idempotencyKey']
          session['payload'] = payload
          tool = build_placement_preview_tool(
            label: prepared['definition']['name'], extents_mm: prepared['extents'],
            on_commit: ->(transform) { handle_commit_catalog_preview(dialog, session['gesture_id'], transform) },
            on_cancel: lambda { |reason|
              handle_placement_preview_cancelled(dialog, definition_id, 'definitionId',
                                                 session['gesture_id'], reason)
            },
            model: model
          )
          return unless activate_placement_preview(dialog, session, tool, 'definitionId' => definition_id)

          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => true, 'code' => 'preview_active', 'definitionId' => definition_id })
        rescue StandardError => e
          @logger.error('catalog_placement_preview_begin_failed', error: e)
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'error', 'definitionId' => definition_id,
                           'reason' => e.message })
        end

        # Preview click for an EXISTING project unit: the canonical #place
        # command receives the accepted transform; identity is stamped
        # verbatim (no new unit, no commercial quantity change) and the
        # post-insert convergence syncs the working copy with readback. The
        # gesture must match the captured session: same gesture id, same
        # model AND same binding — anything else fails closed before
        # touching the host or the server, with a correlated answer.
        def handle_commit_placement_preview(dialog, furniture_instance_id, gesture_id, transformation)
          session = @active_placement_preview
          gesture_live = false
          return if placement_preview_reentry?(session, 'project', furniture_instance_id, gesture_id)

          gesture_live = true
          unless placement_preview_gesture_context_ok?(dialog, session, 'onPlaceFurnitureResult',
                                                       'instanceId' => furniture_instance_id)
            clear_placement_preview(session)
            return
          end

          @placement_preview_committing = true
          result = project_furniture_placer.place(
            furniture_instance_id, transformation: transformation,
                                   expected_layout_signature: session['layout_signature']
          )
          result = converge_preview_insert(dialog, result, furniture_instance_id) if result['ok']
          result['instanceId'] ||= furniture_instance_id
          execute_bridge(dialog, 'onPlaceFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => furniture_instance_id })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('placement_preview_commit_failed', error: e)
          execute_bridge(dialog, 'onPlaceFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'instanceId' => furniture_instance_id,
                           'reason' => 'No se pudo colocar el mueble (error interno de SketchUp).' })
        ensure
          @placement_preview_committing = false
          # Only a gesture that actually ran may consume the session: a
          # stale/re-entered return must leave the LIVE gesture untouched.
          clear_placement_preview(session) if gesture_live
        end

        # Preview click for the connected catalog lane: the #390 canonical
        # create happens HERE (identity minted at the explicit commit) and
        # the insertion lands at the accepted transform — under the same
        # gesture-context guards as the Project lane.
        def handle_commit_catalog_preview(dialog, gesture_id, transformation)
          session = @active_placement_preview
          gesture_live = false
          return if placement_preview_reentry?(session, 'catalog', session && session['key'], gesture_id)

          gesture_live = true
          unless placement_preview_gesture_context_ok?(dialog, session, 'onCreateProjectFurnitureResult',
                                                       'definitionId' => session['key'])
            clear_placement_preview(session)
            return
          end

          payload = session['payload'] || {}
          @placement_preview_committing = true
          result = project_furniture_placer.create_and_place(
            definition_id: payload['definitionId'].to_s,
            parameters: payload['parameters'] || {},
            material_choices: payload['materialChoices'] || {},
            idempotency_key: session['idempotency_key'],
            transformation: transformation,
            expected_layout_signature: session['layout_signature']
          )
          result = converge_preview_insert(dialog, result, result['instanceId']) if result['ok']
          execute_bridge(dialog, 'onCreateProjectFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok'] && result['instanceId']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => result['instanceId'] })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('catalog_preview_commit_failed', error: e)
          execute_bridge(dialog, 'onCreateProjectFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        ensure
          @placement_preview_committing = false
          clear_placement_preview(session) if gesture_live
        end

        # #469 increment 4 — local/disconnected Biblioteca lane: the model
        # is NOT bound to a project, so the placement keeps LOCAL semantics
        # (instanceRef identity, no FurnitureInstance, no working-copy PUT).
        # The interaction is IDENTICAL to the connected lanes — the SAME
        # shared tool built by the SAME controller authority (extents,
        # snap providers, gesture guards); only the commit differs.
        def begin_local_catalog_placement_preview(dialog, payload, definition_id, model)
          prepared = local_catalog_preview_preparation(payload, definition_id)
          unless prepared['ok']
            execute_bridge(dialog, 'onPlacementPreviewStarted', prepared)
            return
          end

          session = placement_preview_session('catalog_local', definition_id, model, prepared)
          session['payload'] = payload
          tool = build_placement_preview_tool(
            label: prepared['definition']['name'], extents_mm: prepared['extents'],
            on_commit: ->(transform) { handle_commit_local_catalog_preview(dialog, session['gesture_id'], transform) },
            on_cancel: lambda { |reason|
              handle_placement_preview_cancelled(dialog, definition_id, 'definitionId',
                                                 session['gesture_id'], reason)
            },
            model: model
          )
          return unless activate_placement_preview(dialog, session, tool, 'definitionId' => definition_id)

          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => true, 'code' => 'preview_active', 'definitionId' => definition_id })
        rescue StandardError => e
          @logger.error('local_catalog_preview_begin_failed', error: e)
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'error', 'definitionId' => definition_id,
                           'reason' => e.message })
        end

        # Local-lane preparation: definition + composition WITHOUT any
        # project binding. The composition authority is the resolvable
        # server layout when the catalog can resolve one (the SAME
        # dimensionsMm/layout_signature contract as the connected lane) or,
        # offline, the generic authoring composition (normalized parameters
        # — the exact values the commit's generic renderer consumes). One
        # resolve HERE, outside the cursor loop; never per mouse event.
        def local_catalog_preview_preparation(payload, definition_id)
          definition = @catalog_provider.find_definition(definition_id)
          unless definition
            return { 'ok' => false, 'code' => 'definition_unavailable',
                     'reason' => 'el catálogo del taller no incluye la definición de este mueble',
                     'definitionId' => definition_id }
          end

          composition = local_catalog_composition(payload, definition)
          extents = if composition['layout']
                      Tools::FurniturePlacementTool.extents_from_layout(composition['layout'])
                    else
                      Model::GenericAuthoringRenderer.generic_extents(composition['parameters'])
                    end
          if extents.nil? || composition['layout_signature'].nil?
            return { 'ok' => false, 'code' => 'preview_unavailable',
                     'reason' => 'la composición resuelta no publicó dimensiones utilizables para la vista previa',
                     'definitionId' => definition_id }
          end

          { 'ok' => true, 'code' => 'preview_ready', 'definition' => definition,
            'parameters' => composition['parameters'], 'layout' => composition['layout'],
            'layout_signature' => composition['layout_signature'], 'extents' => extents }
        end

        # The local lane's composition at one point in time: normalized
        # parameters (the generic renderer's complete input) plus the
        # best-effort authoritative layout. The SAME function runs at begin
        # and at the click — its signature is what the commit compares.
        def local_catalog_composition(payload, definition)
          parameters = Model::FurnitureIntent.normalize_parameters(definition, payload['parameters'] || {})
          layout = resolve_layout_for(definition, payload['parameters'], payload['materialChoices'])
          signature = if layout
                        Connection::ProjectFurniture::PlacementGuards.layout_signature(layout)
                      else
                        local_generic_signature(definition, parameters)
                      end
          { 'parameters' => parameters, 'layout' => layout, 'layout_signature' => signature }
        end

        # Offline composition digest: definition identity + declared schema
        # + the normalized parameters. Any catalog drift between preview
        # and click changes it and the local commit fails closed — the
        # accepted transform never lands against a different composition.
        def local_generic_signature(definition, parameters)
          [
            definition['furniture_definition_id'],
            definition['definition_version'] || definition['definitionVersion'] || definition['version'],
            (definition['parameters'] || []).map { |p| "#{p['name']}@#{p['defaultValue']}" }.join(','),
            parameters.map { |name, value| "#{name}=#{value}" }.sort.join(',')
          ].join('|')
        end

        # #469 increment 4 — the local-lane click: ONE builder commit at
        # the accepted transform with LOCAL semantics (instanceRef, no
        # FurnitureInstance, no working-copy PUT, no convergence). The
        # gesture must still match the captured session (model + binding)
        # and the composition must still answer the previewed signature —
        # anything else fails closed BEFORE the model is touched.
        def handle_commit_local_catalog_preview(dialog, gesture_id, transformation)
          session = @active_placement_preview
          gesture_live = false
          return if placement_preview_reentry?(session, 'catalog_local', session && session['key'], gesture_id)

          gesture_live = true
          unless placement_preview_gesture_context_ok?(dialog, session, 'onInsertionResult',
                                                       'definitionId' => session['key'])
            clear_placement_preview(session)
            return
          end

          inputs = local_catalog_commit_inputs(session)
          clear_placement_preview(session)
          if inputs[:code]
            answer_local_preview_failure(dialog, session['key'], inputs[:code], inputs[:reason])
            return
          end

          @placement_preview_committing = true
          run_local_catalog_insert(dialog, session, inputs, transformation)
        rescue StandardError => e
          @logger.error('local_catalog_preview_commit_failed', error: e)
          execute_bridge(dialog, 'onInsertionResult',
                         { 'ok' => false, 'success' => false, 'code' => 'error',
                           'definitionId' => session && session['key'],
                           'error' => e.message, 'reason' => e.message })
        ensure
          @placement_preview_committing = false
          clear_placement_preview(session) if gesture_live
        end

        # The productive local commit itself: ONE builder insert at the
        # accepted transform, answered on the library insert channel with
        # placed_via_preview so the UI never advertises a Move handoff.
        def run_local_catalog_insert(dialog, session, inputs, transformation)
          result = furniture_builder_for(active_model).insert_furniture(
            active_model, inputs[:definition], session['payload']['parameters'] || {},
            resolved_layout: inputs[:composition]['layout'],
            material_choices: session['payload']['materialChoices'],
            transformation: transformation, prepare: false
          )
          result['ok'] = result['success']
          result['placed_via_preview'] = true
          result['definitionId'] = session['key']
          execute_bridge(dialog, 'onInsertionResult', result)
          log_operation_result('furniture_inserted', session['key'], result)
        end

        # The local commit's inputs, resolved fresh at the click: the
        # definition must still exist and the recomputed composition must
        # still answer the previewed signature. A :code key means the
        # correlated failure to answer instead of inputs.
        def local_catalog_commit_inputs(session)
          definition = @catalog_provider.find_definition(session['key'].to_s)
          unless definition
            return { code: 'definition_unavailable',
                     reason: 'la definición ya no está disponible en el catálogo' }
          end

          composition = local_catalog_composition(session['payload'] || {}, definition)
          if composition['layout_signature'] != session['layout_signature']
            return { code: 'composition_changed',
                     reason: 'la composición del mueble cambió desde la vista previa; generála de nuevo' }
          end

          { definition: definition, composition: composition }
        end

        # Local-lane failures answer the legacy insert result channel the
        # library entry point listens to — correlated, honest, re-arming.
        def answer_local_preview_failure(dialog, definition_id, code, reason)
          execute_bridge(dialog, 'onInsertionResult',
                         { 'ok' => false, 'success' => false, 'code' => code,
                           'definitionId' => definition_id, 'error' => reason, 'reason' => reason })
        end

        # Esc / tool switch / dialog close: the tool mutated nothing, so
        # cancellation is pure UI state — re-arm the entry point and tell
        # the user the unit stays pending. GESTURE-MATCHED: the late end of
        # an old gesture can never cancel or clear a newer one.
        def handle_placement_preview_cancelled(dialog, key, key_name, gesture_id, reason)
          session = @active_placement_preview
          @logger.info('placement_preview_cancelled', { 'reason' => reason.to_s, key => key })
          return unless session && session['gesture_id'] == gesture_id && session['key'] == key

          @active_placement_preview = nil
          payload = { 'ok' => true, 'code' => 'preview_cancelled', 'reason' => reason.to_s }
          payload[key_name] = key
          execute_bridge(dialog, 'onPlacementPreviewCancelled', payload)
        end

        # Closes any live preview gesture when the dialog closes. The
        # session is cleared FIRST so the tool's cancel callback cannot
        # re-enter controller state (and no bridge push is attempted on a
        # dialog that is going away).
        def cancel_active_placement_preview
          session = @active_placement_preview
          return unless session

          @active_placement_preview = nil
          session['tool']&.cancel_preview(:dialog_closed)
        rescue StandardError => e
          @logger&.error('placement_preview_close_cancel_failed', error: e)
        end

        # Another preview is already live: answer the NEW entry point
        # honestly instead of leaving its controls stuck — the active
        # gesture is untouched.
        # Returns the busy payload it answered (truthy), or nil when no
        # preview is live — callers early-return on the payload itself.
        def respond_placement_preview_busy(dialog, key_fields)
          return unless @active_placement_preview

          @logger.warn('placement_preview_busy', key_fields)
          busy = { 'ok' => false, 'code' => 'preview_busy',
                   'reason' => 'ya hay una colocación en curso; terminála con un clic o con Esc ' \
                               'antes de iniciar otra' }.merge(key_fields)
          execute_bridge(dialog, 'onPlacementPreviewStarted', busy)
          busy
        end

        # Catalog preparation + extents, answering definitionId on failure.
        def begin_catalog_preview_preparation(payload, definition_id)
          prepared = project_furniture_placer.prepare_catalog_preview(
            definition_id: definition_id,
            parameters: payload['parameters'] || {},
            material_choices: payload['materialChoices'] || {}
          )
          prepared = prepare_preview_extents(prepared, definition_id, 'definitionId') if prepared['ok']
          return prepared if prepared['ok']

          prepared['definitionId'] ||= definition_id
          prepared
        end

        # Gesture session: the exact context a later click must reproduce —
        # the model object, the binding triple, a unique gesture id and the
        # authoritative composition fingerprint the preview was built from.
        def placement_preview_session(kind, key, model, prepared)
          { 'kind' => kind, 'key' => key, 'model' => model,
            'binding' => placement_binding_triple(model),
            'auth' => project_furniture_placer.service.context_fingerprint,
            'gesture_id' => "preview-#{(Time.now.to_f * 1000).to_i}-#{rand(0xffff).to_s(16)}#{rand(0xffff).to_s(16)}",
            'layout_signature' => prepared['layout_signature'],
            'extents' => prepared['extents'] }
        end

        # Tool activation is part of the gesture: if select_tool or activate
        # fails, the session is discarded and the entry point is answered
        # with a correlated failure — a retry starts clean.
        # Returns the live session on success, nil after answering the
        # correlated failure (never a bare boolean: the session IS the proof
        # the gesture is running).
        def activate_placement_preview(dialog, session, tool, key_fields)
          model = session['model']
          model.select_tool(tool)
          tool.activate
          session['tool'] = tool
          @active_placement_preview = session
          session
        rescue StandardError => e
          @logger.error('placement_preview_activation_failed', { 'error' => e }.merge(key_fields))
          @active_placement_preview = nil
          # The failure may have happened AFTER select_tool pushed the
          # tool: put the model back so the retry starts clean.
          begin
            model&.select_tool(nil)
          rescue StandardError
            nil
          end
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'activation_failed',
                           'reason' => 'no se pudo activar la herramienta de colocación; inténtalo de nuevo' }
                           .merge(key_fields))
          nil
        end

        # True (and logs) when the commit must be ignored: a re-entered
        # gesture or a late commit from a gesture that already ended — its
        # controls were recovered when that gesture terminated, so there is
        # nothing to answer and a NEWER gesture must stay untouched.
        def placement_preview_reentry?(session, kind, key, gesture_id)
          if @placement_preview_committing
            @logger.warn('placement_preview_commit_reentered', { 'kind' => kind, 'key' => key })
            return true
          end
          return false if session && session['kind'] == kind && session['key'] == key &&
                          session['gesture_id'] == gesture_id

          @logger.warn('placement_preview_commit_stale',
                       { 'kind' => kind, 'key' => key, 'gesture_id' => gesture_id })
          true
        end

        # Combined gesture-context guard: model + binding must always match
        # the captured gesture; the authenticated-context guard applies to
        # the lanes whose commit talks to the server. The LOCAL lane
        # (#469 increment 4) commits with no server-owned identity — its
        # safety net is the composition signature comparison, so an unknown
        # auth context cannot block it (the connection determines
        # identity/persistence, never the placement interaction).
        def placement_preview_gesture_context_ok?(dialog, session, bridge_method, key_fields)
          placement_preview_context_ok?(dialog, session, bridge_method, key_fields) &&
            (session['kind'] == 'catalog_local' ||
             placement_preview_auth_ok?(dialog, session, bridge_method, key_fields))
        end

        # Exact-context guard: the click must land on the SAME model and
        # the SAME binding the gesture captured. Otherwise nothing is
        # placed and the entry point gets a correlated, honest failure.
        def placement_preview_context_ok?(dialog, session, bridge_method, key_fields)
          unless active_model.equal?(session['model'])
            @logger.warn('placement_preview_model_changed', key_fields)
            execute_bridge(dialog, bridge_method,
                           { 'ok' => false, 'code' => 'context_changed',
                             'reason' => 'el modelo activo cambió durante la colocación; nada fue colocado' }
                           .merge(key_fields))
            return false
          end

          return true if placement_binding_triple(active_model) == session['binding']

          @logger.warn('placement_preview_binding_changed', key_fields)
          execute_bridge(dialog, bridge_method,
                         { 'ok' => false, 'code' => 'context_changed',
                           'reason' => 'el enlace del modelo cambió durante la colocación; nada fue colocado' }
                         .merge(key_fields))
          false
        end

        # Authenticated-context guard with explicit semantics: a TECHNICAL
        # token refresh keeps the same context identity (the gesture
        # survives); logout, a new enrollment/session or a backend switch
        # changes or voids it. An unknown/unreadable current context fails
        # closed — nil never equals nil.
        def placement_preview_auth_ok?(dialog, session, bridge_method, key_fields)
          current = project_furniture_placer.service.context_fingerprint
          return true if current && session['auth'] && current == session['auth']

          @logger.warn('placement_preview_auth_changed', key_fields)
          execute_bridge(dialog, bridge_method,
                         { 'ok' => false, 'code' => 'context_changed',
                           'reason' => 'la sesión o el servidor cambió durante la colocación; nada fue colocado' }
                         .merge(key_fields))
          false
        end

        # A gesture may only start under a PINNABLE auth context: when the
        # identity is unknown or unreadable there is nothing to verify the
        # click against, so the entry point fails closed up front.
        # Truthy when a pinnable context exists; false after answering the
        # correlated failure (callers early-return on the falsy answer).
        def placement_preview_auth_available?(dialog, key_fields)
          return true if project_furniture_placer.service.context_fingerprint

          @logger.warn('placement_preview_auth_unavailable', key_fields)
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'auth_context_unavailable',
                           'reason' => 'no se pudo confirmar la sesión para asegurar la colocación; reintentá' }
                         .merge(key_fields))
          false
        end

        def placement_binding_triple(model)
          binding = Connection::ModelBinding::Store.new(model).read
          return nil unless binding

          [binding.project_id, binding.design_id, binding.base_revision_id]
        end

        # The tool keeps the model captured at gesture time: ending an old
        # tool must never select_tool over the CURRENT dynamic model (which
        # may have moved on to another document). Extents carry their local
        # minimum (origin_mm) so the anchor maps the real furniture box.
        # Host::PlacementEnvironment supplies neighbor/base-plane discovery;
        # this bridge only wires both providers into the lifecycle tool.
        def build_placement_preview_tool(label:, extents_mm:, on_commit:, on_cancel:, model:)
          Tools::FurniturePlacementTool.new(
            label: label, extents_mm: extents_mm,
            on_commit: on_commit, on_cancel: on_cancel,
            model_provider: -> { model },
            origin_mm: extents_mm[:origin_mm] || [0.0, 0.0, 0.0],
            logger: @logger,
            furniture_targets_provider: placement_furniture_targets_provider(model),
            base_planes_provider: placement_base_planes_provider(model)
          )
        end

        # Authoritative preview extents: the resolved layout's dimensionsMm
        # ([w, h, d]) or, when absent, the boards' local AABB — preview-only
        # derivation that never touches productive geometry.
        def prepare_preview_extents(prepared, key, key_name)
          extents = Tools::FurniturePlacementTool.extents_from_layout(prepared['layout'])
          return prepared.merge('extents' => extents) if extents

          { 'ok' => false, 'code' => 'preview_unavailable',
            'reason' => 'la composición resuelta no publicó dimensiones utilizables para la vista previa',
            key_name => key }
        end

        def converge_preview_insert(_dialog, result, furniture_instance_id)
          return result unless result['ok'] && furniture_instance_id && @position_sync_coordinator

          model = active_model
          binding = Connection::ModelBinding::Store.new(model).read
          return result unless binding

          preflight_review_session
          converged = @position_sync_coordinator.converge_inserted_unit(model, binding, furniture_instance_id)
          converged['ok'] ? converged : result
        end

        def clear_placement_preview(preview)
          @active_placement_preview = nil if @active_placement_preview.equal?(preview) ||
                                             @active_placement_preview == preview
        end
      end
    end
  end
end
