# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Design-wide batch validation (#731 PR2 / closes the #466 loop).
      #
      # For EVERY managed FurnitureInstance of the canonical publication
      # scope — the same ManifestBuilder inventory the design publish will
      # manifest, injected through scope_provider — this orchestrator runs
      # the SAME authoritative PreflightReviewSession#run the unit
      # `Verificar fabricación` uses (locate → InspectionResolver resolve →
      # PreflightReview → PreflightTracker.record_furniture!). It owns no
      # manufacturing truth, derives no scope and touches no transport.
      #
      # Freshness policy (#731): the tracker's fingerprint is computed
      # server-side and cannot be recomputed locally, so the batch
      # revalidates the WHOLE scope on every run — ready/warning entries
      # included. Correctness over request savings.
      #
      # Execution model: strictly sequential, ONE unit per scheduler tick
      # (the injected scheduler defers to the host event loop), so the
      # dialog stays responsive and the context is revalidated between
      # units. A context switch (model or exact binding changed) ABORTS the
      # run; a blocked/unavailable unit is a RESULT and never aborts — the
      # publication gate decides at the end.
      #
      # Superseded runs: each run carries a generation token; cancel! (or a
      # newer start) invalidates every late callback of the previous one.
      class DesignPreflightBatch
        COMPLETED = 'completed'
        CONTEXT_CHANGED = 'context_changed'
        SCOPE_UNAVAILABLE = 'scope_unavailable'
        UNBOUND = 'unbound'
        CANCELLED = 'cancelled'

        def initialize(scope_provider:, preflight_session:, model_provider:,
                       binding_provider:, scheduler:, on_progress: nil,
                       on_complete: nil, logger: SafeLogger.new)
          @scope_provider = scope_provider
          @preflight_session = preflight_session
          @model_provider = model_provider
          @binding_provider = binding_provider
          @scheduler = scheduler
          @on_progress = on_progress
          @on_complete = on_complete
          @logger = logger
          @run = nil
          @generation = 0
        end

        def busy?
          !@run.nil?
        end

        # Generation the NEXT start will run under. Callers that must wire
        # completion guards before start (synchronous schedulers run the
        # whole batch inside #start) read this first.
        def next_generation
          @generation + 1
        end

        # Starts a batch over the current canonical publication scope.
        # Returns the start outcome hash (never raises): 'started' is true
        # only when a run actually began; every other case is an honest
        # fail-closed reason the caller can surface.
        def start
          return start_outcome(false, 'busy') if busy?

          model = @model_provider.call
          binding = model ? @binding_provider.call(model) : nil
          return start_outcome(false, UNBOUND) unless model && binding

          scope = publication_scope
          return start_outcome(false, SCOPE_UNAVAILABLE) unless scope.is_a?(Array)

          @generation += 1
          @run = {
            'generation' => @generation,
            'model' => model,
            'binding' => binding,
            'pending' => scope.map { |item| item['furnitureInstanceId'] }.compact,
            'states' => {},
            'reasons' => {},
            'done' => 0
          }
          schedule_next_tick
          start_outcome(true, COMPLETED)
        end

        # Invalidates the in-flight run: its late progress/completion
        # callbacks are discarded by the generation guard.
        def cancel!
          @run = nil
        end

        private

        def start_outcome(started, code)
          { 'started' => started, 'code' => code, 'generation' => @generation }
        end

        def publication_scope
          @scope_provider.call
        rescue StandardError => e
          @logger.error('design_preflight_batch_scope_failed', error: e)
          nil
        end

        def schedule_next_tick
          run = @run
          return unless run

          @scheduler.call do
            process_tick(run['generation'])
          end
        end

        # One unit per tick: context → resolve → progress → next/complete.
        def process_tick(generation)
          run = @run
          return unless run && run['generation'] == generation

          unless context_current?(run)
            finish(run, CONTEXT_CHANGED)
            return
          end

          furniture_instance_id = run['pending'].shift
          if furniture_instance_id.nil?
            finish(run, COMPLETED)
            return
          end

          run_unit(run, furniture_instance_id)
          run['done'] += 1
          emit_progress(run)
          schedule_next_tick
        end

        def run_unit(run, furniture_instance_id)
          scope = CommandContract.furniture_scope('furnitureInstanceId' => furniture_instance_id)
          message_id = "batch-#{run['generation']}-#{run['done']}-#{furniture_instance_id[0, 8]}"
          @preflight_session.run(scope, message_id: message_id)
          run['states'][furniture_instance_id] = state_for(furniture_instance_id)
        rescue StandardError => e
          # An unexpected per-unit failure is an honest unavailable result:
          # the batch continues and the gate fails closed on it.
          @logger.error('design_preflight_batch_unit_failed',
                        error: e, furniture_instance_id: furniture_instance_id)
          run['states'][furniture_instance_id] = 'unavailable'
          run['reasons'][furniture_instance_id] = e.message
        end

        # Effective furniture state with the SAME priority the publication
        # gate applies across the tracker's alias entries.
        def state_for(furniture_instance_id)
          states = preflight_session_tracker_states(furniture_instance_id)
          PublicationPreflightGate::STATE_PRIORITY.find { |state| states.include?(state) } ||
            PublicationPreflightGate::UNVERIFIED
        end

        def finish(run, code)
          @run = nil
          result = {
            'ok' => code == COMPLETED,
            'code' => code,
            'generation' => run['generation'],
            'total' => run['done'] + run['pending'].length,
            'validated' => run['done'],
            'states' => run['states'],
            'reasons' => run['reasons']
          }
          emit_completion(run, result)
        end

        def emit_progress(run)
          return unless @on_progress

          total = run['done'] + run['pending'].length
          @on_progress.call('generation' => run['generation'], 'done' => run['done'], 'total' => total)
        end

        def emit_completion(_run, result)
          return unless @on_complete

          @on_complete.call(result)
        end

        # Exact context guard (PR1 semantics): same model object AND the
        # same exact binding (project, design, base revision).
        def context_current?(run)
          return false unless @model_provider.call.equal?(run['model'])

          current = @binding_provider.call(run['model'])
          binding_payload(current) == binding_payload(run['binding'])
        end

        def binding_payload(binding)
          return nil unless binding.respond_to?(:to_h)

          binding.to_h
        end

        # Delegates to the shared tracker through the session seam so the
        # gate's alias-priority logic reads one truth.
        def preflight_session_tracker_states(furniture_instance_id)
          tracker = @preflight_session.respond_to?(:tracker) ? @preflight_session.tracker : nil
          return [] unless tracker.respond_to?(:furniture_entries_for)

          tracker.furniture_entries_for(furniture_instance_id).map(&:state).uniq
        end
      end
    end
  end
end
