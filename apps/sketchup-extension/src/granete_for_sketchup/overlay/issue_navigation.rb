# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # Viewport problem navigation (#466 / SU-UX-1): from a review issue to
      # its exact managed context in the model. Location is by Granete
      # semantic identity through namespaced metadata (EntityLocator) —
      # never by SketchUp name, GUID, persistent_id or geometry. The most
      # specific candidate wins; when the exact child was regenerated and
      # its locator is stale, navigation falls back to the owning furniture
      # instead of failing.
      #
      # View state only, like ProvenanceNavigation (#470): selection + camera
      # framing. No SketchUp operation, no entity change, no metadata write —
      # navigation can never mutate authoring/manufacturing state.
      class IssueNavigation
        TARGET_PREFERENCES = %w[primary hardware part furniture].freeze

        def initialize(locator:, model_provider:, logger: nil)
          @locator = locator
          @model_provider = model_provider
          @logger = logger
        end

        # Navigates to an issue's context by review issueId. `preference`
        # picks among the review's candidates: 'primary' (most specific),
        # 'hardware', 'part' or 'furniture'. Returns a result hash
        # { kind, id, fallback } or nil when nothing honest can be located.
        def navigate(review, issue_id, preference = 'primary')
          root = @locator.locate_furniture(review.scope)
          return nil unless root

          candidate = candidate_for(review, issue_id, preference)
          if candidate
            entity = @locator.locate_child(root, candidate['id'])
            if entity
              frame(entity)
              return { 'kind' => candidate['kind'], 'id' => candidate['id'], 'fallback' => false }
            end
          end

          # Fallback (#466): the exact child may have been regenerated and
          # its host locator is stale; the owning furniture still frames the
          # problem honestly.
          frame(root)
          { 'kind' => 'furniture', 'id' => nil, 'fallback' => true }
        end

        private

        def candidate_for(review, issue_id, preference)
          candidates = review.candidates_by_issue_id(issue_id)
          return nil if candidates.empty?

          case preference
          when 'hardware' then candidates.find { |candidate| candidate['kind'] == 'hardware' }
          when 'part' then candidates.find { |candidate| candidate['kind'] == 'part' }
          when 'furniture' then nil
          else candidates.first
          end
        end

        # Selecting + zooming is viewport state: no operation frame, no
        # model mutation — the selection observer then publishes the
        # semantic context (#468 hardware editor opens from selection).
        def frame(entity)
          model = @model_provider.call
          return unless model.respond_to?(:selection)

          model.selection.clear
          model.selection.add(entity)
          view = model.active_view if model.respond_to?(:active_view)
          return unless view

          if view.respond_to?(:zoom)
            view.zoom(entity)
          elsif view.respond_to?(:invalidate)
            view.invalidate
          end
        rescue StandardError => e
          # A dead entity reference must never break review navigation; the
          # caller's fallback keeps the flow honest.
          @logger&.warn('preflight_issue_navigation_failed', error: e.message)
          nil
        end
      end
    end
  end
end
