# frozen_string_literal: true

# Panel Proyecto (#389) + lanes de placement preview + workflows de diseño (publish/validate). Se parte en #848 fase C2.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module ProjectFurnitureBridge # rubocop:disable Metrics/ModuleLength
        # Unit-length/orthogonality tolerance for the oriented target
        # frames (#469 increment 3): host transform axes are floats.
        UNIT_EPSILON = 1e-6

        def register_project_furniture_callbacks(dialog)
          dialog.add_action_callback('get_project_furniture') { handle_get_project_furniture(dialog) }
          dialog.add_action_callback('place_furniture_instance') { |_c, p| handle_place_furniture_instance(dialog, p) }
          dialog.add_action_callback('create_project_furniture') { |_c, p| handle_create_project_furniture(dialog, p) }
          dialog.add_action_callback('confirm_placement_instance') do |_c, p|
            handle_confirm_placement_instance(dialog, p)
          end
          dialog.add_action_callback('cancel_placement_instance') do |_c, p|
            handle_cancel_placement_instance(dialog, p)
          end
          dialog.add_action_callback('restore_furniture_instance') do |_c, p|
            handle_restore_furniture_instance(dialog, p)
          end
          dialog.add_action_callback('select_project_furniture') { |_c, p| handle_select_project_furniture(p) }
          dialog.add_action_callback('validate_managed_furniture_identity') do
            handle_validate_managed_furniture_identity(dialog)
          end
          dialog.add_action_callback('rescan_duplicates') do
            handle_rescan_duplicates(dialog)
          end
          dialog.add_action_callback('publish_design_revision') do
            handle_publish_design_revision(dialog)
          end
          dialog.add_action_callback('validate_design_revision') do |_c, _p|
            handle_validate_design_revision(dialog)
          end
          dialog.add_action_callback('synchronize_design') do
            handle_synchronize_design(dialog)
          end
          # #469 — shared transient placement preview (Project + Library
          # consume the same FurniturePlacementTool; only identity
          # provenance differs at commit).
          dialog.add_action_callback('begin_placement_preview') do |_c, p|
            handle_begin_placement_preview(dialog, p)
          end
          dialog.add_action_callback('begin_catalog_placement_preview') do |_c, p|
            handle_begin_catalog_placement_preview(dialog, p)
          end
        end

        # Panel payload: binding-aware reconciliation per furnitureInstanceId.
        def handle_get_project_furniture(dialog)
          result = project_furniture_placer.panel
          execute_bridge(dialog, 'onProjectFurniture', result)
        rescue StandardError => e
          @logger.error('project_furniture_panel_failed', error: e)
          execute_bridge(dialog, 'onProjectFurniture', { 'state' => 'error', 'reason' => e.message })
        end

        # #810 — the explicit "Sincronizar diseño" operation: one conscious
        # add/update/delete sync through the conflict-safe frontier, verified
        # by authoritative readback. Success refreshes the panel and marks the
        # commercial projection synchronized; the HtmlDialog refetches the
        # confirmed total from the backend (no local price math).
        def handle_synchronize_design(dialog)
          result = design_sync_synchronizer.synchronize_design
          execute_bridge(dialog, 'onSynchronizeDesignResult', result)
          if result['ok']
            notify_commercial_projection_synchronization(:full)
            handle_get_project_furniture(dialog)
            push_preflight_state(dialog)
            mark_host_save_pending
          end
        rescue StandardError => e
          @logger.error('design_sync_handler_failed', error: e)
          execute_bridge(dialog, 'onSynchronizeDesignResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Place EXISTING FurnitureInstance: identity arrives from the server
        # list; the placer guarantees no new business object is created and
        # the working copy keeps every other item.
        def handle_place_furniture_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          fi_id = payload['furnitureInstanceId'].to_s
          result = project_furniture_placer.place(fi_id)
          result['instanceId'] ||= fi_id
          if result['ok'] && @position_sync_coordinator
            model = active_model
            binding = Connection::ModelBinding::Store.new(model).read
            if binding
              preflight_review_session
              converged = @position_sync_coordinator.converge_inserted_unit(model, binding, fi_id)
              result = converged if converged['ok']
            end
          end
          result['instanceId'] ||= fi_id
          execute_bridge(dialog, 'onPlaceFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => fi_id })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_place_failed', error: e)
          execute_bridge(dialog, 'onPlaceFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'instanceId' => fi_id,
                           'reason' => 'No se pudo colocar el mueble (error interno de SketchUp).' })
        end

        # #390 / DT-6: Create and place from Catalog in design-first flow.
        def handle_create_project_furniture(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = project_furniture_placer.create_and_place(
            definition_id: payload['definitionId'].to_s,
            parameters: payload['parameters'] || {},
            material_choices: payload['materialChoices'] || {},
            idempotency_key: payload['idempotencyKey']
          )
          if result['ok'] && result['instanceId'] && @position_sync_coordinator
            model = active_model
            binding = Connection::ModelBinding::Store.new(model).read
            if binding
              preflight_review_session
              converged = @position_sync_coordinator.converge_inserted_unit(model, binding, result['instanceId'])
              result = converged if converged['ok']
            end
          end
          execute_bridge(dialog, 'onCreateProjectFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok'] && result['instanceId']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => result['instanceId'] })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_create_failed', error: e)
          execute_bridge(dialog, 'onCreateProjectFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def handle_confirm_placement_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          fi_id = payload['furnitureInstanceId'].to_s
          result = project_furniture_placer.confirm_placement(fi_id)
          execute_bridge(dialog, 'onConfirmPlacementResult', result)
          notify_commercial_projection_synchronization(:partial) if result['ok']
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => fi_id })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_confirm_failed', error: e)
          execute_bridge(dialog, 'onConfirmPlacementResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def handle_cancel_placement_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = project_furniture_placer.cancel_placement(payload['furnitureInstanceId'].to_s)
          execute_bridge(dialog, 'onCancelPlacementResult', result)
          handle_get_project_furniture(dialog) if result['ok']
        rescue StandardError => e
          @logger.error('project_furniture_cancel_failed', error: e)
          execute_bridge(dialog, 'onCancelPlacementResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
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
        # The managed-neighbor and base-plane providers are built HERE for
        # both lanes — Library and Project placement share the same tool,
        # same engine and the same target resolution; only identity
        # provenance differs.
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

        # #469 increment 3 (review) — pure-data provider of HORIZONTAL host
        # base planes (top-level faces, either winding — the engine treats
        # ±Z as the same floor) so a picked wall and the floor COMPOSE
        # through the real tool. Local and read-only; the tool's snapshot
        # budget keeps it at one scan per gesture plus one revalidation at
        # the click — never a scan per mouse event. Top-level faces only:
        # nested content keeps whatever its owning component's own pick
        # proposes through the InputPoint face.
        def placement_base_planes_provider(model)
          lambda do
            # Deterministic ROOT scan: active_entities changes with the
            # user's open edit context and would make the gesture
            # snapshot and the click revalidation disagree. Nested
            # containers are handled by the recursive accumulated
            # transform below.
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            entities = model.respond_to?(:entities) ? model.entities : nil
            return [] unless entities.respond_to?(:each)

            scan_base_planes(entities, Geom::Transformation.new,
                             @metadata_store_factory.call(model), model, [])
          end
        end

        # Recursive horizontal-face scan: faces emit WORLD planes;
        # containers recurse with the accumulated transform (parent *
        # child, SketchUp composition semantics) so room fixtures nested
        # inside Groups/Components participate with their true world
        # placement. EFFECTIVE VISIBILITY FIRST (#469 review r5): the
        # scan keeps the INSTANCE PATH and a surface the designer cannot
        # see (own hidden flag, Tag/Layer off, hidden/tagged-off parent
        # anywhere up the path) never participates — snapping extends
        # VISIBLE inference. GRANETE FURNITURE ROOTS ARE PRUNED (managed
        # metadata kind == furnitureInstance, connected or local): a
        # placed cabinet's boards/shelves/tops are furniture, not room
        # floors — they must never become "Piso" candidates that beat
        # the architectural floor by a shorter Z distance. HOST-FAITHFUL
        # access (a real ComponentInstance has no #entities — its
        # content lives on the definition):
        #   Group              → entity.entities
        #   ComponentInstance  → entity.definition.entities
        def scan_base_planes(entities, world_transform, metadata_store, model, instance_path)
          planes = []
          entities.each do |entity|
            child_path = instance_path + [entity]
            next unless effective_path_visible?(model, child_path)

            case entity
            when ::Sketchup::Face
              plane = placement_face_world_plane(entity, world_transform)
              planes << plane if plane
            when ::Sketchup::Group, ::Sketchup::ComponentInstance
              next if granete_furniture_root?(entity, metadata_store)

              child_entities = entity.is_a?(::Sketchup::Group) ? entity.entities : entity.definition.entities
              planes.concat(scan_base_planes(child_entities,
                                             world_transform * entity.transformation,
                                             metadata_store, model, child_path))
            end
          end
          planes
        end

        # Effective visibility of the FULL instance path through the REAL
        # host API: Model#drawing_element_visible? (SketchUp 2020+;
        # accepts an Array<Sketchup::Drawingelement>) accounts for the
        # element's own hidden flag, its Tag/Layer and every parent's
        # state under the CURRENT model options. The only supported host
        # target (SketchUp 2026.2, see the extension README) always has
        # the method and the fixed implementation. Documented defensive
        # paths for older hosts, never silent:
        #   * method absent (< 2020): explicit per-element fallback walk
        #     (own visible? + own Layer visible? along the path);
        #   * ArgumentError: documented host bug FIXED in 2026.0 (the
        #     call threw when the path's last element was a
        #     Group/ComponentInstance). It can only surface on the
        #     pre-descend subtree probe; treat as "cannot decide →
        #     descend" — the FACE-level call (paths end in a Face) is
        #     authoritative and never hits the bug.
        def effective_path_visible?(model, instance_path)
          return true if instance_path.empty?

          if model.respond_to?(:drawing_element_visible?)
            begin
              return model.drawing_element_visible?(instance_path)
            rescue ArgumentError
              return true
            end
          end

          instance_path.all? do |element|
            own_visible = element.respond_to?(:visible?) ? element.visible? : true
            layer = element.respond_to?(:layer) ? element.layer : nil
            layer_visible = layer.respond_to?(:visible?) ? layer.visible? : true
            own_visible && layer_visible
          end
        end

        # True when the entity's Granete metadata marks it as a managed
        # furniture root (kind == furnitureInstance) — connected or
        # local. The furniture's own geometry never contributes base
        # planes.
        def granete_furniture_root?(entity, metadata_store)
          metadata = metadata_store.respond_to?(:read) ? metadata_store.read(entity) : nil
          metadata.is_a?(Hash) && metadata['kind'] == 'furnitureInstance'
        end

        # One horizontal face as a WORLD base-plane descriptor: the world
        # normal must stay vertical (a tilted container tilts its floors
        # — rejected), and the plane carries a BOUNDING-RECTANGLE
        # APPROXIMATION of its world extent (the transformed VERTEX
        # positions folded to a world XY min/max interval — the real
        # Geom::BoundingBox has no #transform to lean on) plus a world
        # plane point, so the engine never treats a distant platform as
        # an infinite floor. APPROXIMATION, NOT EXACT: concave faces,
        # L-shapes, holes and notches are covered by their bounding
        # rectangle (conservative over-inclusion near the notch);
        # polygon-aware footprints (loops with holes) are remaining
        # #469 scope.
        def placement_face_world_plane(entity, world_transform)
          return nil unless placement_local_horizontal_face?(entity)
          return nil unless placement_world_normal_vertical?(entity.normal, world_transform)

          positions = entity.vertices
                            .map { |vertex| vertex.position.transform(world_transform) }
                            .map { |position| point_mm(position) }
          return nil if positions.empty?

          footprint = world_footprint(positions)
          { 'point_mm' => positions.first, 'normal_mm' => [0.0, 0.0, 1.0],
            'footprint_min_mm' => footprint[0], 'footprint_max_mm' => footprint[1] }
        end

        # The face's WORLD normal stays vertical (a tilted container
        # tilts its floors — rejected).
        def placement_world_normal_vertical?(normal, world_transform)
          world = normal.transform(world_transform)
          world.x.to_f.abs < UNIT_EPSILON && world.y.to_f.abs < UNIT_EPSILON &&
            world.z.to_f.abs > 1.0 - UNIT_EPSILON
        end

        # World min/max corner pair folded from transformed vertex
        # positions (mm triples).
        def world_footprint(positions)
          min = [0, 1, 2].map { |axis| positions.map { |point| point[axis] }.min }
          max = [0, 1, 2].map { |axis| positions.map { |point| point[axis] }.max }
          [min, max]
        end

        # A face whose LOCAL normal is vertical (either winding).
        def placement_local_horizontal_face?(entity)
          normal = entity.respond_to?(:normal) ? entity.normal : nil
          normal.respond_to?(:z) && normal.x.to_f.abs < UNIT_EPSILON &&
            normal.y.to_f.abs < UNIT_EPSILON && normal.z.to_f.abs > 1.0 - UNIT_EPSILON
        end

        # #469 increments 2+3 — pure-data provider of Granete-managed
        # neighbors for side-to-side snapping. Targets are resolved by
        # SERVER identity through ManagedFurniture metadata — never by
        # component name/GUID — and the scan is local/read-only (no
        # request, no mutation), so it is safe inside the cursor loop.
        # #469 increment 4: placed LOCAL furniture (instanceRef identity,
        # no furnitureInstanceId) joins the same stream under its local
        # ref — no server identity is invented to earn snapping. Ambiguous
        # roots (duplicated identity in either stream), erased entities,
        # non-rigid frames and units without a PERSISTED placement
        # envelope offer no candidate: an unsafe target fails closed
        # instead of guessing.
        def placement_furniture_targets_provider(model)
          lambda do
            metadata_store = @metadata_store_factory.call(model)
            index = Connection::ProjectFurniture::ManagedFurniture.index(
              model, metadata_store
            )
            server_targets = index[:by_id].flat_map do |furniture_instance_id, entries|
              next [] if entries.length != 1

              placement_target_descriptor(furniture_instance_id, entries.first[:entity], metadata_store)
            end
            local_targets = index[:local_by_ref].flat_map do |instance_ref, entries|
              next [] if entries.length != 1

              placement_target_descriptor(instance_ref, entries.first[:entity], metadata_store)
            end
            server_targets + local_targets
          end
        end

        # Oriented-frame descriptor of one managed root for the snap
        # engine (#469 increment 3). The frame comes from the entity's
        # REAL rigid transform (world origin + horizontal unit right/front
        # axes) plus the PERSISTED placement envelope
        # (`placementEnvelopeMm`: the layout-derived local box the
        # canonical commit writes through PlacementPreviewExtents — the
        # same authority the transient preview uses). The world AABB and
        # the definition bounds are explicitly NOT the side authority:
        # both aggregate whatever else the definition holds (protruding
        # hardware/visual assets) and would displace real cabinet sides.
        # Host transform axes are INCHES-direction vectors; the engine
        # works in mm. The label comes from the entity display name
        # (cosmetic only — identity stays the furnitureInstanceId above).
        def placement_target_descriptor(furniture_instance_id, entity, metadata_store)
          return [] unless entity.respond_to?(:transformation)
          return [] if entity.respond_to?(:valid?) && !entity.valid?

          frame = placement_target_frame(entity, metadata_store)
          return [] unless frame

          [{
            'furniture_instance_id' => furniture_instance_id,
            'label' => placement_target_label(entity),
            'origin_world_mm' => frame[:origin_world_mm],
            'front_dir_mm' => frame[:front_dir_mm],
            'right_dir_mm' => frame[:right_dir_mm],
            'local_min_mm' => frame[:local_min_mm],
            'local_max_mm' => frame[:local_max_mm]
          }]
        rescue StandardError => e
          @logger.warn('placement_target_skipped', { 'error' => e.message })
          []
        end

        # The root's oriented frame, validated fail-closed: horizontal
        # UNIT right/front (any yaw, but no tilt and no scaling — a scaled
        # instance's axis vectors leave unit length), mutually orthogonal
        # and right-handed (right × front = +Z: a mirrored frame is not
        # the furniture's own frame), with zaxis ≈ +Z (no tilt), and a
        # usable PERSISTED placement envelope. nil when any check fails —
        # such a target offers no candidate.
        def placement_target_frame(entity, metadata_store)
          transform = entity.transformation
          right = horizontal_unit_dir_mm(transform.xaxis)
          front = horizontal_unit_dir_mm(transform.yaxis)
          return nil unless right && front
          return nil unless (right[0] * front[1]) - (right[1] * front[0]) > 1.0 - UNIT_EPSILON
          return nil unless vertical_up_axis?(transform.zaxis)

          envelope = persisted_envelope(entity, metadata_store)
          return nil unless envelope

          { origin_world_mm: point_mm(transform.origin),
            front_dir_mm: front, right_dir_mm: right,
            local_min_mm: envelope[0], local_max_mm: envelope[1] }
        end

        # The persisted layout-derived placement box {min_mm:, max_mm:} as
        # a [min, max] pair of mm triples — nil (fail-closed) when the
        # metadata carries no valid envelope: the unit predates increment
        # 3 or its commit had no authoritative layout.
        def persisted_envelope(entity, metadata_store)
          metadata = metadata_store.respond_to?(:read) ? metadata_store.read(entity) : nil
          envelope = metadata.is_a?(Hash) ? metadata['placementEnvelopeMm'] : nil
          min = mm_triple(envelope.is_a?(Hash) ? envelope['min_mm'] : nil)
          max = mm_triple(envelope.is_a?(Hash) ? envelope['max_mm'] : nil)
          return nil unless min && max

          [min, max]
        end

        # A persisted coordinate triple: exactly 3 finite numerics in mm.
        def mm_triple(value)
          return nil unless value.is_a?(Array) && value.length == 3 &&
                            value.all? { |component| component.is_a?(Numeric) && component.to_f.finite? }

          value.map(&:to_f)
        end

        # Host Point3d (INCHES) → mm triple for frame/descriptor data.
        def point_mm(point)
          mm = 25.4
          [point.x.to_f * mm, point.y.to_f * mm, point.z.to_f * mm]
        end

        # A host axis vector as a horizontal UNIT mm direction — nil when
        # it tilts off the XY plane or leaves unit length (scaled).
        def horizontal_unit_dir_mm(vector)
          return nil unless vector.respond_to?(:x) && vector.respond_to?(:y) && vector.respond_to?(:z)

          x = vector.x.to_f
          y = vector.y.to_f
          z = vector.z.to_f
          return nil unless z.abs < UNIT_EPSILON
          return nil unless (Math.sqrt((x**2) + (y**2)) - 1.0).abs < UNIT_EPSILON

          [x, y, 0.0]
        end

        # zaxis must be exactly +Z: tilt or a flipped frame rejects.
        def vertical_up_axis?(vector)
          vector.respond_to?(:x) && vector.x.to_f.abs < UNIT_EPSILON &&
            vector.respond_to?(:y) && vector.y.to_f.abs < UNIT_EPSILON &&
            vector.respond_to?(:z) && ((vector.z.to_f - 1.0).abs < UNIT_EPSILON)
        end

        # Display label: the entity's human name without the technical id
        # suffix. Cosmetic only — never identity authority.
        def placement_target_label(entity)
          name = entity.respond_to?(:name) ? entity.name.to_s : ''
          label = name.sub(/\s*\([^()]*\)\s*\z/, '').strip
          label.empty? ? 'Mueble' : label
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

        def handle_restore_furniture_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          furniture_instance_id = payload['furnitureInstanceId'].to_s
          result = if mutation_coordinator.busy?
                     {
                       'ok' => false, 'code' => 'action_in_progress',
                       'reason' => 'hay otra modificación del modelo en curso',
                       'instanceId' => furniture_instance_id
                     }
                   else
                     project_furniture_placer.restore(furniture_instance_id)
                   end
          execute_bridge(dialog, 'onRestoreFurnitureResult', result)
          mark_host_save_pending if result['ok'] && result['restored'] == true
          handle_get_project_furniture(dialog)
        rescue StandardError => e
          @logger.error('project_furniture_restore_failed', error: e)
          execute_bridge(dialog, 'onRestoreFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Focus an already-placed unit: pure viewport selection state.
        def handle_select_project_furniture(raw_payload = nil)
          payload = if raw_payload.is_a?(String) && !raw_payload.strip.empty?
                      JSON.parse(raw_payload)
                    else
                      raw_payload || {}
                    end
          fi_id = payload['furnitureInstanceId'].to_s
          return if fi_id.empty?

          model = active_model
          located = Connection::ProjectFurniture::ManagedFurniture.locate(
            model, @metadata_store_factory.call(model), fi_id
          )
          if located['entity'] && model.respond_to?(:selection)
            model.selection.clear
            model.selection.add(located['entity'])
            @logger.info('project_furniture_selected', furniture_instance_id: fi_id)
          else
            @logger.warn('project_furniture_select_rejected', furniture_instance_id: fi_id)
          end
        rescue StandardError => e
          @logger.error('project_furniture_select_failed', error: e)
        end

        # Pushes a fresh panel payload when a visible dialog exists — used at
        # dialog ready and on active-document switches (the panel follows the
        # binding of whichever model is open).
        def refresh_project_furniture
          handle_get_project_furniture(@dialog) if @dialog&.visible?
        end

        def handle_observed_working_copy_commit
          notify_commercial_projection_synchronization(:partial)
          refresh_project_furniture
        end

        def handle_observed_position_sync_outcome(outcome = nil, **kwargs)
          return unless @dialog&.visible?

          outcome = kwargs if outcome.nil? || !outcome.is_a?(Hash)
          return unless outcome.is_a?(Hash)

          current = active_model
          return unless current
          return if outcome[:model] && !current.equal?(outcome[:model])
          return unless sync_outcome_binding_matches?(current, outcome[:binding])

          handle_get_project_furniture(@dialog)

          return unless outcome[:status] == :success

          push_preflight_state(@dialog)
          mark_host_save_pending
        end

        def sync_outcome_binding_matches?(current_model, outcome_binding)
          return true unless outcome_binding

          current_binding = if defined?(Connection::ModelBinding::Store)
                              Connection::ModelBinding::Store.new(current_model).read
                            end
          if current_binding
            return current_binding.project_id == outcome_binding.project_id &&
                   current_binding.design_id == outcome_binding.design_id &&
                   current_binding.base_revision_id == outcome_binding.base_revision_id
          end

          return true unless @model_binding_connector.respond_to?(:status)

          status = @model_binding_connector.status
          return true unless status.is_a?(Hash) && status['binding'].is_a?(Hash)

          b = status['binding']
          b['projectId'] == outcome_binding.project_id &&
            b['designId'] == outcome_binding.design_id &&
            b['baseRevisionId'] == outcome_binding.base_revision_id
        end

        def handle_observed_position_sync_complete(_event, _ids)
          return unless @dialog&.visible?

          handle_get_project_furniture(@dialog)
          push_preflight_state(@dialog)
          mark_host_save_pending
        end

        def handle_host_inventory_change
          refresh_project_furniture
        end

        # #391 / DT-7: Publish precheck for managed furniture identity.
        def handle_validate_managed_furniture_identity(dialog)
          result = if duplicate_resolver
                     duplicate_resolver.validate_model(active_model)
                   else
                     { 'valid' => true, 'code' => 'valid' }
                   end
          execute_bridge(dialog, 'onValidateFurnitureIdentityResult', result)
        rescue StandardError => e
          @logger.error('validate_managed_furniture_identity_failed', error: e)
          execute_bridge(dialog, 'onValidateFurnitureIdentityResult',
                         { 'valid' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #391 / DT-7: Rescan and resolve all duplicate identities in the model.
        def handle_rescan_duplicates(dialog)
          result = if duplicate_resolver
                     duplicate_resolver.rescan_and_resolve(active_model)
                   else
                     { 'ok' => false, 'code' => 'resolver_unavailable' }
                   end
          execute_bridge(dialog, 'onRescanDuplicatesResult', result)
          handle_get_project_furniture(dialog)
        rescue StandardError => e
          @logger.error('rescan_duplicates_failed', error: e)
          execute_bridge(dialog, 'onRescanDuplicatesResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #392 / DT-8: publish the connected design as an immutable revision
        # with model/manifest/preview artifacts. The dialog never builds
        # business payloads — the publisher owns the sequence, reuses the
        # #391 precheck, and reports honest progress steps.
        #
        # #731 PR2: `Publicar diseño` is now an ORCHESTRATION, not a gate
        # wall. One click runs: fresh HostReconciliation → safe convergence
        # of every pending_confirmation position (1 coalesced working copy
        # transaction) → design-wide batch validation over the canonical
        # publication scope → FRESH PublicationPreflightGate evaluation →
        # Publisher.publish (or exceptions-only rendering). The gate is
        # still enforced fail-closed Ruby-side immediately before the
        # publisher; the batch never mints readiness and the publisher
        # stays publication-only.
        def handle_publish_design_revision(dialog)
          unless @design_publisher
            execute_bridge(dialog, 'onPublishResult',
                           { 'ok' => false, 'code' => 'publisher_unavailable',
                             'reason' => 'la publicación de diseños no está disponible' })
            return
          end

          start_design_workflow(dialog, 'publish')
        rescue StandardError => e
          @logger.error('publish_design_revision_failed', error: e)
          execute_bridge(dialog, 'onPublishResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #731 PR2 Entrega D: explicit design-wide validation. Runs the SAME
        # DesignPreflightBatch `Publicar diseño` runs — never a second
        # path — and reports the same exceptions-only projection without
        # publishing.
        def handle_validate_design_revision(dialog)
          start_design_workflow(dialog, 'validate')
        rescue StandardError => e
          @logger.error('validate_design_revision_failed', error: e)
          execute_bridge(dialog, 'onDesignValidationResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def start_design_workflow(dialog, kind)
          if design_workflow_busy?
            execute_bridge(dialog, workflow_result_channel(kind),
                           { 'ok' => false, 'code' => 'action_in_progress',
                             'reason' => 'hay una validación o publicación del diseño en curso' })
            return
          end

          model = active_model
          binding = model && Connection::ModelBinding::Store.new(model).read
          unless model && binding
            finish_design_workflow(dialog, kind,
                                   { 'ok' => false, 'code' => 'unbound',
                                     'reason' => 'conectá este modelo a un proyecto y diseño primero' })
            return
          end

          @design_workflow = { 'kind' => kind, 'model' => model, 'binding' => binding }
          report_design_workflow_progress(dialog, kind, 0, 0, 'Preparando validación del diseño…')

          host = design_workflow_host_projection(model, binding)
          design_workflow_converge_pending(dialog, kind, model, binding, host)
          host = design_workflow_host_projection(model, binding)

          blockers = design_workflow_host_blockers(host)
          if blockers.any?
            # Hard host blockers (duplicate_local, missing_local,
            # incompatible, terminal_or_orphan, unavailable projection…)
            # have NO safe automatic repair: stop before the batch and show
            # the exceptions.
            finish_design_workflow_exceptions(dialog, kind, host, blockers)
            return
          end

          # Wire the completion guard BEFORE start: a synchronous scheduler
          # (tests, non-UI hosts) runs the whole batch inside #start.
          @design_workflow['batch_generation'] = design_preflight_batch.next_generation
          outcome = design_preflight_batch.start
          finish_design_workflow(dialog, kind, batch_start_failure(outcome)) unless outcome['started'] == true
        rescue StandardError => e
          @logger.error('design_workflow_start_failed', error: e, kind: kind)
          finish_design_workflow(dialog, kind, { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Batch progress → per-channel feedback. Superseded generations and
        # runs whose workflow already finished are discarded.
        def handle_design_validation_progress(payload)
          workflow = @design_workflow
          return unless workflow
          return unless payload['generation'] == workflow['batch_generation']

          dialog = @dialog
          return unless dialog&.visible?

          report_design_workflow_progress(dialog, workflow['kind'],
                                          payload['done'].to_i, payload['total'].to_i, nil)
        end

        # Batch completion → FRESH gate evaluation (never the batch's own
        # tally) → publish or exceptions. A mutation that landed during the
        # batch flips tracker entries to stale, so the gate re-reads the
        # honest state here and blocks the publish.
        def handle_design_validation_complete(result)
          workflow = @design_workflow
          return unless workflow
          return unless result['generation'] == workflow['batch_generation']

          dialog = @dialog
          return unless dialog

          unless design_workflow_context_current?(workflow)
            finish_design_workflow(dialog, workflow['kind'],
                                   { 'ok' => false, 'code' => 'context_changed',
                                     'reason' => 'el modelo activo o su enlace cambió durante la validación' })
            return
          end

          push_preflight_state(dialog)

          if result['code'] != Host::DesignPreflightBatch::COMPLETED
            finish_design_workflow(dialog, workflow['kind'],
                                   { 'ok' => false, 'code' => result['code'],
                                     'reason' => 'la validación del diseño no completó' })
            return
          end

          host = design_workflow_host_projection(workflow['model'], workflow['binding'])
          if workflow['kind'] == 'validate'
            finish_design_validation_only(dialog, host)
          else
            finish_publish_after_validation(dialog, host)
          end
        rescue StandardError => e
          @logger.error('design_validation_complete_failed', error: e)
          finish_design_workflow(@dialog, 'publish', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        private

        # `Validar diseño` outcome: the same exceptions-only projection,
        # without any publish attempt.
        def finish_design_validation_only(dialog, host)
          finish_design_workflow(dialog, 'validate',
                                 { 'ok' => true, 'code' => Host::DesignPreflightBatch::COMPLETED,
                                   'validation' => publication_validation_projection(nil, host, []) })
        end

        # Publish half of the completion: mutation-free check, FRESH gate,
        # then the untouched publisher sequence.
        def finish_publish_after_validation(dialog, host)
          if mutation_coordinator.respond_to?(:busy?) && mutation_coordinator.busy?
            finish_design_workflow(dialog, 'publish',
                                   { 'ok' => false, 'code' => 'action_in_progress',
                                     'reason' => mutation_in_progress_reason })
            return
          end

          gate = publication_gate_projection
          if gate.nil? || gate['allowed'] != true
            failure = { 'ok' => false, 'code' => 'preflight_incomplete',
                        'reason' => publish_gate_reason(gate) }
            finish_design_workflow_exceptions(dialog, 'publish', host, [], extra: failure)
            return
          end

          on_progress = ->(step) { execute_bridge(dialog, 'onPublishProgress', { 'step' => step }) }
          publish_result = @design_publisher.publish(on_progress: on_progress)
          notify_commercial_projection_synchronization(:full) if publish_result['ok']
          execute_bridge(dialog, 'onPublishResult', publish_result)
          # The binding base label and capabilities follow the new revision.
          handle_get_model_binding(dialog) if publish_result['ok']
          @design_workflow = nil
        end

        def design_workflow_busy?
          !@design_workflow.nil?
        end

        def mutation_in_progress_reason
          'hay otra modificación del modelo en curso; reintentá la publicación'
        end

        def workflow_result_channel(kind)
          kind == 'validate' ? 'onDesignValidationResult' : 'onPublishResult'
        end

        def finish_design_workflow(dialog, kind, result)
          @design_workflow = nil
          execute_bridge(dialog, workflow_result_channel(kind), result)
        end

        # Exceptions-only ending (#731 product rule): the designer sees the
        # summary counts and ONLY the furniture that requires attention —
        # never a list of per-unit successes.
        def finish_design_workflow_exceptions(dialog, kind, host, blockers, extra: {})
          validation = publication_validation_projection(nil, host, blockers)
          if kind == 'validate'
            finish_design_workflow(dialog, kind,
                                   { 'ok' => true, 'code' => 'exceptions',
                                     'validation' => validation })
          else
            failure = extra.any? ? extra : { 'ok' => false, 'code' => 'preflight_incomplete' }
            failure['reason'] ||= publish_gate_reason(publication_gate_projection)
            finish_design_workflow(dialog, kind,
                                   failure.merge('validation' => validation))
          end
        end

        def design_workflow_host_projection(model, binding)
          return nil unless @host_reconciliation

          method = @host_reconciliation.method(:projection)
          accepts_context = method.parameters.any? { |kind, _name| %i[key keyreq keyrest].include?(kind) }
          accepts_context ? method.call(model: model, binding: binding) : method.call
        rescue StandardError => e
          @logger.error('design_workflow_host_projection_failed', error: e)
          nil
        end

        # Safe automatic convergence: only pending_confirmation units of a
        # CONNECTED projection, converging in one coalesced working copy
        # transaction. Every other state is left untouched for the honest
        # blocker classification that follows.
        def design_workflow_converge_pending(dialog, kind, model, binding, host)
          return false unless host.is_a?(Hash) && host['state'] == 'connected'
          return false unless @position_sync_coordinator.respond_to?(:converge_pending)

          pending = host['items'].to_a
                                 .select { |item| item['reconciliationState'] == 'pending_confirmation' }
                                 .filter_map { |item| item['id'] }
          return false if pending.empty?

          report_design_workflow_progress(dialog, kind, 0, 0, 'Sincronizando posiciones pendientes…')
          result = @position_sync_coordinator.converge_pending(model, binding, pending)
          result['ok'] == true
        rescue StandardError => e
          @logger.error('design_workflow_converge_failed', error: e)
          false
        end

        # Hard blockers have no safe automatic repair: every blocking
        # reconciliation item of a connected projection, or the projection's
        # own unavailable state.
        def design_workflow_host_blockers(host)
          if host.is_a?(Hash) && host['state'] == 'connected'
            host['items'].to_a.select { |item| item['blocking'] }.map do |item|
              { 'furnitureInstanceId' => item['id'], 'displayName' => item['displayName'],
                'state' => item['reconciliationState'], 'reason' => item['reason'] }
            end
          else
            [{ 'state' => host.is_a?(Hash) ? host['state'] : 'unknown',
               'reason' => host.is_a?(Hash) ? host['reason'] : 'no se pudo reconciliar el modelo con el diseño' }]
          end
        end

        def design_workflow_context_current?(workflow)
          return false unless active_model.equal?(workflow['model'])

          current = Connection::ModelBinding::Store.new(workflow['model']).read
          current && current.to_h == workflow['binding'].to_h
        end

        def report_design_workflow_progress(dialog, kind, done, total, detail)
          text = detail || "Validando diseño… #{done} de #{total}"
          if kind == 'validate'
            execute_bridge(dialog, 'onDesignValidationProgress',
                           { 'done' => done, 'total' => total, 'detail' => text })
          else
            execute_bridge(dialog, 'onPublishProgress',
                           { 'step' => 'validating', 'detail' => text })
          end
        end

        def batch_start_failure(outcome)
          scope_reason = 'no se pudo confirmar el alcance de publicación del diseño'
          reasons = {
            'busy' => ['action_in_progress', 'hay una validación del diseño en curso'],
            Host::DesignPreflightBatch::UNBOUND => ['unbound', 'conectá este modelo a un proyecto y diseño primero'],
            Host::DesignPreflightBatch::SCOPE_UNAVAILABLE => ['preflight_incomplete', scope_reason]
          }
          code, reason = reasons.fetch(outcome['code'], ['error', 'no se pudo iniciar la validación del diseño'])
          { 'ok' => false, 'code' => code, 'reason' => reason }
        end

        # #731 exceptions-only projection. Counts come from the gate/scope
        # denominator; cards exist ONLY for furniture requiring attention
        # (blocked/stale/unverified/unavailable or hard reconciliation
        # states). displayNames come from the HostReconciliation authority;
        # issue detail from the stored authoritative review — never from
        # names or geometry.
        def publication_validation_projection(gate, host, extra_blockers)
          scope_items = publication_workflow_scope_items
          gate ||= publication_gate_projection
          host_items = host.is_a?(Hash) && host['state'] == 'connected' ? host['items'].to_a : []
          by_id = host_items.to_h { |item| [item['id'], item] }

          # Hard host blockers first: their reconciliation state and reason
          # are more specific than a generic unverified scope entry.
          seen = {}
          exceptions = host_blocker_exceptions(host_items, seen)
          exceptions.concat(scope_state_exceptions(scope_items, by_id, seen))
          exceptions.concat(new_extra_blockers(extra_blockers, seen))

          total = gate && gate['total'] ? gate['total'] : scope_items.length
          ready = gate && gate['verified'] ? gate['verified'] : 0
          { 'total' => total, 'ready' => ready, 'attention' => exceptions.length,
            'exceptions' => exceptions }
        end

        def host_blocker_exceptions(host_items, seen)
          host_items.filter_map do |item|
            next unless item['blocking']
            next if seen[item['id']]

            seen[item['id']] = true
            validation_exception_payload(item['id'], item['reconciliationState'],
                                         item, item['reason'])
          end
        end

        def scope_state_exceptions(scope_items, by_id, seen)
          scope_items.filter_map do |item|
            id = item['furnitureInstanceId']
            next if seen[id]

            state = scope_state_for(id)
            next if %w[ready warning].include?(state)

            seen[id] = true
            validation_exception_payload(id, state, by_id[id])
          end
        end

        def new_extra_blockers(extra_blockers, seen)
          extra_blockers.filter_map do |blocker|
            id = blocker['furnitureInstanceId']
            next if id && seen[id]

            seen[id] = true
            blocker.merge('review' => nil).compact
          end
        end

        def scope_state_for(furniture_instance_id)
          return Host::PublicationPreflightGate::UNVERIFIED unless @publication_gate

          @publication_gate.state_for_furniture(furniture_instance_id)
        end

        def validation_exception_payload(furniture_instance_id, state, host_item, reason = nil)
          review = nil
          if furniture_instance_id
            review = preflight_review_session.payload_for('furnitureInstanceId' => furniture_instance_id)
          end
          {
            'furnitureInstanceId' => furniture_instance_id,
            'displayName' => host_item && host_item['displayName'],
            'state' => state,
            'reason' => reason || (host_item && host_item['reason']) || (review && review['reason']),
            'review' => review
          }.compact
        end

        def publication_workflow_scope_items
          return [] unless @publication_scope_provider

          @publication_scope_provider.call || []
        rescue StandardError => e
          @logger.error('publication_workflow_scope_failed', error: e)
          []
        end

        # Lazy shared batch: the SAME scope provider, session, tracker and
        # event-loop deferral the unit review and publisher flows use.
        def design_preflight_batch
          @design_preflight_batch ||= Host::DesignPreflightBatch.new(
            scope_provider: -> { @publication_scope_provider&.call },
            preflight_session: preflight_review_session,
            model_provider: method(:active_model),
            binding_provider: ->(model) { Connection::ModelBinding::Store.new(model).read },
            scheduler: ->(&block) { host_event_loop_defer(&block) },
            on_progress: method(:handle_design_validation_progress),
            on_complete: method(:handle_design_validation_complete),
            logger: @logger
          )
        end

        def host_event_loop_defer(&block)
          if defined?(::UI) && ::UI.respond_to?(:start_timer)
            ::UI.start_timer(0, false, &block)
          else
            block.call
          end
        end

        # Honest Spanish reason for a blocked publication gate, in the same
        # priority the dialog renders (blocked > stale > unavailable >
        # unverified).
        def publish_gate_reason(gate)
          scope_unknown = 'no se pudo confirmar el alcance de publicación del diseño'
          return scope_unknown if gate.nil? || !gate['scopeAvailable']

          unless gate['hostAvailable'] && gate['hostClean']
            count = gate['hostAttention'].to_i
            return "hay #{count} muebles que requieren reconciliación con este archivo SketchUp" if count.positive?

            return 'no se pudo confirmar que este archivo SketchUp coincida con el diseño'
          end
          return 'hay muebles con problemas de fabricación' if gate['blocked'].to_i.positive?
          return 'la revisión de fabricación quedó desactualizada' if gate['stale'].to_i.positive?
          if gate['unavailable'].to_i.positive?
            return 'no se pudo confirmar el estado de fabricación de todos los muebles'
          end

          "faltan verificar #{gate['pending']} de #{gate['total']} muebles del diseño"
        end

        def project_furniture_placer
          @project_furniture_placer
        end

        def duplicate_resolver
          @duplicate_resolver
        end
      end

      # #498 / SU-HOST-1 shared host mutation bridge: every managed
      # authoring mutation from the dialog — the legacy update_furniture
      # command and the new versioned authoring_mutation channel — runs
      # through ONE Host::AuthoringMutationCoordinator. This bridge only
      # adapts dialog payloads into MutationCommand seams; correlation,
      # late-response rejection, one-operation atomicity, rollback, selection
      # restore and degraded semantics live in the coordinator so #466–#471
      # plug in without cloning any of it.
    end
  end
end
