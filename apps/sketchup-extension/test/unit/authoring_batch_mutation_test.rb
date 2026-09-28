# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../support/host_runtime'
require_relative '../support/mutation_orchestration_fixture'

# #471 R2: ONE user batch command = N authoritative resolves BEFORE any
# host mutation, then ONE journal operation applying every accepted
# rebuild. All-or-nothing with a single coherent undo: resolve failure
# touches nothing, a stale member blocks the batch, an apply failure
# aborts the one operation, and the UI-facing outcome is ONE value that
# can never report N applied when fewer succeeded.
class AuthoringBatchMutationTest < Minitest::Test
  HOST = Granete::SketchUpExtension::Host
  FIXTURE = MutationOrchestrationFixture

  attr_reader :model, :coordinator, :restored_targets

  def setup
    @model = FIXTURE::FakeHostModel.new(FIXTURE::H1, FIXTURE::M1)
    @restored_targets = []
    @preflight_tracker = HOST::PreflightTracker.new
    @coordinator = HOST::AuthoringMutationCoordinator.new(
      model_provider: -> { @model },
      logger: Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new),
      selection_restorer: lambda { |target|
        @restored_targets << target
        :restored
      },
      preflight_tracker: @preflight_tracker
    )
  end

  def golden_resolve(scenario, fail_with: nil)
    lambda do |ctx|
      raise fail_with if fail_with

      body = FIXTURE.response_for(scenario, message_id: ctx[:message_id],
                                            idempotency_key: ctx[:idempotency_key])
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
        body,
        expected_request: { 'messageId' => ctx[:message_id], 'idempotencyKey' => ctx[:idempotency_key] }
      )
    end
  end

  def batch_command(ref, resolve: golden_resolve('02-move-shelf'), apply_mode: :commit,
                    context_valid: -> { true })
    FIXTURE.build_command(
      model: model,
      semantic_target: { 'furnitureInstanceRef' => ref },
      resolve: resolve, apply_mode: apply_mode, context_valid: context_valid,
      name: 'update_furniture'
    )
  end

  def test_committed_batch_applies_every_member_inside_one_operation
    commands = [batch_command('inst-a'), batch_command('inst-b'), batch_command('inst-c')]

    outcome = coordinator.execute_batch(commands)

    assert outcome.committed?, "outcome: #{outcome.outcome}/#{outcome.reason}"
    assert_equal 3, outcome.result['applied']
    assert_equal true, outcome.result['batch']
    assert_equal 3, outcome.result['items'].length
    # ONE SketchUp operation carries the whole batch: one coherent undo.
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
    assert_equal(1, model.operations.count { |entry| entry.first == :commit })
    assert_equal ['Granete · Editar lote (3 muebles)'], model.operation_names
    assert_equal(%w[inst-a inst-b inst-c], restored_targets.map { |t| t['furnitureInstanceRef'] })
    assert_equal 'idle', coordinator.state
  end

  def test_resolve_failure_on_a_member_stops_the_batch_before_any_host_mutation
    rejection = Granete::SketchUpExtension::Library::AuthoringResolveError.new(
      'parámetro fuera de rango', status: 422, issues: []
    )
    commands = [
      batch_command('inst-a'),
      batch_command('inst-b', resolve: golden_resolve(nil, fail_with: rejection)),
      batch_command('inst-c')
    ]

    outcome = coordinator.execute_batch(commands)

    assert outcome.rejected?, "outcome: #{outcome.outcome}"
    assert_includes outcome.reason, 'inst-b', 'the failing member is named'
    assert model.operations.empty?, 'a failed batch resolve starts zero operations'
    assert_equal FIXTURE::H1, model.hierarchy, 'the host keeps the previous valid state'
    assert_equal 'idle', coordinator.state
    assert_empty restored_targets
  end

  def test_apply_failure_mid_batch_aborts_the_single_operation_all_or_nothing
    commands = [
      batch_command('inst-a'),
      batch_command('inst-b', apply_mode: :raise_mid_operation),
      batch_command('inst-c')
    ]

    outcome = coordinator.execute_batch(commands)

    assert outcome.aborted?, "outcome: #{outcome.outcome}"
    assert_equal 'host_apply_failure', outcome.category
    assert_includes outcome.reason, 'lote abortado'
    # The ONE operation started for the batch was aborted — no commit, so
    # the batch never lands half-applied.
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
    assert_equal(1, model.operations.count { |entry| entry.first == :abort })
    assert(model.operations.none? { |entry| entry.first == :commit })
    assert_equal 'idle', coordinator.state
  end

  def test_apply_refusal_mid_batch_rejects_without_committing
    commands = [
      batch_command('inst-a'),
      batch_command('inst-b', apply_mode: :refuse)
    ]

    outcome = coordinator.execute_batch(commands)

    assert outcome.aborted?
    assert_equal 'invalid_authoring_input', outcome.category
    assert_includes outcome.reason, 'el layout resuelto no aplica'
    assert(model.operations.none? { |entry| entry.first == :commit })
  end

  def test_stale_member_blocks_the_whole_batch
    commands = [
      batch_command('inst-a'),
      batch_command('inst-b', context_valid: -> { false })
    ]

    outcome = coordinator.execute_batch(commands)

    assert outcome.stale?
    assert_includes outcome.reason, 'inst-b'
    assert model.operations.empty?, 'a stale batch never opens a host operation'
    assert_equal 'idle', coordinator.state
  end

  def test_second_batch_while_busy_is_soft_cancelled
    parked = coordinator.begin_resolve(batch_command('inst-parked'))

    refute_nil parked
    duplicate = coordinator.execute_batch([batch_command('inst-a'), batch_command('inst-b')])

    assert duplicate.cancelled?
    assert_equal 'duplicate_submit', duplicate.reason
    # The parked single mutation is untouched: no extra operations ran.
    assert model.operations.empty?
  end
end
