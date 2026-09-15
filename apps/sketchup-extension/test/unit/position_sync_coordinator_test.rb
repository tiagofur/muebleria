# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/host_reconciliation'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/host/command_contract'
require_relative '../../src/granete_for_sketchup/host/position_sync_observer'
require_relative '../../src/granete_for_sketchup/connection/position_sync_coordinator'

PF = Granete::SketchUpExtension::Connection::ProjectFurniture
MB = Granete::SketchUpExtension::Connection::ModelBinding
MS = Granete::SketchUpExtension::Metadata::Store
CONNECTION = Granete::SketchUpExtension::Connection

class NullLogger
  def info(*); end
  def warn(*); end
  def error(*); end
end

class PositionSyncCoordinatorTest < Minitest::Test
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'
  FI_1 = '51000000-0000-0000-0000-0000000000f1'

  class CoordModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-token'
    end
  end

  class FakeTransport
    attr_reader :requests
    attr_accessor :before_request

    def initialize
      @requests = []
      @routes = {}
      @before_request = nil
    end

    def configure?
      true
    end

    def respond(method, path, status, body)
      @routes[[method.to_s.upcase, path]] = { 'status' => status, 'body' => body }
    end

    def request(payload, authorization_header: nil)
      _ = authorization_header
      method = payload['method'].to_s.upcase
      path = payload['path']
      @before_request&.call(method, path)
      @requests << { 'method' => method, 'path' => path, 'body' => payload['body'], 'headers' => payload['headers'] }
      route = @routes[[method, path]]
      if method == 'PUT' && path =~ %r{/working-copy}
        return route if route && route['status'] != 200

        body = (route ? route['body'] : nil) || payload['body'] || {}
        body = body.dup
        body['project_id'] ||= PROJECT_ID
        body['design_id'] ||= DESIGN_ID
        body['base_revision_id'] ||= REVISION_R1
        body['items'] ||= []
        @routes[['GET', path]] = { 'status' => 200, 'body' => body }
        return { 'status' => 200, 'body' => body }
      end
      return route if route

      { 'status' => 404, 'body' => { 'error' => { 'code' => 'not_found' } } }
    end

    def requests_for(method, path_regex)
      @requests.select { |r| r['method'] == method.to_s.upcase && r['path'] =~ path_regex }
    end
  end

  class FakePreflightSession
    attr_reader :runs

    def initialize
      @runs = []
    end

    def run(scope, message_id:)
      @runs << { scope: scope, message_id: message_id }
    end
  end

  def setup
    @model = CoordModel.new
    @current_model = @model
    @transport = FakeTransport.new
    @auth = FakeAuth.new
    @logger = NullLogger.new
    @service = PF::Service.new(transport: @transport, auth_provider: @auth, logger: @logger)

    write_binding(@model)
    stub_project_furniture([
                             {
                               'id' => FI_1,
                               'project_id' => PROJECT_ID,
                               'furniture_definition_id' => DEFINITION_ID,
                               'lifecycle_status' => 'active',
                               'origin' => 'design',
                               'display_name' => 'Módulo 1'
                             }
                           ])
    stub_working_copy([])

    @reconciliation = PF::HostReconciliation.new(
      model_provider: -> { @current_model },
      binding_store_factory: ->(m) { MB::Store.new(m) },
      service: @service,
      metadata_store_factory: ->(m) { MS.new(m) },
      logger: @logger
    )

    @preflight_session = FakePreflightSession.new
    @coordinator = CONNECTION::PositionSyncCoordinator.new(
      model_provider: -> { @current_model },
      binding_store_factory: ->(m) { MB::Store.new(m) },
      service: @service,
      metadata_store_factory: ->(m) { MS.new(m) },
      host_reconciliation: @reconciliation,
      preflight_session: @preflight_session,
      logger: @logger
    )
    @coordinator.rebind(@model)
  end

  def test_converge_inserted_unit_syncs_and_runs_initial_preflight
    _entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read

    result = @coordinator.converge_inserted_unit(@model, binding, FI_1)

    assert result['ok']
    assert_equal 'placed', result['code']
    assert_equal FI_1, result['instanceId']

    # Working copy received the PUT request
    puts = @transport.requests_for('PUT', %r{/working-copy})
    assert_equal 1, puts.length
    assert_equal FI_1, puts.first['body']['items'].first['furniture_instance_id']

    # Preflight was triggered automatically (R1)
    assert_equal 1, @preflight_session.runs.length
    assert_equal FI_1, @preflight_session.runs.first[:scope]['furnitureInstanceId']

    # Reconciliation is now present_synced
    panel = @reconciliation.projection
    assert panel['clean']
    row = panel['items'].find { |i| i['id'] == FI_1 }
    assert_equal 'present_synced', row['reconciliationState']
  end

  def test_converge_inserted_unit_handles_network_failure_without_rollback
    create_managed_root(FI_1)
    binding = MB::Store.new(@model).read

    # Configure transport to fail on PUT
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 503,
                       { 'error' => { 'message' => 'Service Unavailable' } })

    result = @coordinator.converge_inserted_unit(@model, binding, FI_1)

    refute result['ok']
    assert_equal 'sync_failed', result['code']

    # Invariant (Caso 4): the entity is NOT rolled back or destroyed
    refute_empty @model.entities.to_a
    refute_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']

    # Host reconciliation reflects pending_confirmation
    panel = @reconciliation.projection
    refute panel['clean']
    row = panel['items'].find { |i| i['id'] == FI_1 }
    assert_equal 'pending_confirmation', row['reconciliationState']
  end

  def test_on_transaction_commit_syncs_moved_entity_without_preflight_invalidation
    entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read

    # First, converge initial placement
    @coordinator.converge_inserted_unit(@model, binding, FI_1)
    assert_equal 1, @transport.requests_for('PUT', %r{/working-copy}).length
    assert_equal 1, @preflight_session.runs.length

    # Update working copy stub to reflect converged state
    stub_working_copy([
                        { 'furniture_instance_id' => FI_1,
                          'furniture_definition_id' => DEFINITION_ID,
                          'parameters' => {}, 'material_choices' => {},
                          'transform' => { 'translation_mm' => [0.0, 0.0, 0.0],
                                           'rotation_deg' => [0.0, 0.0, 0.0] } }
                      ])

    # Move entity 500mm along X
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(500.0 / 25.4, 0, 0))

    events = []
    @coordinator.on_sync_complete = ->(event, ids) { events << [event, ids] }

    # Native SketchUp transaction commit
    @coordinator.on_transaction_commit(@model)

    # Should have sent a new PUT to working copy
    puts = @transport.requests_for('PUT', %r{/working-copy})
    assert_equal 2, puts.length

    # Top-level move updates WorkingCopy but does NOT re-trigger fabrication preflight (R3)
    assert_equal 1, @preflight_session.runs.length

    # Event notified
    assert_equal 1, events.length
    assert_equal :move, events.first[0]
    assert_equal [FI_1], events.first[1]
  end

  def test_on_transaction_undo_and_redo_sync_restored_transform
    entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read
    @coordinator.converge_inserted_unit(@model, binding, FI_1)

    # User undoes a move: transform reverts to origin
    entity.transformation = Geom::Transformation.new
    @coordinator.on_transaction_undo(@model)

    # User redoes a move: transform changes again
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(200.0 / 25.4, 0, 0))
    @coordinator.on_transaction_redo(@model)

    puts = @transport.requests_for('PUT', %r{/working-copy})
    assert_operator puts.length, :>=, 2
  end

  def test_rapid_transactions_coalesce
    timers = {}
    next_timer_id = 1
    UI.define_singleton_method(:start_timer) do |_delay, _repeats, &block|
      id = (next_timer_id += 1)
      timers[id] = block
      id
    end
    UI.define_singleton_method(:stop_timer) do |id|
      timers.delete(id)
    end

    entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read
    @coordinator.converge_inserted_unit(@model, binding, FI_1)

    stub_working_copy([
                        { 'furniture_instance_id' => FI_1,
                          'furniture_definition_id' => DEFINITION_ID,
                          'parameters' => {}, 'material_choices' => {},
                          'transform' => { 'translation_mm' => [0.0, 0.0, 0.0],
                                           'rotation_deg' => [0.0, 0.0, 0.0] } }
                      ])

    initial_puts = @transport.requests_for('PUT', %r{/working-copy}).length

    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(100.0 / 25.4, 0, 0))
    @coordinator.on_transaction_commit(@model)

    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(200.0 / 25.4, 0, 0))
    @coordinator.on_transaction_commit(@model)

    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(300.0 / 25.4, 0, 0))
    @coordinator.on_transaction_commit(@model)

    assert_equal 1, timers.length

    timers.values.first.call

    puts = @transport.requests_for('PUT', %r{/working-copy})
    assert_equal initial_puts + 1, puts.length
    last_transform = puts.last['body']['items'].first['transform']
    assert_in_delta 300.0, last_transform['translation_mm'][0], 0.01
  ensure
    UI.singleton_class.send(:remove_method, :start_timer) if UI.respond_to?(:start_timer)
    UI.singleton_class.send(:remove_method, :stop_timer) if UI.respond_to?(:stop_timer)
  end

  def test_suppress_prevents_internal_operations_from_triggering_sync
    entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read
    @coordinator.converge_inserted_unit(@model, binding, FI_1)

    initial_puts = @transport.requests_for('PUT', %r{/working-copy}).length

    @coordinator.suppress do
      entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(100.0 / 25.4, 0, 0))
      @coordinator.on_transaction_commit(@model)
    end

    # No sync triggered during suppressed block
    assert_equal initial_puts, @transport.requests_for('PUT', %r{/working-copy}).length
  end

  def test_inactive_model_discards_sync
    other_model = CoordModel.new
    @coordinator.on_transaction_commit(other_model)

    # Invariant (Caso 12): other model operations do not trigger PUT requests on current design
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_model_switch_during_working_copy_get_aborts_put
    entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read
    @coordinator.converge_inserted_unit(@model, binding, FI_1)

    stub_working_copy([
                        { 'furniture_instance_id' => FI_1,
                          'furniture_definition_id' => DEFINITION_ID,
                          'parameters' => {}, 'material_choices' => {},
                          'transform' => { 'translation_mm' => [0.0, 0.0, 0.0],
                                           'rotation_deg' => [0.0, 0.0, 0.0] } }
                      ])
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(500.0 / 25.4, 0, 0))

    initial_puts = @transport.requests_for('PUT', %r{/working-copy}).length

    # When GET /working-copy arrives, active model switches before PUT!
    other_model = CoordModel.new
    @transport.before_request = lambda do |method, path|
      @current_model = other_model if method == 'GET' && path =~ %r{/working-copy}
    end

    @coordinator.sync_moved_entities(@model)

    # Invariant: 0 PUT calls when model switched during GET
    new_puts = @transport.requests_for('PUT', %r{/working-copy}).length - initial_puts
    assert_equal 0, new_puts
  end

  def test_binding_switch_during_working_copy_get_aborts_put
    entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read
    @coordinator.converge_inserted_unit(@model, binding, FI_1)

    stub_working_copy([
                        { 'furniture_instance_id' => FI_1,
                          'furniture_definition_id' => DEFINITION_ID,
                          'parameters' => {}, 'material_choices' => {},
                          'transform' => { 'translation_mm' => [0.0, 0.0, 0.0],
                                           'rotation_deg' => [0.0, 0.0, 0.0] } }
                      ])
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(500.0 / 25.4, 0, 0))

    initial_puts = @transport.requests_for('PUT', %r{/working-copy}).length

    @transport.before_request = lambda do |method, path|
      if method == 'GET' && path =~ %r{/working-copy}
        write_binding(@model, project_id: '41000000-0000-0000-0000-000000000002')
      end
    end

    @coordinator.sync_moved_entities(@model)

    # Invariant: 0 PUT calls when binding switched during GET
    new_puts = @transport.requests_for('PUT', %r{/working-copy}).length - initial_puts
    assert_equal 0, new_puts
  end

  def test_model_switch_during_debounce_has_zero_side_effects
    timers = {}
    next_timer_id = 1
    UI.define_singleton_method(:start_timer) do |_delay, _repeats, &block|
      id = (next_timer_id += 1)
      timers[id] = block
      id
    end
    UI.define_singleton_method(:stop_timer) do |id|
      timers.delete(id)
    end

    entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read
    @coordinator.converge_inserted_unit(@model, binding, FI_1)

    initial_reqs = @transport.requests.length

    # Move entity
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(500.0 / 25.4, 0, 0))
    @coordinator.on_transaction_commit(@model)

    # Timer was scheduled
    assert_equal 1, timers.length

    # Switch active model before debounce timer runs
    other_model = CoordModel.new
    @current_model = other_model

    # Debounce runs on previous model, but model has switched
    timers.values.first.call

    # Invariant: 0 side effects (no new requests to server)
    new_reqs = @transport.requests.length - initial_reqs
    assert_equal 0, new_reqs
  ensure
    UI.singleton_class.send(:remove_method, :start_timer) if UI.respond_to?(:start_timer)
    UI.singleton_class.send(:remove_method, :stop_timer) if UI.respond_to?(:stop_timer)
  end

  def test_authoritative_put_readback_mismatch_fails_closed
    create_managed_root(FI_1)
    binding = MB::Store.new(@model).read

    # Server returns 200 OK for PUT, but with a mismatched transform (e.g. 9999mm)
    mismatched_body = {
      'design_id' => DESIGN_ID,
      'project_id' => PROJECT_ID,
      'base_revision_id' => REVISION_R1,
      'items' => [
        {
          'furniture_instance_id' => FI_1,
          'furniture_definition_id' => DEFINITION_ID,
          'parameters' => {},
          'material_choices' => {},
          'transform' => { 'translation_mm' => [9999.0, 9999.0, 9999.0],
                           'rotation_deg' => [0.0, 0.0, 0.0] }
        }
      ]
    }
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 200, mismatched_body)

    events = []
    @coordinator.on_sync_complete = ->(event, ids) { events << [event, ids] }

    result = @coordinator.converge_inserted_unit(@model, binding, FI_1)

    # Invariant: NO success, fails closed
    refute result['ok']
    assert_equal 'readback_mismatch', result['code']

    # Invariant: NO known-transform advance
    known_for_model = @coordinator.known_transforms[@model] || {}
    assert_nil known_for_model[FI_1]

    # Invariant: NO on_sync_complete callback
    assert_empty events

    # Invariant: reconciliation remains pending
    panel = @reconciliation.projection
    refute panel['clean']
    row = panel['items'].find { |i| i['id'] == FI_1 }
    assert_equal 'pending_confirmation', row['reconciliationState']
  end

  private

  def write_binding(model, project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: REVISION_R1)
    MB::Store.new(model).write!(
      MB::Binding.new(
        project_id: project_id,
        design_id: design_id,
        base_revision_id: base_revision_id
      )
    )
  end

  def stub_project_furniture(body)
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200, body)
  end

  def stub_working_copy(items)
    body = {
      'design_id' => DESIGN_ID,
      'project_id' => PROJECT_ID,
      'base_revision_id' => REVISION_R1,
      'items' => items
    }
    @transport.respond(:get, "/designs/#{DESIGN_ID}/working-copy", 200, body)
  end

  def create_managed_root(furniture_id)
    definition = @model.definitions.add("Managed #{furniture_id}")
    entity = @model.entities.add_instance(definition, Geom::Transformation.new)
    MS.new(@model).write(entity, {
                           'namespace' => 'com.granete.sketchup_extension',
                           'metadataVersion' => 1,
                           'kind' => 'furnitureInstance',
                           'identity' => { 'instanceRef' => furniture_id,
                                           'furnitureInstanceId' => furniture_id,
                                           'projectId' => PROJECT_ID,
                                           'designId' => DESIGN_ID },
                           'intent' => { 'furnitureDefinitionId' => DEFINITION_ID,
                                         'parameters' => {},
                                         'materialChoices' => {} }
                         })
    entity
  end
end
