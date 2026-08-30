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

  def fixture_request
    scenario('01-params-materials-parity')['request']
  end

  def parse_response(body, expected_request: fixture_request)
    Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
      body, expected_request: expected_request
    )
  end

  def snapshot_placement
    scenario('01-params-materials-parity')['response']['normalizedSnapshot']['hardwarePlacements'][0]
  end

  def deep_copy(value)
    JSON.parse(JSON.generate(value))
  end

  def accepted_scenario(id)
    raw = scenario(id)
    result = parse_response(raw['response'], expected_request: raw['request'])
    assert result.accepted?, "scenario #{id} must parse as accepted"
    result
  end

  def test_parses_every_golden_scenario_fail_closed
    fixture['scenarios'].each do |raw|
      result = parse_response(raw['response'], expected_request: raw['request'])
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

    assert_match(/\Asha256-[0-9a-f]{64}\z/, result.manufacturing_fingerprint)
  end

  def test_full_material_projection_and_cost_only_hardware_parse_fail_closed
    material = accepted_scenario('11-material-pbr-roundtrip')
    textured = material.layout.boards.find do |board|
      board.material_texture_url == '/api/media/materials/roble-claro-texture.webp'
    end
    refute_nil textured
    assert_equal '/api/media/materials/roble-claro.webp', textured.material_image_url
    assert_equal 600.0, textured.material_texture_tile_width_mm
    assert_equal 1200.0, textured.material_texture_tile_length_mm
    assert_in_delta 0.42, textured.material_roughness, 1e-9
    assert_in_delta 0.08, textured.material_metalness, 1e-9
    assert_in_delta 0.15, textured.material_clearcoat, 1e-9
    assert_equal true, textured.material_grain

    cost_only = accepted_scenario('12-cost-only-manual-hardware')
    semantic_ids = cost_only.normalized_snapshot['hardwarePlacements'].map do |placement|
      placement['hardwarePlacementId']
    end
    assert_equal ['hp-cost-only-01'], semantic_ids
    refute_includes cost_only.layout.hardware.map(&:placement_id), 'hp-cost-only-01'
    assert_match(/\Asha256-[0-9a-f]{64}\z/, cost_only.manufacturing_fingerprint)
  end

  def test_rejected_resolve_carries_structured_codes_not_messages
    result = parse_response(
      scenario('07-orphan-anchor-rejection')['response']
    )
    refute result.accepted?
    codes = result.issues.map(&:code)
    assert_includes codes, 'RELATIONSHIP_ORPHANED'
  end

  def test_parameter_issue_preserves_safe_details_and_rejects_object_values
    raw = scenario('neg-parameter-wrong-type')
    result = parse_response(raw['response'], expected_request: raw['request'])
    issue = result.issues.first
    assert_equal 'PARAMETER_TYPE_INVALID', issue.code
    assert_equal 'boolean', issue.details['expectedType']
    assert_equal 'string', issue.details['receivedType']

    body = deep_copy(raw['response'])
    body['issues'][0]['details']['receivedValue'] = { 'secret' => 'not scalar' }
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body, expected_request: raw['request'])
    end
  end

  def test_unknown_schema_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('schemaId' => 'granete.sketchup-authoring.v1')
    error = assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
    assert_match(/Schema de resolve no soportado/, error.message)
  end

  def test_unknown_resolve_contract_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('resolveContract' => 'granete.other.v9')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_unknown_status_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('status' => 'maybe')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_accepted_without_resolved_layout_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('status' => 'accepted')
    body.delete('resolved')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
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
      parse_response(body)
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
      parse_response(body)
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
      parse_response(body)
    end
  end

  def test_wrong_schema_version_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('schemaVersion' => '1.1')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_partial_empty_correlation_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('responseMessageId' => '')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_unknown_issue_code_fails_closed
    body = scenario('07-orphan-anchor-rejection')['response']
    body['issues'][0] = body['issues'][0].merge('code' => 'SHELF2Z_UNSUPPORTED')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_transport_issue_codes_are_in_the_closed_set
    %w[METHOD_NOT_ALLOWED AUTHENTICATION_REQUIRED ACCESS_FORBIDDEN CONTENT_TYPE_UNSUPPORTED].each do |code|
      body = deep_copy(scenario('07-orphan-anchor-rejection')['response'])
      body['issues'][0]['code'] = code
      result = parse_response(body)
      assert_equal [code], result.issues.map(&:code)
    end
  end

  def test_malformed_fingerprint_fails_closed
    resolved = scenario('01-params-materials-parity')['response']['resolved']
    machining = resolved['machining'].merge('manufacturingFingerprint' => 'fnv1a-ZZZZZZZZ')
    body = scenario('01-params-materials-parity')['response']
           .merge('resolved' => resolved.merge('machining' => machining))
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_legacy_fingerprint_fails_closed
    body = deep_copy(scenario('01-params-materials-parity')['response'])
    body['resolved']['machining']['manufacturingFingerprint'] = 'fnv1a-a948a1cb'
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_missing_catalog_revision_fails_closed
    body = scenario('01-params-materials-parity')['response'].merge('catalogRevision' => '')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_snapshot_echo_with_removed_v1_fields_fails_closed
    snapshot = scenario('01-params-materials-parity')['response']['normalizedSnapshot']
               .merge('hardwarePlacements' => [
                        snapshot_placement.merge('rotationDeg' => 0)
                      ])
    body = scenario('01-params-materials-parity')['response'].merge('normalizedSnapshot' => snapshot)
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_snapshot_echo_with_non_finite_offset_fails_closed
    snapshot = scenario('01-params-materials-parity')['response']['normalizedSnapshot']
               .merge('hardwarePlacements' => [
                        snapshot_placement.merge('offsetMm' => [Float::INFINITY, 100])
                      ])
    body = scenario('01-params-materials-parity')['response'].merge('normalizedSnapshot' => snapshot)
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_accepted_without_normalized_snapshot_fails_closed
    body = deep_copy(scenario('01-params-materials-parity')['response'])
    body.delete('normalizedSnapshot')
    assert_contract_error(body)
  end

  def test_accepted_without_preflight_fails_closed
    body = deep_copy(scenario('01-params-materials-parity')['response'])
    body['resolved'].delete('preflight')
    assert_contract_error(body)
  end

  def test_unknown_preflight_scope_status_and_contract_fail_closed
    {
      'scope' => 'manufacturing-ready',
      'status' => 'ready',
      'preflightContract' => 'granete.other-preflight.v2'
    }.each do |key, value|
      body = deep_copy(scenario('01-params-materials-parity')['response'])
      body['resolved']['preflight'][key] = value
      assert_contract_error(body)
    end
  end

  def test_issue_without_severity_fails_closed
    body = deep_copy(scenario('07-orphan-anchor-rejection')['response'])
    body['issues'][0].delete('severity')
    assert_contract_error(body)
  end

  def test_hole_numeric_strings_and_numeric_type_fail_closed
    { 'xMm' => '37', 'diameterMm' => '35', 'type' => 123 }.each do |key, value|
      body = deep_copy(scenario('02-move-shelf')['response'])
      body['resolved']['machining']['operations'][0]['holes'][0][key] = value
      assert_contract_error(body)
    end
  end

  def test_snapshot_parameter_and_material_choice_shapes_fail_closed
    [{ 'parameters' => { 'widthMm' => [600] } },
     { 'parameters' => { 'widthMm' => Float::INFINITY } },
     { 'materialChoices' => { 'FRENTE' => 18 } }].each do |replacement|
      body = deep_copy(scenario('01-params-materials-parity')['response'])
      replacement.each { |key, value| body['normalizedSnapshot'][key] = value }
      assert_contract_error(body)
    end
  end

  def test_snapshot_duplicate_ids_fail_closed
    %w[components relationships hardwarePlacements].each do |collection|
      source_id = collection == 'relationships' ? '02-move-shelf' : '01-params-materials-parity'
      body = deep_copy(scenario(source_id)['response'])
      body['normalizedSnapshot'][collection] << deep_copy(body['normalizedSnapshot'][collection].first)
      assert_contract_error(body)
    end
  end

  def test_snapshot_relationship_with_unknown_anchor_fails_closed
    body = deep_copy(scenario('02-move-shelf')['response'])
    body['normalizedSnapshot']['relationships'][0]['targets'][0]['componentInstanceId'] = 'missing-component'
    assert_contract_error(body)
  end

  def test_layout_component_ids_must_match_normalized_snapshot
    body = deep_copy(scenario('02-move-shelf')['response'])
    body['normalizedSnapshot']['components'][0]['componentInstanceId'] = 'other-side'
    assert_contract_error(body)
  end

  def test_response_correlation_must_match_expected_request
    raw = scenario('01-params-materials-parity')
    expected = deep_copy(raw['request']).merge('messageId' => 'msg-other')
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(
        raw['response'], expected_request: expected
      )
    end
  end

  def test_response_message_id_must_match_in_reply_to
    body = deep_copy(scenario('01-params-materials-parity')['response'])
    body['responseMessageId'] = 'resolve-someone-else'
    assert_contract_error(body)
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

  def assert_contract_error(body)
    assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
      parse_response(body)
    end
  end

  def test_provider_posts_the_authoring_intent_and_parses_the_result
    request_payload = scenario('01-params-materials-parity')['request']
    result = provider({ 'status' => 200, 'body' => scenario('01-params-materials-parity')['response'] })
             .resolve_authoring(request_payload)

    assert result.accepted?
    assert_equal Granete::SketchUpExtension::Library::LayoutContract::SUPPORTED_TRANSFORM_CONTRACT,
                 result.layout.transform_contract
  end

  def test_provider_transport_shape_is_post_body_only
    request_payload = scenario('01-params-materials-parity')['request']
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
      provider({ 'status' => 422, 'body' => rejected })
        .resolve_authoring(scenario('07-orphan-anchor-rejection')['request'])
    end

    assert_equal 422, error.status
    assert_includes error.issues.map(&:code), 'RELATIONSHIP_ORPHANED'
    assert_match(/RELATIONSHIP_ORPHANED/, error.message)
  end

  def test_transport_preserves_uncorrelated_typed_405_and_415_rejections
    { 405 => 'METHOD_NOT_ALLOWED', 415 => 'CONTENT_TYPE_UNSUPPORTED' }.each do |status, code|
      body = deep_copy(scenario('07-orphan-anchor-rejection')['response'])
      body['responseMessageId'] = ''
      body['inReplyToMessageId'] = ''
      body['idempotencyKey'] = ''
      body['catalogRevision'] = ''
      body['issues'] = [{ 'code' => code, 'message' => code, 'severity' => 'error' }]

      error = assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveError) do
        Granete::SketchUpExtension::Library::AuthoringResolveTransport.interpret(
          { 'status' => status, 'body' => body }, expected_request: fixture_request
        )
      end
      assert_equal status, error.status
      assert_equal [code], error.issues.map(&:code)
    end
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
      provider({ 'status' => 200, 'body' => body })
        .resolve_authoring(scenario('01-params-materials-parity')['request'])
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
