# frozen_string_literal: true

# Revisión de preflight (#466): batch + gate de publicación.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module PreflightReviewBridge
        def handle_preflight_review(dialog, payload_json)
          envelope = Host::CommandContract.parse_preflight_command!(payload_json)
          case envelope['command']
          when 'run'
            preflight_review_session.run(review_scope(envelope), message_id: envelope['messageId'])
          when 'navigate_issue'
            preflight_review_session.navigate(review_scope(envelope),
                                              issue_id: envelope['payload']['issueId'],
                                              target: envelope['payload']['target'])
          end
          push_preflight_state(dialog, review_scope(envelope))
        rescue Host::CommandContract::ContractError => e
          @logger.error('preflight_review_contract_rejected', error: e)
          push_preflight_state(dialog)
        rescue StandardError => e
          @logger.error('preflight_review_failed', error: e)
          push_preflight_state(dialog)
        end

        # Pushes tracker entries plus the review of the scope (or the most
        # recent one) with its honest effective status, and the design-wide
        # publication gate projection (#466) composed Ruby-side — JS never
        # rebuilds the #392 publication scope.
        def push_preflight_state(dialog, scope_or_key = nil)
          return unless dialog&.visible?

          session = preflight_review_session
          payload = scope_or_key && session.payload_for(scope_or_key)
          payload ||= session.reviews.values.last&.then do |review|
            session.payload_for(review.target_key)
          end
          execute_bridge(dialog, 'onPreflightState',
                         Host::CommandContract.preflight_state_envelope(
                           mutation_coordinator.preflight_tracker.payload,
                           review: payload,
                           publication_gate: publication_gate_projection
                         ))
        rescue StandardError => e
          @logger.error('preflight_state_push_failed', error: e)
        end

        private

        # Design-wide publish gate projection (#466). nil when no gate is
        # wired or its evaluation fails — the dialog then stays fail-closed.
        def publication_gate_projection
          return nil unless @publication_gate

          @publication_gate.projection
        rescue StandardError => e
          @logger.error('publication_gate_projection_failed', error: e)
          nil
        end

        # Lazy shared session: same resolver/locator seams as #470, one
        # tracker, one review store per dialog controller.
        def preflight_review_session
          @preflight_review_session ||= Host::PreflightReviewSession.new(
            tracker: mutation_coordinator.preflight_tracker,
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
            logger: @logger
          ).tap do |session|
            if @position_sync_coordinator.respond_to?(:preflight_session=)
              @position_sync_coordinator.preflight_session = session
            end
          end
        end

        def review_scope(envelope)
          Host::CommandContract.furniture_scope(envelope['semanticTarget'])
        end
      end

      # Migration review wiring (#416): bridges the scanner/migrator with
      # the review HtmlDialog. Included by DialogController so the migration
      # flow reuses the same catalog provider, metadata store factory and
      # furniture builder as insertion/edition — never a parallel resolution
      # path.
    end
  end
end
