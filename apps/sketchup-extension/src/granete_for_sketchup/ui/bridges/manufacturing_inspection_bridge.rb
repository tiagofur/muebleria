# frozen_string_literal: true

# Inspección de manufactura (#470): overlay por pieza/herraje.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module ManufacturingInspectionBridge # rubocop:disable Metrics/ModuleLength
        # Lazy, injectable overlay manager: built on first inspection use so
        # sessions that never inspect pay nothing.
        def manufacturing_overlay
          @manufacturing_overlay ||= Overlay::Manager.new(
            resolver: Overlay::InspectionResolver.new(
              catalog_provider: @catalog_provider,
              metadata_store_factory: @metadata_store_factory,
              logger: @logger
            ),
            locator: Overlay::EntityLocator.new(
              metadata_store_factory: @metadata_store_factory,
              model_provider: method(:active_model)
            ),
            model_provider: method(:active_model),
            preflight_tracker: mutation_coordinator.preflight_tracker,
            logger: @logger,
            on_state_change: ->(_payload) { push_manufacturing_state(@dialog) if @dialog&.visible? },
            on_viewport_selection: ->(entity) { handle_viewport_selection(entity) }
          )
        end

        def handle_manufacturing_inspection(dialog, payload_json)
          envelope = Host::CommandContract.parse_manufacturing_command!(payload_json)
          case envelope['command']
          when 'set_mode'
            apply_inspection_mode(envelope)
          when 'select_feature'
            manufacturing_overlay.select_feature(envelope['payload']['visualId'].to_s)
          when 'set_filter'
            manufacturing_overlay.set_filter(envelope['payload']['filter'].to_s)
          when 'refresh'
            manufacturing_overlay.refresh
          when 'navigate_to_source'
            navigate_inspection_source(envelope)
          end
          push_manufacturing_state(dialog)
        rescue Host::CommandContract::ContractError => e
          @logger.error('manufacturing_inspection_contract_rejected', error: e)
          push_manufacturing_state(dialog)
        rescue StandardError => e
          @logger.error('manufacturing_inspection_failed', error: e)
          push_manufacturing_state(dialog)
        end

        def push_manufacturing_state(dialog)
          overlay = @manufacturing_overlay
          return unless overlay && dialog&.visible?

          execute_bridge(dialog, 'onManufacturingState',
                         Host::CommandContract.manufacturing_state_envelope(
                           message_id: Host::CommandContract.next_outcome_message_id,
                           state: overlay.to_payload
                         ))
        rescue StandardError => e
          @logger.error('manufacturing_state_push_failed', error: e)
        end

        private

        def apply_inspection_mode(envelope)
          if envelope['payload']['mode'] == 'on'
            manufacturing_overlay.enable(envelope['semanticTarget'])
          else
            manufacturing_overlay.disable
          end
        end

        def navigate_inspection_source(envelope)
          overlay = manufacturing_overlay
          snapshot = overlay.snapshot
          feature = snapshot&.feature_by_visual_id(envelope['payload']['visualId'].to_s)
          return if feature.nil?

          navigation = Overlay::ProvenanceNavigation.new(
            locator: Overlay::EntityLocator.new(
              metadata_store_factory: @metadata_store_factory,
              model_provider: method(:active_model)
            ),
            model_provider: method(:active_model)
          ).navigate_to_source(feature, snapshot)
          @logger&.info('manufacturing_provenance_navigation',
                        source_kind: feature.source_kind, located: !navigation.nil?)
          navigation
        end

        # Viewport pick fell through to a model entity: resolve its semantic
        # context and run the normal selection flow (dialog update + overlay
        # re-scope) — identical to clicking it in the model.
        def handle_viewport_selection(entity)
          model = active_model
          return unless model

          context = @selection_observer.resolve(entity, selection: model.selection)
          handle_selection_change(context)
        end

        # Selection changed: re-scope the active overlay to the managed
        # part/furniture context, or clear it honestly for unmanaged
        # selections (#470 §44/#45).
        def rescope_overlay_from_selection(payload)
          overlay = @manufacturing_overlay
          return unless overlay&.mode_on?

          overlay.rescope(scope_of_selection(payload))
        end

        def scope_of_selection(payload)
          return {} unless payload.is_a?(Hash)

          scope = {}
          scope['furnitureInstanceId'] = payload['furnitureInstanceId'] if payload['furnitureInstanceId']
          scope['furnitureInstanceRef'] = payload['furnitureInstanceRef'] if payload['furnitureInstanceRef']
          scope['componentInstanceId'] = payload['componentInstanceId'] if payload['componentInstanceId']
          scope
        end

        def overlay_mutation_started(semantic_target)
          overlay = @manufacturing_overlay
          return unless overlay&.mode_on?

          overlay.mutation_started(semantic_target || {})
        end

        def overlay_mutation_outcome(outcome)
          overlay = @manufacturing_overlay
          return unless overlay&.mode_on?

          overlay.handle_mutation_outcome(outcome)
        end
      end

      # #466 / SU-UX-1 authoritative preflight review bridge: `Verificar
      # fabricación` runs the SAME #477 authoring resolve as the mutation and
      # inspection flows (never a local validation), projects the resolve's
      # preflight subset into a review (grouped issues, Spanish remediation)
      # and navigates each issue to its exact managed context in the
      # viewport. Commands arrive through the versioned preflight_command
      # channel; state leaves through preflight_state envelopes (entries +
      # review). Read-only: no coordinator, no SketchUp operation, no
      # metadata write. Orchestration lives in Host::PreflightReviewSession.
    end
  end
end
