# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/commercial_projection'
require_relative '../../src/granete_for_sketchup/library/authoring_resolve_contract'
require_relative '../../src/granete_for_sketchup/host/preflight_tracker'
require_relative '../../src/granete_for_sketchup/host/authoring_mutation_coordinator'
require_relative '../../src/granete_for_sketchup/host/publication_preflight_gate'
require_relative '../../src/granete_for_sketchup/host/preflight_review_copy'
require_relative '../../src/granete_for_sketchup/host/preflight_review'
require_relative '../../src/granete_for_sketchup/host/preflight_review_session'
require_relative '../../src/granete_for_sketchup/host/design_preflight_batch'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/overlay/issue_navigation'
require_relative '../../src/granete_for_sketchup/tools/internal_component_move_tool'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'

# #731 PR2 — the `Publicar diseño` orchestration end-to-end at the dialog
# controller seam: automatic convergence of pending positions, design-wide
# batch validation, FRESH gate evaluation before the publisher,
# single-flight behavior, mutation-during-batch staleness, exceptions-only
# projections and the CommercialProjection full-sync contract.
class DialogPublishWorkflowTest < Minitest::Test
  Host = Granete::SketchUpExtension::Host
  Library = Granete::SketchUpExtension::Library
  UIController = Granete::SketchUpExtension::UserInterface::DialogController

  FI_A = '51000000-0000-0000-0000-0000000000a1'
  FI_B = '51000000-0000-0000-0000-0000000000b2'
  FI_C = '51000000-0000-0000-0000-0000000000c3'
  FI_D = '51000000-0000-0000-0000-0000000000d4'
  FI_E = '51000000-0000-0000-0000-0000000000e5'
  PROJECT_ID = '41000000-0000-0000-0000-0000000000f1'
  DESIGN_ID = '52000000-0000-0000-0000-0000000000f1'
  BASE_ID = '53000000-0000-0000-0000-0000000000f1'

  class StatusProvider
    def call
      { 'state' => 'configured', 'heading' => 'Conexión configurada', 'message' => 'x' }
    end
  end

  # Serves ready (cleared scenario) or blocked (conflict scenario) resolves
  # in the caller-declared order — the per-furniture authoritative truth of
  # a run, furniture-agnostic like the server wire itself.
  class SequenceProvider < OverlayFixture::FakeCatalogProvider
    READY = '18-hardware-conflict-cleared'
    BLOCKED = '17-hardware-drilling-conflict'

    def initialize(outcomes)
      super()
      @outcomes = outcomes.dup
    end

    def resolve_authoring(request_payload)
      @requests << request_payload
      outcome = @outcomes.shift || :ready
      body = scenario_body(outcome == :ready ? READY : BLOCKED)
      body['responseMessageId'] = "resolve-#{request_payload['messageId']}"
      body['inReplyToMessageId'] = request_payload['messageId']
      body['idempotencyKey'] = request_payload['idempotencyKey']
      Library::AuthoringResolveContract.parse!(
        body, expected_request: { 'messageId' => request_payload['messageId'],
                                  'idempotencyKey' => request_payload['idempotencyKey'] }
      )
    end

    private

    def scenario_body(scenario_id)
      scenario = OverlayFixture.golden['scenarios'].find { |entry| entry['id'] == scenario_id }
      JSON.parse(JSON.generate(scenario['response']))
    end
  end

  # Controller with a CONTROLLABLE scheduler: the design workflow defers
  # to a queue the test drains tick by tick (the real host defers to the
  # UI event loop), so mid-batch mutations and double clicks are honest.
  class WorkflowController < UIController
    def deferred
      @deferred ||= []
    end

    def host_event_loop_defer(&block)
      deferred << block
    end

    def drain
      deferred.shift.call until deferred.empty?
    end
  end

  class MutableHost
    attr_accessor :projection_payload

    def projection(model: nil, binding: nil)
      _ = model
      _ = binding
      projection_payload
    end
  end

  class FakePositionSync
    attr_reader :converge_calls

    def initialize(on_converged: nil)
      @converge_calls = []
      @on_converged = on_converged
    end

    def converge_pending(model, binding, ids)
      @converge_calls << { model: model, binding: binding, ids: ids }
      @on_converged&.call
      { 'ok' => true, 'synced' => ids, 'failed' => {} }
    end

    def detach; end

    def rebind(_model); end

    def shutdown; end
  end

  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model = OverlayFixture.build_model
    [FI_A, FI_B, FI_C, FI_D].each { |id| place_furniture(id) }
    Granete::SketchUpExtension::Connection::ModelBinding::Store.new(@model).write!(
      Granete::SketchUpExtension::Connection::ModelBinding::Binding.new(
        project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: BASE_ID
      )
    )
  end

  def teardown
    @controller&.close
  end

  # Caso 1/5 del issue: 4 unverified present_synced → Publicar → batch →
  # 4 resolves → gate allowed → exactly one publish.
  def test_publish_auto_validates_the_whole_scope_and_publishes_once
    publisher = recording_publisher
    host = connected_host(%w[present_synced present_synced present_synced present_synced])
    controller = build_controller(%i[ready ready ready ready], publisher, host)

    controller.handle_publish_design_revision(controller_dialog(controller))
    controller.drain

    assert_equal 4, controller_scope_resolves(controller), 'one resolve per scope furniture'
    assert_equal [:publish], publisher.calls
    assert_equal true, publish_result(controller)['ok']
  end

  # Caso 2/10: F3 blocked → no publish → ONLY F3 in the exceptions.
  def test_publish_with_a_blocked_unit_shows_only_that_exception
    publisher = recording_publisher
    host = connected_host(%w[present_synced present_synced present_synced present_synced])
    controller = build_controller(%i[ready ready blocked ready], publisher, host)

    controller.handle_publish_design_revision(controller_dialog(controller))
    controller.drain

    assert_empty publisher.calls
    result = publish_result(controller)
    assert_equal 'preflight_incomplete', result['code']
    validation = result['validation']
    assert_equal 4, validation['total']
    assert_equal 3, validation['ready']
    assert_equal 1, validation['attention']
    assert_equal([FI_C], validation['exceptions'].map { |e| e['furnitureInstanceId'] })
    exception = validation['exceptions'].first
    assert_equal 'blocked', exception['state']
    refute_nil exception['review'], 'the exception carries its authoritative review'
  end

  # Caso 4: pending_confirmation is converged safely before the batch.
  def test_publish_converges_pending_positions_before_validating
    publisher = recording_publisher
    host = connected_host(['pending_confirmation'] + (%w[present_synced] * 3))
    # A successful converge makes the FRESH reconciliation see present_synced.
    position_sync = FakePositionSync.new(
      on_converged: -> { host.projection_payload = connected_host(%w[present_synced] * 4).projection_payload }
    )
    controller = build_controller(%i[ready ready ready ready], publisher, host, position_sync: position_sync)

    controller.handle_publish_design_revision(controller_dialog(controller))
    assert_equal 1, position_sync.converge_calls.length
    assert_equal [FI_A], position_sync.converge_calls.first[:ids]
    assert_empty publisher.calls, 'nothing publishes until the batch and gate pass'
    controller.drain

    assert_equal [:publish], publisher.calls
  end

  # Caso 6: hard host blockers stop the orchestration before any resolve.
  def test_publish_with_a_hard_host_blocker_never_resolves_or_publishes
    publisher = recording_publisher
    host = connected_host(['duplicate_local'])
    host.projection_payload['items'] << blocking_item(FI_A, 'duplicate_local',
                                                      'hay más de una entidad raíz con la misma identidad')
    position_sync = FakePositionSync.new
    controller = build_controller(%i[ready ready ready ready], publisher, host, position_sync: position_sync)

    controller.handle_publish_design_revision(controller_dialog(controller))
    controller.drain

    assert_empty publisher.calls
    assert_empty position_sync.converge_calls, 'duplicate_local is never auto-repaired'
    assert_equal 0, controller_scope_resolves(controller)
    validation = publish_result(controller)['validation']
    exception = validation['exceptions'].find { |e| e['furnitureInstanceId'] == FI_A }
    refute_nil exception
    assert_equal 'duplicate_local', exception['state']
  end

  # Caso 8: double click → one orchestration, one batch, one publish.
  def test_publish_double_click_runs_a_single_orchestration
    publisher = recording_publisher
    host = connected_host(%w[present_synced] * 4)
    controller = build_controller(%i[ready ready ready ready], publisher, host)
    dialog = controller_dialog(controller)

    controller.handle_publish_design_revision(dialog)
    controller.handle_publish_design_revision(dialog) # still in flight
    controller.drain

    assert_equal 4, controller_scope_resolves(controller), 'exactly one batch ran'
    assert_equal [:publish], publisher.calls
  end

  # Caso 9: a manufacturing mutation lands mid-batch → the FRESH gate sees
  # the stale entry and the publish never uses the previous results.
  def test_mutation_during_batch_blocks_the_publish_through_the_fresh_gate
    publisher = recording_publisher
    host = connected_host(%w[present_synced] * 4)
    controller = build_controller(%i[ready ready ready ready], publisher, host)
    dialog = controller_dialog(controller)

    controller.handle_publish_design_revision(dialog)
    controller.drain
    assert_equal [:publish], publisher.calls # control: all ready publishes

    publisher2 = recording_publisher
    controller2 = build_controller(%i[ready ready ready ready], publisher2, host)
    dialog2 = controller_dialog(controller2)
    controller2.handle_publish_design_revision(dialog2)
    controller2.deferred.shift.call # FIA validated ready

    tracker(controller2).invalidate_target!({ 'furnitureInstanceId' => FI_A },
                                            fingerprint: 'sha256-after-edit')
    controller2.drain

    assert_empty publisher2.calls, 'a stale entry must block the publish'
    result = publish_result(controller2)
    assert_equal 'preflight_incomplete', result['code']
    stale_exception = result['validation']['exceptions'].find do |e|
      e['furnitureInstanceId'] == FI_A
    end
    refute_nil stale_exception
    assert_includes result['validation']['exceptions'].map { |e| e['furnitureInstanceId'] }, FI_A
    assert_equal 'stale', stale_exception['state']
  end

  # Entrega D: Validar diseño runs the SAME batch without publishing.
  def test_validate_design_runs_the_batch_without_publishing
    publisher = recording_publisher
    host = connected_host(%w[present_synced] * 4)
    controller = build_controller(%i[ready ready ready ready], publisher, host)
    dialog = controller_dialog(controller)

    controller.handle_validate_design_revision(dialog)
    controller.drain

    assert_equal 4, controller_scope_resolves(controller)
    assert_empty publisher.calls
    result = validation_result(controller)
    assert_equal true, result['ok']
    assert_equal 4, result['validation']['ready']
    assert_equal 0, result['validation']['attention']
  end

  # Caso 13: :full commercial sync fires ONLY after a successful publish —
  # never after batch validation alone.
  def test_commercial_full_sync_only_after_a_successful_publish
    publisher = recording_publisher
    host = connected_host(%w[present_synced] * 4)
    controller = build_controller(%i[ready ready ready ready], publisher, host)
    dialog = controller_dialog(controller)

    controller.handle_validate_design_revision(dialog)
    controller.drain
    assert_empty commercial_sync_scripts(controller), 'validation alone never triggers :full'

    controller.handle_publish_design_revision(dialog)
    controller.drain

    full = commercial_sync_scripts(controller)
    assert_equal 1, full.length, 'exactly one :full after the publish'
    payload = JSON.parse(full.first.match(/onCommercialProjectionSynchronization\((.*)\)\z/m)[1])
    assert_equal 'full', payload['scope']
  end

  private

  def recording_publisher
    publisher = Object.new
    calls = []
    publisher.define_singleton_method(:calls) { calls }
    publisher.define_singleton_method(:publish) do |on_progress: nil|
      calls << :publish
      on_progress&.call('publishing')
      { 'ok' => true, 'revisionId' => 'r-new', 'revisionNumber' => 2 }
    end
    publisher
  end

  def place_furniture(id)
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: Granete::SketchUpExtension::Metadata::Store.new(@model)
    )
    result = builder.place_existing_furniture(
      @model,
      furniture_instance_id: id,
      definition: OverlayFixture::DEFINITION,
      parameters: OverlayFixture::PARAMETERS,
      resolved_layout: OverlayFixture.native_layout
    )
    raise "placement failed for #{id}" unless result['entity']

    result['entity']
  end

  def connected_host(states)
    host = MutableHost.new
    items = [FI_A, FI_B, FI_C, FI_D].zip(states).map do |id, state|
      item = { 'id' => id, 'reconciliationState' => state,
               'blocking' => !%w[present_synced unplaced].include?(state) }
      item['displayName'] = "Módulo #{id[0, 4]}"
      item
    end
    host.projection_payload = {
      'state' => 'connected', 'clean' => states.all? { |s| %w[present_synced unplaced].include?(s) },
      'items' => items, 'summary' => { 'attention' => items.count { |i| i['blocking'] } }
    }
    host
  end

  def blocking_item(id, state, reason)
    { 'id' => id, 'reconciliationState' => state, 'blocking' => true,
      'displayName' => "Módulo #{id[0, 4]}", 'reason' => reason }
  end

  def build_controller(outcomes, publisher, host, position_sync: FakePositionSync.new)
    provider = SequenceProvider.new(outcomes)
    tracker = Host::PreflightTracker.new
    coordinator = Host::AuthoringMutationCoordinator.new(
      model_provider: -> { @model }, logger: @logger, preflight_tracker: tracker
    )
    scope_items = [FI_A, FI_B, FI_C, FI_D].map { |id| { 'furnitureInstanceId' => id } }
    gate = Host::PublicationPreflightGate.new(
      scope_provider: -> { scope_items },
      host_reconciliation: Struct.new(:projection).new(
        { 'state' => 'connected', 'clean' => true, 'summary' => { 'attention' => 0 } }
      ),
      tracker: tracker, logger: @logger
    )
    @controller = WorkflowController.new(
      logger: @logger, status_provider: StatusProvider.new, catalog_provider: provider,
      design_publisher: publisher,
      mutation_coordinator: coordinator,
      publication_gate: gate,
      host_reconciliation: host,
      position_sync_coordinator: position_sync,
      publication_scope_provider: -> { scope_items }
    )
    @tracker = tracker
    @provider = provider
    @controller.show
    @controller
  end

  def tracker(controller)
    controller.send(:mutation_coordinator).preflight_tracker
  end

  def controller_scope_resolves(controller)
    controller.send(:design_preflight_batch)
    provider_requests(controller).length
  end

  def provider_requests(controller)
    _ = controller
    @provider.requests
  end

  def controller_dialog(controller)
    controller.instance_variable_get(:@dialog)
  end

  def scripts(controller, bridge)
    controller_dialog(controller).executed_scripts.select { |s| s.include?(bridge) }
  end

  def publish_result(controller)
    script = scripts(controller, 'onPublishResult').last
    JSON.parse(script.match(/onPublishResult\((.*)\)\z/m)[1])
  end

  def validation_result(controller)
    script = scripts(controller, 'onDesignValidationResult').last
    JSON.parse(script.match(/onDesignValidationResult\((.*)\)\z/m)[1])
  end

  def commercial_sync_scripts(controller)
    scripts(controller, 'onCommercialProjectionSynchronization')
  end
end
