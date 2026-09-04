# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../support/host_runtime'
require_relative '../support/mutation_orchestration_fixture'

# THE #498 / SU-HOST-1 coordinator suite: one domain-neutral orchestrator
# carries every authoring mutation from semantic intent to atomic host
# commit. Positive path plus the mandatory negative proofs: rejected
# resolve starts zero operations, host exception aborts and preserves the
# previous hierarchy/metadata, late responses are discarded by
# correlation, wrong-context results never apply, double submits cannot
# start two host applies, generic previews can never become productive,
# and component/hardware semantic targets ride the same neutral channel.
class HostAuthoringMutationCoordinatorTest < Minitest::Test
  HOST = Granete::SketchUpExtension::Host
  CommandContract = Granete::SketchUpExtension::Host::CommandContract
  FIXTURE = MutationOrchestrationFixture

  attr_reader :model, :coordinator, :restored_targets

  def setup
    @model = FIXTURE::FakeHostModel.new(FIXTURE::H1, FIXTURE::M1)
    @restored_targets = []
    @selection_restorer = lambda { |target|
      @restored_targets << target
      :restored
    }
    @preflight_tracker = HOST::PreflightTracker.new
    @coordinator = HOST::AuthoringMutationCoordinator.new(
      model_provider: -> { @model },
      logger: Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new),
      selection_restorer: @selection_restorer,
      preflight_tracker: @preflight_tracker
    )
  end

  # Resolve double: submits the #477 golden envelope with correlation
  # rewritten to the coordinator's request — REAL contract parsing.
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

  def command(semantic_target: FIXTURE::FI_1, resolve: golden_resolve('02-move-shelf'),
              apply_mode: :commit, context_valid: -> { true }, manufacturing_affecting: true,
              name: 'fake_mutation')
    FIXTURE.build_command(model: model, semantic_target: semantic_target, resolve: resolve,
                          apply_mode: apply_mode, context_valid: context_valid,
                          manufacturing_affecting: manufacturing_affecting, name: name)
  end

  def test_successful_mutation_commits_one_operation_and_invalidates_preflight
    outcome = coordinator.execute(command)

    assert outcome.committed?, "outcome: #{outcome.outcome}/#{outcome.reason}"
    assert_equal 'committed', outcome.outcome
    assert_equal 'authoring_resolve', outcome.resolve_kind
    assert_equal 'resolved_current', outcome.degraded
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
    assert_equal(1, model.operations.count { |entry| entry.first == :commit })
    assert_equal ['Editar Mueble (fixture)'], model.operation_names
    # The accepted boards replaced H1 inside that single operation.
    assert_equal %w[side-left-01 side-right-01 floor-01 top-01 back-01 shelf-01 door-01], model.hierarchy
    assert_equal FIXTURE::M2, model.metadata
    assert_match(/\Asha256-[0-9a-f]{64}\z/, outcome.fingerprint)
    refute_nil outcome.catalog_revision
    assert_equal 'idle', coordinator.state
    assert_equal [FIXTURE::FI_1], restored_targets
    assert_equal 'stale', @preflight_tracker.state_for(command.target_key)
  end

  def test_rejected_resolve_starts_zero_operations_and_preserves_previous_hierarchy
    rejection = reject_with_fixture('07-orphan-anchor-rejection')
    resolve = golden_resolve('07-orphan-anchor-rejection', fail_with: rejection)
    outcome = coordinator.execute(command(resolve: resolve))

    assert_equal 'rejected', outcome.outcome
    assert_equal 'manufacturing_blocker', outcome.category
    assert_includes outcome.issues.map(&:code), 'RELATIONSHIP_ORPHANED'
    assert_empty model.operations
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
    assert_equal 'idle', coordinator.state
    assert_empty restored_targets
  end

  # The golden rejection arrives over HTTP 422: the transport raises an
  # AuthoringResolveError carrying the structured issues.
  def reject_with_fixture(scenario)
    entry = FIXTURE.scenario(scenario)
    result = Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
      entry['response'], expected_request: entry['request']
    )
    first = result.issues.first
    Granete::SketchUpExtension::Library::AuthoringResolveError.new(
      "La autoría fue rechazada (#{first&.code})", status: entry['expectedHttpStatus'], issues: result.issues
    )
  end

  def test_network_failure_is_unavailable_and_previous_state_survives
    error = Granete::SketchUpExtension::Library::AuthoringResolveError.new('Error de conexión al resolver autoría')
    outcome = coordinator.execute(command(resolve: golden_resolve(nil, fail_with: error)))

    assert_equal 'unavailable', outcome.outcome
    assert_equal 'network_unavailable', outcome.category
    assert_equal 'offline_cached', outcome.degraded
    assert_empty model.operations
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
  end

  def test_auth_and_license_failures_stay_distinct_from_offline
    auth = Granete::SketchUpExtension::Library::AuthoringResolveError.new('Sesión inválida', status: 401)
    outcome = coordinator.execute(command(resolve: golden_resolve(nil, fail_with: auth)))
    assert_equal 'unavailable', outcome.outcome
    assert_equal 'authentication', outcome.category
    assert_equal 'sync_required', outcome.degraded

    license = Granete::SketchUpExtension::Library::AuthoringResolveError.new('Licencia requerida', status: 403)
    outcome = coordinator.execute(command(resolve: golden_resolve(nil, fail_with: license)))
    assert_equal 'license_capability', outcome.category
    assert_equal 'blocked_incompatible', outcome.degraded
  end

  def test_stale_conflict_maps_to_stale_outcome
    issue = Struct.new(:code).new('CATALOG_REVISION_STALE')
    error = Granete::SketchUpExtension::Library::AuthoringResolveError.new('stale', status: 409, issues: [issue])
    outcome = coordinator.execute(command(resolve: golden_resolve(nil, fail_with: error)))

    assert_equal 'stale', outcome.outcome
    assert_equal 'stale_conflict', outcome.category
    assert_equal 'resolved_stale', outcome.degraded
    assert_empty model.operations
  end

  def test_incompatible_contract_fails_closed_before_any_host_work
    error = Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError.new('schema 9.9')
    outcome = coordinator.execute(command(resolve: golden_resolve(nil, fail_with: error)))

    assert_equal 'rejected', outcome.outcome
    assert_equal 'incompatible_contract', outcome.category
    assert_equal 'blocked_incompatible', outcome.degraded
    assert_empty model.operations
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
  end

  def test_host_exception_mid_operation_aborts_and_previous_hierarchy_and_metadata_survive
    outcome = coordinator.execute(command(apply_mode: :raise_mid_operation))

    assert_equal 'aborted', outcome.outcome
    assert_equal 'host_apply_failure', outcome.category
    # ONE operation started, aborted (never committed): H1 survives intact
    # and no partial new hierarchy remains.
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
    assert_equal(1, model.operations.count { |entry| entry.first == :abort })
    assert_equal(0, model.operations.count { |entry| entry.first == :commit })
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
    refute_includes model.hierarchy, 'board:partial'
    assert_equal 'idle', coordinator.state
  end

  def test_apply_refused_before_operation_is_aborted_with_input_category
    outcome = coordinator.execute(command(apply_mode: :refuse))

    assert_equal 'aborted', outcome.outcome
    assert_equal 'invalid_authoring_input', outcome.category
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
    assert_equal(1, model.operations.count { |entry| entry.first == :abort })
    assert_equal(0, model.operations.count { |entry| entry.first == :commit })
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
  end

  def test_two_operations_violate_atomicity_and_abort
    outcome = coordinator.execute(command(apply_mode: :two_operations))

    # Malicious/buggy command attempts transaction operations:
    # CommandHostContext raises NestedOperationError and the coordinator aborts.
    # Exactly ONE host operation started, ZERO committed, ONE aborted.
    # Model remains H1 for hierarchy and metadata.
    assert_equal 'aborted', outcome.outcome
    assert_equal 'host_apply_failure', outcome.category
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
    assert_equal(0, model.operations.count { |entry| entry.first == :commit })
    assert_equal(1, model.operations.count { |entry| entry.first == :abort })
  end

  def test_start_operation_host_failure_leaves_model_untouched
    model.fail_start = true
    outcome = coordinator.execute(command)

    assert_equal 'aborted', outcome.outcome
    assert_equal 'host_apply_failure', outcome.category
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
    assert_equal(0, model.operations.count { |entry| entry.first == :commit })
    assert_equal(0, model.operations.count { |entry| entry.first == :abort })
    assert_equal 'idle', coordinator.state
  end

  def test_commit_operation_host_failure_aborts_and_preserves_previous_state
    model.fail_commit = true
    outcome = coordinator.execute(command)

    assert_equal 'aborted', outcome.outcome
    assert_equal 'host_apply_failure', outcome.category
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
    assert_equal(1, model.operations.count { |entry| entry.first == :abort })
    assert_equal(0, model.operations.count { |entry| entry.first == :commit })
    assert_equal 'idle', coordinator.state
  end

  def test_wrong_context_result_never_applies
    context_valid = -> { false } # user moved to FI-002 while FI-001 resolved
    outcome = coordinator.execute(command(context_valid: context_valid))

    assert_equal 'stale', outcome.outcome
    assert_equal 'stale_conflict', outcome.category
    assert_empty model.operations
    assert_equal FIXTURE::H1, model.hierarchy
    assert_equal FIXTURE::M1, model.metadata
    assert_empty restored_targets
  end

  def test_double_submit_is_soft_cancelled_without_a_second_host_apply
    resolve_calls = 0
    resolve = lambda do |ctx|
      resolve_calls += 1
      golden_resolve('02-move-shelf').call(ctx)
    end
    first = command(resolve: resolve)
    second = command(resolve: resolve)

    # Command A is in flight (async pair): a second submit while resolving
    # is soft-cancelled — no state corruption, no second resolve, no host op.
    coordinator.begin_resolve(first)
    assert coordinator.busy?
    duplicate = coordinator.execute(second)
    assert_equal 'cancelled', duplicate.outcome
    assert_equal 'duplicate_submit', duplicate.reason
    assert_equal 'resolving', coordinator.state

    # Completing the FIRST command still works normally afterwards.
    context = coordinator.pending_request_context
    result = coordinator.deliver_response(
      FIXTURE.response_for('02-move-shelf', message_id: context[:message_id],
                                            idempotency_key: context[:idempotency_key])
    )
    assert coordinator.complete(first, context, result).committed?
    # The cancelled duplicate never reached resolve OR the host: exactly one
    # operation for the whole interaction.
    assert_equal 0, resolve_calls # async pair: resolve ran via deliver_response, not the proc
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
  end

  def test_real_supersession_rejects_older_response_and_commits_newer_command
    cmd_a = command(name: 'command_a')
    cmd_b = command(name: 'command_b', semantic_target: FIXTURE::C_1_TARGET)

    ctx_a = coordinator.begin_resolve(cmd_a)
    assert_equal 'resolving', coordinator.state
    assert_equal ctx_a[:message_id], coordinator.pending_request_context[:message_id]

    # B supersedes A BEFORE A response
    ctx_b = coordinator.supersede_pending!(cmd_b)
    assert_equal 'resolving', coordinator.state
    assert_equal ctx_b[:message_id], coordinator.pending_request_context[:message_id]
    refute_equal ctx_a[:message_id], ctx_b[:message_id]

    # A late response arrives -> SupersededResponseError
    resp_a = FIXTURE.response_for('02-move-shelf', message_id: ctx_a[:message_id],
                                                   idempotency_key: ctx_a[:idempotency_key])
    assert_raises(HOST::SupersededResponseError) do
      coordinator.deliver_response(resp_a)
    end

    # Completing A yields stale outcome with zero host operations
    outcome_a = coordinator.complete(cmd_a, ctx_a, nil)
    assert_equal 'stale', outcome_a.outcome
    assert_equal(0, model.operations.count { |entry| entry.first == :start })

    # B response arrives -> delivers cleanly and commits
    resp_b = FIXTURE.response_for('02-move-shelf', message_id: ctx_b[:message_id],
                                                   idempotency_key: ctx_b[:idempotency_key])
    result_b = coordinator.deliver_response(resp_b)
    outcome_b = coordinator.complete(cmd_b, ctx_b, result_b)

    assert outcome_b.committed?
    assert_equal(1, model.operations.count { |entry| entry.first == :start })
    assert_equal(1, model.operations.count { |entry| entry.first == :commit })
    assert_equal(0, model.operations.count { |entry| entry.first == :abort })
    assert_equal 'idle', coordinator.state
  end

  def test_deliver_response_without_pending_request_fails_closed
    envelope = FIXTURE.response_for('02-move-shelf', message_id: 'mut-x', idempotency_key: 'k')
    assert_raises(HOST::NoPendingRequestError) { coordinator.deliver_response(envelope) }
  end

  def test_complete_for_a_superseded_command_returns_stale_without_host_work
    superseded = command
    current = command
    coordinator.begin_resolve(current)

    ctx = { message_id: 'mut-other', idempotency_key: 'other', furniture: nil }
    outcome = coordinator.complete(superseded, ctx, nil)
    assert_equal 'stale', outcome.outcome
    assert_equal 'superseded_by_newer_command', outcome.reason
    assert_empty model.operations
    assert coordinator.busy? # the CURRENT command stays untouched
  end

  def test_cancelled_resolve_performs_no_host_work
    cancelled = ->(_ctx) { raise HOST::CancelledError, 'usuario canceló' }
    outcome = coordinator.execute(command(resolve: cancelled))

    assert_equal 'cancelled', outcome.outcome
    assert_empty model.operations
    assert_equal FIXTURE::H1, model.hierarchy
  end

  def test_generic_preview_commits_but_never_becomes_productive
    resolve = ->(ctx) { FIXTURE.layout_result(nil, ctx, resolve_kind: 'generic_preview') }
    outcome = coordinator.execute(command(resolve: resolve))

    assert outcome.committed?
    assert_equal 'generic_preview', outcome.resolve_kind
    assert_equal 'unresolved_preview', outcome.degraded
    assert_equal 'unavailable', @preflight_tracker.state_for(command.target_key)
    refute HOST::DegradedState.productive?(outcome.degraded)
  end

  def test_native_layout_channel_commits_productive_state
    layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(
      FIXTURE.scenario('02-move-shelf')['response']['resolved']['layout']
    )
    resolve = ->(ctx) { FIXTURE.layout_result(layout, ctx) }
    outcome = coordinator.execute(command(resolve: resolve))

    assert outcome.committed?
    assert_equal 'native_layout', outcome.resolve_kind
    assert_equal 'resolved_current', outcome.degraded
  end

  def test_component_and_hardware_semantic_targets_ride_the_neutral_channel
    component_outcome = coordinator.execute(command(semantic_target: FIXTURE::C_1_TARGET))
    assert component_outcome.committed?
    assert_equal FIXTURE::C_1_TARGET, restored_targets.first
    assert_equal 'stale', @preflight_tracker.state_for(CommandContract.semantic_target_key(FIXTURE::C_1_TARGET))

    hardware_outcome = coordinator.execute(command(semantic_target: FIXTURE::HP_1_TARGET))
    assert hardware_outcome.committed?
    assert_equal FIXTURE::HP_1_TARGET, restored_targets.last
    assert_equal 'stale', @preflight_tracker.state_for(CommandContract.semantic_target_key(FIXTURE::HP_1_TARGET))
  end

  def test_non_manufacturing_mutation_does_not_invalidate_preflight
    outcome = coordinator.execute(command(manufacturing_affecting: false))
    assert outcome.committed?
    assert_equal 'unknown', @preflight_tracker.state_for(CommandContract.semantic_target_key(FIXTURE::FI_1))
  end

  def test_outcome_envelope_is_versioned_and_correlated
    outcome = coordinator.execute(command)
    envelope = outcome.to_envelope(in_reply_to: 'cmd-from-js')
    assert_equal 'granete.sketchup-host-command.v1', envelope['schemaId']
    assert_equal 'mutation_state', envelope['type']
    assert_equal 'cmd-from-js', envelope['inReplyTo']
    assert_equal 'committed', envelope['outcome']
    assert_equal 'resolved_current', envelope['degraded']
    assert_equal({ 'furnitureInstanceRef' => 'inst-fi-1' }, envelope['semanticTarget'])
    assert envelope['result']['success']
    assert_match(/\Asha256-[0-9a-f]{64}\z/, outcome.fingerprint)
  end

  def test_begin_resolve_allocates_stable_correlation
    cmd = command
    context = coordinator.begin_resolve(cmd)
    assert_match(/\Amut-/, context[:message_id])
    assert_includes context[:idempotency_key], 'sketchup-mutation'
    assert_equal 'resolving', coordinator.state
    assert_raises(HOST::DuplicateSubmitError) { coordinator.begin_resolve(command) }
  end
end
