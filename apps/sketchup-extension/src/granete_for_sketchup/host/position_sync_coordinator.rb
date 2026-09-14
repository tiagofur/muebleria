# frozen_string_literal: true

require 'json'
require_relative '../logging'
require_relative '../connection/transform_contract'
require_relative '../connection/managed_furniture'
require_relative '../connection/project_furniture_contract'
require_relative 'command_contract'

module Granete
  module SketchUpExtension
    module Host
      # Observer for SketchUp model transactions: detects native MOVE, ROTATE,
      # UNDO, and REDO on Granete-managed top-level furniture instances.
      class PositionSyncModelObserver < (defined?(::Sketchup::ModelObserver) ? ::Sketchup::ModelObserver : Object)
        def initialize(coordinator)
          super() if defined?(::Sketchup::ModelObserver)
          @coordinator = coordinator
        end

        def onTransactionCommit(model)
          @coordinator.on_transaction_commit(model)
        rescue StandardError
          nil
        end

        def onTransactionUndo(model)
          @coordinator.on_transaction_undo(model)
        rescue StandardError
          nil
        end

        def onTransactionRedo(model)
          @coordinator.on_transaction_redo(model)
        rescue StandardError
          nil
        end
      end

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
      class PositionSyncCoordinator # rubocop:disable Metrics/ClassLength
        attr_reader :known_transforms
        attr_accessor :on_sync_complete, :preflight_session

        def initialize(model_provider:, binding_store_factory:, service:,
                       metadata_store_factory:, host_reconciliation:,
                       intent_store: nil, mutation_coordinator: nil,
                       preflight_session: nil, on_sync_complete: nil,
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
          @logger = logger
          @suppressed = false
          @known_transforms = {}.compare_by_identity
          @model_observer = PositionSyncModelObserver.new(self)
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
          detach_observed_model
          cancel_timer
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
          @suppressed || (@mutation_coordinator&.busy? || false)
        end

        # R1: Explicit convergence called immediately after physical insertion.
        # Performs sync placement -> readback -> reconciliation -> initial preflight.
        def converge_inserted_unit(model, binding, furniture_instance_id)
          return failure(:no_model, 'no hay un modelo activo') unless model && active_model?(model)
          return failure(:no_binding, 'el modelo no está enlazado') unless binding

          located = locate_unit(model, furniture_instance_id)
          entity = located['entity']
          return failure(:not_found, 'el mueble no está en el modelo') unless entity
          return failure(:duplicate_detected, 'duplicado detectado') if located['duplicates'] > 1

          suppress do
            sync_result = sync_entity_placement(model, binding, furniture_instance_id, entity)
            return sync_result unless sync_result['ok']

            update_known_transform(model, furniture_instance_id, entity)
            run_initial_preflight(furniture_instance_id)

            @on_sync_complete&.call(:insert, [furniture_instance_id])
            { 'ok' => true, 'code' => 'placed', 'instanceId' => furniture_instance_id }
          end
        rescue StandardError => e
          @logger.error('position_sync_converge_inserted_failed',
                        error: e, furniture_instance_id: furniture_instance_id)
          { 'ok' => false, 'code' => 'sync_failed', 'reason' => e.message,
            'instanceId' => furniture_instance_id }
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

        def record_transforms(model)
          return unless model

          index = Connection::ProjectFurniture::ManagedFurniture.index(
            model, @metadata_store_factory.call(model)
          )
          transforms = {}
          index[:by_id].each do |id, entries|
            entity = entries.first[:entity]
            if entity.respond_to?(:transformation)
              transforms[id] = Connection::ProjectFurniture::TransformContract.from_host(entity.transformation)
            end
          end
          @known_transforms[model] = transforms
        end

        def sync_moved_entities(model)
          return if suppressed?
          return unless model && active_model?(model)

          binding = binding_for(model)
          return unless binding

          moved_entries = detect_moved_entries(model)
          return if moved_entries.empty?

          execute_moved_sync(model, binding, moved_entries)
        end

        private

        def handle_transaction_event(model)
          return if suppressed?
          return unless model && active_model?(model)

          schedule_sync(model)
        end

        def schedule_sync(model)
          cancel_timer
          if defined?(::UI) && ::UI.respond_to?(:start_timer)
            @timer_id = ::UI.start_timer(0.2, false) do
              @timer_id = nil
              sync_moved_entities(model)
            end
          else
            sync_moved_entities(model)
          end
        end

        def cancel_timer
          return unless @timer_id

          ::UI.stop_timer(@timer_id) if defined?(::UI) && ::UI.respond_to?(:stop_timer)
          @timer_id = nil
        end

        def detect_moved_entries(model)
          index = Connection::ProjectFurniture::ManagedFurniture.index(
            model, @metadata_store_factory.call(model)
          )
          known = @known_transforms[model] || {}
          moved = []

          index[:by_id].each do |id, entries|
            next if entries.length > 1

            entity = entries.first[:entity]
            next unless entity.respond_to?(:transformation)

            current = Connection::ProjectFurniture::TransformContract.from_host(entity.transformation)
            last = known[id]
            if last.nil? || !Connection::ProjectFurniture::TransformContract.equivalent?(current, last)
              moved << { id: id, entity: entity, transform: current }
            end
          end
          moved
        end

        def execute_moved_sync(model, binding, moved_entries)
          suppress do
            working = @service.get_working_copy(binding.design_id)
            merged_items = working.items
            moved_entries.each do |item|
              intent = placement_intent(model, item[:entity], item[:id])
              locator = Connection::ProjectFurniture::ManagedFurniture.persistent_locator(item[:entity])
              merged_items = Connection::ProjectFurniture::WorkingCopyMerger.merge(
                Struct.new(:items).new(merged_items), item[:id], item[:entity], intent: intent, locator: locator
              )
            end

            @service.update_working_copy(binding.design_id, items: merged_items,
                                                            base_revision_id: binding.base_revision_id)

            @known_transforms[model] ||= {}
            moved_entries.each do |item|
              @known_transforms[model][item[:id]] = item[:transform]
            end

            # R3: MOVE top-level does NOT invalidate preflight tracker or trigger re-resolves!
            @logger.info('position_sync_moved_synced', count: moved_entries.length)
            @on_sync_complete&.call(:move, moved_entries.map { |m| m[:id] })
          end
        rescue StandardError => e
          @logger.error('position_sync_moved_failed', error: e)
        end

        def sync_entity_placement(model, binding, furniture_instance_id, entity)
          working = @service.get_working_copy(binding.design_id)
          intent = placement_intent(model, entity, furniture_instance_id) || {}
          locator = Connection::ProjectFurniture::ManagedFurniture.persistent_locator(entity)
          merged = Connection::ProjectFurniture::WorkingCopyMerger.merge(
            working, furniture_instance_id, entity, intent: intent, locator: locator
          )
          @service.update_working_copy(binding.design_id, items: merged,
                                                          base_revision_id: binding.base_revision_id)
          @intent_store&.clear(furniture_instance_id)
          @logger.info('position_sync_placement_synced',
                       furniture_instance_id: furniture_instance_id,
                       project_id: binding.project_id, design_id: binding.design_id)
          { 'ok' => true, 'code' => 'placed', 'instanceId' => furniture_instance_id }
        end

        def update_known_transform(model, furniture_instance_id, entity)
          @known_transforms[model] ||= {}
          return unless entity.respond_to?(:transformation)

          @known_transforms[model][furniture_instance_id] =
            Connection::ProjectFurniture::TransformContract.from_host(entity.transformation)
        end

        def run_initial_preflight(furniture_instance_id)
          return unless @preflight_session

          scope = CommandContract.furniture_scope({ 'furnitureInstanceId' => furniture_instance_id })
          @preflight_session.run(scope, message_id: "init-#{furniture_instance_id[0, 8]}")
        rescue StandardError => e
          @logger.warn('position_sync_initial_preflight_failed',
                       error: e, furniture_instance_id: furniture_instance_id)
        end

        def locate_unit(model, furniture_instance_id)
          Connection::ProjectFurniture::ManagedFurniture.locate(
            model, @metadata_store_factory.call(model), furniture_instance_id
          )
        end

        def placement_intent(model, entity, furniture_instance_id)
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

        def failure(code, reason)
          { 'ok' => false, 'code' => code.to_s, 'reason' => reason }
        end
      end
    end
  end
end
