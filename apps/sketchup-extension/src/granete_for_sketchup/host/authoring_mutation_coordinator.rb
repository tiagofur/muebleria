# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      class DuplicateSubmitError < StandardError; end
      class SupersededResponseError < StandardError; end
      class NoPendingRequestError < StandardError; end
      class AtomicityViolationError < StandardError; end
      class CancelledError < StandardError; end

      # THE shared host mutation coordinator (#498 / SU-HOST-1). One
      # domain-neutral orchestrator executes every managed authoring
      # mutation (#466–#471 plug commands into it; they never clone it):
      #
      #   validate semantic target → editing_intent → allocate correlation →
      #   resolving → authoritative resolve (#477 contract) → reject
      #   malformed/stale/superseded/wrong-context → ONE SketchUp operation
      #   (OperationJournal) → apply accepted hierarchy → metadata written
      #   inside the operation by the builder → restore semantic selection →
      #   invalidate preflight → committed.
      #
      # Any failure aborts (or never starts the operation) and the previous
      # valid hierarchy/metadata survives. Current geometry is NEVER deleted
      # before an authoritative resolve succeeds. #execute never raises for
      # resolve/apply failures — it returns the terminal MutationOutcome.
      class AuthoringMutationCoordinator
        RESOLVE_ERROR_CLASSES = [
          Library::AuthoringResolveError,
          Library::LayoutResolutionError,
          Library::AuthoringResolveContract::ContractError,
          Transport::RequestError
        ].freeze

        attr_reader :interaction_state, :last_outcome, :pending_request_context, :preflight_tracker

        def initialize(model_provider:, logger:, selection_restorer: nil, preflight_tracker: nil)
          @model_provider = model_provider
          @logger = logger
          @selection_restorer = selection_restorer
          @preflight_tracker = preflight_tracker || PreflightTracker.new
          @interaction_state = InteractionState.new
          @pending = nil
          @last_outcome = nil
        end

        def state
          @interaction_state.state
        end

        def busy?
          @interaction_state.busy?
        end

        # Synchronous pipeline used by the dialog bridge. A second submit
        # while a mutation is in flight is soft-cancelled: no state change,
        # no host operation (double-click guard).
        def execute(command, command_message_id: nil)
          return duplicate_outcome(command) if busy?

          request_context = begin_resolve(command)
          result = resolve_phase(command, request_context)
          return result if result.is_a?(MutationOutcome)

          complete(command, request_context, result, command_message_id: command_message_id)
        end

        # Async pair (late-response proof + future #467/#468 flows): parks
        # the command at `resolving` with allocated correlation and returns
        # the request context. The response MUST come back through
        # #deliver_response, which validates it against the CURRENT pending
        # request — a response for an older command can never pass.
        def begin_resolve(command)
          raise DuplicateSubmitError, 'otra mutación está en curso' if busy?

          target = CommandContract.parse_semantic_target(command.semantic_target)
          @interaction_state.transition!('editing_intent')
          @interaction_state.transition!('resolving')
          identity = MessageIdentity.allocate
          context = {
            message_id: identity[:message_id],
            idempotency_key: identity[:idempotency_key],
            furniture: command.build_furniture_request,
            semantic_target: target
          }
          @pending = { command: command, context: context }
          @pending_request_context = context
          log_event('mutation_resolving', command, context)
          context
        end

        # Validates a resolve response envelope against the CURRENT pending
        # request. A late response (older inReplyToMessageId) raises
        # SupersededResponseError and can never reach the host; correlation
        # completeness/matching is enforced by the #477 contract parser.
        def deliver_response(envelope)
          pending = @pending
          raise NoPendingRequestError, 'no hay una mutación pendiente' unless pending

          if late_response?(envelope, pending[:context][:message_id])
            raise SupersededResponseError,
                  "respuesta tardía para #{envelope['inReplyToMessageId'].inspect} " \
                  "(pendiente: #{pending[:context][:message_id].inspect})"
          end

          Library::AuthoringResolveContract.parse!(
            envelope,
            expected_request: {
              'messageId' => pending[:context][:message_id],
              'idempotencyKey' => pending[:context][:idempotency_key]
            }
          )
        end

        # Applies an accepted result for the CURRENT pending command. A
        # complete() for a superseded command returns a stale outcome without
        # touching the newer command's state or the host.
        def complete(command, request_context, result, command_message_id: nil)
          unless pending_matches?(command, request_context)
            # A late completion for a superseded command returns a stale
            # outcome WITHOUT touching the newer command's pending request
            # or state machine.
            log_event('mutation_superseded_late_result', command, nil)
            return superseded_outcome(command)
          end
          unless command.context_still_valid?
            @interaction_state.transition!('stale')
            return finish_with(
              build_outcome(command, 'stale', category: 'stale_conflict',
                                              reason: 'el contexto semántico cambió durante el resolve',
                                              request_context: request_context)
            )
          end

          @interaction_state.transition!('applying_host_mutation')
          journal = OperationJournal.new(@model_provider.call)
          begin
            apply_result = command.apply_accepted_state(result, journal)
            verify_atomicity!(journal)
            restore_selection(command, result)
            invalidate_preflight(command, result, request_context)
            @interaction_state.transition!('committed')
            log_event('mutation_committed', command, request_context,
                      host_operations: journal.started_count, resolve_kind: resolve_kind_of(result))
            finish_with(
              build_outcome(command, 'committed', result: apply_result,
                                                  request_context: request_context, resolved: result)
            )
          rescue MutationCommand::ApplyRefused => e
            journal.abort_if_open!
            @interaction_state.transition!('aborted')
            log_event('mutation_refused', command, request_context, reason: e.message)
            finish_with(
              build_outcome(command, 'aborted', category: 'invalid_authoring_input', reason: e.message,
                                                request_context: request_context)
            )
          rescue StandardError => e
            journal.abort_if_open!
            @interaction_state.transition!('aborted')
            log_event('mutation_host_apply_failed', command, request_context, error: e.message)
            finish_with(
              build_outcome(command, 'aborted', category: 'host_apply_failure', reason: e.message,
                                                request_context: request_context)
            )
          end
        end

        private

        # Resolve stage: authoritative answer, or a terminal outcome when
        # the resolve was rejected/unavailable/stale/cancelled.
        def resolve_phase(command, request_context)
          result = command.resolve_intent(request_context)
          unless result.respond_to?(:accepted?) && result.accepted?
            raise Library::AuthoringResolveError, 'el resolve no devolvió un resultado aceptado'
          end

          result
        rescue CancelledError => e
          @interaction_state.transition!('cancelled')
          log_event('mutation_cancelled', command, request_context, reason: e.message)
          finish_with(build_outcome(command, 'cancelled', reason: e.message, request_context: request_context))
        rescue *RESOLVE_ERROR_CLASSES => e
          category = ErrorTaxonomy.category_for(e)
          outcome_name = case category
                         when 'network_unavailable', 'authentication', 'license_capability' then 'unavailable'
                         when 'stale_conflict' then 'stale'
                         else 'rejected'
                         end
          @interaction_state.transition!(outcome_name)
          log_event("mutation_#{outcome_name}", command, request_context,
                    category: category, error: e.message)
          finish_with(
            build_outcome(command, outcome_name, category: category, reason: e.message,
                                                  issues: issues_of(e), request_context: request_context)
          )
        end

        # ONE operation per accepted mutation, enforced by the journal; the
        # builder writes accepted metadata INSIDE that same operation, so a
        # failure can never leave new geometry + old metadata.
        def verify_atomicity!(journal)
          return if journal.started_count == 1 && journal.committed_count == 1

          raise AtomicityViolationError,
                'una mutación aceptada debe ser exactamente UNA operación SketchUp ' \
                "(starts=#{journal.started_count} commits=#{journal.committed_count})"
        end

        def restore_selection(command, result)
          restored = command.restore_selection(result)
          restored ||= if @selection_restorer.respond_to?(:restore)
                         @selection_restorer.restore(command.semantic_target)
                       elsif @selection_restorer.respond_to?(:call)
                         @selection_restorer.call(command.semantic_target)
                       end
          @logger&.debug('mutation_selection_restore_skipped') unless restored
        rescue StandardError => e
          @logger&.warn('mutation_selection_restore_failed', error: e)
        end

        # Post-commit state invalidation never fails the committed mutation;
        # worst case the tracker keeps the previous entry.
        def invalidate_preflight(command, result, request_context)
          return unless @preflight_tracker && command.manufacturing_affecting?

          if resolve_kind_of(result) == 'generic_preview'
            # A generic preview carries no manufacturing truth at all.
            @preflight_tracker.mark_unavailable!(command.target_key,
                                                 message_id: request_context[:message_id])
          else
            @preflight_tracker.invalidate!(command.target_key,
                                           fingerprint: fingerprint_of(result),
                                           catalog_revision: revision_of(result),
                                           message_id: request_context[:message_id])
          end
        rescue StandardError => e
          @logger&.warn('mutation_preflight_invalidation_failed', error: e)
        end

        def late_response?(envelope, current_message_id)
          envelope.is_a?(Hash) &&
            envelope['inReplyToMessageId'].is_a?(String) &&
            !envelope['inReplyToMessageId'].empty? &&
            envelope['inReplyToMessageId'] != current_message_id
        end

        def pending_matches?(command, request_context)
          @pending && @pending[:command].equal?(command) &&
            @pending[:context][:message_id] == request_context[:message_id]
        end

        def duplicate_outcome(command)
          log_event('mutation_duplicate_submit', command, nil)
          MutationOutcome.new(outcome: 'cancelled', reason: 'duplicate_submit',
                              semantic_target: command.semantic_target)
                         .with_mutation_name(command.name)
        end

        def superseded_outcome(command)
          log_event('mutation_superseded_late_result', command, nil)
          MutationOutcome.new(outcome: 'stale', category: 'stale_conflict',
                              reason: 'superseded_by_newer_command',
                              semantic_target: command.semantic_target).with_mutation_name(command.name)
        end

        def build_outcome(command, name, category: nil, reason: nil, issues: [], result: nil,
                          request_context: {}, resolved: nil)
          MutationOutcome.new(
            outcome: name, category: category, reason: reason, issues: issues, result: result,
            resolve_kind: resolve_kind_of(resolved),
            degraded: DegradedState.for_mutation(name, category: category,
                                                   resolve_kind: resolve_kind_of(resolved)),
            semantic_target: command.semantic_target,
            correlation: {
              'messageId' => request_context[:message_id],
              'idempotencyKey' => request_context[:idempotency_key]
            }.compact,
            fingerprint: fingerprint_of(resolved),
            catalog_revision: revision_of(resolved)
          ).with_mutation_name(command.name)
        end

        def finish_with(outcome_value)
          record(outcome_value)
          outcome_value
        end

        # Clears the pending request and returns the machine to idle from a
        # terminal outcome state. The outcome stays available as
        # last_outcome for the dialog push.
        def record(outcome_value)
          @last_outcome = outcome_value
          @pending = nil
          @pending_request_context = nil
          @interaction_state.finish!
          outcome_value
        end

        def issues_of(error)
          error.respond_to?(:issues) ? error.issues.to_a : []
        end

        def resolve_kind_of(result)
          result.respond_to?(:resolve_kind) ? result.resolve_kind : 'authoring_resolve'
        end

        def fingerprint_of(result)
          result.respond_to?(:manufacturing_fingerprint) ? result.manufacturing_fingerprint : nil
        end

        def revision_of(result)
          result.respond_to?(:catalog_revision) ? result.catalog_revision : nil
        end

        def log_event(event, command, request_context, extra = {})
          @logger&.info(event, {
                          mutation: command.name,
                          correlation_id: request_context && request_context[:message_id],
                          semantic_target: command.semantic_target,
                          state: @interaction_state.state
                        }.merge(extra))
        end
      end
    end
  end
end
