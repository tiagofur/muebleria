# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Orchestrates #466 preflight review sessions for the dialog: runs the
      # authoritative resolve (the SAME InspectionResolver seam as #470 — no
      # parallel transport), records the outcome in the shared PreflightTracker
      # and navigates issues to their exact managed context. Read-only: no
      # coordinator, no SketchUp operation, no metadata write.
      class PreflightReviewSession
        def initialize(tracker:, resolver:, locator:, model_provider:, logger: nil)
          @tracker = tracker
          @resolver = resolver
          @locator = locator
          @model_provider = model_provider
          @logger = logger
          @reviews = {}
        end

        attr_reader :reviews

        # Runs the authoritative preflight for a furniture-scoped semantic
        # target and returns the stored review. A missing furniture, a
        # rejected authoring intent and an unreachable server map to honest
        # blocked/unavailable reviews — never to a guessed ready.
        def run(scope, message_id:)
          key = CommandContract.semantic_target_key(scope)
          furniture = @locator.locate_furniture(scope)
          if furniture.nil?
            @tracker.mark_unavailable!(key, message_id: message_id)
            return store(key, PreflightReview.unavailable(
                                scope: scope, reason: 'El mueble ya no está en el modelo'
                              ))
          end

          review = build_review(furniture, scope, message_id)
          store(key, review).tap do |stored|
            @logger&.info('preflight_review_run', status: stored.status,
                                                  issue_count: stored.issue_count, key: key)
          end
        rescue Library::AuthoringResolveError => e
          store(key, review_from_rejection(e, scope, message_id))
        end

        # Navigates a review issue to its exact managed context; returns the
        # navigation result hash (or nil when nothing honest can be located).
        def navigate(scope, issue_id:, target: 'primary')
          review = @reviews[CommandContract.semantic_target_key(scope)]
          return nil unless review&.issue_by_id(issue_id.to_s)

          preference = Overlay::IssueNavigation::TARGET_PREFERENCES.include?(target) ? target : 'primary'
          navigation = Overlay::IssueNavigation.new(
            locator: @locator, model_provider: @model_provider, logger: @logger
          ).navigate(review, issue_id.to_s, preference)
          review.record_navigation(issue_id.to_s, navigation)
          @logger&.info('preflight_review_navigation', issue_id: issue_id,
                                                       kind: navigation && navigation['kind'],
                                                       fallback: navigation && navigation['fallback'])
          navigation
        end

        # Review payload with its honest effective status: a tracker
        # stale/unavailable state always wins over a recorded ready.
        def payload_for(scope_or_key)
          key = if scope_or_key.is_a?(Hash)
                  CommandContract.semantic_target_key(
                    CommandContract.furniture_scope(scope_or_key)
                  )
                else
                  scope_or_key
                end
          review = @reviews[key]
          return nil unless review

          state = @tracker.state_for(review.target_key)
          effective = %w[stale unavailable].include?(state) ? state : nil
          review.to_payload(effective_status: effective)
        end

        private

        def build_review(furniture, scope, _message_id)
          resolved = @resolver.resolve(furniture_entity: furniture, model: @model_provider.call)
          result = resolved[:result]
          # record_furniture! (not the raw-key record!) so a fresh
          # authoritative result supersedes the sibling alias entries of
          # the SAME unit — the #466 design-wide publish gate reads the
          # tracker per furniture and must never see a fresh ready
          # contradicted by an older stale alias.
          @tracker.record_furniture!(scope,
                                     PreflightReview.review_status_from(result),
                                     fingerprint: result.manufacturing_fingerprint,
                                     catalog_revision: result.catalog_revision,
                                     message_id: resolved[:message_id])
          PreflightReview.from_accepted_result(
            result: result, scope: scope, message_id: resolved[:message_id]
          )
        end

        def review_from_rejection(error, scope, message_id)
          key = CommandContract.semantic_target_key(scope)
          if error.issues && !error.issues.empty?
            # A rejected authoring intent is an authoritative NOT-ready: its
            # structured issues are reviewable like any other.
            @tracker.record_furniture!(scope, 'blocked', message_id: message_id)
            PreflightReview.from_rejection(issues: error.issues, scope: scope,
                                           message_id: message_id, reason: error.message)
          else
            @tracker.mark_unavailable!(key, message_id: message_id)
            PreflightReview.unavailable(scope: scope, reason: error.message)
          end
        end

        def store(key, review)
          @reviews[key] = review
          review
        end
      end
    end
  end
end
