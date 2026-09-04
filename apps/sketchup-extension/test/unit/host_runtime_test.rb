# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../support/host_runtime'

# Pure-unit coverage of the #498 / SU-HOST-1 shared host runtime building
# blocks: interaction state machine, error taxonomy, degraded states,
# message identity, operation journal, preflight tracker and the versioned
# bridge command contract.
class HostRuntimeTest < Minitest::Test
  HOST = Granete::SketchUpExtension::Host

  def test_interaction_state_machine_happy_path
    machine = HOST::InteractionState.new
    assert_equal 'idle', machine.state
    refute machine.busy?
    machine.transition!('editing_intent')
    machine.transition!('resolving')
    assert machine.busy?
    machine.transition!('applying_host_mutation')
    machine.transition!('committed')
    machine.finish!
    assert_equal 'idle', machine.state
  end

  def test_interaction_state_failure_branches_are_explicit
    machine = HOST::InteractionState.new
    machine.transition!('editing_intent').transition!('resolving')
    machine.transition!('rejected')
    machine.finish!
    assert_equal 'idle', machine.state

    machine.transition!('editing_intent').transition!('resolving')
    machine.transition!('unavailable')
    machine.finish!

    machine.transition!('editing_intent').transition!('resolving')
    machine.transition!('stale')
    machine.finish!

    machine.transition!('editing_intent').transition!('resolving')
    machine.transition!('cancelled')
    machine.finish!

    machine.transition!('editing_intent').transition!('resolving').transition!('applying_host_mutation')
    machine.transition!('aborted')
    machine.finish!
    assert_equal 'idle', machine.state
  end

  def test_impossible_transitions_fail_loudly
    machine = HOST::InteractionState.new
    error = assert_raises(HOST::InvalidTransitionError) { machine.transition!('committed') }
    assert_includes error.message, 'idle → committed'

    machine.transition!('editing_intent').transition!('resolving').transition!('applying_host_mutation')
    assert_raises(HOST::InvalidTransitionError) { machine.transition!('rejected') }
    assert_raises(HOST::InvalidTransitionError) { machine.transition!('resolving') }
  end

  def test_finish_only_returns_from_terminal_outcomes
    machine = HOST::InteractionState.new
    machine.transition!('editing_intent')
    assert_raises(HOST::InvalidTransitionError) { machine.finish! }
    assert_equal 'editing_intent', machine.state
  end

  def test_error_taxonomy_maps_statuses_without_reading_text
    assert_equal 'authentication', HOST::ErrorTaxonomy.category_for(
      Granete::SketchUpExtension::Library::AuthoringResolveError.new('x', status: 401)
    )
    assert_equal 'license_capability', HOST::ErrorTaxonomy.category_for(
      Granete::SketchUpExtension::Library::AuthoringResolveError.new('x', status: 403)
    )
    assert_equal 'stale_conflict', HOST::ErrorTaxonomy.category_for(
      Granete::SketchUpExtension::Library::AuthoringResolveError.new('x', status: 409)
    )
    assert_equal 'network_unavailable', HOST::ErrorTaxonomy.category_for(
      Granete::SketchUpExtension::Library::AuthoringResolveError.new('x', status: 503)
    )
  end

  def test_error_taxonomy_maps_structured_issue_codes
    issue = Struct.new(:code).new('CATALOG_REVISION_STALE')
    error = Granete::SketchUpExtension::Library::AuthoringResolveError.new('x', issues: [issue])
    assert_equal 'stale_conflict', HOST::ErrorTaxonomy.category_for(error)

    issue = Struct.new(:code).new('PARAMETER_OUT_OF_RANGE')
    error = Granete::SketchUpExtension::Library::AuthoringResolveError.new('x', issues: [issue])
    assert_equal 'invalid_authoring_input', HOST::ErrorTaxonomy.category_for(error)

    issue = Struct.new(:code).new('DRILLING_CONFLICT')
    error = Granete::SketchUpExtension::Library::AuthoringResolveError.new('x', issues: [issue])
    assert_equal 'manufacturing_blocker', HOST::ErrorTaxonomy.category_for(error)
  end

  def test_error_taxonomy_shape_based_connection_failure_and_contract_drift
    # The provider's connection wrapper: no status, no issues.
    error = Granete::SketchUpExtension::Library::AuthoringResolveError.new('Error de conexión …')
    assert_equal 'network_unavailable', HOST::ErrorTaxonomy.category_for(error)

    contract = Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError.new('schema drift')
    assert_equal 'incompatible_contract', HOST::ErrorTaxonomy.category_for(contract)

    layout_error = Granete::SketchUpExtension::Library::LayoutResolutionError.new('Sesión inválida o expirada',
                                                                                  status: 401)
    assert_equal 'authentication', HOST::ErrorTaxonomy.category_for(layout_error)
  end

  def test_degraded_states_map_from_outcomes_and_never_let_previews_be_productive
    degraded = HOST::DegradedState
    assert_equal 'resolved_current', degraded.for_mutation('committed', resolve_kind: 'authoring_resolve')
    assert_equal 'resolved_current', degraded.for_mutation('committed', resolve_kind: 'native_layout')
    assert_equal 'unresolved_preview', degraded.for_mutation('committed', resolve_kind: 'generic_preview')
    assert_equal 'offline_cached', degraded.for_mutation('unavailable', category: 'network_unavailable')
    assert_equal 'sync_required', degraded.for_mutation('unavailable', category: 'authentication')
    assert_equal 'blocked_incompatible', degraded.for_mutation('unavailable', category: 'license_capability')
    assert_equal 'blocked_incompatible', degraded.for_mutation('unavailable', category: 'incompatible_contract')
    assert_equal 'resolved_stale', degraded.for_mutation('stale')
    assert_equal 'blocked_incompatible', degraded.for_mutation('rejected', category: 'incompatible_contract')
    assert_equal 'resolved_current', degraded.for_mutation('rejected', category: 'invalid_authoring_input')
    assert_nil degraded.for_mutation('cancelled')

    assert degraded.productive?('resolved_current')
    refute degraded.productive?('unresolved_preview')
    refute degraded.productive?('offline_cached')
  end

  def test_degraded_states_map_from_catalog_provenance
    degraded = HOST::DegradedState
    assert_equal 'resolved_current', degraded.for_catalog_source('remote')
    assert_equal 'unresolved_preview', degraded.for_catalog_source('local')
    assert_equal 'sync_required', degraded.for_catalog_source('unauthenticated')
    assert_equal 'blocked_incompatible', degraded.for_catalog_source('license_blocked')
    assert_equal 'offline_cached', degraded.for_catalog_source('error')
  end

  def test_message_identity_allocates_unique_pairs
    first = HOST::MessageIdentity.allocate
    second = HOST::MessageIdentity.allocate
    refute_equal first[:message_id], second[:message_id]
    refute_equal first[:idempotency_key], second[:idempotency_key]
    assert_match(/\Amut-/, first[:message_id])
    assert_includes first[:idempotency_key], 'sketchup-mutation'
  end

  def test_operation_journal_enforces_one_operation_and_safe_abort
    model = Object.new
    # rubocop:disable-next Style/OptionalBooleanParameter
    def model.start_operation(_name, _flag = true); end
    journal = HOST::OperationJournal.new(model)
    assert_raises(HOST::NestedOperationError) do
      journal.start_operation('a')
      journal.start_operation('b')
    end
  end

  def test_operation_journal_counts_and_delegates
    calls = []
    model = Object.new
    model.define_singleton_method(:start_operation) { |name, _flag = true| calls << [:start, name] }
    model.define_singleton_method(:commit_operation) { calls << [:commit] }
    model.define_singleton_method(:abort_operation) { calls << [:abort] }
    model.define_singleton_method(:definitions) { :defs }

    journal = HOST::OperationJournal.new(model)
    assert_equal :defs, journal.definitions
    assert journal.respond_to?(:definitions)

    journal.abort_if_open! # no-op: nothing open, nothing delegated
    assert_empty calls

    journal.start_operation('Editar Mueble', true)
    journal.commit_operation
    assert_equal 1, journal.started_count
    assert_equal 1, journal.committed_count

    journal.start_operation('Editar Mueble', true)
    journal.abort_if_open!
    assert_equal 2, journal.started_count
    assert_equal 1, journal.aborted_count
    assert_equal %i[start commit start abort], calls.map(&:first)
  end

  def test_preflight_tracker_invalidates_but_never_marks_ready
    tracker = HOST::PreflightTracker.new
    assert_equal 'unknown', tracker.state_for('furnitureInstanceRef=inst-1')

    tracker.invalidate!('furnitureInstanceRef=inst-1', fingerprint: "sha256-#{'a' * 64}",
                                                       catalog_revision: 'workshop-1', message_id: 'mut-1')
    assert_equal 'stale', tracker.state_for('furnitureInstanceRef=inst-1')

    tracker.mark_unavailable!('furnitureInstanceRef=inst-2')
    assert_equal 'unavailable', tracker.state_for('furnitureInstanceRef=inst-2')

    payload = tracker.payload
    states = payload.map { |entry| entry['state'] }
    refute_includes states, 'ready'
    assert_includes states, 'stale'
    stale = payload.find { |entry| entry['state'] == 'stale' }
    assert_equal "sha256-#{'a' * 64}", stale['fingerprint']
    assert_equal 'workshop-1', stale['catalogRevision']
    assert_equal 'mut-1', stale['messageId']
    assert_equal 1, tracker.payload_for('furnitureInstanceRef=inst-2').length
    assert_empty tracker.payload_for('furnitureInstanceRef=missing')
  end

  def test_command_contract_parses_a_valid_command_and_closes_the_shape
    envelope = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-mut-1-abc',
      'mutation' => 'update_furniture',
      'semanticTarget' => { 'furnitureInstanceRef' => 'inst-9' },
      'payload' => { 'definitionId' => 'kitchen-base-standard' }
    }
    parsed = HOST::CommandContract.parse_command!(JSON.generate(envelope))
    assert_equal 'cmd-mut-1-abc', parsed['messageId']
    assert_equal 'update_furniture', parsed['mutation']
    assert_equal({ 'furnitureInstanceRef' => 'inst-9' }, parsed['semanticTarget'])
  end

  def test_command_contract_rejects_unknown_schema_mutation_and_targets
    contract = HOST::CommandContract
    assert_raises(contract::ContractError) do
      contract.parse_command!('schemaId' => 'granete.other.v1', 'messageId' => 'm', 'mutation' => 'update_furniture')
    end
    assert_raises(contract::ContractError) do
      contract.parse_command!('schemaId' => contract::SCHEMA_ID, 'messageId' => 'm', 'mutation' => 'move_shelf')
    end
    assert_raises(contract::ContractError) do
      contract.parse_command!('schemaId' => contract::SCHEMA_ID, 'messageId' => 'm', 'mutation' => 'update_furniture',
                              'semanticTarget' => { 'persistentId' => '123' })
    end
    assert_raises(contract::ContractError) do
      contract.parse_command!('schemaId' => contract::SCHEMA_ID, 'messageId' => 'm', 'mutation' => 'update_furniture',
                              'semanticTarget' => {})
    end
    error = assert_raises(contract::ContractError) do
      contract.parse_command!('schemaId' => contract::SCHEMA_ID, 'messageId' => 'm', 'mutation' => 'update_furniture',
                              'semanticTarget' => { 'componentInstanceId' => 'shelf-01' })
    end
    assert_includes error.message, 'dueño'
  end

  def test_command_contract_builds_and_validates_ruby_to_js_envelopes
    envelope = HOST::CommandContract.mutation_state_envelope(
      message_id: 'mut-out-1', in_reply_to: 'cmd-1', mutation: 'update_furniture',
      outcome: 'rejected', category: 'invalid_authoring_input', reason: 'x',
      issues: [], semantic_target: { 'furnitureInstanceRef' => 'i' }
    )
    assert_equal 'granete.sketchup-host-command.v1', envelope['schemaId']
    assert_equal 'mutation_state', envelope['type']
    assert_equal 'rejected', envelope['outcome']

    assert_raises(HOST::CommandContract::ContractError) do
      HOST::CommandContract.mutation_state_envelope(message_id: 'm', in_reply_to: nil, mutation: 'x',
                                                    outcome: 'exploded')
    end
    assert_raises(HOST::CommandContract::ContractError) do
      HOST::CommandContract.mutation_state_envelope(message_id: 'm', in_reply_to: nil, mutation: 'x',
                                                    outcome: 'rejected', category: 'not_a_category')
    end
    degraded = HOST::CommandContract.degraded_state_envelope('sync_required')
    assert_equal 'degraded_state', degraded['type']
    assert_raises(HOST::CommandContract::ContractError) { HOST::CommandContract.degraded_state_envelope('ready') }
  end
end
