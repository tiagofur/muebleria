# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      # Coordinates automatic position convergence between the local SketchUp host
      # and Granete's authoritative WorkingCopy (R1, R2, R3, R4).
      #
      # Key responsibilities:
      # - R1: Explicit post-insert convergence without depending on observers that
      #       ignore internal operations.
      # - R2: Detects local transform changes and keeps WorkingCopy in sync.
      # - R3: Top-level MOVE/ROTATE updates WorkingCopy without invalidating
      #       fabrication preflight or forcing redundant re-resolves.
      # - Debouncing / coalescing rapid moves (A -> B -> C converges to C).
      # - Strict context revalidation before PUT (model + exact binding).
      # - Authoritative PUT readback before advancing local known_transforms.
      # - Structured outcome callback (on_sync_outcome) for both success and failure
      #   allowing the UI to honestly present pending_confirmation on sync failures.
      class PositionSyncCoordinator # rubocop:disable Metrics/ClassLength
        attr_reader :known_transforms
        attr_accessor :on_sync_outcome, :on_sync_complete, :preflight_session

        # rubocop:disable-next Metrics/ParameterLists
        def initialize(model_provider:, binding_store_factory:, service:,
                       metadata_store_factory:, host_reconciliation:,
                       intent_store: nil, mutation_coordinator: nil,
                       preflight_session: nil, on_sync_complete: nil,
                       on_sync_outcome: nil,
                       logger: SafeLogger.new)
          @model_provider = model_provider
          @binding_store_factory = binding_store_factory
          @service = service
          @metadata_store_factory = metadata_store_factory
          @host_reconciliation = host_reconciliation
          @intent_store = intent_store
          @mutation_coordinator = mutation_coordinator
          @preflight_session = preflight_session
          @on_sync_complete = on_sync_complete
          @on_sync_outcome = on_sync_outcome
          @logger = logger
          @suppressed = false
          @known_transforms = {}
          @model_observer = Host::PositionSyncObserver.new(self)
          @observed_model = nil
          @timer_id = nil
        end

        def rebind(model)
          return if @observed_model.equal?(model)

          detach_observed_model
          @observed_model = model
          attach_observed_model
          record_transforms(model) if model
        end

        def shutdown
          detach
        end

        def detach
          detach_observed_model
          cancel_timer
        end
        alias detach_model detach

        def suppress
          previous = @suppressed
          @suppressed = true
          yield
        ensure
          @suppressed = previous
        end

        def suppressed?
          @suppressed
        end

        def on_transaction_commit(model)
          handle_transaction_event(model)
        end

        def on_transaction_undo(model)
          handle_transaction_event(model)
        end

        def on_transaction_redo(model)
          handle_transaction_event(model)
        end

        def converge_inserted_unit(model, binding, furniture_instance_id) # rubocop:disable Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/MethodLength, Metrics/PerceivedComplexity
          captured_model = model
          captured_binding = binding
          unless captured_binding
            return failure(:unbound_model, 'modelo sin vincular a proyecto de Granete', furniture_instance_id)
          end

          unless context_valid?(captured_model, captured_binding)
            return failure(:context_changed, 'el modelo o binding cambió antes de sincronizar', furniture_instance_id)
          end

          located = ProjectFurniture::ManagedFurniture.locate(
            captured_model,
            @metadata_store_factory.call(captured_model),
            furniture_instance_id
          )
          entity = located['entity']
          return failure(:not_placed, 'el mueble no está en el modelo', furniture_instance_id) unless entity

          host_transform = entity.respond_to?(:transformation) ? entity.transformation : nil
          unless host_transform
            return failure(:no_transform, 'el mueble no tiene transformación', furniture_instance_id)
          end

          working = @service.get_working_copy(captured_binding.design_id)
          intent = @intent_store&.fetch(furniture_instance_id) ||
                   read_intent_from_metadata(captured_model, entity, furniture_instance_id) || {}
          locator = ProjectFurniture::ManagedFurniture.persistent_locator(entity)

          merged_items = ProjectFurniture::WorkingCopyMerger.merge(
            working,
            furniture_instance_id,
            entity,
            intent: intent,
            locator: locator
          )

          unless context_valid?(captured_model, captured_binding)
            return failure(:context_changed,
                           'el modelo o binding cambió antes de enviar cambios al servidor',
                           furniture_instance_id)
          end

          outcome = DesignSync::SafeWrite.write(
            service: @service, working: working, items: merged_items,
            base_revision_id: captured_binding.base_revision_id
          )
          updated_wc = outcome['working']

          unless context_valid?(captured_model, captured_binding)
            return failure(:context_changed,
                           'el modelo o binding cambió durante la sincronización',
                           furniture_instance_id)
          end

          # P2: Validate project_id, design_id, AND base_revision_id
          unless updated_wc.design_id == captured_binding.design_id &&
                 updated_wc.project_id == captured_binding.project_id &&
                 updated_wc.base_revision_id == captured_binding.base_revision_id
            emit_sync_outcome(
              event: :insert,
              ids: [furniture_instance_id],
              status: :failed,
              code: :base_revision_mismatch,
              model: captured_model,
              binding: captured_binding
            )
            return failure(:base_revision_mismatch,
                           'el Working Copy devuelto no coincide con la revisión base del modelo',
                           furniture_instance_id)
          end

          returned_item = updated_wc.items.find { |i| i.furniture_instance_id == furniture_instance_id }
          unless returned_item&.transform &&
                 ProjectFurniture::TransformContract.equivalent_to_host?(returned_item.transform, host_transform)
            emit_sync_outcome(
              event: :insert,
              ids: [furniture_instance_id],
              status: :failed,
              code: :readback_mismatch,
              model: captured_model,
              binding: captured_binding
            )
            return failure(:readback_mismatch,
                           'la posición devuelta por el servidor difiere del estado local',
                           furniture_instance_id)
          end

          @known_transforms[captured_model] ||= {}
          @known_transforms[captured_model][furniture_instance_id] = returned_item.transform
          @intent_store&.clear(furniture_instance_id) if @intent_store.respond_to?(:clear)
          @intent_store&.delete(furniture_instance_id) if @intent_store.respond_to?(:delete)

          run_initial_preflight(furniture_instance_id)
          emit_sync_outcome(
            event: :insert,
            ids: [furniture_instance_id],
            status: :success,
            code: :ok,
            model: captured_model,
            binding: captured_binding
          )

          { 'ok' => true, 'code' => 'placed', 'instanceId' => furniture_instance_id }
        rescue StandardError => e
          @logger.error('position_sync_insert_failed', error: e, furniture_instance_id: furniture_instance_id)
          emit_sync_outcome(
            event: :insert,
            ids: [furniture_instance_id],
            status: :failed,
            code: extract_error_code(e),
            model: captured_model,
            binding: captured_binding
          )
          failure(:sync_failed, e.message, furniture_instance_id)
        end

        def sync_moved_entities(model) # rubocop:disable Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/MethodLength, Metrics/PerceivedComplexity
          return if suppressed?
          return unless model && active_model?(model)

          captured_model = model
          captured_binding = binding_for(captured_model)
          return unless captured_binding

          return unless context_valid?(captured_model, captured_binding)

          moved_entries = detect_moved_entries(captured_model)
          return if moved_entries.empty?

          all_ids = moved_entries.map { |item| item[:id] }

          working = @service.get_working_copy(captured_binding.design_id)

          return unless context_valid?(captured_model, captured_binding)

          current_working = working
          moved_entries.each do |item|
            intent = read_intent_from_metadata(captured_model, item[:entity], item[:id]) || {}
            locator = ProjectFurniture::ManagedFurniture.persistent_locator(item[:entity])
            merged_items = ProjectFurniture::WorkingCopyMerger.merge(
              current_working,
              item[:id],
              item[:entity],
              intent: intent,
              locator: locator
            )
            current_working = Struct.new(:items).new(merged_items)
          end

          return unless context_valid?(captured_model, captured_binding)

          outcome = DesignSync::SafeWrite.write(
            service: @service, working: working, items: current_working.items,
            base_revision_id: captured_binding.base_revision_id
          )
          updated_wc = outcome['working']

          return unless context_valid?(captured_model, captured_binding)

          # P2: Validate project_id, design_id, AND base_revision_id
          unless updated_wc.design_id == captured_binding.design_id &&
                 updated_wc.project_id == captured_binding.project_id &&
                 updated_wc.base_revision_id == captured_binding.base_revision_id
            @logger.warn('position_sync_moved_base_revision_mismatch',
                         design_id: captured_binding.design_id,
                         expected_base: captured_binding.base_revision_id,
                         returned_base: updated_wc.base_revision_id)
            emit_sync_outcome(
              event: :move,
              ids: all_ids,
              status: :failed,
              code: :base_revision_mismatch,
              model: captured_model,
              binding: captured_binding
            )
            return
          end

          synced_ids = []
          failed_ids = []
          moved_entries.each do |item|
            returned = updated_wc.items.find { |w| w.furniture_instance_id == item[:id] }
            entity = item[:entity]
            host_transform = entity.respond_to?(:transformation) ? entity.transformation : nil
            if returned&.transform && host_transform &&
               ProjectFurniture::TransformContract.equivalent_to_host?(returned.transform, host_transform)
              @known_transforms[captured_model] ||= {}
              @known_transforms[captured_model][item[:id]] = returned.transform
              synced_ids << item[:id]
            else
              failed_ids << item[:id]
            end
          end

          if synced_ids.any?
            @logger.info('position_sync_moved_synced', count: synced_ids.length)
            emit_sync_outcome(
              event: :move,
              ids: synced_ids,
              status: :success,
              code: :ok,
              model: captured_model,
              binding: captured_binding
            )
          end

          if failed_ids.any?
            @logger.warn('position_sync_moved_readback_mismatch', count: failed_ids.length)
            emit_sync_outcome(
              event: :move,
              ids: failed_ids,
              status: :failed,
              code: :readback_mismatch,
              model: captured_model,
              binding: captured_binding
            )
          end
        rescue StandardError => e
          @logger.error('position_sync_moved_failed', error: e)
          if all_ids&.any?
            emit_sync_outcome(
              event: :move,
              ids: all_ids,
              status: :failed,
              code: extract_error_code(e),
              model: captured_model,
              binding: captured_binding
            )
          end
        end

        def record_transforms(model)
          return unless model

          index = ProjectFurniture::ManagedFurniture.index(
            model, @metadata_store_factory.call(model)
          )
          transforms = {}
          index[:by_id].each do |id, entries|
            next if entries.length > 1

            entity = entries.first[:entity]
            if entity.respond_to?(:transformation)
              transforms[id] = ProjectFurniture::TransformContract.from_host(entity.transformation)
            end
          end
          @known_transforms[model] = transforms
        end

        # #731 PR2 — converge every pending_confirmation unit of the design
        # in ONE authoritative working copy transaction: a single GET, one
        # WorkingCopyMerger pass over all units, a single PUT and a
        # per-unit authoritative readback (never N GET+PUT rounds). The
        # caller is responsible for having classified the ids as
        # pending_confirmation against a FRESH HostReconciliation
        # projection — that classification already proves the instance is
        # active, there is exactly one local root and the identity and
        # definition match the authorities. This method adds the PR1
        # invariants: exact context guards before and after the PUT, exact
        # baseRevisionId validation, readback transform equivalence and no
        # known-state advance when anything mismatches.
        #
        # It performs NO preflight by itself: the design-wide batch that
        # follows owns validation. Positions it converges become
        # present_synced for the next reconciliation projection.
        def converge_pending(model, binding, furniture_instance_ids) # rubocop:disable Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/MethodLength, Metrics/PerceivedComplexity
          return convergence_failure(:unbound_model, 'modelo sin vincular a proyecto de Granete', []) unless binding
          unless context_valid?(
            model, binding
          )
            return convergence_failure(:context_changed, 'el modelo o binding cambió antes de sincronizar',
                                       [])
          end

          metadata_store = @metadata_store_factory.call(model)
          entries = furniture_instance_ids.map do |id|
            entity = ProjectFurniture::ManagedFurniture.locate(model, metadata_store, id)['entity']
            { id: id, entity: entity }
          end
          located_entries = entries.select { |entry| entry[:entity] }
          missing = entries.select { |entry| entry[:entity].nil? }.map { |entry| entry[:id] }
          if located_entries.empty?
            return convergence_failure(:not_placed, 'los muebles no están en el modelo',
                                       missing)
          end

          working = @service.get_working_copy(binding.design_id)
          unless context_valid?(
            model, binding
          )
            return convergence_failure(:context_changed,
                                       'el modelo o binding cambió antes de enviar cambios al servidor', missing)
          end

          merged_items = working.items
          located_entries.each do |entry|
            intent = read_intent_from_metadata(model, entry[:entity], entry[:id]) || {}
            locator = ProjectFurniture::ManagedFurniture.persistent_locator(entry[:entity])
            merged_items = ProjectFurniture::WorkingCopyMerger.merge(
              Struct.new(:items).new(merged_items),
              entry[:id], entry[:entity], intent: intent, locator: locator
            )
          end

          unless context_valid?(
            model, binding
          )
            return convergence_failure(:context_changed, 'el modelo o binding cambió durante la sincronización',
                                       missing)
          end

          outcome = DesignSync::SafeWrite.write(
            service: @service, working: working, items: merged_items,
            base_revision_id: binding.base_revision_id
          )
          updated_wc = outcome['working']

          unless context_valid?(model, binding)
            return convergence_failure(:context_changed,
                                       'el modelo o binding cambió durante la sincronización', missing)
          end

          unless updated_wc.design_id == binding.design_id &&
                 updated_wc.project_id == binding.project_id &&
                 updated_wc.base_revision_id == binding.base_revision_id
            emit_sync_outcome(event: :converge, ids: located_entries.map { |entry| entry[:id] },
                              status: :failed, code: :base_revision_mismatch,
                              model: model, binding: binding)
            return convergence_failure(:base_revision_mismatch,
                                       'el Working Copy devuelto no coincide con la revisión base del modelo', missing)
          end

          synced = []
          failed = missing.to_h { |id| [id, 'not_placed'] }
          located_entries.each do |entry|
            returned = updated_wc.items.find { |item| item.furniture_instance_id == entry[:id] }
            host_transform = entry[:entity].respond_to?(:transformation) ? entry[:entity].transformation : nil
            if returned&.transform && host_transform &&
               ProjectFurniture::TransformContract.equivalent_to_host?(returned.transform, host_transform)
              @known_transforms[model] ||= {}
              @known_transforms[model][entry[:id]] = returned.transform
              synced << entry[:id]
            else
              failed[entry[:id]] = 'readback_mismatch'
            end
          end

          if synced.any?
            @logger.info('position_sync_converge_synced', count: synced.length)
            emit_sync_outcome(event: :converge, ids: synced, status: :success,
                              code: :ok, model: model, binding: binding)
          end
          if failed.any?
            @logger.warn('position_sync_converge_mismatch', failed: failed)
            emit_sync_outcome(event: :converge, ids: failed.keys, status: :failed,
                              code: :readback_mismatch, model: model, binding: binding)
          end

          { 'ok' => failed.empty?, 'code' => failed.empty? ? 'converged' : 'readback_mismatch',
            'synced' => synced, 'failed' => failed }
        rescue StandardError => e
          @logger.error('position_sync_converge_failed', error: e,
                                                         ids: furniture_instance_ids)
          emit_sync_outcome(event: :converge, ids: furniture_instance_ids, status: :failed,
                            code: extract_error_code(e), model: model, binding: binding)
          convergence_failure(extract_error_code(e), e.message, [])
        end

        private

        def convergence_failure(code, reason, missing)
          failed = missing.to_h { |id| [id, 'not_placed'] }
          { 'ok' => false, 'code' => code.to_s, 'reason' => reason, 'synced' => [], 'failed' => failed }
        end

        def emit_sync_outcome(event:, ids:, status:, model:, binding:, code: :ok)
          unless context_valid?(model, binding)
            @logger.info('position_sync_outcome_discarded_context_changed',
                         event: event, ids: ids, status: status, code: code)
            return
          end

          outcome = {
            event: event,
            ids: ids,
            status: status,
            code: code,
            model: model,
            binding: binding
          }

          if @on_sync_outcome
            begin
              @on_sync_outcome.call(outcome)
            rescue ArgumentError
              @on_sync_outcome.call(**outcome)
            end
          end

          @on_sync_complete&.call(event, ids) if status == :success
        end

        def extract_error_code(error)
          return error.kind.to_sym if error.respond_to?(:kind) && error.kind
          return error.code.to_sym if error.respond_to?(:code) && error.code

          :sync_failed
        end

        def handle_transaction_event(model)
          return if suppressed?
          return unless model && active_model?(model)

          schedule_sync(model)
        end

        def schedule_sync(model)
          cancel_timer
          captured_model = model
          captured_binding = binding_for(model)
          return unless captured_binding

          timer_block = proc do
            @timer_id = nil
            next unless context_valid?(captured_model, captured_binding)

            sync_moved_entities(captured_model)
          end

          if defined?(::UI) && ::UI.respond_to?(:start_timer)
            @timer_id = ::UI.start_timer(0.2, false, &timer_block)
          else
            timer_block.call
          end
        end

        def cancel_timer
          return unless @timer_id

          ::UI.stop_timer(@timer_id) if defined?(::UI) && ::UI.respond_to?(:stop_timer)
          @timer_id = nil
        end

        def context_valid?(captured_model, captured_binding)
          return false unless captured_model && captured_binding
          return false unless active_model?(captured_model)

          current_binding = binding_for(captured_model)
          return false unless current_binding
          return false unless current_binding.project_id == captured_binding.project_id
          return false unless current_binding.design_id == captured_binding.design_id
          return false unless current_binding.base_revision_id == captured_binding.base_revision_id

          true
        end

        def detect_moved_entries(model)
          index = ProjectFurniture::ManagedFurniture.index(
            model, @metadata_store_factory.call(model)
          )
          known = @known_transforms[model] || {}
          moved = []

          index[:by_id].each do |id, entries|
            next if entries.length > 1

            entity = entries.first[:entity]
            next unless entity.respond_to?(:transformation)

            current = ProjectFurniture::TransformContract.from_host(entity.transformation)
            last = known[id]
            if last.nil? || !ProjectFurniture::TransformContract.equivalent?(current, last)
              moved << { id: id, entity: entity, transform: current }
            end
          end
          moved
        end

        def run_initial_preflight(furniture_instance_id)
          return unless @preflight_session

          scope = { 'furnitureInstanceId' => furniture_instance_id }
          @preflight_session.run(scope, message_id: "init-#{furniture_instance_id[0, 8]}")
        rescue StandardError => e
          @logger.warn('position_sync_initial_preflight_failed',
                       error: e, furniture_instance_id: furniture_instance_id)
        end

        def read_intent_from_metadata(model, entity, furniture_instance_id)
          metadata = @metadata_store_factory.call(model).read(entity)
          identity = metadata.is_a?(Hash) ? metadata['identity'] : nil
          if identity&.dig('furnitureInstanceId') != furniture_instance_id
            @logger.error('position_sync_intent_mismatch',
                          furniture_instance_id: furniture_instance_id,
                          stored: identity&.dig('furnitureInstanceId'))
            return nil
          end

          metadata['intent'].is_a?(Hash) ? metadata['intent'] : {}
        end

        def active_model?(model)
          @model_provider.call.equal?(model)
        end

        def binding_for(model)
          return nil unless model

          factory = @binding_store_factory
          store = factory.arity.zero? ? factory.call : factory.call(model)
          store.read
        rescue StandardError
          nil
        end

        def attach_observed_model
          return unless @observed_model.respond_to?(:add_observer)

          @observed_model.add_observer(@model_observer)
        end

        def detach_observed_model
          return unless @observed_model.respond_to?(:remove_observer)

          @observed_model.remove_observer(@model_observer)
          @observed_model = nil
        end

        def failure(code, reason, furniture_instance_id = nil)
          result = { 'ok' => false, 'code' => code.to_s, 'reason' => reason }
          result['instanceId'] = furniture_instance_id if furniture_instance_id
          result
        end
      end
    end
  end
end
