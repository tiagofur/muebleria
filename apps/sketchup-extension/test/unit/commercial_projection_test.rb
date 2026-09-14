# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/connection/commercial_projection'

class CommercialProjectionTest < Minitest::Test
  CP = Granete::SketchUpExtension::Connection::CommercialProjection
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'

  class Auth
    def configured? = true
    def authorization_header = 'Bearer device-token'
  end

  class Transport
    attr_reader :payload

    def initialize(response)
      @response = response
    end

    # Same shape as Transport::HttpAdapter#request: a braceless trailing hash
    # at the call site is parsed as keywords here and drops the payload.
    def request(payload, authorization_header: nil) # rubocop:disable Lint/UnusedMethodArgument
      @payload = payload
      @response
    end
  end

  class LocalStateModel
    def initialize
      @attributes = {}
    end

    def get_attribute(dictionary, key)
      @attributes[[dictionary, key]]
    end

    def set_attribute(dictionary, key, value)
      @attributes[[dictionary, key]] = value
    end
  end

  def projection
    {
      'schema' => 'granete.commercial-projection.v1', 'status' => 'current',
      'projectId' => PROJECT_ID, 'designId' => DESIGN_ID,
      'workingVersion' => 'working-4',
      'workingFingerprint' => "sha256-#{'a' * 64}",
      'catalogFingerprint' => "sha256-#{'b' * 64}",
      'projectionFingerprint' => "sha256-#{'c' * 64}",
      'pricingAuthority' => 'calc-project-breakdown',
      'calculatedAt' => '2026-09-13T12:00:00Z', 'currency' => 'MXN', 'itemCount' => 1,
      'amounts' => { 'materialsCost' => nil, 'edgeTotal' => nil, 'hardwareTotal' => nil,
                     'directCost' => 0.0, 'laborModular' => 0.0, 'laborFixedCost' => 0.0,
                     'marginFactor' => 1.0, 'saleTotal' => 0.0 },
      'costsWithheld' => false, 'saleAmountsWithheld' => false,
      'reference' => nil, 'acceptedReference' => nil, 'latestPublishedReference' => nil,
      'comparison' => nil, 'issues' => []
    }
  end

  def test_service_uses_exact_bound_path_and_device_authorization
    transport = Transport.new('status' => 200, 'body' => projection)
    result = CP::Service.new(transport: transport, auth_provider: Auth.new).fetch(PROJECT_ID, DESIGN_ID)

    assert_equal 0.0, result.dig('amounts', 'saleTotal')
    assert_equal 'GET', transport.payload['method']
    assert_equal "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/commercial-projection", transport.payload['path']
    assert_equal 'Bearer device-token', transport.payload.dig('headers', 'Authorization')
  end

  def test_contract_rejects_missing_amount_instead_of_inventing_zero
    body = projection
    body['amounts']['saleTotal'] = nil
    parsed = CP::Contract.parse!(body)
    assert_nil parsed.dig('amounts', 'saleTotal')
  end

  def test_contract_rejects_omitted_required_amount
    body = projection
    body['amounts'].delete('saleTotal')

    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_rejects_omitted_nullable_top_level_field
    body = projection
    body.delete('comparison')

    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_fails_closed_on_unknown_schema
    body = projection.merge('schema' => 'granete.commercial-projection.v2')
    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_rejects_unknown_fields_and_non_string_issues
    body = projection.merge('unexpected' => true)
    assert_raises(ArgumentError) { CP::Contract.parse!(body) }

    body = projection
    body['amounts']['unexpected'] = 1
    assert_raises(ArgumentError) { CP::Contract.parse!(body) }

    body = projection
    body['issues'] = [{ 'code' => 'not-generated' }]
    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_rejects_invalid_calculated_at
    body = projection
    body['calculatedAt'] = 'today'

    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_fails_closed_on_invalid_reference_and_comparison
    body = projection
    body['reference'] = {
      'quoteRevisionId' => PROJECT_ID, 'revisionNumber' => 1, 'status' => 'accepted',
      'currency' => 'MXN', 'saleTotal' => 100.0
    }
    body['comparison'] = { 'absoluteDelta' => Float::INFINITY, 'percentageDelta' => nil }

    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_accepts_generated_published_reference_status
    body = projection
    body['reference'] = {
      'quoteRevisionId' => PROJECT_ID, 'revisionNumber' => 1, 'status' => 'published',
      'currency' => 'MXN', 'saleTotal' => 100.0
    }

    assert_equal 'published', CP::Contract.parse!(body).dig('reference', 'status')
  end

  def test_contract_preserves_legacy_reference_with_unknown_currency
    body = projection
    body['reference'] = {
      'quoteRevisionId' => PROJECT_ID, 'revisionNumber' => 1, 'status' => 'published',
      'currency' => nil, 'saleTotal' => nil
    }

    assert_nil CP::Contract.parse!(body).dig('reference', 'currency')
  end

  def test_service_rejects_response_for_another_design
    body = projection.merge('designId' => '52000000-0000-0000-0000-000000000009')
    service = CP::Service.new(transport: Transport.new('status' => 200, 'body' => body), auth_provider: Auth.new)

    error = assert_raises(CP::Service::Error) { service.fetch(PROJECT_ID, DESIGN_ID) }
    assert_equal :incompatible, error.kind
  end

  def test_local_work_state_preserves_pending_across_partial_sync_and_reopen
    model = LocalStateModel.new
    state = CP::LocalWorkState.new(model)

    dirty = state.mark_pending!(project_id: PROJECT_ID, design_id: DESIGN_ID)
    partial = CP::LocalWorkState.new(model).record_sync!(
      project_id: PROJECT_ID, design_id: DESIGN_ID, scope: :partial
    )

    assert dirty['localChangesPending']
    assert partial['localChangesPending']
    assert_equal 'partial', partial['scope']
    assert_operator partial['generation'], :>, dirty['generation']
  end

  def test_missing_local_work_metadata_is_unconfirmed
    snapshot = CP::LocalWorkState.new(LocalStateModel.new).snapshot(
      project_id: PROJECT_ID, design_id: DESIGN_ID
    )

    refute snapshot['localChangesPending']
    refute snapshot['matchConfirmed']
    assert_equal 'unconfirmed', snapshot['scope']
  end

  def test_missing_context_in_existing_payload_is_unconfirmed
    model = LocalStateModel.new
    state = CP::LocalWorkState.new(model)
    other_design = '52000000-0000-0000-0000-000000000002'
    state.record_sync!(project_id: PROJECT_ID, design_id: DESIGN_ID, scope: :full)

    snapshot = CP::LocalWorkState.new(model).snapshot(project_id: PROJECT_ID, design_id: other_design)

    refute snapshot['localChangesPending']
    refute snapshot['matchConfirmed']
    assert_equal 'unconfirmed', snapshot['scope']
  end

  def test_partial_sync_does_not_confirm_untracked_context
    model = LocalStateModel.new

    partial = CP::LocalWorkState.new(model).record_sync!(
      project_id: PROJECT_ID, design_id: DESIGN_ID, scope: :partial
    )

    refute partial['localChangesPending']
    refute partial['matchConfirmed']
    assert_equal 'partial', partial['scope']
  end

  def test_full_sync_confirms_untracked_context_and_survives_reopen
    model = LocalStateModel.new
    synced = CP::LocalWorkState.new(model).record_sync!(
      project_id: PROJECT_ID, design_id: DESIGN_ID, scope: :full
    )
    reopened = CP::LocalWorkState.new(model).snapshot(project_id: PROJECT_ID, design_id: DESIGN_ID)

    refute synced['localChangesPending']
    assert synced['matchConfirmed']
    refute reopened['localChangesPending']
    assert reopened['matchConfirmed']
    assert_equal synced['generation'], reopened['generation']
  end

  def test_previous_v1_pending_entry_stays_pending_but_is_not_match_evidence
    model = LocalStateModel.new
    key = "#{PROJECT_ID}/#{DESIGN_ID}"
    model.set_attribute(
      CP::LocalWorkState::DICTIONARY,
      CP::LocalWorkState::KEY,
      JSON.generate('schemaVersion' => 1,
                    'contexts' => { key => { 'generation' => 7, 'localChangesPending' => true } })
    )

    snapshot = CP::LocalWorkState.new(model).snapshot(project_id: PROJECT_ID, design_id: DESIGN_ID)

    assert snapshot['localChangesPending']
    refute snapshot['matchConfirmed']
    assert_equal 7, snapshot['generation']
  end

  def test_previous_v1_clean_entry_is_unconfirmed_until_a_full_sync
    model = LocalStateModel.new
    key = "#{PROJECT_ID}/#{DESIGN_ID}"
    model.set_attribute(
      CP::LocalWorkState::DICTIONARY,
      CP::LocalWorkState::KEY,
      JSON.generate('schemaVersion' => 1,
                    'contexts' => { key => { 'generation' => 3, 'localChangesPending' => false } })
    )

    state = CP::LocalWorkState.new(model)
    snapshot = state.snapshot(project_id: PROJECT_ID, design_id: DESIGN_ID)
    partial = state.record_sync!(project_id: PROJECT_ID, design_id: DESIGN_ID, scope: :partial)

    refute snapshot['localChangesPending']
    refute snapshot['matchConfirmed']
    refute partial['matchConfirmed']
  end

  def test_only_full_sync_clears_exact_context_without_mixing_designs
    model = LocalStateModel.new
    state = CP::LocalWorkState.new(model)
    other_design = '52000000-0000-0000-0000-000000000002'
    state.mark_pending!(project_id: PROJECT_ID, design_id: DESIGN_ID)
    state.mark_pending!(project_id: PROJECT_ID, design_id: other_design)

    clean = state.record_sync!(project_id: PROJECT_ID, design_id: DESIGN_ID, scope: :full)

    refute clean['localChangesPending']
    assert CP::LocalWorkState.new(model).snapshot(
      project_id: PROJECT_ID, design_id: other_design
    )['localChangesPending']
  end

  def test_corrupt_local_work_state_fails_closed
    model = LocalStateModel.new
    model.set_attribute(CP::LocalWorkState::DICTIONARY, CP::LocalWorkState::KEY, '{broken')

    snapshot = CP::LocalWorkState.new(model).snapshot(project_id: PROJECT_ID, design_id: DESIGN_ID)

    refute snapshot['localChangesPending']
    refute snapshot['matchConfirmed']
    assert_equal 'unconfirmed', snapshot['scope']
  end
end
