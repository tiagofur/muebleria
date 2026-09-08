# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/connection/model_binding'

# #499 Slice 3 — Web→SketchUp pairing receive. These tests prove:
#   * the code is normalized with the backend semantics and never persisted;
#   * exchange travels through the SAME extension-authenticated transport;
#   * the binding written is the EXACT grant pin (R1 pin + R2 working base
#     stays R1 and surfaces as the existing stale_base state);
#   * confirmation fires only after a dictionary readback of the exact
#     identity, and only the grant's exact ids/base are sent;
#   * one-time semantics are honest: a consumed code reports code_unusable,
#     a failed local bind reports the new-code recovery path;
#   * the manual bind flow is untouched (regression).
class PairingConnectTest < Minitest::Test
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  OTHER_DESIGN_ID = '52000000-0000-0000-0000-000000000002'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  REVISION_R2 = '53000000-0000-0000-0000-000000000002'
  GRANT_ID = '88000000-0000-0000-0000-000000000001'
  FRESH_GRANT_ID = '88000000-0000-0000-0000-000000000002'
  CODE = 'ABCD234EFGH5'
  FRESH_CODE = 'WXYZ234EFGH5'

  class BindingModel
    def initialize
      @attributes = {}
      @operations = []
    end

    attr_reader :operations

    def get_attribute(dictionary, key)
      @attributes[[dictionary, key]]
    end

    def set_attribute(dictionary, key, value)
      @attributes[[dictionary, key]] = value
    end

    def raw_binding
      @attributes[['com.granete.project', 'granete.project-binding.v1']]
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

  # A store whose readback returns a DIFFERENT identity than what was
  # written — proving confirmation depends on the readback, not the write.
  # Lies only AFTER a write happened: before that it behaves like the real
  # store so the rebind pre-check sees the model's true prior state.
  class LyingStore
    attr_writer :readback

    def initialize(model)
      @model = model
      @readback = nil
      @written = false
    end

    def read
      return @readback if @written && @readback

      Granete::SketchUpExtension::Connection::ModelBinding::Store.new(@model).read
    end

    def write!(binding)
      @written = true
      Granete::SketchUpExtension::Connection::ModelBinding::Store.new(@model).write!(binding)
    end

    def last_error
      nil
    end
  end

  class FakeTransport
    attr_reader :requests

    def initialize
      @requests = []
      @responses = {}
    end

    def respond_post(path, status, body)
      @responses[[:post, path]] = { 'status' => status, 'body' => body }
    end

    def respond_post_sequence(path, responses)
      @responses[[:post, path]] = responses.map { |status, body| { 'status' => status, 'body' => body } }
    end

    def request(command)
      @requests << command
      key = [command['method'].to_s.downcase.to_sym, command['path']]
      response = @responses[key]
      response = response.shift if response.is_a?(Array)
      return { 'status' => 500, 'body' => {} } unless response

      { 'status' => response['status'], 'headers' => {},
        'body' => response['body'].is_a?(Hash) ? JSON.parse(JSON.generate(response['body'])) : response['body'] }
    end
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer extension-token'
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

  def exchange_payload(pinned: REVISION_R1, working_base: REVISION_R2, design_id: DESIGN_ID, grant_id: GRANT_ID)
    {
      'grant_id' => grant_id,
      'action' => 'open_design',
      'pinned_base_revision_id' => pinned,
      'state' => 'valid',
      'schema_version' => 1,
      'organization' => { 'id' => '60000000-0000-0000-0000-000000000001', 'name' => 'Carpintería García' },
      'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina García' },
      'design' => { 'id' => design_id, 'name' => 'Cocina Principal', 'status' => 'active' },
      'working_copy' => { 'base_revision_id' => working_base, 'base_revision_number' => 2,
                          'updated_at' => '2026-09-03T12:00:00Z' },
      'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
    }
  end

  def status_payload(state: 'valid', base: REVISION_R2, number: 2)
    {
      'state' => state,
      'schema_version' => 1,
      'organization' => { 'id' => '60000000-0000-0000-0000-000000000001', 'name' => 'Carpintería García' },
      'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina García' },
      'design' => { 'id' => DESIGN_ID, 'name' => 'Cocina Principal', 'status' => 'active' },
      'working_copy' => { 'base_revision_id' => base, 'base_revision_number' => number,
                          'updated_at' => '2026-09-03T12:00:00Z' },
      'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
    }
  end

  def connector(model, transport)
    mb::Connector.new(
      store_factory: -> { mb::Store.new(model) },
      service: mb::Service.new(transport: transport, auth_provider: FakeAuth.new,
                               logger: Granete::SketchUpExtension::SafeLogger.new),
      logger: Granete::SketchUpExtension::SafeLogger.new
    )
  end

  def stub_pairing_backend(transport, pinned: REVISION_R1, working_base: REVISION_R2,
                           exchange_status: 200, confirm_status: 200, design_id: DESIGN_ID)
    transport.respond_post('/design-pairing-grants:exchange', exchange_status,
                           exchange_status == 200 ? exchange_payload(pinned: pinned, working_base: working_base,
                                                                     design_id: design_id) : { 'message' => 'nope' })
    transport.respond_post("/design-pairing-grants/#{GRANT_ID}:confirm", confirm_status,
                           { 'id' => GRANT_ID, 'action' => 'open_design',
                             'status' => confirm_status == 200 ? 'confirmed' : 'conflict' })
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{design_id}/binding:validate", 200,
                           status_payload(base: working_base))
  end

  # --- normalization -------------------------------------------------------

  def test_normalization_matches_backend_semantics
    service = mb::Service.new(transport: FakeTransport.new, auth_provider: FakeAuth.new)
    assert_equal 'ABCD234EFGH5', service.class.normalize_pairing_code(' abcd-234e fgh5 ')
    assert_equal '', service.class.normalize_pairing_code('····')
  end

  def test_short_code_fails_locally_without_any_http
    model = BindingModel.new
    transport = FakeTransport.new
    result = connector(model, transport).connect_with_code('corto')

    refute result['ok']
    assert_equal 'invalid_code', result['code']
    assert_equal true, result['pairing']
    assert transport.requests.empty?, 'a malformed code must never reach the server'
  end

  # --- happy path: exact pin + readback + confirm ---------------------------

  def test_exchange_binds_exact_pin_then_confirms_after_readback
    model = BindingModel.new
    transport = FakeTransport.new
    stub_pairing_backend(transport, pinned: REVISION_R1, working_base: REVISION_R2)

    result = connector(model, transport).connect_with_code(" #{CODE.downcase} ")

    assert result['ok'], result.inspect
    assert_equal true, result['pairing']

    # Exchange used the SAME authenticated transport with the normalized code.
    exchange = transport.requests.find { |r| r['path'] == '/design-pairing-grants:exchange' }
    refute_nil exchange
    assert_equal 'Bearer extension-token', exchange['headers']['Authorization']
    assert_equal CODE, exchange['body']['code']

    # The dictionary carries the EXACT pinned R1 — not the newer R2 working base.
    stored = mb::Store.new(model).read
    assert_equal PROJECT_ID, stored.project_id
    assert_equal DESIGN_ID, stored.design_id
    assert_equal REVISION_R1, stored.base_revision_id

    # Confirmation carries exactly the persisted identity.
    confirm = transport.requests.find { |r| r['path'] == "/design-pairing-grants/#{GRANT_ID}:confirm" }
    refute_nil confirm
    assert_equal({ 'project_id' => PROJECT_ID, 'design_id' => DESIGN_ID,
                   'base_revision_id' => REVISION_R1 }, confirm['body'])

    # The raw code never enters the model.
    refute model.raw_binding.include?(CODE)
  end

  def test_null_pin_stays_null_when_the_working_base_is_r1
    model = BindingModel.new
    transport = FakeTransport.new
    stub_pairing_backend(transport, pinned: nil, working_base: REVISION_R1)

    result = connector(model, transport).connect_with_code(CODE)

    assert result['ok'], result.inspect
    stored = mb::Store.new(model).read
    assert_nil stored.base_revision_id, 'a null grant pin must not rebase to the current working base'

    confirm = transport.requests.find { |r| r['path'] == "/design-pairing-grants/#{GRANT_ID}:confirm" }
    assert_equal({ 'project_id' => PROJECT_ID, 'design_id' => DESIGN_ID,
                   'base_revision_id' => nil }, confirm['body'])

    # The binding remains the exact null pin while the separate working
    # context reports R1 from the authoritative validation response.
    status = connector(model, transport).status
    assert_equal REVISION_R1, status['authoritativeBaseRevisionId']
    assert_nil mb::Store.new(model).read.base_revision_id
  end

  def test_stale_base_is_surfaced_not_silently_rebased
    model = BindingModel.new
    transport = FakeTransport.new
    stub_pairing_backend(transport, pinned: REVISION_R1, working_base: REVISION_R2)

    result = connector(model, transport).connect_with_code(CODE)

    assert result['ok']
    # Status derives the EXISTING stale_base state: stored R1 vs authoritative R2.
    assert_equal 'stale_base', result['status']['state']
    assert_equal REVISION_R2, result['status']['authoritativeBaseRevisionId']
    # And the binding itself keeps the exact pin.
    assert_equal REVISION_R1, mb::Store.new(model).read.base_revision_id
  end

  # --- one-time semantics ---------------------------------------------------

  def test_used_or_expired_code_is_actionable_not_internal
    model = BindingModel.new
    transport = FakeTransport.new
    stub_pairing_backend(transport, exchange_status: 409)

    result = connector(model, transport).connect_with_code(CODE)

    refute result['ok']
    assert_equal 'code_unusable', result['code']
    assert_match(/generá uno nuevo en la web/i, result['reason'])
    assert_nil mb::Store.new(model).read, 'a failed exchange must never write a binding'
  end

  def test_unknown_code_is_code_not_found
    model = BindingModel.new
    transport = FakeTransport.new
    stub_pairing_backend(transport, exchange_status: 404)

    result = connector(model, transport).connect_with_code(CODE)

    refute result['ok']
    assert_equal 'code_not_found', result['code']
  end

  def test_network_failure_is_indeterminate_and_never_claims_the_code_survived
    model = BindingModel.new
    conn = mb::Connector.new(
      store_factory: -> { mb::Store.new(model) },
      service: mb::Service.new(transport: RaisingTransport.new, auth_provider: FakeAuth.new,
                               logger: Granete::SketchUpExtension::SafeLogger.new),
      logger: Granete::SketchUpExtension::SafeLogger.new
    )

    result = conn.connect_with_code(CODE)

    refute result['ok']
    assert_equal 'unreachable', result['code']
    assert_match(/no se pudo confirmar el estado del código/i, result['reason'])
    refute_match(/no se consumió|pendiente|intercambiado/i, result['reason'])
    assert_nil mb::Store.new(model).read
  end

  # --- honest recovery: consumed code + failed local persistence -------------

  def test_readback_mismatch_blocks_confirmation_and_explains_recovery
    model = BindingModel.new
    transport = FakeTransport.new
    stub_pairing_backend(transport, pinned: REVISION_R1, working_base: REVISION_R2)

    lying = LyingStore.new(model)
    lying.readback = mb::Binding.new(project_id: PROJECT_ID, design_id: OTHER_DESIGN_ID,
                                     base_revision_id: REVISION_R1, schema_version: 1)
    conn = mb::Connector.new(
      store_factory: -> { lying },
      service: mb::Service.new(transport: transport, auth_provider: FakeAuth.new,
                               logger: Granete::SketchUpExtension::SafeLogger.new),
      logger: Granete::SketchUpExtension::SafeLogger.new
    )

    result = conn.connect_with_code(CODE)

    refute result['ok']
    assert_equal 'bind_readback_failed', result['code']
    assert_match(/generá un código nuevo en la web/i, result['reason'])
    confirm = transport.requests.find { |r| r['path'] == "/design-pairing-grants/#{GRANT_ID}:confirm" }
    assert_nil confirm, 'a failed readback must never confirm'
  end

  def test_confirm_http_failure_after_successful_bind_is_an_honest_partial
    model = BindingModel.new
    transport = FakeTransport.new
    stub_pairing_backend(transport, confirm_status: 409, pinned: REVISION_R1, working_base: REVISION_R1)

    result = connector(model, transport).connect_with_code(CODE)

    # The binding IS persisted and verified; only the web confirmation failed.
    assert result['ok'], result.inspect
    assert_equal true, result['confirmationFailed']
    assert_equal REVISION_R1, mb::Store.new(model).read.base_revision_id
  end

  # --- rebind policy ---------------------------------------------------------

  def test_model_bound_to_other_design_requires_fresh_pairing_code
    model = BindingModel.new
    mb::Store.new(model).write!(mb::Binding.new(project_id: PROJECT_ID, design_id: OTHER_DESIGN_ID,
                                                base_revision_id: nil, schema_version: 1))
    transport = FakeTransport.new
    stub_pairing_backend(transport, design_id: DESIGN_ID)

    result = connector(model, transport).connect_with_code(CODE)

    refute result['ok']
    assert_equal 'pairing_rebind_requires_new_code', result['code']
    assert_equal 'manual_rebind_then_new_code', result['recovery']
    assert_equal true, result['pairing']
    # The previous binding is preserved untouched; the dialog must not route
    # the exchanged pairing grant into the manual rebind confirmation.
    assert_equal OTHER_DESIGN_ID, mb::Store.new(model).read.design_id
  end

  def test_rebind_after_consumed_r1_grant_requires_new_code_without_rebasing_to_r2
    model = BindingModel.new
    mb::Store.new(model).write!(mb::Binding.new(project_id: PROJECT_ID, design_id: OTHER_DESIGN_ID,
                                                base_revision_id: nil, schema_version: 1))
    transport = FakeTransport.new
    stub_pairing_backend(transport, pinned: REVISION_R1, working_base: REVISION_R2, design_id: DESIGN_ID)

    result = connector(model, transport).connect_with_code(CODE)

    refute result['ok']
    assert_equal 'pairing_rebind_requires_new_code', result['code']
    assert_equal 'manual_rebind_then_new_code', result['recovery']
    assert_match(/revisión exacta/i, result['reason'])
    assert_match(/código nuevo en la web/i, result['reason'])
    # The consumed pairing grant cannot turn R1 into the manual flow's R2.
    stored = mb::Store.new(model).read
    assert_equal OTHER_DESIGN_ID, stored.design_id
    assert_nil stored.base_revision_id
    refute transport.requests.any? { |r| r['path'].include?(':confirm') },
           'a rejected pairing rebind must never confirm the exchanged grant'
  end

  def test_rebind_after_consumed_null_grant_requires_new_code_without_rebasing_to_r1
    model = BindingModel.new
    mb::Store.new(model).write!(mb::Binding.new(project_id: PROJECT_ID, design_id: OTHER_DESIGN_ID,
                                                base_revision_id: REVISION_R2, schema_version: 1))
    transport = FakeTransport.new
    stub_pairing_backend(transport, pinned: nil, working_base: REVISION_R1, design_id: DESIGN_ID)

    result = connector(model, transport).connect_with_code(CODE)

    refute result['ok']
    assert_equal 'pairing_rebind_requires_new_code', result['code']
    assert_equal true, result['pairing']
    # An explicit null pin also cannot become the manual working base R1.
    stored = mb::Store.new(model).read
    assert_equal OTHER_DESIGN_ID, stored.design_id
    assert_equal REVISION_R2, stored.base_revision_id
    refute transport.requests.any? { |r| r['path'].include?(':confirm') },
           'the old binding remains and the consumed grant stays unconfirmed'
  end

  def test_recovery_manual_rebind_then_fresh_pairing_restores_exact_pin
    [
      { pinned: REVISION_R1, working_base: REVISION_R2 },
      { pinned: nil, working_base: REVISION_R1 }
    ].each do |scenario|
      model = BindingModel.new
      mb::Store.new(model).write!(mb::Binding.new(project_id: PROJECT_ID, design_id: OTHER_DESIGN_ID,
                                                  base_revision_id: REVISION_R2, schema_version: 1))
      transport = FakeTransport.new
      transport.respond_post_sequence('/design-pairing-grants:exchange', [
        [200, exchange_payload(**scenario, grant_id: GRANT_ID)],
        [200, exchange_payload(**scenario, grant_id: FRESH_GRANT_ID)]
      ])
      transport.respond_post("/design-pairing-grants/#{FRESH_GRANT_ID}:confirm", 200,
                             { 'id' => FRESH_GRANT_ID, 'action' => 'open_design', 'status' => 'confirmed' })
      transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate", 200,
                             status_payload(base: scenario[:working_base]))
      conn = connector(model, transport)

      recovered = conn.connect_with_code(CODE)
      refute recovered['ok']
      assert_equal 'pairing_rebind_requires_new_code', recovered['code']
      refute transport.requests.any? { |r| r['path'].include?(':confirm') },
             'the consumed collision grant must stay unconfirmed'

      manual = conn.bind(project_id: PROJECT_ID, design_id: DESIGN_ID, confirm_rebind: true)
      assert manual['ok'], manual.inspect
      assert_equal scenario[:working_base], mb::Store.new(model).read.base_revision_id,
                   'manual rebind remains an explicit independent workflow'

      fresh = conn.connect_with_code(FRESH_CODE)
      assert fresh['ok'], fresh.inspect
      stored = mb::Store.new(model).read
      if scenario[:pinned].nil?
        assert_nil stored.base_revision_id, 'the fresh pairing must preserve an explicit null pin'
      else
        assert_equal scenario[:pinned], stored.base_revision_id,
                     'the fresh pairing must restore its exact pin'
      end
      confirmation = transport.requests.find do |request|
        request['path'] == "/design-pairing-grants/#{FRESH_GRANT_ID}:confirm"
      end
      refute_nil confirmation
      if scenario[:pinned].nil?
        assert_nil confirmation['body']['base_revision_id']
      else
        assert_equal scenario[:pinned], confirmation['body']['base_revision_id']
      end
    end
  end

  # --- manual flow regression -------------------------------------------------

  def test_manual_bind_still_writes_the_authoritative_working_base
    model = BindingModel.new
    transport = FakeTransport.new
    stub_pairing_backend(transport)
    transport.respond_post("/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate", 200,
                           status_payload(base: REVISION_R2, number: 2))

    result = connector(model, transport).bind(project_id: PROJECT_ID, design_id: DESIGN_ID)

    assert result['ok'], result.inspect
    stored = mb::Store.new(model).read
    assert_equal PROJECT_ID, stored.project_id
    assert_equal REVISION_R2, stored.base_revision_id,
                 'the manual flow keeps writing the authoritative working base'
    confirm = transport.requests.find { |r| r['path'].include?(':confirm') }
    assert_nil confirm, 'manual binds never touch the pairing confirm endpoint'
  end
end
