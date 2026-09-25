# frozen_string_literal: true

# Workflows de diseño (#731/#392): Publicar revisión y Validar diseño — orquestación
# (auto-sync → batch → gate → publish), progreso, excepciones y proyecciones.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module DesignWorkflowBridge # rubocop:disable Metrics/ModuleLength
        def register_design_workflow_callbacks(dialog)
          dialog.add_action_callback('publish_design_revision') do
            handle_publish_design_revision(dialog)
          end
          dialog.add_action_callback('validate_design_revision') do |_c, _p|
            handle_validate_design_revision(dialog)
          end
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
      end
    end
  end
end
