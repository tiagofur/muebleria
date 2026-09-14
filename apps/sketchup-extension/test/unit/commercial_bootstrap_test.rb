# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/project_bootstrap'
require_relative '../../src/granete_for_sketchup/connection/initial_quote'

class CommercialBootstrapTest < Minitest::Test
  PB = Granete::SketchUpExtension::Connection::ProjectBootstrap
  IQ = Granete::SketchUpExtension::Connection::InitialQuote
  PROJECT_ID = '71000000-0000-0000-0000-000000000718'
  DESIGN_ID = '72000000-0000-0000-0000-000000000718'
  CUSTOMER_ID = '70000000-0000-0000-0000-000000000718'

  class Auth
    def configured? = true
    def authorization_header = 'Bearer sketchup-device'
  end

  class Transport
    attr_reader :requests

    def initialize(responses)
      @responses = responses
      @requests = []
    end

    def request(payload)
      @requests << payload
      @responses.shift
    end
  end

  class Model
    def initialize = @attributes = {}
    def get_attribute(dict, key) = @attributes[[dict, key]]
    def set_attribute(dict, key, value) = @attributes[[dict, key]] = value
    def delete_attribute(dict, key) = @attributes.delete([dict, key])
  end

  class Connector
    attr_reader :binds

    def initialize
      @connected = false
      @binds = []
    end

    def status
      return { 'state' => 'unbound' } unless @connected

      { 'state' => 'connected', 'binding' => { 'projectId' => PROJECT_ID, 'designId' => DESIGN_ID } }
    end

    def bind(project_id:, design_id:)
      @binds << [project_id, design_id]
      @connected = true
      { 'ok' => true, 'status' => status }
    end
  end

  class FlakyBootstrapService
    attr_reader :keys

    def initialize
      @calls = 0
      @keys = []
    end

    def create(_request, key)
      @keys << key
      @calls += 1
      raise PB::Service::Error.new(:unreachable, 'lost') if @calls == 1

      { 'customer' => { 'id' => CUSTOMER_ID, 'name' => 'Ana' },
        'binding' => Struct.new(:project, :design).new({ 'id' => PROJECT_ID }, { 'id' => DESIGN_ID }) }
    end
  end

  class FlakyQuoteService
    attr_reader :keys

    def initialize
      @calls = 0
      @keys = []
    end

    def create(**args)
      @keys << args[:idempotency_key]
      @calls += 1
      raise IQ::Service::Error.new(:unreachable, 'lost') if @calls == 1

      { 'id' => CUSTOMER_ID, 'projectId' => PROJECT_ID, 'revisionNumber' => 1,
        'status' => 'draft', 'commercialSnapshot' => {} }
    end
  end

  class SuccessfulBootstrapService
    attr_reader :keys
    attr_accessor :on_create

    def initialize = @keys = []

    def create(_request, key)
      @keys << key
      @on_create&.call
      { 'customer' => { 'id' => CUSTOMER_ID, 'name' => 'Ana' },
        'binding' => Struct.new(:project, :design).new({ 'id' => PROJECT_ID }, { 'id' => DESIGN_ID }) }
    end
  end

  class FlakyConnector < Connector
    def bind(project_id:, design_id:)
      @attempts ||= 0
      @attempts += 1
      return { 'ok' => false, 'code' => 'bind_failed' } if @attempts == 1

      super
    end
  end

  class PartialConnector < Connector
    def bind(project_id:, design_id:)
      result = super
      @attempts ||= 0
      @attempts += 1
      return { 'ok' => false, 'code' => 'bind_readback_failed' } if @attempts == 1

      result
    end
  end

  def binding_payload
    {
      'state' => 'valid', 'schema_version' => 1,
      'organization' => { 'id' => CUSTOMER_ID, 'name' => 'Taller' },
      'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina',
                     'customer' => { 'id' => CUSTOMER_ID, 'name' => 'Ana' } },
      'design' => { 'id' => DESIGN_ID, 'name' => 'Principal', 'status' => 'active' },
      'working_copy' => { 'base_revision_id' => nil, 'base_revision_number' => nil,
                          'updated_at' => '2026-09-13T12:00:00Z' },
      'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
    }
  end

  def test_bootstrap_service_uses_only_bounded_routes_and_idempotency
    transport = Transport.new([
                                { 'status' => 200, 'body' => [{ 'id' => CUSTOMER_ID, 'name' => 'Ana' }] },
                                { 'status' => 201, 'body' => { 'customer' => { 'id' => CUSTOMER_ID, 'name' => 'Ana' },
                                                               'binding' => binding_payload } }
                              ])
    service = PB::Service.new(transport: transport, auth_provider: Auth.new)
    assert_equal CUSTOMER_ID, service.customers.first['id']
    service.create({ 'projectName' => 'Cocina', 'designName' => 'Principal',
                     'existingCustomerId' => CUSTOMER_ID }, 'bootstrap-key')

    paths = transport.requests.map { |request| request['path'] }
    assert_equal %w[/customers/summaries /projects:bootstrap-design], paths
    assert_equal 'bootstrap-key', transport.requests.last.dig('headers', 'Idempotency-Key')
    refute transport.requests.last['body'].key?('projectId')
  end

  def test_bootstrap_persists_technical_intent_before_request_and_reuses_it_after_failure
    model = Model.new
    service = FlakyBootstrapService.new
    connector = Connector.new
    coordinator = PB::Coordinator.new(model_provider: -> { model }, service: service, connector: connector)
    payload = { 'projectName' => 'Cocina Ana', 'designName' => 'Principal',
                'customerMode' => 'new', 'customerName' => 'Ana' }

    refute coordinator.create(payload)['ok']
    raw = model.get_attribute('com.granete.project', PB::Coordinator::INTENT_KEY)
    refute_includes raw, 'Cocina'
    refute_includes raw, 'Ana'
    assert coordinator.create(payload)['ok']
    assert_equal 1, service.keys.uniq.length
    assert_empty model.get_attribute('com.granete.project', PB::Coordinator::INTENT_KEY)
    assert_equal [[PROJECT_ID, DESIGN_ID]], connector.binds
  end

  def test_initial_quote_service_sends_exact_tokens_to_design_q1_route
    quote = { 'id' => CUSTOMER_ID, 'projectId' => PROJECT_ID, 'revisionNumber' => 1,
              'status' => 'draft', 'sourceType' => 'manual',
              'commercialSnapshot' => {
                'currency' => 'MXN', 'breakdown' => { 'salePrice' => 125.0 },
                'designSource' => { 'designId' => DESIGN_ID, 'workingVersion' => 'working-1',
                                    'workingFingerprint' => "sha256-#{'a' * 64}" }
              } }
    transport = Transport.new([{ 'status' => 201, 'body' => quote }])
    service = IQ::Service.new(transport: transport, auth_provider: Auth.new)
    result = service.create(project_id: PROJECT_ID, design_id: DESIGN_ID,
                            working_version: 'working-1', working_fingerprint: "sha256-#{'a' * 64}",
                            idempotency_key: 'q1-key')
    assert_equal 1, result['revisionNumber']
    request = transport.requests.first
    assert_equal "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/quote-revisions", request['path']
    assert_equal({ 'workingVersion' => 'working-1', 'workingFingerprint' => "sha256-#{'a' * 64}" }, request['body'])
    assert_equal 'q1-key', request.dig('headers', 'Idempotency-Key')
  end

  def test_bootstrap_replays_same_server_intent_after_local_binding_failure
    model = Model.new
    service = SuccessfulBootstrapService.new
    coordinator = PB::Coordinator.new(model_provider: -> { model }, service: service, connector: FlakyConnector.new)
    payload = { 'projectName' => 'Cocina Ana', 'designName' => 'Principal',
                'customerMode' => 'new', 'customerName' => 'Ana' }

    refute coordinator.create(payload)['ok']
    assert coordinator.create(payload)['ok']
    assert_equal 1, service.keys.uniq.length
  end

  def test_initial_quote_service_rejects_response_for_another_working_copy
    quote = { 'id' => CUSTOMER_ID, 'projectId' => PROJECT_ID, 'revisionNumber' => 1,
              'status' => 'draft', 'sourceType' => 'manual',
              'commercialSnapshot' => { 'designSource' => {
                'designId' => DESIGN_ID, 'workingVersion' => 'working-2',
                'workingFingerprint' => "sha256-#{'b' * 64}"
              } } }
    service = IQ::Service.new(transport: Transport.new([{ 'status' => 201, 'body' => quote }]),
                              auth_provider: Auth.new)

    error = assert_raises(IQ::Service::Error) do
      service.create(project_id: PROJECT_ID, design_id: DESIGN_ID, working_version: 'working-1',
                     working_fingerprint: "sha256-#{'a' * 64}", idempotency_key: 'q1-key')
    end
    assert_equal :incompatible, error.kind
  end

  def test_bootstrap_late_response_cannot_bind_a_different_active_model
    original = Model.new
    other = Model.new
    active = original
    service = SuccessfulBootstrapService.new
    service.on_create = -> { active = other }
    connector = Connector.new
    coordinator = PB::Coordinator.new(model_provider: -> { active }, service: service, connector: connector)
    payload = { 'projectName' => 'Cocina Ana', 'designName' => 'Principal',
                'customerMode' => 'new', 'customerName' => 'Ana' }

    result = coordinator.create(payload)
    refute result['ok']
    assert_equal 'context_changed', result['code']
    assert_empty connector.binds
    refute_nil original.get_attribute('com.granete.project', PB::Coordinator::INTENT_KEY)
  end

  def test_bootstrap_recovers_persisted_binding_with_same_server_key
    model = Model.new
    service = SuccessfulBootstrapService.new
    connector = PartialConnector.new
    coordinator = PB::Coordinator.new(model_provider: -> { model }, service: service, connector: connector)
    payload = { 'projectName' => 'Cocina Ana', 'designName' => 'Principal',
                'customerMode' => 'new', 'customerName' => 'Ana' }

    refute coordinator.create(payload)['ok']
    assert coordinator.create(payload)['ok']
    assert_equal 1, service.keys.uniq.length
    assert_empty model.get_attribute('com.granete.project', PB::Coordinator::INTENT_KEY)
  end

  def test_initial_quote_retry_reuses_model_persisted_technical_key
    model = Model.new
    service = FlakyQuoteService.new
    coordinator = IQ::Coordinator.new(model_provider: -> { model }, service: service)
    args = { project_id: PROJECT_ID, design_id: DESIGN_ID,
             working_version: 'working-1', working_fingerprint: "sha256-#{'a' * 64}" }

    assert_raises(IQ::Service::Error) { coordinator.create(**args) }
    raw = model.get_attribute('com.granete.project', IQ::Coordinator::INTENT_KEY)
    refute_includes raw, PROJECT_ID
    refute_includes raw, DESIGN_ID
    assert_equal 1, coordinator.create(**args)['revisionNumber']
    assert_equal 1, service.keys.uniq.length
    assert_empty model.get_attribute('com.granete.project', IQ::Coordinator::INTENT_KEY)
  end
end
