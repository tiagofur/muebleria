# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/host/command_contract'
require_relative '../../src/granete_for_sketchup/host/preflight_tracker'
require_relative '../../src/granete_for_sketchup/host/publication_preflight_gate'
require_relative '../../src/granete_for_sketchup/host/design_preflight_batch'

# #731 PR2 — design-wide batch validation unit contract:
# * one authoritative session.run per publication-scope furniture;
# * blocked/unavailable units are RESULTS, never aborts;
# * the WHOLE scope is revalidated every run (no local freshness proof);
# * a context switch aborts and discards;
# * superseded generations never reach the callbacks;
# * single-flight: a busy batch refuses to start again.
class DesignPreflightBatchTest < Minitest::Test
  Host = Granete::SketchUpExtension::Host

  FI_A = '51000000-0000-0000-0000-0000000000a1'
  FI_B = '51000000-0000-0000-0000-0000000000b2'
  FI_C = '51000000-0000-0000-0000-0000000000c3'

  class NullLogger
    def info(*); end
    def warn(*); end
    def error(*); end
  end

  # Session double: runs the authoritative seam and records honest tracker
  # entries, with per-furniture configurable statuses and raisers.
  class FakeSession
    attr_reader :runs, :tracker

    def initialize(statuses = {}, raisers = {})
      @tracker = Host::PreflightTracker.new
      @statuses = statuses
      @raisers = raisers
      @runs = []
    end

    def run(scope, message_id:)
      id = scope['furnitureInstanceId']
      @runs << { id: id, message_id: message_id }
      raise @raisers[id] if @raisers.key?(id)

      status = @statuses.fetch(id, 'ready')
      if status == 'unavailable'
        @tracker.mark_unavailable!(Host::CommandContract.semantic_target_key(scope),
                                   message_id: message_id)
      else
        @tracker.record_furniture!(scope, status,
                                   fingerprint: "sha256-#{id}",
                                   message_id: message_id)
      end
      nil
    end
  end

  def setup
    @model = Object.new
    @binding = Struct.new(:project_id, :design_id, :base_revision_id).new('p1', 'd1', 'r1')
    @current_model = @model
    @current_binding = @binding
    @scope = [
      { 'furnitureInstanceId' => FI_A },
      { 'furnitureInstanceId' => FI_B },
      { 'furnitureInstanceId' => FI_C }
    ]
    @progress = []
    @completions = []
  end

  def test_validates_every_scope_unit_and_completes_with_states
    session = FakeSession.new
    batch = build_batch(session)

    outcome = batch.start

    assert outcome['started']
    assert_equal 3, session.runs.length, 'one authoritative run per scope furniture'
    assert(session.runs.all? { |run| run[:message_id].start_with?('batch-') })
    result = @completions.last
    assert result['ok']
    assert_equal 'completed', result['code']
    assert_equal 3, result['total']
    assert_equal 3, result['validated']
    assert_equal({ FI_A => 'ready', FI_B => 'ready', FI_C => 'ready' }, result['states'])
    assert_equal 3, @progress.length
    assert_equal 3, @progress.last['done']
    refute batch.busy?
  end

  def test_blocked_unit_is_a_result_and_the_batch_continues
    session = FakeSession.new(FI_A => 'ready', FI_B => 'blocked', FI_C => 'warning')
    batch = build_batch(session)

    batch.start

    result = @completions.last
    assert result['ok'], 'manufacturing rejections never abort the batch'
    assert_equal 'blocked', result['states'][FI_B]
    assert_equal 'warning', result['states'][FI_C]
  end

  # Freshness is NOT locally provable (#731): even fully ready tracker
  # entries must not skip a unit on the next run. Guards against a future
  # unsafe "validate only the pending ones" optimization.
  def test_revalidates_the_whole_scope_even_when_entries_are_already_ready
    session = FakeSession.new
    batch = build_batch(session)

    batch.start
    assert_equal 3, session.runs.length

    batch.start
    assert_equal 6, session.runs.length, 'a second run must revalidate every scope furniture'
  end

  def test_context_switch_aborts_without_resolving_the_rest
    session = FakeSession.new
    queue = []
    batch = build_batch(session, scheduler: ->(&block) { queue << block })

    batch.start
    assert_equal 1, queue.length
    queue.shift.call # FIA resolved under model A
    assert_equal 1, session.runs.length

    @current_model = Object.new # user switched to model B
    queue.shift.call

    result = @completions.last
    assert_equal 'context_changed', result['code']
    assert_equal 1, session.runs.length, 'no further resolves for the abandoned design'
    refute result['ok']
    refute batch.busy?
  end

  def test_superseded_run_late_ticks_are_discarded
    session = FakeSession.new
    queue = []
    batch = build_batch(session, scheduler: ->(&block) { queue << block })

    batch.start
    queue.shift.call # one unit resolved; the next tick stays queued
    assert_equal 1, session.runs.length
    stale_ticks = queue.dup
    batch.cancel!

    stale_ticks.each(&:call)

    assert_empty @completions, 'a cancelled generation must never complete'
    assert_equal 1, session.runs.length, 'only the tick that ran before the cancel executed'

    batch.start
    queue.shift.call until queue.empty?
    assert_equal 4, session.runs.length, 'a fresh run starts over the full scope'
    assert @completions.last['ok']
  end

  def test_unexpected_unit_error_maps_to_unavailable_and_continues
    session = FakeSession.new({}, FI_B => RuntimeError.new('boom'))
    batch = build_batch(session)

    batch.start

    result = @completions.last
    assert result['ok'], 'an unexpected per-unit failure is honest data, not an abort'
    assert_equal 'unavailable', result['states'][FI_B]
    assert_equal 'boom', result['reasons'][FI_B]
    assert_equal 3, session.runs.length
  end

  def test_start_is_single_flight_while_busy
    session = FakeSession.new
    queue = []
    batch = build_batch(session, scheduler: ->(&block) { queue << block })

    first = batch.start
    second = batch.start

    assert first['started']
    refute second['started']
    assert_equal 'busy', second['code']
    assert_equal 1, queue.length, 'the busy refusal schedules nothing'
  end

  def test_unbound_and_unavailable_scope_fail_closed
    session = FakeSession.new
    unbound = build_batch(session, model_provider: -> {})
    assert_equal 'unbound', unbound.start['code']

    no_scope = build_batch(session, scope_provider: -> {})
    assert_equal 'scope_unavailable', no_scope.start['code']
    assert_empty session.runs
  end

  private

  def build_batch(session, scope_provider: nil, model_provider: nil, scheduler: nil)
    Host::DesignPreflightBatch.new(
      scope_provider: scope_provider || -> { @scope },
      preflight_session: session,
      model_provider: model_provider || -> { @current_model },
      binding_provider: ->(_model) { @current_binding },
      scheduler: scheduler || ->(&block) { block.call },
      on_progress: ->(payload) { @progress << payload },
      on_complete: ->(result) { @completions << result },
      logger: NullLogger.new
    )
  end
end
