# frozen_string_literal: true

require 'stringio'
require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_grant_manager'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_downloader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/host_reconciliation'
require_relative '../../src/granete_for_sketchup/connection/host_restore'
require_relative '../../src/granete_for_sketchup/connection/panel_state'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/connection/design_sync'
require_relative '../../src/granete_for_sketchup/host/position_sync_observer'
require_relative '../../src/granete_for_sketchup/connection/position_sync_coordinator'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'
require_relative '../support/host_runtime'
require_relative '../support/overlay_runtime'
require_relative '../../src/granete_for_sketchup/host/preflight_review_copy'
require_relative '../../src/granete_for_sketchup/host/preflight_review'
require_relative '../../src/granete_for_sketchup/host/preflight_review_session'
require_relative '../../src/granete_for_sketchup/overlay/issue_navigation'
require_relative '../../src/granete_for_sketchup/tools/internal_component_move_tool'
require_relative '../../src/granete_for_sketchup/tools/furniture_placement_tool'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'
require_relative '../../src/granete_for_sketchup/assets/media_authorizer'

# Host-faithful InputPoint stub for the controller-driven tool: the class
# hook `next_position_mm` scripts what the host inference returns (nil = an
# invalid pick). Defined once for the whole process; inert (nil) by default
# so other suites that never set it see invalid picks, not phantom points.
unless defined?(Sketchup::InputPoint)
  module Sketchup
    class InputPoint
      class << self
        attr_accessor :next_position_mm
      end

      def pick(_view, _x_pos, _y_pos, _other = nil)
        @valid = !self.class.next_position_mm.nil?
      end

      def valid?
        @valid == true
      end

      def position
        mm = self.class.next_position_mm
        Geom::Point3d.new(mm[0] / 25.4, mm[1] / 25.4, mm[2] / 25.4)
      end
    end
  end
end

MB = Granete::SketchUpExtension::Connection::ModelBinding
PF = Granete::SketchUpExtension::Connection::ProjectFurniture
MS = Granete::SketchUpExtension::Metadata::Store
LIB = Granete::SketchUpExtension::Library
FBUILDER = Granete::SketchUpExtension::Model::FurnitureBuilder
TOOL = Granete::SketchUpExtension::Tools::FurniturePlacementTool

# #469 — DialogController placement-preview lifecycle: the gesture-context
# contract (model + binding + gesture id + composition fingerprint), the
# honest answers for busy/activation-failure/stale gestures, and the REAL
# placement convergence through the controller commit path (Placer + real
# PositionSyncCoordinator + SafeWrite PUT with expected_working_version and
# authoritative readback) — the Placer suites do not substitute for this.
class PlacementPreviewControllerTest < Minitest::Test
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  REVISION_R2 = '53000000-0000-0000-0000-000000000002'
  DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'
  FI_1 = '51000000-0000-0000-0000-0000000000f1'
  FI_2 = '51000000-0000-0000-0000-0000000000f2'

  CLICK_POSITION_MM = [1000.0, 200.0, 30.0].freeze

  class PreviewModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-token'
    end

    def refresh_if_needed; end
  end

  # Router transport with a journal plus a DYNAMIC working-copy PUT: the
  # server echoes the submitted items verbatim with a bumped workingVersion —
  # exactly the readback the real convergence validates against.
  class FakeTransport
    attr_reader :requests

    def initialize
      @requests = []
      @routes = {}
    end

    def respond(method, path, status, body)
      @routes[[method.to_s.upcase, path]] = { 'status' => status, 'body' => body }
    end

    def request(payload, _authorization_header = nil)
      method = payload['method'].to_s.upcase
      path = payload['path']
      @requests << { 'method' => method, 'path' => path, 'body' => payload['body'],
                     'headers' => payload['headers'] }
      route = route_for(method, path, payload['body'])
      return route if route

      raise Granete::SketchUpExtension::Transport::RequestError, "no route for #{method} #{path}"
    end

    def requests_for(method, path_pattern)
      @requests.select { |r| r['method'] == method && r['path'].match?(path_pattern) }
    end

    private

    def route_for(method, path, body)
      return @routes[[method, path]] if @routes.key?([method, path])

      if method == 'PUT' && path == "/designs/#{DESIGN_ID}/working-copy"
        return { 'status' => 200,
                 'body' => { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                             'base_revision_id' => REVISION_R1,
                             'updated_at' => '2026-09-23T00:02:00Z',
                             'items' => body['items'] } }
      end

      nil
    end
  end

  class FakeCatalog
    attr_reader :layout_resolves
    attr_accessor :dims_mutable, :unusable_layout

    def initialize
      @layout_resolves = []
      @dims_mutable = nil
      @unusable_layout = false
    end

    def find_definition(id)
      return nil if @unusable_layout && id != DEFINITION_ID

      { 'furniture_definition_id' => DEFINITION_ID, 'code' => 'BASE-900',
        'name' => 'Gabinete Asimétrico 900', 'category' => 'kitchen_base', 'version' => '1.0.0',
        'parameters' => [
          { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => 900, 'unit' => 'mm' },
          { 'name' => 'heightMm', 'label' => 'Alto', 'type' => 'number', 'defaultValue' => 800, 'unit' => 'mm' },
          { 'name' => 'depthMm', 'label' => 'Fondo', 'type' => 'number', 'defaultValue' => 500, 'unit' => 'mm' }
        ] }
    end

    def resolved_native_layout(_definition_id, _params = {}, choices = {})
      @layout_resolves << choices.dup
      return unusable_layout_object if @unusable_layout

      body = layout_base_body
      body['dimensionsMm'] = @dims_mutable if @dims_mutable
      LIB::LayoutContract.parse!(body)
    end

    def unusable_layout_object
      layout = Object.new
      layout.define_singleton_method(:dimensions_mm) { nil }
      layout.define_singleton_method(:boards) { [] }
      layout
    end

    def layout_base_body
      {
        'furnitureDefinitionId' => DEFINITION_ID, 'definitionName' => 'Gabinete Asimétrico 900',
        'transformContract' => 'granete.local-basis.v1', 'dimensionsMm' => [900, 800, 500],
        'components' => [
          { 'componentInstanceId' => 'st-body', 'componentDefinitionId' => 'st-body',
            'slotId' => 'interior', 'role' => 'INTERIOR', 'optionRole' => 'INTERIOR',
            'name' => 'Lateral', 'kind' => 'board',
            'localTransform' => { 'translationMm' => [0, 0, 0],
                                  'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } },
            'widthMm' => 900, 'thicknessMm' => 18, 'lengthMm' => 800 }
        ],
        'hardware' => []
      }
    end
  end

  class NullLogger
    def info(_event, _context = {}); end

    def warn(_event, _context = {}); end

    def error(_event, _context = {}); end
  end

  class StatusProvider
    def call
      { heading: 'Conectado', message: 'Listo', state: 'configured' }
    end
  end

  def setup
    SketchupStub.reset!
    Sketchup::InputPoint.next_position_mm = nil
    @model = PreviewModel.new
    SketchupStub.active_model = @model
    @transport = FakeTransport.new
    @catalog = FakeCatalog.new
    write_binding(REVISION_R1)
    stub_binding_validation(REVISION_R1)
    stub_project_furniture
    stub_working_copy_get

    @placer = build_placer
    @coordinator = Granete::SketchUpExtension::Connection::PositionSyncCoordinator.new(
      model_provider: -> { Sketchup.active_model },
      binding_store_factory: ->(m) { MB::Store.new(m) },
      service: @placer.service,
      metadata_store_factory: ->(m) { MS.new(m) },
      host_reconciliation: placer_reconciliation,
      logger: NullLogger.new
    )
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new),
      status_provider: StatusProvider.new,
      project_furniture_placer: @placer,
      position_sync_coordinator: @coordinator
    )
    @dialog = @controller.show
  end

  def teardown
    Sketchup::InputPoint.next_position_mm = nil
    SketchupStub.reset!
  end

  # Flagship walk: begin → tool active → click → canonical place + REAL
  # convergence (one PUT with the frontier token + authoritative readback),
  # same identity, no creation request, session cleared.
  def test_commit_through_controller_converges_real_working_copy
    begin_preview(FI_1)
    tool = active_tool
    assert tool.active?
    assert(bridge_scripts('onPlacementPreviewStarted').any? { |s| s.include?('"preview_active"') })

    click(tool)

    results = bridge_scripts('onPlaceFurnitureResult')
    assert_equal 1, results.length
    assert_includes results.first, '"ok":true'
    assert_includes results.first, '"code":"placed"', 'the real convergence must confirm the position'

    # Exactly one working-copy PUT, carrying the frontier token from the GET
    # and the accepted transform (contract-level mm).
    puts_requests = @transport.requests_for('PUT', %r{/working-copy})
    assert_equal 1, puts_requests.length
    put = puts_requests.first
    assert_equal '2026-09-23T00:00:00Z', put['body']['expected_working_version'],
                 'the PUT must carry the canonical workingVersion token (#810)'
    placed_item = put['body']['items'].find { |i| i['furniture_instance_id'] == FI_1 }
    refute_nil placed_item
    assert_in_delta CLICK_POSITION_MM[0], placed_item['transform']['translation_mm'][0], 1e-3
    assert_in_delta CLICK_POSITION_MM[2], placed_item['transform']['translation_mm'][2], 1e-3

    # Same business identity, no creation request, session closed.
    located = PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)
    assert located['entity']
    assert_equal 1, located['duplicates']
    assert_empty @transport.requests_for('POST', %r{/furniture-instances})
    assert_nil active_preview_session

    # Panel refresh + preflight push followed the placement.
    assert bridge_scripts('onProjectFurniture').length >= 2
  end

  def test_second_commit_of_the_same_gesture_is_ignored
    begin_preview(FI_1)
    tool = active_tool
    click(tool)
    click(tool) # late duplicate: tool already terminal

    assert_equal 1, @transport.requests_for('PUT', %r{/working-copy}).length
    # And a forged stale-gesture commit reaches nothing.
    @controller.handle_commit_placement_preview(@dialog, FI_1, 'bogus-gesture',
                                                Geom::Transformation.new)
    assert_equal 1, @transport.requests_for('PUT', %r{/working-copy}).length
    assert_equal 1, bridge_scripts('onPlaceFurnitureResult').length
  end

  def test_begin_while_preview_active_answers_busy_and_keeps_first_gesture
    begin_preview(FI_1)
    first_tool = active_tool

    @dialog.callbacks.fetch('begin_placement_preview').call(
      nil, JSON.generate('furnitureInstanceId' => FI_2)
    )

    busy = bridge_scripts('onPlacementPreviewStarted').last
    assert_includes busy, '"code":"preview_busy"'
    assert_includes busy, FI_2, 'the busy answer is correlated to the NEW entry point'
    assert first_tool.active?, 'the live gesture is untouched'
    assert_equal FI_1, active_preview_session['key']
  end

  def test_activation_failure_cleans_up_and_the_next_attempt_works
    def @model.select_tool(_tool)
      raise 'host refused the tool'
    end

    @dialog.callbacks.fetch('begin_placement_preview').call(
      nil, JSON.generate('furnitureInstanceId' => FI_1)
    )

    failure = bridge_scripts('onPlacementPreviewStarted').last
    assert_includes failure, '"code":"activation_failed"'
    assert_includes failure, FI_1, 'correlated to the attempted entry point'
    assert_nil active_preview_session, 'the broken gesture leaves no session behind'

    # The retry starts clean and works.
    @model.singleton_class.send(:remove_method, :select_tool)
    begin_preview(FI_1)
    assert active_tool.active?
    click(active_tool)
    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true'
  end

  def test_escape_cancels_zero_residue_and_next_attempt_works
    begin_preview(FI_1)
    tool = active_tool

    tool.onKeyDown(27, false, 0, @model.active_view)

    cancelled = bridge_scripts('onPlacementPreviewCancelled').last
    assert_includes cancelled, '"code":"preview_cancelled"'
    assert_includes cancelled, FI_1
    assert tool.cancelled?
    assert_nil active_preview_session
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity'],
               'the unit stays pending — zero residue'
    assert_empty @transport.requests_for('PUT', %r{/working-copy})

    begin_preview(FI_1)
    click(active_tool)
    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true'
  end

  def test_tool_switch_deactivation_cancels_the_gesture
    begin_preview(FI_1)
    tool = active_tool

    tool.deactivate(@model.active_view)

    assert tool.cancelled?
    assert_includes bridge_scripts('onPlacementPreviewCancelled').last, 'tool_switched'
    assert_nil active_preview_session
  end

  def test_model_change_between_begin_and_click_fails_closed
    begin_preview(FI_1)
    tool = active_tool

    other_model = PreviewModel.new
    SketchupStub.active_model = other_model
    click(tool)

    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"context_changed"'
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity'],
               'the original model is untouched'
    assert_empty other_model.entities.instances, 'the new context receives nothing'
    assert_nil active_preview_session

    # Back on the bound model, a fresh gesture works.
    SketchupStub.active_model = @model
    begin_preview(FI_1)
    click(active_tool)
    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true'
  end

  # The reviewer's exact case: a DIFFERENT binding inside the SAME Model
  # cannot confirm the gesture captured under the old binding.
  def test_binding_change_inside_same_model_fails_closed
    begin_preview(FI_1)
    tool = active_tool

    write_binding(REVISION_R2)
    stub_binding_validation(REVISION_R2)
    click(tool)

    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"context_changed"', result
    assert_includes result, 'el enlace del modelo cambió'
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    assert_nil active_preview_session
  end

  def test_dialog_close_cancels_live_preview
    begin_preview(FI_1)
    tool = active_tool

    @controller.close

    assert tool.cancelled?
    assert_nil active_preview_session
    assert_includes @model.selected_tools, nil, 'the selection tool is restored'
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
  end

  # The late end of an OLD gesture (its tool deactivating after the gesture
  # was already replaced) must never cancel or clear the NEW one.
  def test_late_end_of_old_gesture_does_not_affect_the_new_one
    begin_preview(FI_1)
    old_tool = active_tool
    old_tool.onKeyDown(27, false, 0, @model.active_view) # gesture A ends normally

    begin_preview(FI_2)
    new_tool = active_tool
    scripts_before = @dialog.executed_scripts.length

    old_tool.deactivate(@model.active_view) # late, duplicate end of A
    @controller.handle_commit_placement_preview(@dialog, FI_1, 'stale-gesture',
                                                Geom::Transformation.new)

    assert new_tool.active?, 'the live gesture B keeps running'
    assert_equal FI_2, active_preview_session['key']
    assert_equal scripts_before, @dialog.executed_scripts.length,
                 'a dead gesture produces no bridge noise'
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  # Fix #6 regression: unresolvable catalog extents answer honestly with
  # definitionId — the old key: call crashed into a generic error instead.
  def test_catalog_preview_without_usable_extents_answers_preview_unavailable
    @catalog.unusable_layout = true

    @dialog.callbacks.fetch('begin_catalog_placement_preview').call(
      nil, JSON.generate('definitionId' => DEFINITION_ID, 'parameters' => {},
                         'materialChoices' => {})
    )

    failure = bridge_scripts('onPlacementPreviewStarted').last
    assert_includes failure, '"code":"preview_unavailable"', failure
    assert_includes failure, DEFINITION_ID, 'the failure is correlated via definitionId'
    assert_nil active_preview_session
  end

  def test_catalog_commit_mints_identity_only_at_click_and_converges
    stub_create_instance
    @dialog.callbacks.fetch('begin_catalog_placement_preview').call(
      nil, JSON.generate('definitionId' => DEFINITION_ID, 'parameters' => {},
                         'materialChoices' => {}, 'idempotencyKey' => 'idem-9')
    )
    tool = active_tool
    assert tool.active?
    assert_empty @transport.requests_for('POST', %r{/furniture-instances}),
                 'previewing the catalog mints nothing'

    click(tool)

    creates = @transport.requests_for('POST', %r{/furniture-instances})
    assert_equal 1, creates.length
    assert_equal 'idem-9', creates.first['headers']['Idempotency-Key']
    assert_includes bridge_scripts('onCreateProjectFurnitureResult').last, '"code":"placed"'
    assert_equal 1, @transport.requests_for('PUT', %r{/working-copy}).length
    assert_nil active_preview_session
  end

  def test_catalog_composition_change_between_preview_and_click_fails_closed
    stub_create_instance
    @dialog.callbacks.fetch('begin_catalog_placement_preview').call(
      nil, JSON.generate('definitionId' => DEFINITION_ID, 'parameters' => {},
                         'materialChoices' => {}, 'idempotencyKey' => 'idem-9')
    )
    tool = active_tool

    @catalog.dims_mutable = [1200, 800, 500] # the workshop re-composed it
    click(tool)

    result = bridge_scripts('onCreateProjectFurnitureResult').last
    assert_includes result, '"code":"composition_changed"', result
    assert_empty @transport.requests_for('POST', %r{/furniture-instances}),
                 'no identity against a stale preview'
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
  end

  def test_project_composition_change_between_preview_and_click_fails_closed
    begin_preview(FI_1)
    tool = active_tool

    @catalog.dims_mutable = [850, 800, 500]
    click(tool)

    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"composition_changed"', result
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  private

  def begin_preview(furniture_instance_id)
    @dialog.callbacks.fetch('begin_placement_preview').call(
      nil, JSON.generate('furnitureInstanceId' => furniture_instance_id)
    )
  end

  def active_tool
    @model.selected_tools.last
  end

  def click(tool)
    Sketchup::InputPoint.next_position_mm = CLICK_POSITION_MM.dup
    tool.onMouseMove(0, 50, 50, @model.active_view)
    tool.onLButtonDown(0, 50, 50, @model.active_view)
  end

  def active_preview_session
    @controller.instance_variable_get(:@active_placement_preview)
  end

  def bridge_scripts(method)
    @dialog.executed_scripts.select { |script| script.include?("GraneteDialog.#{method}(") }
  end

  def build_placer
    PF::Placer.new(
      model_provider: -> { Sketchup.active_model },
      binding_store_factory: ->(m) { MB::Store.new(m) },
      model_binding_service: MB::Service.new(
        transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      service: PF::Service.new(transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new),
      metadata_store_factory: ->(m) { MS.new(m) },
      catalog_provider: @catalog,
      furniture_builder_factory: ->(m) { FBUILDER.new(metadata_store: MS.new(m)) },
      logger: NullLogger.new
    )
  end

  # A reconciliation DOUBLE over the placer's transport (projection shape
  # only — convergence itself runs against the real coordinator + service).
  def placer_reconciliation
    model_provider = -> { Sketchup.active_model }
    binding_factory = ->(m) { MB::Store.new(m) }
    service = @placer.service
    metadata_factory = ->(m) { MS.new(m) }
    Granete::SketchUpExtension::Connection::ProjectFurniture::HostReconciliation.new(
      model_provider: model_provider, binding_store_factory: binding_factory,
      service: service, metadata_store_factory: metadata_factory, logger: NullLogger.new
    )
  end

  def write_binding(base)
    MB::Store.new(@model).write!(
      MB::Binding.new(project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: base)
    )
  end

  def stub_binding_validation(base)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate", 200,
                       { 'state' => 'valid', 'schema_version' => 1,
                         'organization' => { 'id' => '10000000-0000-0000-0000-00000000000a',
                                             'name' => 'Carpintería Prueba' },
                         'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina Prueba' },
                         'design' => { 'id' => DESIGN_ID, 'name' => 'Diseño principal', 'status' => 'active' },
                         'working_copy' => { 'base_revision_id' => base, 'base_revision_number' => 1 },
                         'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true,
                                             'can_create_initial_quote' => true } })
  end

  def stub_project_furniture
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200,
                       [instance_body(FI_1), instance_body(FI_2)])
  end

  def stub_working_copy_get
    @transport.respond(:get, "/designs/#{DESIGN_ID}/working-copy", 200,
                       { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                         'base_revision_id' => REVISION_R1, 'source_type' => 'manual',
                         'updated_at' => '2026-09-23T00:00:00Z', 'items' => [] })
  end

  def stub_create_instance
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       'id' => FI_1, 'project_id' => PROJECT_ID,
                       'furniture_definition_id' => DEFINITION_ID,
                       'origin' => 'design', 'lifecycle_status' => 'active', 'version' => 1,
                       'created_at' => '2026-09-23T00:00:00Z', 'updated_at' => '2026-09-23T00:00:00Z')
  end

  def instance_body(id)
    { 'id' => id, 'project_id' => PROJECT_ID, 'furniture_definition_id' => DEFINITION_ID,
      'origin' => 'quote', 'lifecycle_status' => 'active', 'version' => 1,
      'created_at' => '2026-09-23T00:00:00Z', 'updated_at' => '2026-09-23T00:00:00Z',
      'display' => { 'name' => 'Gabinete Asimétrico 900',
                     'dimensions_mm' => { 'width' => 900, 'height' => 800, 'depth' => 500 } } }
  end
end
