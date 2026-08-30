# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/identity'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/library/authoring_resolve_contract'

# #477 — versioned rich authoring resolve contract, Ruby parsing side.
#
# The fixture consumed here (contracts/sketchupAuthoringResolve.contract.json)
# is generated from the Go resolver's own HTTP responses (golden author), so
# these tests exercise the exact wire shape the server serves. Ruby is a
# consumer: it never recomputes machining and fails closed on unknown
# schema/contract/provenance instead of guessing.
class AuthoringResolveContractTest < Minitest::Test
  GOLDEN_PATH = File.expand_path('../../../../contracts/sketchupAuthoringResolve.contract.json', __dir__)
  CONTRACT = 'granete.sketchup-authoring-resolve.v1'

  def fixture
    @fixture ||= JSON.parse(File.read(GOLDEN_PATH))
  end

  def scenario(id)
    fixture['scenarios'].find { |s| s['id'] == id } ||
      raise("missing scenario #{id} in golden")
  end

  def snapshot_placement
    scenario('01-params-materials-parity')['response']['normalizedSnapshot']['hardwarePlacements'][0]
  end

  def accepted_scenario(id)
    result = Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(scenario(id)['response'])
    assert result.accepted?, "scenario #{id} must parse as accepted"
    result
  end

  def test_parses_every_golden_scenario_fail_closed
    fixture['scenarios'].each do |raw|
      result = Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(raw['response'])
      assert_equal CONTRACT, raw['response']['schemaId']
      if raw['expectedHttpStatus'] == 200
        assert result.accepted?
        refute_nil result.layout
        refute_nil result.manufacturing_fingerprint
        refute_empty result.catalog_revision
      else
        refute result.accepted?
        refute result.issues.empty?
        result.issues.each { |issue| refute_empty issue.code }
      end
    end
  end

  def test_accepted_resolve_carries_identity_and_machining_with_provenance
    result = accepted_scenario('02-move-shelf')

    # Occurrence identity survives the wire for the atomic native rebuild.
    instance_ids = result.layout.boards.map(&:component_instance_id)
    scenario('02-move-shelf')['request']['furniture']['components'].each do |occurrence|
      assert_includes instance_ids, occurrence['componentInstanceId']
    end

    # Machining ops carry exactly one provenance variant keyed by stable ids.
    relationship_ops = result.operations.reject { |op| op.relationship_id.nil? }
    refute_empty relationship_ops
    relationship_ops.each do |op|
      refute_nil op.host_component_instance_id
      assert_includes instance_ids, op.host_component_instance_id
      op.holes.each do |hole|
        %w[face xMm yMm diameterMm depthMm type].each { |key| refute_nil hole[key], "#{key} missing" }
      end
    end

    # The moved shelf drove the side machining to the authored height.
    side_holes = relationship_ops
                 .select { |op| op.host_component_instance_id == 'side-left-01' }
                 .flat_map(&:holes)
    side_holes.each { |hole| assert_equal 520, hole['yMm'] }

    assert_match(/\Afnv1a-[0-9a-f]{8}\z/, result.manufacturing_fingerprint)
  end

  def test_rejected_resolve_carries_structured_codes_not_messages
    result = Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
      scenario('07-orphan-anchor-rejection')['response']
    )
    refute result.accepted?
    codes = result.issues.map(&:code)
    assert_includes codes, 'RELATIONSHIP_ORPHANED'
  end

  def test_unknown_schema_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('schemaId' => 'granete.sketchup-authoring.v1')
    error = assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
    assert_match(/Schema de resolve no soportado/, error.message)
  end

  def test_unknown_resolve_contract_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('resolveContract' => 'granete.other.v9')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_unknown_status_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('status' => 'maybe')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_accepted_without_resolved_layout_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('status' => 'accepted')
    body.delete('resolved')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_ambiguous_provenance_fails_closed
    op = scenario('02-move-shelf')['response']['resolved']['machining']['operations'][0]
         .merge('provenance' => { 'sourceKind' => 'relationship',
                                  'hardwarePlacementId' => 'hp-1' })
    machining = scenario('02-move-shelf')['response']['resolved']['machining'].merge('operations' => [op])
    resolved = scenario('02-move-shelf')['response']['resolved'].merge('machining' => machining)
    body = scenario('02-move-shelf')['response'].merge('resolved' => resolved)
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_invalid_hole_face_fails_closed
    holes = scenario('02-move-shelf')['response']['resolved']['machining']['operations'][0]['holes']
            .map { |hole| hole.merge('face' => 'diagonal') }
    op = scenario('02-move-shelf')['response']['resolved']['machining']['operations'][0].merge('holes' => holes)
    machining = scenario('02-move-shelf')['response']['resolved']['machining'].merge('operations' => [op])
    resolved = scenario('02-move-shelf')['response']['resolved'].merge('machining' => machining)
    body = scenario('02-move-shelf')['response'].merge('resolved' => resolved)
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_build_request_carries_the_versioned_envelope_without_query_keys
    furniture = {
      'furnitureDefinitionId' => 'mod-1',
      'parameters' => { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
      'components' => [
        { 'componentInstanceId' => 'shelf-01', 'componentDefinitionId' => 'mod-comp-shelf',
          'transform' => { 'frame' => 'assembly', 'translationMm' => [18, 18, 350] } }
      ]
    }
    request = Granete::SketchUpExtension::Library::AuthoringResolveRequest.build_request(
      message_id: 'msg-ruby-1', idempotency_key: 'skp:resolve:msg-ruby-1', furniture: furniture
    )

    assert_equal CONTRACT, request['schemaId']
    assert_equal 'granete.sketchup-authoring-resolve', request['schemaName']
    assert_equal '1.0', request['schemaVersion']
    assert_equal 'granete-for-sketchup', request.dig('source', 'client')
    assert_equal 'mm', request.dig('units', 'length')
    assert_equal 'right', request.dig('coordinateSystem', 'handedness')
    assert_equal furniture, request['furniture']
    # No authoring intent may ever degrade into flat parameter keys.
    refute request.key?('shelf2Z')
    refute request['furniture'].key?('shelf2Z')
  end

  def test_wrong_schema_name_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('schemaName' => 'granete.sketchup-authoring')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_wrong_schema_version_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('schemaVersion' => '1.1')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_partial_empty_correlation_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('responseMessageId' => '')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_unknown_issue_code_fails_closed
    body = scenario('07-orphan-anchor-rejection')['response']
    body['issues'][0] = body['issues'][0].merge('code' => 'SHELF2Z_UNSUPPORTED')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_malformed_fingerprint_fails_closed
    resolved = scenario('01-params-materials-parity')['response']['resolved']
    machining = resolved['machining'].merge('manufacturingFingerprint' => 'fnv1a-ZZZZZZZZ')
    body = scenario('01-params-materials-parity')['response']
           .merge('resolved' => resolved.merge('machining' => machining))
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_missing_catalog_revision_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('catalogRevision' => '')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_snapshot_echo_with_removed_v1_fields_fails_closed
    snapshot = scenario('01-params-materials-parity')['response']['normalizedSnapshot']
               .merge('hardwarePlacements' => [
                        snapshot_placement.merge('rotationDeg' => 0)
                      ])
    body = scenario('01-params-materials-parity')['response'].merge('normalizedSnapshot' => snapshot)
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  def test_snapshot_echo_with_non_finite_offset_fails_closed
    snapshot = scenario('01-params-materials-parity')['response']['normalizedSnapshot']
               .merge('hardwarePlacements' => [
                        snapshot_placement.merge('offsetMm' => [Float::INFINITY, 100])
                      ])
    body = scenario('01-params-materials-parity')['response'].merge('normalizedSnapshot' => snapshot)
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(body)
    end
  end

  # --- provider integration --------------------------------------------------

  class FakeTransport
    attr_reader :payload, :authorization_header

    def initialize(response)
      @response = response
    end

    def configured?
      true
    end

    def request(payload, authorization_header: nil)
      @payload = payload
      @authorization_header = authorization_header
      @response
    end
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-session-token'
    end
  end

  def provider(response)
    Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new(response), auth_provider: FakeAuth.new
    )
  end

  def test_provider_posts_the_authoring_intent_and_parses_the_result
    request_payload = Granete::SketchUpExtension::Library::AuthoringResolveRequest.build_request(
      message_id: 'msg-1', idempotency_key: 'key-1',
      furniture: { 'furnitureDefinitionId' => 'mod-1' }
    )
    result = provider({ 'status' => 200, 'body' => scenario('01-params-materials-parity')['response'] })
             .resolve_authoring(request_payload)

    assert result.accepted?
    assert_equal Granete::SketchUpExtension::Library::LayoutContract::SUPPORTED_TRANSFORM_CONTRACT,
                 result.layout.transform_contract
  end

  def test_provider_transport_shape_is_post_body_only
    request_payload = { 'schemaId' => CONTRACT }
    remote = provider({ 'status' => 200, 'body' => scenario('01-params-materials-parity')['response'] })
    remote.resolve_authoring(request_payload)

    payload = remote.instance_variable_get(:@transport).payload
    assert_equal 'POST', payload['method']
    assert_equal '/furniture/authoring/resolve', payload['path']
    refute payload['path'].include?('?')
    assert_equal request_payload, payload['body']
    assert_equal 'Bearer test-session-token',
                 remote.instance_variable_get(:@transport).authorization_header
  end

  def test_provider_maps_rejections_to_structured_issue_codes
    rejected = scenario('07-orphan-anchor-rejection')['response']
    error = assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveError) do
      provider({ 'status' => 422, 'body' => rejected }).resolve_authoring('schemaId' => CONTRACT)
    end

    assert_equal 422, error.status
    assert_includes error.issues.map(&:code), 'RELATIONSHIP_ORPHANED'
    assert_match(/RELATIONSHIP_ORPHANED/, error.message)
  end

  def test_provider_maps_session_and_license_failures
    [401, 403].each do |status|
      error = assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveError) do
        provider({ 'status' => status, 'body' => '' }).resolve_authoring('schemaId' => CONTRACT)
      end
      assert_equal status, error.status
    end
  end

  def test_provider_fails_closed_on_unknown_server_contract
    body = scenario('01-params-materials-parity')['response'].merge('resolveContract' => 'granete.unknown.v1')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      provider({ 'status' => 200, 'body' => body }).resolve_authoring('schemaId' => CONTRACT)
    end
  end

  def test_static_providers_do_not_resolve_authoring
    assert_nil Granete::SketchUpExtension::Library::StaticCatalogProvider.new.resolve_authoring('x')
  end

  def test_unconfigured_provider_returns_nil_instead_of_guessing
    remote = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(transport: nil, auth_provider: nil)
    assert_nil remote.resolve_authoring('schemaId' => CONTRACT)
  end
end
