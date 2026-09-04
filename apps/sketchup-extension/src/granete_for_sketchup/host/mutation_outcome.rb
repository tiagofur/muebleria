# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Terminal value of one orchestrated mutation (#498): stable outcome +
      # stable error category + structured issues + the resolve channel and
      # resulting degraded state. UI copy may be Spanish; behavior branches
      # on outcome/category — never on text.
      class MutationOutcome
        OUTCOMES = %w[committed rejected unavailable stale cancelled aborted].freeze
        RESOLVE_KINDS = %w[authoring_resolve native_layout generic_preview].freeze

        attr_reader :outcome, :category, :reason, :issues, :result, :resolve_kind,
                    :degraded, :semantic_target, :correlation, :fingerprint, :catalog_revision

        def initialize(outcome:, category: nil, reason: nil, issues: [], result: nil,
                       resolve_kind: nil, degraded: nil, semantic_target: {}, correlation: {},
                       fingerprint: nil, catalog_revision: nil)
          unless OUTCOMES.include?(outcome)
            raise ArgumentError, "unknown mutation outcome #{outcome.inspect}"
          end
          if category && !ErrorTaxonomy::CATEGORIES.include?(category)
            raise ArgumentError, "unknown error category #{category.inspect}"
          end
          if resolve_kind && !RESOLVE_KINDS.include?(resolve_kind)
            raise ArgumentError, "unknown resolve kind #{resolve_kind.inspect}"
          end

          @outcome = outcome
          @category = category
          @reason = reason
          @issues = issues
          @result = result
          @resolve_kind = resolve_kind
          @degraded = degraded
          @semantic_target = semantic_target
          @correlation = correlation
          @fingerprint = fingerprint
          @catalog_revision = catalog_revision
        end

        def committed?
          @outcome == 'committed'
        end

        # Versioned bridge envelope for the dialog mutation channel.
        def to_envelope(message_id: CommandContract.next_outcome_message_id, in_reply_to: nil)
          CommandContract.mutation_state_envelope(
            message_id: message_id,
            in_reply_to: in_reply_to,
            mutation: @mutation_name,
            outcome: @outcome,
            category: @category,
            reason: @reason,
            issues: @issues,
            result: @result,
            resolve_kind: @resolve_kind,
            degraded: @degraded,
            semantic_target: @semantic_target
          )
        end

        def with_mutation_name(name)
          @mutation_name = name.to_s
          self
        end
      end
    end
  end
end
