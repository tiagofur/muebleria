# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Authoring-command plugin contract (#498 / task §33): feature commands
      # (#467 shelves, #468 hardware) plug into the shared coordinator by
      # providing exactly these seams — the coordinator stays domain-neutral
      # and never learns what a hinge or a shelf is.
      #
      #   name                    -> String (mutation type, logging/envelope)
      #   semantic_target         -> Hash (CommandContract target shape)
      #   build_furniture_request -> Hash|nil (#477 furniture section; nil =
      #                                this command resolves another way)
      #   resolve_intent(ctx)     -> accepted-result object (raises on failure)
      #   context_still_valid?    -> bool (exact semantic context unchanged)
      #   apply_accepted_state(result, journal) -> Hash (ONE operation through
      #                                the journal; MUST raise on failure)
      #   restore_selection(result) -> entity|nil (view state, optional)
      #   manufacturing_affecting? -> bool
      class MutationCommand
        class ApplyRefused < StandardError; end
        class ApplyFailed < StandardError; end

        def initialize(name:, semantic_target:, resolve:, apply:, context_valid:,
                       build_furniture_request: nil, restore_selection: nil,
                       manufacturing_affecting: true)
          @name = name.to_s
          @semantic_target = semantic_target
          @build_furniture_request = build_furniture_request
          @resolve = resolve
          @apply = apply
          @context_valid = context_valid
          @restore_selection = restore_selection
          @manufacturing_affecting = manufacturing_affecting
        end

        attr_reader :name, :semantic_target, :build_furniture_request

        def resolve_intent(request_context)
          @resolve.call(request_context)
        end

        def context_still_valid?
          @context_valid.call
        end

        def manufacturing_affecting?
          @manufacturing_affecting
        end

        def apply_accepted_state(result, journal)
          @apply.call(result, journal)
        end

        def restore_selection(result)
          return nil unless @restore_selection

          @restore_selection.call(result)
        end

        def target_key
          CommandContract.semantic_target_key(@semantic_target)
        end
      end

      # Accepted-result adapter for the authoritative GET-layout resolve
      # channel (the production update path before #467/#468 capture full
      # #477 snapshots): Granete still resolves the composition server-side,
      # so this is authoritative resolve — not a local guess — but it carries
      # no machining fingerprint, and its degraded semantics reflect that.
      class LayoutResolveResult
        attr_reader :layout, :correlation, :resolve_kind

        def initialize(layout:, message_id:, idempotency_key:, resolve_kind: 'native_layout')
          @layout = layout
          @resolve_kind = resolve_kind
          @correlation = {
            'responseMessageId' => "resolve-#{message_id}",
            'inReplyToMessageId' => message_id,
            'idempotencyKey' => idempotency_key
          }
        end

        def accepted?
          true
        end

        def issues
          []
        end

        def manufacturing_fingerprint
          nil
        end

        def catalog_revision
          nil
        end

        def normalized_snapshot
          nil
        end
      end
    end
  end
end
