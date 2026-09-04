# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      class InvalidTransitionError < StandardError; end

      # Explicit interaction state machine (#498 / authoring interaction
      # contract §2 / integration excellence §8.3). Ten ambiguous booleans
      # (isLoading, isEditing, hasError…) are forbidden: every phase change is
      # a validated transition and impossible transitions fail loudly instead
      # of silently corrupting the mutation flow.
      #
      # Canonical flow:
      #   idle → editing_intent → resolving → applying_host_mutation → committed → idle
      # Failure branches:
      #   resolving → rejected | unavailable | stale | cancelled
      #   applying_host_mutation → aborted (host exception aborts the operation)
      class InteractionState
        STATES = %w[idle selecting editing_intent resolving applying_host_mutation
                    committed rejected cancelled aborted unavailable stale].freeze

        TRANSITIONS = {
          'idle' => %w[selecting editing_intent],
          'selecting' => %w[idle editing_intent],
          'editing_intent' => %w[resolving cancelled],
          'resolving' => %w[applying_host_mutation rejected unavailable stale cancelled],
          'applying_host_mutation' => %w[committed aborted],
          'committed' => %w[idle],
          'rejected' => %w[idle],
          'cancelled' => %w[idle],
          'aborted' => %w[idle],
          'unavailable' => %w[idle],
          'stale' => %w[idle]
        }.freeze

        BUSY_STATES = %w[editing_intent resolving applying_host_mutation].freeze
        OUTCOME_STATES = %w[committed rejected cancelled aborted unavailable stale].freeze

        attr_reader :state

        def initialize(state = 'idle')
          raise ArgumentError, "unknown state #{state.inspect}" unless STATES.include?(state)

          @state = state
        end

        def can_transition?(next_state)
          TRANSITIONS.fetch(@state).include?(next_state)
        end

        def transition!(next_state)
          unless can_transition?(next_state)
            raise InvalidTransitionError, "illegal interaction transition #{@state} → #{next_state}"
          end

          @state = next_state
          self
        end

        # Returns the machine to idle after a terminal outcome so the runtime
        # is ready for the next command. Busy states must resolve through
        # their own failure branches first — finishing from busy fails
        # loudly instead of silently discarding in-flight state.
        def finish!
          return self if @state == 'idle'

          transition!('idle')
        end

        def busy?
          BUSY_STATES.include?(@state)
        end

        def outcome?
          OUTCOME_STATES.include?(@state)
        end

        def ==(other)
          other.is_a?(InteractionState) && state == other.state
        end
      end
    end
  end
end
