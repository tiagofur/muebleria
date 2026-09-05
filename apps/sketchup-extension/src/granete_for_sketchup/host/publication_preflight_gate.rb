# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Design-wide publication gate (#466 final closure).
      #
      # #392 publishes a COMPLETE DesignRevision, so the universe this gate
      # evaluates is exactly the managed FurnitureInstance set the
      # publisher will put in the manifest — obtained from the SAME
      # authority (Connection::DesignPublish::ManifestBuilder), never from
      # the PreflightTracker, the current selection, names, display names
      # or geometry. No second membership source exists here.
      #
      # The gate NEVER computes manufacturing readiness: every furniture
      # state arrives from the PreflightTracker's authoritative entries
      # (backend resolve outcomes and their invalidations). It only answers
      # "does EVERY FurnitureInstance #392 will publish have a current
      # authoritative ready/warning result?". Fail-closed: when the
      # publication scope cannot be established (no model, no binding,
      # read failure) the answer is blocked — never a guessed scope.
      class PublicationPreflightGate
        # Priority among the states one furniture may carry across its
        # alias entries: an authoritative `blocked` verdict and any
        # stale/unavailable invalidation always win over an older
        # ready/warning; a fresh authoritative record supersedes the
        # sibling alias markers of the same unit (PreflightTracker
        # .record_furniture!), so re-verification unblocks coherently.
        STATE_PRIORITY = %w[blocked stale unavailable ready warning].freeze
        UNVERIFIED = 'unverified'

        # scope_provider: callable returning the canonical #392 manifest
        # items (each carrying furnitureInstanceId) or nil when the scope
        # cannot be established.
        def initialize(scope_provider:, tracker:, logger: nil)
          @scope_provider = scope_provider
          @tracker = tracker
          @logger = logger
        end

        def allowed?
          projection['allowed'] == true
        end

        # Dialog/enforcement projection. Every count's denominator is the
        # canonical publication scope — never the tracker entries, so
        # unverified furniture blocks and unrelated entries are invisible.
        def projection
          items = publication_scope
          return scope_unavailable_projection unless items.is_a?(Array)

          states = items.map { |item| state_for_furniture(item['furnitureInstanceId']) }
          counts = states.tally
          verified = counts.fetch('ready', 0) + counts.fetch('warning', 0)
          {
            'scopeAvailable' => true,
            'allowed' => states.all? { |state| %w[ready warning].include?(state) },
            'total' => items.length,
            'verified' => verified,
            'pending' => items.length - verified,
            'blocked' => counts['blocked'],
            'stale' => counts['stale'],
            'unavailable' => counts['unavailable'],
            'unverified' => counts[UNVERIFIED]
          }
        end

        # Effective furniture-level state from the tracker's
        # furniture-scoped alias entries (id and ref namespaces address the
        # same physical unit). A furniture without any entry was never
        # verified: `unverified`, never a guessed ready.
        def state_for_furniture(furniture_instance_id)
          states = @tracker.furniture_entries_for(furniture_instance_id).map(&:state).uniq
          STATE_PRIORITY.find { |state| states.include?(state) } || UNVERIFIED
        end

        private

        def publication_scope
          @scope_provider.call
        rescue StandardError => e
          @logger&.error('publication_preflight_scope_failed', error: e)
          nil
        end

        def scope_unavailable_projection
          {
            'scopeAvailable' => false,
            'allowed' => false,
            'total' => 0,
            'verified' => 0,
            'pending' => 0,
            'blocked' => 0,
            'stale' => 0,
            'unavailable' => 0,
            'unverified' => 0
          }
        end
      end
    end
  end
end
