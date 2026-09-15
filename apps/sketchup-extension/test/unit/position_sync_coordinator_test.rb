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
require_relative '../../src/granete_for_sketchup/connection/panel_state'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/host/command_contract'
require_relative '../../src/granete_for_sketchup/host/position_sync_observer'
require_relative '../../src/granete_for_sketchup/connection/position_sync_coordinator'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'

PF = Granete::SketchUpExtension::Connection::ProjectFurniture
MB = Granete::SketchUpExtension::Connection::ModelBinding
MS = Granete::SketchUpExtension::Metadata::Store
CONNECTION = Granete::SketchUpExtension::Connection
UIDialogController = Granete::SketchUpExtension::UserInterface::DialogController

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
  FI_2 = '51000000-0000-0000-0000-0000000000f2'
  FI_3 = '51000000-0000-0000-0000-0000000000f3'
  FI_4 = '51000000-0000-0000-0000-0000000000f4'
  FI_5 = '51000000-0000-0000-0000-0000000000f5'

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
    SketchupStub.active_model = @model if defined?(SketchupStub)
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

  def teardown
    SketchupStub.active_model = nil if defined?(SketchupStub)
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

  def test_regression_1_network_failure_after_move_refreshes_dialog_to_pending_confirmation
    entity = create_managed_root(FI_1)
    binding = MB::Store.new(@model).read

    # Initially converged and present_synced
    @coordinator.converge_inserted_unit(@model, binding, FI_1)
    stub_working_copy([
                        { 'furniture_instance_id' => FI_1,
                          'furniture_definition_id' => DEFINITION_ID,
                          'parameters' => {}, 'material_choices' => {},
                          'transform' => { 'translation_mm' => [0.0, 0.0, 0.0],
                                           'rotation_deg' => [0.0, 0.0, 0.0] } }
                      ])

    panel_initial = @reconciliation.projection
    assert panel_initial['clean']
    assert_equal 'present_synced', panel_initial['items'].first['reconciliationState']

    rec = @reconciliation
    fake_placer = Object.new
    fake_placer.define_singleton_method(:panel) do
      PF::PanelState.build_panel_payload(reconciliation: rec, catalog_provider: nil)
    end

    controller = UIDialogController.new(
      logger: @logger,
      status_provider: Object.new,
      project_furniture_placer: fake_placer,
      position_sync_coordinator: @coordinator
    )
    dialog = controller.show
    dialog.executed_scripts.clear

    outcomes = []
    success_events = []
    original_outcome_handler = @coordinator.on_sync_outcome
    @coordinator.on_sync_outcome = lambda do |outcome|
      outcomes << outcome
      original_outcome_handler&.call(outcome)
    end
    @coordinator.on_sync_complete = ->(event, ids) { success_events << [event, ids] }

    # User changes local transform
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(500.0 / 25.4, 0, 0))

    # Transport returns 503 on PUT
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 503,
                       { 'error' => { 'message' => 'Service Unavailable' } })

    # onTransactionCommit triggers sync
    @coordinator.on_transaction_commit(@model)

    # Invariants:
    # 1. No known_transform advance
    known_for_model = @coordinator.known_transforms[@model] || {}
    refute_equal [500.0, 0.0, 0.0], known_for_model[FI_1]&.dig('translation_mm')

    # 2. No success callback
    assert_empty success_events

    # 3. Failure outcome callback emitted for same context
    assert_equal 1, outcomes.length
    assert_equal :move, outcomes.first[:event]
    assert_equal [FI_1], outcomes.first[:ids]
    assert_equal :failed, outcomes.first[:status]

    # 4. DialogController refreshed Project Furniture
    project_furniture_scripts = dialog.executed_scripts.select { |s| s.include?('onProjectFurniture') }
    refute_empty project_furniture_scripts
    payload = JSON.parse(project_furniture_scripts.last[/onProjectFurniture\((.*)\)\z/, 1])

    # 5. HostReconciliation reports pending_confirmation, panel clean == false, row is NOT present_synced
    refute payload['clean']
    row = payload['items'].find { |i| i['id'] == FI_1 }
    assert_equal 'pending_confirmation', row['reconciliationState']
    refute row['placed']
    assert row['pendingConfirm'] # UI action is “Reintentar sincronización”
  end

  def test_regression_2_readback_mismatch_after_move_refreshes_dialog_to_pending_confirmation
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

    rec = @reconciliation
    fake_placer = Object.new
    fake_placer.define_singleton_method(:panel) do
      PF::PanelState.build_panel_payload(reconciliation: rec, catalog_provider: nil)
    end

    controller = UIDialogController.new(
      logger: @logger,
      status_provider: Object.new,
      project_furniture_placer: fake_placer,
      position_sync_coordinator: @coordinator
    )
    dialog = controller.show
    dialog.executed_scripts.clear

    outcomes = []
    success_events = []
    original_outcome_handler = @coordinator.on_sync_outcome
    @coordinator.on_sync_outcome = lambda do |outcome|
      outcomes << outcome
      original_outcome_handler&.call(outcome)
    end
    @coordinator.on_sync_complete = ->(event, ids) { success_events << [event, ids] }

    # User moves entity to 500mm
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(500.0 / 25.4, 0, 0))

    # Server returns 200 OK, but returned transform is 9999mm (mismatch)
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

    @coordinator.on_transaction_commit(@model)

    # Invariant: NO known_transform advance to 500mm
    known_for_model = @coordinator.known_transforms[@model] || {}
    refute_equal [500.0, 0.0, 0.0], known_for_model[FI_1]&.dig('translation_mm')

    # Invariant: NO success callback
    assert_empty success_events

    # Invariant: failure outcome emitted
    assert_equal 1, outcomes.length
    assert_equal :failed, outcomes.first[:status]
    assert_equal :readback_mismatch, outcomes.first[:code]

    # Invariant: DialogController refreshed Project Furniture
    project_furniture_scripts = dialog.executed_scripts.select { |s| s.include?('onProjectFurniture') }
    refute_empty project_furniture_scripts
    payload = JSON.parse(project_furniture_scripts.last[/onProjectFurniture\((.*)\)\z/, 1])

    # Invariant: HostReconciliation reports pending_confirmation & retry action visible
    refute payload['clean']
    row = payload['items'].find { |i| i['id'] == FI_1 }
    assert_equal 'pending_confirmation', row['reconciliationState']
    assert row['pendingConfirm']
  end

  def test_regression_3_context_switch_during_move_failure_does_not_pollute_new_model
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

    model_b = CoordModel.new
    write_binding(model_b, project_id: '41000000-0000-0000-0000-000000000002',
                           design_id: '52000000-0000-0000-0000-000000000002',
                           base_revision_id: '53000000-0000-0000-0000-000000000002')

    dialog_b_refreshes = []
    fake_placer_b = Object.new
    fake_placer_b.define_singleton_method(:panel) do
      dialog_b_refreshes << true
      { 'clean' => true, 'items' => [] }
    end

    controller_b = UIDialogController.new(
      logger: @logger,
      status_provider: Object.new,
      project_furniture_placer: fake_placer_b,
      position_sync_coordinator: @coordinator
    )
    dialog_b = controller_b.show
    dialog_b.executed_scripts.clear

    # Move entity in model A
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(500.0 / 25.4, 0, 0))

    # Before result arrives: active model switches to B and PUT returns 503
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 503,
                       { 'error' => { 'message' => '503 Unavailable' } })
    @transport.before_request = lambda do |method, path|
      if method == 'PUT' && path =~ %r{/working-copy}
        @current_model = model_b
        SketchupStub.active_model = model_b
      end
    end

    @coordinator.sync_moved_entities(@model)

    # Invariant: NO refresh of model B's dialog
    assert_empty dialog_b_refreshes
    project_furniture_scripts = dialog_b.executed_scripts.select { |s| s.include?('onProjectFurniture') }
    assert_empty project_furniture_scripts

    # Invariant: NO known_transform advance for model B
    known_b = @coordinator.known_transforms[model_b] || {}
    assert_empty known_b
  end

  def test_regression_4_base_mismatch_insert_fails_closed
    create_managed_root(FI_1)
    binding = MB::Store.new(@model).read

    # PUT returns base = R2 (different from binding base R1)
    mismatched_base_body = {
      'design_id' => DESIGN_ID,
      'project_id' => PROJECT_ID,
      'base_revision_id' => '53000000-0000-0000-0000-000000000002',
      'items' => [
        {
          'furniture_instance_id' => FI_1,
          'furniture_definition_id' => DEFINITION_ID,
          'parameters' => {},
          'material_choices' => {},
          'transform' => { 'translation_mm' => [0.0, 0.0, 0.0],
                           'rotation_deg' => [0.0, 0.0, 0.0] }
        }
      ]
    }
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 200, mismatched_base_body)

    events = []
    outcomes = []
    @coordinator.on_sync_complete = ->(event, ids) { events << [event, ids] }
    @coordinator.on_sync_outcome = ->(outcome) { outcomes << outcome }
    preflight_runs_before = @preflight_session.runs.length

    result = @coordinator.converge_inserted_unit(@model, binding, FI_1)

    # Invariant: fails closed with base_revision_mismatch
    refute result['ok']
    assert_equal 'base_revision_mismatch', result['code']

    # Invariant: NO known_transform advance
    known_for_model = @coordinator.known_transforms[@model] || {}
    assert_nil known_for_model[FI_1]

    # Invariant: NO initial preflight run
    assert_equal preflight_runs_before, @preflight_session.runs.length

    # Invariant: NO success callback
    assert_empty events

    # Invariant: failure outcome emitted
    assert_equal 1, outcomes.length
    assert_equal :failed, outcomes.first[:status]
    assert_equal :base_revision_mismatch, outcomes.first[:code]
  end

  def test_regression_5_base_mismatch_move_fails_closed
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

    # PUT returns base = R2
    mismatched_base_body = {
      'design_id' => DESIGN_ID,
      'project_id' => PROJECT_ID,
      'base_revision_id' => '53000000-0000-0000-0000-000000000002',
      'items' => [
        {
          'furniture_instance_id' => FI_1,
          'furniture_definition_id' => DEFINITION_ID,
          'parameters' => {},
          'material_choices' => {},
          'transform' => { 'translation_mm' => [500.0, 0.0, 0.0],
                           'rotation_deg' => [0.0, 0.0, 0.0] }
        }
      ]
    }
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 200, mismatched_base_body)

    events = []
    outcomes = []
    @coordinator.on_sync_complete = ->(event, ids) { events << [event, ids] }
    @coordinator.on_sync_outcome = ->(outcome) { outcomes << outcome }

    @coordinator.on_transaction_commit(@model)

    # Invariant: NO known_transform advance
    known_for_model = @coordinator.known_transforms[@model] || {}
    refute_equal [500.0, 0.0, 0.0], known_for_model[FI_1]&.dig('translation_mm')

    # Invariant: NO success callback
    assert_empty events

    # Invariant: failure outcome with base_revision_mismatch
    assert_equal 1, outcomes.length
    assert_equal :failed, outcomes.first[:status]
    assert_equal :base_revision_mismatch, outcomes.first[:code]

    # Invariant: reconciliation remains pending
    stub_working_copy([
                        { 'furniture_instance_id' => FI_1,
                          'furniture_definition_id' => DEFINITION_ID,
                          'parameters' => {}, 'material_choices' => {},
                          'transform' => { 'translation_mm' => [0.0, 0.0, 0.0],
                                           'rotation_deg' => [0.0, 0.0, 0.0] } }
                      ])
    panel = @reconciliation.projection
    refute panel['clean']
    row = panel['items'].find { |i| i['id'] == FI_1 }
    assert_equal 'pending_confirmation', row['reconciliationState']
  end

  # ------------------------------------------------------------------
  # #731 PR2 — design-wide convergence of pending_confirmation units.
  # ------------------------------------------------------------------

  def test_converge_pending_coalesces_all_units_into_one_get_and_one_put
    ids = [FI_1, FI_2, FI_3, FI_4, FI_5]
    ids.each { |id| create_managed_root(id) }
    binding = MB::Store.new(@model).read

    result = @coordinator.converge_pending(@model, binding, ids)

    assert result['ok'], result.inspect
    assert_equal 'converged', result['code']
    assert_equal ids.sort, result['synced'].sort
    assert_empty result['failed']
    # ONE authoritative working copy transaction, never N GET+PUT rounds.
    assert_equal 1, @transport.requests_for('GET', %r{/working-copy}).length
    assert_equal 1, @transport.requests_for('PUT', %r{/working-copy}).length
    put_items = @transport.requests_for('PUT', %r{/working-copy}).first['body']['items']
    assert_equal 5, put_items.length
    # No per-unit preflight: the design-wide batch that follows owns it.
    assert_empty @preflight_session.runs
  end

  def test_converge_pending_reports_readback_mismatch_without_advancing_known_state
    create_managed_root(FI_1)
    binding = MB::Store.new(@model).read
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 200,
                       { 'project_id' => PROJECT_ID, 'design_id' => DESIGN_ID,
                         'base_revision_id' => REVISION_R1,
                         'items' => [
                           { 'furniture_instance_id' => FI_1,
                             'parameters' => {}, 'material_choices' => {},
                             'transform' => { 'translation_mm' => [999_999.0, 0.0, 0.0],
                                              'rotation_deg' => [0.0, 0.0, 0.0] } }
                         ] })

    result = @coordinator.converge_pending(@model, binding, [FI_1])

    refute result['ok']
    assert_equal 'readback_mismatch', result['code']
    assert_equal({ FI_1 => 'readback_mismatch' }, result['failed'])
    assert_empty result['synced']
    assert_nil @coordinator.known_transforms[@model][FI_1],
               'a mismatching readback must not advance the known state'
  end

  def test_converge_pending_aborts_without_put_when_context_changes
    create_managed_root(FI_1)
    binding = MB::Store.new(@model).read
    @transport.before_request = lambda do |method, path|
      @current_model = Object.new if method == 'GET' && path =~ %r{/working-copy}
    end

    result = @coordinator.converge_pending(@model, binding, [FI_1])

    refute result['ok']
    assert_equal 'context_changed', result['code']
    assert_empty @transport.requests_for('PUT', %r{/working-copy}),
                 'a context switch before the PUT must leave the server untouched'
  ensure
    @transport.before_request = nil
  end

  def test_converge_pending_requires_a_binding
    create_managed_root(FI_1)

    result = @coordinator.converge_pending(@model, nil, [FI_1])

    refute result['ok']
    assert_equal 'unbound_model', result['code']
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
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
