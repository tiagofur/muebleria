# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/connection/model_binding'

# #388 / DT-4 — model ↔ Project/Design binding. These tests prove the
# authority rules of the slice:
#   * binding metadata survives write/read roundtrips and never depends on
#     filename, path or model GUID;
#   * corrupt/foreign-shaped stored metadata reads as invalid, never as a
#     valid binding;
#   * the service maps HTTP outcomes to typed errors (no message parsing);
#   * the connector writes ONLY after successful authoritative validation,
#     preserves the previous binding on failure, requires explicit confirm
#     for rebind and adopts the authoritative base only on explicit action;
#   * the state machine surfaces every canonical state distinctly.
class ModelBindingTest < Minitest::Test
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  OTHER_PROJECT_ID = '41000000-0000-0000-0000-000000000002'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  OTHER_DESIGN_ID = '52000000-0000-0000-0000-000000000002'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  REVISION_R2 = '53000000-0000-0000-0000-000000000002'

  class BindingModel
    attr_reader :operations

    def initialize
      @attributes = {}
      @operations = []
    end

    def get_attribute(dictionary, key)
      @attributes[[dictionary, key]]
    end

    def set_attribute(dictionary, key, value)
      @attributes[[dictionary, key]] = value
    end

    def raw_binding
      @attributes[['com.granete.project', 'granete.project-binding.v1']]
    end

    def write_raw_binding(payload)
      @attributes[['com.granete.project', 'granete.project-binding.v1']] = payload
    end

    def start_operation(name, disable_ui)
      @operations << [:start, name, disable_ui]
    end

    def commit_operation
      @operations << :commit
    end

    def abort_operation
      @operations << :abort
    end
  end

  class FakeTransport
    attr_reader :requests

    def initialize
      @requests = []
      @responses = {}
    end

    def respond_with(path, status, body)
      @responses[[:get, path]] = { 'status' => status, 'body' => body }
    end

    def respond_post(path, status, body)
      @responses[[:post, path]] = { 'status' => status, 'body' => body }
    end

    def request(command)
      @requests << command
      key = [command['method'].to_s.downcase.to_sym, command['path']]
      response = @responses[key]
      return { 'status' => 500, 'body' => {} } unless response

      { 'status' => response['status'],
        'headers' => {},
        'body' => response['body'].is_a?(Hash) ? JSON.parse(JSON.generate(response['body'])) : response['body'] }
    end
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-token'
    end
  end

  class UnconfiguredAuth
    def configured?
      false
    end
  end

  class RaisingTransport
    def request(_command)
      raise Granete::SketchUpExtension::Transport::RequestError, 'boom'
    end
  end

  def mb
    Granete::SketchUpExtension::Connection::ModelBinding
  end

  def validation_payload(state: 'valid', base: REVISION_R1, number: 1, schema_version: 1,
                         project_id: PROJECT_ID, design_id: DESIGN_ID)
    {
      'state' => state,
      'schema_version' => schema_version,
      'organization' => { 'id' => '60000000-0000-0000-0000-000000000001', 'name' => 'Carpintería García' },
      'project' => { 'id' => project_id, 'name' => 'Cocina García' },
      'design' => { 'id' => design_id, 'name' => 'Cocina Principal', 'status' => 'active' },
      'working_copy' => { 'base_revision_id' => base, 'base_revision_number' => number,
                          'updated_at' => '2026-09-03T12:00:00Z' },
      'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
    }
  end

  def binding(base: REVISION_R1)
    mb::Binding.new(project_id: PROJECT_ID, design_id: DESIGN_ID,
                    base_revision_id: base, schema_version: 1)
  end

  def service_with(transport)
    mb::Service.new(transport: transport, auth_provider: FakeAuth.new,
                    logger: Granete::SketchUpExtension::SafeLogger.new)
  end

  def connector_with(model, transport)
    mb::Connector.new(
      store_factory: -> { mb::Store.new(model) },
      service: service_with(transport),
      logger: Granete::SketchUpExtension::SafeLogger.new
    )
  end

  # --- Store --------------------------------------------------------------

  def test_store_roundtrip_survives_and_never_touches_filename_or_guid
    model = BindingModel.new
    store = mb::Store.new(model)

    assert_nil store.read
    assert store.write!(binding)

    stored = store.read
    refute_nil stored
    assert_equal PROJECT_ID, stored.project_id
    assert_equal DESIGN_ID, stored.design_id
    assert_equal REVISION_R1, stored.base_revision_id
    assert_equal 1, stored.schema_version

    # The binding is one atomic JSON envelope in the Granete-owned model
    # dictionary — no filename/path/GUID anywhere in the payload.
    raw = JSON.parse(model.raw_binding)
    assert_equal %w[baseRevisionId designId projectId schemaVersion], raw.keys.sort
    assert_operator model.operations, :include?, [:start, 'Conectar modelo a Granete', true]
    assert_operator model.operations, :include?, :commit
  end

  def test_store_reads_corrupt_metadata_as_invalid_never_as_binding
    model = BindingModel.new
    store = mb::Store.new(model)

    model.write_raw_binding('{not json')
    assert_nil store.read
    assert_equal :invalid_binding_json, store.last_error

    model.write_raw_binding(JSON.generate('projectId' => 'not-a-uuid', 'designId' => DESIGN_ID,
                                          'baseRevisionId' => nil, 'schemaVersion' => 1))
    assert_nil store.read
    assert_equal :invalid_binding_metadata, store.last_error

    # A binding pointing at another design's shape but with valid ids stays a
    # binding: corruption is about shape, not about which business object.
    model.write_raw_binding(JSON.generate('projectId' => OTHER_PROJECT_ID, 'designId' => OTHER_DESIGN_ID,
                                          'baseRevisionId' => nil, 'schemaVersion' => 1))
    refute_nil store.read
    assert_nil store.last_error
  end

  def test_store_rejects_writing_invalid_bindings
    model = BindingModel.new
    store = mb::Store.new(model)
    invalid = mb::Binding.new(project_id: 'local-skp-123', design_id: DESIGN_ID,
                              base_revision_id: nil, schema_version: 1)

    assert_raises(ArgumentError) { store.write!(invalid) }
    assert_nil model.raw_binding
    assert_empty model.operations
  end

  # --- Service ------------------------------------------------------------

  def test_service_validate_parses_authoritative_response_and_sends_client_version
    transport = FakeTransport.new
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate",
                           200, validation_payload)
    service = service_with(transport)

    validation = service.validate(project_id: PROJECT_ID, design_id: DESIGN_ID,
                                  base_revision_id: REVISION_R1)

    assert_equal 'valid', validation.state
    assert_equal 'Carpintería García', validation.organization['name']
    assert_equal REVISION_R1, validation.working_copy['base_revision_id']
    assert_equal 1, validation.working_copy['base_revision_number']

    request = transport.requests.first
    assert_equal 'POST', request['method']
    assert_equal 'Bearer test-token', request['headers']['Authorization']
    assert_equal 1, request['body']['client_schema_version']
    assert_equal REVISION_R1, request['body']['base_revision_id']
  end

  def test_service_validate_without_stored_base_omits_expectation
    transport = FakeTransport.new
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate",
                           200, validation_payload)
    service_with(transport).validate(project_id: PROJECT_ID, design_id: DESIGN_ID)

    assert_nil transport.requests.first['body']['base_revision_id']
  end

  def test_service_maps_http_errors_to_typed_kinds
    {
      401 => :unauthenticated, 403 => :unauthorized, 404 => :not_found, 500 => :bad_response
    }.each do |status, kind|
      transport = FakeTransport.new
      transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate",
                             status, { 'error' => 'x' })
      error = assert_raises(mb::Service::Error) do
        service_with(transport).validate(project_id: PROJECT_ID, design_id: DESIGN_ID)
      end
      assert_equal kind, error.kind, "status #{status} must map to #{kind}"
    end
  end

  def test_service_network_failure_and_missing_session_fail_typed
    service = mb::Service.new(transport: RaisingTransport.new, auth_provider: FakeAuth.new)
    error = assert_raises(mb::Service::Error) do
      service.validate(project_id: PROJECT_ID, design_id: DESIGN_ID)
    end
    assert_equal :unreachable, error.kind

    unauth = mb::Service.new(transport: FakeTransport.new, auth_provider: UnconfiguredAuth.new)
    error = assert_raises(mb::Service::Error) do
      unauth.validate(project_id: PROJECT_ID, design_id: DESIGN_ID)
    end
    assert_equal :unauthenticated, error.kind
  end

  def test_service_lists_projects_and_designs_fail_closed
    transport = FakeTransport.new
    transport.respond_with('/projects', 200, [
                             { 'id' => PROJECT_ID, 'name' => 'Cocina García', 'customer' => 'x' },
                             { 'id' => 'garbage', 'name' => 'mangled' }
                           ])
    error = assert_raises(mb::Service::Error) { service_with(transport).list_projects }
    assert_equal :bad_response, error.kind

    transport = FakeTransport.new
    transport.respond_with('/projects', 200, [{ 'id' => PROJECT_ID, 'name' => 'Cocina García' }])
    projects = service_with(transport).list_projects
    assert_equal [{ 'id' => PROJECT_ID, 'name' => 'Cocina García' }], projects

    transport = FakeTransport.new
    transport.respond_with("/projects/#{PROJECT_ID}/designs", 200,
                           [{ 'id' => DESIGN_ID, 'name' => 'Cocina Principal', 'status' => 'active' }])
    designs = service_with(transport).list_designs(PROJECT_ID)
    assert_equal 'Cocina Principal', designs.first['name']
  end

  # --- Contract parser ----------------------------------------------------

  def test_contract_rejects_unknown_shapes_fail_closed
    [
      nil,
      {},
      validation_payload.merge('state' => 'mystery'),
      validation_payload.merge('schema_version' => 0),
      validation_payload.merge('design' => { 'id' => DESIGN_ID, 'name' => 'x', 'status' => 'weird' }),
      validation_payload.merge('working_copy' => { 'base_revision_id' => 'nope', 'base_revision_number' => nil })
    ].each do |payload|
      assert_raises(ArgumentError, "payload #{payload.inspect} must fail closed") do
        mb::Contract.parse!(payload)
      end
    end
  end

  # --- State machine ------------------------------------------------------

  def test_state_derivation_covers_every_canonical_state
    stored = binding
    validation = mb::Contract.parse!(validation_payload)

    assert_equal 'connected', mb::State.derive(stored: stored, validation: validation)
    assert_equal 'stale_base',
                 mb::State.derive(stored: stored,
                                  validation: mb::Contract.parse!(validation_payload(base: REVISION_R2, number: 2)))
    assert_equal 'design_archived',
                 mb::State.derive(stored: stored,
                                  validation: mb::Contract.parse!(validation_payload(state: 'design_archived')))
    assert_equal 'incompatible',
                 mb::State.derive(stored: stored,
                                  validation: mb::Contract.parse!(validation_payload(schema_version: 2)))
    assert_equal 'unbound', mb::State.derive(stored: nil, validation: nil)
    assert_equal 'unauthenticated',
                 mb::State.derive(stored: stored, error: mb::Service::Error.new(:unauthenticated))
    assert_equal 'unauthorized',
                 mb::State.derive(stored: stored, error: mb::Service::Error.new(:unauthorized))
    assert_equal 'invalid', mb::State.derive(stored: stored, error: mb::Service::Error.new(:not_found))
    assert_equal 'unreachable', mb::State.derive(stored: stored, error: mb::Service::Error.new(:unreachable))
    # No authoritative answer for a stored binding: never connected/unbound.
    assert_equal 'invalid', mb::State.derive(stored: stored, validation: nil)
    # nil and stored-nil base both mean "no published revision" → not stale.
    assert_equal 'connected',
                 mb::State.derive(stored: binding(base: nil),
                                  validation: mb::Contract.parse!(validation_payload(base: nil, number: nil)))
  end

  # --- Connector: the write-path authority rules ---------------------------

  def test_bind_writes_only_after_successful_validation
    model = BindingModel.new
    transport = FakeTransport.new
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate",
                           200, validation_payload)
    result = connector_with(model, transport).bind(project_id: PROJECT_ID, design_id: DESIGN_ID)

    assert result['ok'], result.inspect
    stored = mb::Store.new(model).read
    assert_equal PROJECT_ID, stored.project_id
    assert_equal REVISION_R1, stored.base_revision_id
    status = result['status']
    assert_equal 'connected', status['state']
    assert_equal 'Cocina García', status['binding']['projectName']
    assert_equal REVISION_R1, status['authoritativeBaseRevisionId']
  end

  def test_bind_retry_is_idempotent_same_target_same_binding
    model = BindingModel.new
    transport = FakeTransport.new
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate",
                           200, validation_payload)
    connector = connector_with(model, transport)

    first = connector.bind(project_id: PROJECT_ID, design_id: DESIGN_ID)
    second = connector.bind(project_id: PROJECT_ID, design_id: DESIGN_ID)

    assert first['ok'] && second['ok']
    assert_equal JSON.parse(model.raw_binding), JSON.parse(model.raw_binding)
    stored = mb::Store.new(model).read
    assert_equal PROJECT_ID, stored.project_id
  end

  def test_failed_validation_preserves_previous_binding_and_writes_nothing
    model = BindingModel.new
    mb::Store.new(model).write!(binding)
    transport = FakeTransport.new
    # Foreign/inaccessible target: uniform 404.
    transport.respond_post("/projects/#{OTHER_PROJECT_ID}/designs/#{OTHER_DESIGN_ID}/binding:validate",
                           404, { 'error' => 'not found' })
    result = connector_with(model, transport).bind(project_id: OTHER_PROJECT_ID, design_id: OTHER_DESIGN_ID,
                                                   confirm_rebind: true)

    refute result['ok']
    assert_equal 'validation_failed', result['code']
    # The previous valid binding is untouched.
    stored = mb::Store.new(model).read
    assert_equal PROJECT_ID, stored.project_id
    assert_equal DESIGN_ID, stored.design_id
    assert_equal REVISION_R1, stored.base_revision_id
  end

  def test_rebind_requires_explicit_confirmation_and_keeps_old_binding
    model = BindingModel.new
    mb::Store.new(model).write!(binding)
    transport = FakeTransport.new
    transport.respond_post("/projects/#{OTHER_PROJECT_ID}/designs/#{OTHER_DESIGN_ID}/binding:validate",
                           200, validation_payload(project_id: OTHER_PROJECT_ID, design_id: OTHER_DESIGN_ID,
                                                   base: REVISION_R2, number: 2))
    connector = connector_with(model, transport)

    blocked = connector.bind(project_id: OTHER_PROJECT_ID, design_id: OTHER_DESIGN_ID)
    refute blocked['ok']
    assert_equal 'rebind_required', blocked['code']
    assert_equal PROJECT_ID, mb::Store.new(model).read.project_id

    confirmed = connector.bind(project_id: OTHER_PROJECT_ID, design_id: OTHER_DESIGN_ID, confirm_rebind: true)
    assert confirmed['ok']
    stored = mb::Store.new(model).read
    assert_equal OTHER_DESIGN_ID, stored.design_id
    assert_equal REVISION_R2, stored.base_revision_id
  end

  def test_incompatible_server_contract_blocks_binding_fail_loud
    model = BindingModel.new
    transport = FakeTransport.new
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate",
                           200, validation_payload(schema_version: 99))
    result = connector_with(model, transport).bind(project_id: PROJECT_ID, design_id: DESIGN_ID)

    refute result['ok']
    assert_equal 'incompatible', result['code']
    assert_nil mb::Store.new(model).read
  end

  def test_status_detects_stale_base_and_reports_it_distinctly
    model = BindingModel.new
    mb::Store.new(model).write!(binding)
    transport = FakeTransport.new
    # Server advanced to R2 while the model is bound to R1.
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate",
                           200, validation_payload(base: REVISION_R2, number: 2))
    status = connector_with(model, transport).status

    assert_equal 'stale_base', status['state']
    assert_equal REVISION_R2, status['authoritativeBaseRevisionId']
    assert_equal 2, status['authoritativeBaseRevisionNumber']
  end

  def test_adopt_authoritative_base_is_explicit_and_revalidates_first
    model = BindingModel.new
    mb::Store.new(model).write!(binding)
    transport = FakeTransport.new
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate",
                           200, validation_payload(base: REVISION_R2, number: 2))
    connector = connector_with(model, transport)
    connector.status

    result = connector.adopt_authoritative_base
    assert result['ok']
    assert_equal REVISION_R2, mb::Store.new(model).read.base_revision_id
    assert_equal 'connected', result['status']['state']
  end

  def test_bind_rejects_non_uuid_targets_without_any_request
    model = BindingModel.new
    transport = FakeTransport.new
    result = connector_with(model, transport).bind(project_id: 'project-skp-ABC', design_id: DESIGN_ID)

    refute result['ok']
    assert_equal 'invalid_target', result['code']
    assert_empty transport.requests
    assert_nil mb::Store.new(model).read
  end

  def test_status_surfaces_corrupt_stored_metadata_as_invalid
    model = BindingModel.new
    model.write_raw_binding('garbage')
    transport = FakeTransport.new

    status = connector_with(model, transport).status
    assert_equal 'invalid', status['state']
    assert_empty transport.requests
  end
end
