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
require_relative '../../src/granete_for_sketchup/tools/placement_snap_engine'
require_relative '../../src/granete_for_sketchup/tools/furniture_placement_tool'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'
require_relative '../../src/granete_for_sketchup/assets/media_authorizer'

# Host-faithful InputPoint stub for the controller-driven tool: the class
# hooks `next_position_mm`/`next_face` script what the host inference
# returns (nil position = an invalid pick; nil face = free space pick).
# Defined once for the whole process; inert (nil) by default so other
# suites that never set it see invalid picks, not phantom points.
unless defined?(Sketchup::InputPoint)
  module Sketchup
    class InputPoint
      class << self
        attr_accessor :next_position_mm, :next_face
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

      # Host-faithful: InputPoint#face exposes the picked face, nil in
      # space. Scripted per test for the wall snap paths.
      def face
        self.class.next_face
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

  # Auth double mirroring the real semantics: the BEARER is short-lived
  # and technically refreshed (volatile), session_context_id is the stable
  # non-secret context identity that logout/re-enrollment change.
  class FakeAuth
    UNSET = Object.new.freeze
    attr_accessor :header_override, :context_id

    def initialize
      @header_override = UNSET
      @context_id = 'device-context-1'
    end

    def configured?
      true
    end

    def authorization_header
      @header_override.equal?(UNSET) ? 'Bearer test-token' : @header_override
    end

    def session_context_id
      @context_id
    end

    def refresh_if_needed; end
  end

  # Router transport with a journal plus a DYNAMIC working-copy PUT: the
  # server echoes the submitted items verbatim with a bumped workingVersion —
  # exactly the readback the real convergence validates against.
  class FakeTransport
    attr_reader :requests
    attr_accessor :base_url

    def initialize
      @requests = []
      @routes = {}
      @base_url = 'http://taller.local:8080/api'
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
    attr_accessor :dims_mutable, :unusable_layout, :board_mutation, :shifted_layout, :basis_mutation

    def initialize
      @layout_resolves = []
      @dims_mutable = nil
      @unusable_layout = false
      @board_mutation = nil
      @shifted_layout = false
      @basis_mutation = false
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
      apply_board_variants(body)
      LIB::LayoutContract.parse!(body)
    end

    # Board-level variants with UNCHANGED ids: shifted geometry (local
    # minimum away from origin, no top-level dimensionsMm) and a board
    # width mutation — the composition-fingerprint regression shapes.
    def apply_board_variants(body)
      if @shifted_layout
        body.delete('dimensionsMm')
        body['components'][0]['localTransform']['translationMm'] = [100, 50, 20]
      end
      # Rotation-ONLY variant: dimensionsMm stays IDENTICAL on both ends
      # so the sole difference is the board's basis.
      if @basis_mutation
        body['components'][0]['localTransform']['basis'] =
          { 'x' => [0, 1, 0], 'y' => [-1, 0, 0], 'z' => [0, 0, 1] }
      end
      return unless @board_mutation

      body.delete('dimensionsMm')
      body['components'][0]['widthMm'] = @board_mutation
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
    Sketchup::InputPoint.next_face = nil
    @model = PreviewModel.new
    SketchupStub.active_model = @model
    @transport = FakeTransport.new
    @catalog = FakeCatalog.new
    write_binding(REVISION_R1)
    stub_binding_validation(REVISION_R1)
    stub_project_furniture
    stub_working_copy_get

    @auth = FakeAuth.new
    @auth_rotation = ->(new_header) { @auth.header_override = new_header }
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
    Sketchup::InputPoint.next_face = nil
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

    # P1 (review): the canonical commit PERSISTS the layout-derived
    # placement envelope (dimensionsMm [900, 800, 500] → local box
    # [0..900, 0..500, 0..800]) — the semantic side authority later
    # side-snapping consumes, never the definition bounds.
    envelope = MS.new(@model).read(located['entity'])['placementEnvelopeMm']
    assert_equal [0.0, 0.0, 0.0], envelope['min_mm']
    assert_equal [900.0, 500.0, 800.0], envelope['max_mm']

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

  # --- R2: the three REAL close routes all end the gesture, idempotently,
  # without recursion or pushes to the closed dialog — and a dead tool can
  # no longer commit afterwards.
  def test_close_routes_cancel_the_preview_and_block_later_commits
    %i[controller_close close_dialog_callback native_on_closed].each do |route|
      @dialog = @controller.show # close rebuilds the dialog; rebind each pass
      begin_preview(FI_1)
      tool = active_tool
      scripts_before = @dialog.executed_scripts.length

      case route
      when :controller_close then @controller.close
      when :close_dialog_callback then @dialog.callbacks.fetch('close_dialog').call(nil)
      when :native_on_closed
        @dialog.instance_variable_get(:@on_closed).call
      end

      assert tool.cancelled?, "#{route}: the tool ends"
      assert_nil active_preview_session, "#{route}: the session is consumed"
      assert_equal scripts_before, @dialog.executed_scripts.length,
                   "#{route}: no bridge push to a closed dialog"

      # A late click on the dead tool commits nothing.
      click(tool)
      assert_empty @transport.requests_for('PUT', %r{/working-copy}), "#{route}: no commit after close"
      assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    end
  end

  # The host switching tools (user picks another tool) deactivates ours:
  # the preview cancels but the user's NEXT tool is never clobbered, and a
  # new gesture still works afterwards.
  def test_tool_switch_cancel_does_not_clobber_the_users_next_tool
    begin_preview(FI_1)
    tool = active_tool

    user_tool = Object.new
    @model.select_tool(user_tool)
    tool.deactivate(@model.active_view)

    assert tool.cancelled?
    assert_nil active_preview_session
    assert_equal user_tool, @model.selected_tools.last,
                 'deactivation must not select_tool(nil) over the user choice'

    begin_preview(FI_1)
    click(active_tool)
    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true'
  end

  # A failure AFTER select_tool (activation explodes) cleans the model and
  # the session; the retry works.
  def test_failure_after_select_tool_cleans_up_and_retry_works
    begin_preview(FI_1) # sanity: the flow works
    active_tool.onKeyDown(27, false, 0, @model.active_view)

    Sketchup.define_singleton_method(:status_text=) { |_text| raise 'status bar exploded' }
    begin_preview(FI_1)
  ensure
    Sketchup.singleton_class.send(:remove_method, :status_text=) if Sketchup.respond_to?(:status_text=)

    failure = bridge_scripts('onPlacementPreviewStarted').last
    assert_includes failure, '"code":"activation_failed"', failure
    assert_nil active_preview_session
    assert_includes @model.selected_tools, nil,
                    'the half-activated tool is replaced by the selection tool'
    assert @model.selected_tools.last.nil? || !@model.selected_tools.last.is_a?(TOOL) ||
           !@model.selected_tools.last.active?, 'no live preview tool remains'

    begin_preview(FI_1)
    click(active_tool)
    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true'
  end

  # --- R3 authenticated context with EXPLICIT semantics: the bearer is
  # volatile (providers refresh it technically) and is NEVER the identity —
  # logout, a new enrollment/session or a backend switch are what void a
  # gesture; an unknown context never passes as equal.
  def test_technical_token_refresh_keeps_the_gesture
    begin_preview(FI_1)
    tool = active_tool

    # Same context identity, renewed bearer — the DeviceProvider's normal
    # 15-minute technical refresh: the placement must NOT abort.
    @auth.header_override = 'Bearer technically-renewed-token'
    click(tool)

    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true',
                    'a technical refresh of the same context keeps the gesture'
    assert_equal 1, @transport.requests_for('PUT', %r{/working-copy}).length
  end

  def test_new_enrollment_invalidates_the_gesture
    begin_preview(FI_1)
    tool = active_tool

    @auth.context_id = 'device-context-2' # re-enrolled: a NEW context
    click(tool)

    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"context_changed"', result
    assert_includes result, 'la sesión o el servidor cambió'
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
  end

  def test_logout_invalidates_the_gesture
    begin_preview(FI_1)
    tool = active_tool

    @auth.context_id = nil # logged out: no context identity at all
    click(tool)

    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"context_changed"', result
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
  end

  def test_backend_change_invalidates_the_gesture
    begin_preview(FI_1)
    tool = active_tool

    @transport.base_url = 'http://otro-taller.local:9090/api'
    click(tool)

    assert_includes bridge_scripts('onPlaceFurnitureResult').last, 'la sesión o el servidor cambió'
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  # A context that became UNREADABLE between begin and click fails closed —
  # [nil] never equals [nil], unlike the old fingerprint comparison.
  def test_unreadable_context_at_commit_fails_closed
    begin_preview(FI_1)
    tool = active_tool

    @auth.define_singleton_method(:session_context_id) { raise 'session store unreadable' }
    click(tool)

    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"context_changed"', result
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
  end

  # A gesture may not even START without a pinnable context identity.
  def test_begin_refuses_an_unknown_auth_context
    @auth.context_id = nil

    @dialog.callbacks.fetch('begin_placement_preview').call(
      nil, JSON.generate('furnitureInstanceId' => FI_1)
    )

    failure = bridge_scripts('onPlacementPreviewStarted').last
    assert_includes failure, '"code":"auth_context_unavailable"', failure
    assert_includes failure, FI_1
    assert_nil active_preview_session
    assert_empty @model.selected_tools, 'no tool was pushed'

    # Recovery: once the context is readable again the entry point works.
    @auth.context_id = 'device-context-1'
    begin_preview(FI_1)
    assert active_tool.active?
  end

  # --- R2 preview geometry: a layout whose boards sit away from the local
  # origin (no dimensionsMm) keeps its minimum, and the committed transform
  # anchors the REAL box minimum at the clicked point.
  def test_shifted_layout_anchors_the_real_box_minimum
    @catalog.shifted_layout = true
    begin_preview(FI_1)
    tool = active_tool
    click(tool)

    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true'
    root = PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    stored = PF::TransformContract.from_host(root.transformation)
    # BACK_LEFT_BOTTOM anchor = local minimum [100, 50, 20] at the click:
    # translation = click - origin.
    assert_in_delta CLICK_POSITION_MM[0] - 100.0, stored['translation_mm'][0], 1e-3
    assert_in_delta CLICK_POSITION_MM[1] - 50.0, stored['translation_mm'][1], 1e-3
    assert_in_delta CLICK_POSITION_MM[2] - 20.0, stored['translation_mm'][2], 1e-3
  end

  # Board geometry changing under UNCHANGED ids (and no top-level
  # dimensionsMm) is still detected: width 600 → 900 fails closed.
  def test_board_geometry_change_with_same_ids_fails_closed
    @catalog.board_mutation = 600
    begin_preview(FI_1)
    tool = active_tool

    @catalog.board_mutation = 900 # same ids, same definition — wider board
    click(tool)

    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"composition_changed"', result
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
  end

  # R3: a rotation-ONLY board change — same id, same sizes, same
  # translation, dimensionsMm absent, only basis differs — changes the box
  # the preview showed, so the gesture fails closed before inserting.
  def test_board_basis_rotation_with_same_ids_sizes_translation_fails_closed
    @catalog.basis_mutation = false
    begin_preview(FI_1)
    tool = active_tool

    @catalog.basis_mutation = true # only the basis rotates 90° about Z
    click(tool)

    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"composition_changed"', result
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity'],
               'no geometry may be inserted against the stale preview'
    assert_empty @model.entities.instances
  end

  def test_catalog_basis_rotation_never_mints_identity
    stub_create_instance
    @dialog.callbacks.fetch('begin_catalog_placement_preview').call(
      nil, JSON.generate('definitionId' => DEFINITION_ID, 'parameters' => {},
                         'materialChoices' => {}, 'idempotencyKey' => 'idem-9')
    )
    tool = active_tool

    @catalog.basis_mutation = true
    click(tool)

    assert_includes bridge_scripts('onCreateProjectFurnitureResult').last, '"code":"composition_changed"'
    assert_empty @transport.requests_for('POST', %r{/furniture-instances}),
                 'no identity may be created against a stale preview'
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

  # ---- #469 increment 2: managed-neighbor snap targets -------------------

  # The PROJECT lane's tool carries the managed-neighbor provider: a
  # placed Granete root (resolved by furnitureInstanceId metadata) becomes
  # a side-to-side snap target and the committed transform lands on its
  # side at gap 0 — same identity, one PUT.
  def test_project_lane_snaps_to_managed_neighbor_and_commits_the_gap_zero_side
    add_managed_root(FI_2, "Base 600 (#{FI_2})", [0.0, 0.0, 0.0],
                     [600.0 / 25.4, 560.0 / 25.4, 720.0 / 25.4])
    begin_preview(FI_1)
    tool = active_tool

    Sketchup::InputPoint.next_position_mm = [700.0, 280.0, 0.0]
    tool.onMouseMove(0, 50, 50, @model.active_view)

    side = tool.active_snap[:components].find { |c| c[:kind] == :furniture_side }
    assert side, 'the managed neighbor must be offered as a snap target'
    assert_equal FI_2, side[:furniture_instance_id], 'identity comes from metadata, not the name'
    assert_includes side[:label], 'Base 600 · lateral derecho'

    tool.onLButtonDown(0, 50, 50, @model.active_view) # re-picks the SAME aim

    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true'
    put = @transport.requests_for('PUT', %r{/working-copy}).first
    placed = put['body']['items'].find { |i| i['furniture_instance_id'] == FI_1 }
    assert_in_delta 600.0, placed['transform']['translation_mm'][0], 1e-3,
                    'the new left side sits on the neighbor right side (x=600mm)'
  end

  # The CATALOG lane shares the SAME provider and engine: identical snap
  # behavior, only identity provenance differs (Library/Project parity).
  def test_catalog_lane_shares_the_same_managed_neighbor_snap
    add_managed_root(FI_2, "Base 600 (#{FI_2})", [0.0, 0.0, 0.0],
                     [600.0 / 25.4, 560.0 / 25.4, 720.0 / 25.4])
    stub_create_instance
    @dialog.callbacks.fetch('begin_catalog_placement_preview').call(
      nil, JSON.generate('definitionId' => DEFINITION_ID, 'parameters' => {},
                         'materialChoices' => {}, 'idempotencyKey' => 'idem-snap')
    )
    tool = active_tool

    Sketchup::InputPoint.next_position_mm = [700.0, 280.0, 0.0]
    tool.onMouseMove(0, 50, 50, @model.active_view)

    side = tool.active_snap[:components].find { |c| c[:kind] == :furniture_side }
    assert side, 'the catalog lane must resolve the same managed targets'
    assert_equal FI_2, side[:furniture_instance_id]
  end

  # Negative provider proofs: unmanaged geometry, duplicated identity,
  # erased entities and NON-RIGID frames (tilted, scaled, mirrored) never
  # become snap targets — resolution is by managed identity, never by
  # component name. Arbitrary YAW is valid (see the rotated-frame test).
  def test_provider_excludes_unmanaged_duplicated_erased_and_non_rigid_targets
    unmanaged = add_managed_root('fi-unmanaged', 'Cosa suelta (fi-unmanaged)',
                                 [0.0, 0.0, 0.0], [100.0, 100.0, 100.0])
    MS.new(@model).write(unmanaged, { 'namespace' => MS::NAMESPACE,
                                      'metadataVersion' => MS::METADATA_VERSION,
                                      'kind' => 'bootstrapIntent' }) # strip Granete furniture identity
    add_managed_root('fi-dup', 'Duplicado A (fi-dup)', [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    add_managed_root('fi-dup', 'Duplicado B (fi-dup)', [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    erased = add_managed_root('fi-erased', 'Borrado (fi-erased)', [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    erased.define_singleton_method(:valid?) { false }
    tilted = add_managed_root('fi-tilted', 'Inclinado (fi-tilted)', [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    tilted.transformation = Geom::Transformation.axes(
      Geom::Point3d.new(0, 0, 0), Geom::Vector3d.new(1, 0, 0),
      Geom::Vector3d.new(0, 0, 1), Geom::Vector3d.new(0, -1, 0)
    )
    scaled = add_managed_root('fi-scaled', 'Escalado (fi-scaled)', [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    scaled.transformation = Geom::Transformation.axes(
      Geom::Point3d.new(0, 0, 0), Geom::Vector3d.new(1.5, 0, 0),
      Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(0, 0, 1)
    )
    mirrored = add_managed_root('fi-mirrored', 'Espejado (fi-mirrored)', [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    mirrored.transformation = Geom::Transformation.axes(
      Geom::Point3d.new(0, 0, 0), Geom::Vector3d.new(-1, 0, 0),
      Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(0, 0, 1)
    )
    no_envelope = add_managed_root('fi-noenv', 'Sin envelope (fi-noenv)',
                                   [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    MS.new(@model).write(no_envelope, { 'namespace' => MS::NAMESPACE,
                                        'metadataVersion' => MS::METADATA_VERSION,
                                        'kind' => 'furnitureInstance',
                                        'identity' => { 'furnitureInstanceId' => 'fi-noenv' } })
    add_managed_root('fi-ok', 'Sano (fi-ok)', [0.0, 0.0, 0.0], [40.0, 40.0, 40.0])

    targets = @controller.send(:placement_furniture_targets_provider, @model).call

    assert_equal ['fi-ok'], targets.map { |t| t['furniture_instance_id'] },
                 'only the single healthy managed root is a target'
    assert_equal 'Sano', targets.first['label'], 'display label strips the id suffix'
  end

  # #469 increment 3 — a root rotated to an arbitrary yaw IS a target: the
  # descriptor carries the ORIENTED frame from the real rigid transform
  # (world origin + unit front/right) plus the LOCAL definition extents —
  # the world AABB is never part of the contract.
  def test_provider_describes_rotated_roots_with_the_oriented_frame
    half = Math.sqrt(2.0) / 2.0
    rotated = add_managed_root('fi-rot45', 'Rotado 45 (fi-rot45)',
                               [0.0, 0.0, 0.0], [600.0 / 25.4, 560.0 / 25.4, 720.0 / 25.4])
    rotated.transformation = Geom::Transformation.axes(
      Geom::Point3d.new(10.0 / 25.4, 20.0 / 25.4, 0), Geom::Vector3d.new(half, -half, 0),
      Geom::Vector3d.new(half, half, 0), Geom::Vector3d.new(0, 0, 1)
    )

    targets = @controller.send(:placement_furniture_targets_provider, @model).call

    assert_equal(['fi-rot45'], targets.map { |t| t['furniture_instance_id'] })
    target = targets.first
    assert_in_delta 10.0, target['origin_world_mm'][0], 1e-6, 'world origin from the transform'
    assert_in_delta 20.0, target['origin_world_mm'][1], 1e-6
    assert_in_delta half, target['front_dir_mm'][0], 1e-6, 'unit front at 45°'
    assert_in_delta half, target['front_dir_mm'][1], 1e-6
    assert_in_delta half, target['right_dir_mm'][0], 1e-6, 'unit right = front × up'
    assert_in_delta(-half, target['right_dir_mm'][1], 1e-6)
    assert_in_delta 600.0, target['local_max_mm'][0], 1e-6, 'LOCAL extents, not world AABB'
    assert_in_delta 560.0, target['local_max_mm'][1], 1e-6
    assert_in_delta 720.0, target['local_max_mm'][2], 1e-6
    assert_in_delta 0.0, target['local_min_mm'][0], 1e-6
  end

  # P1 (review): the semantic side envelope is the PERSISTED layout-derived
  # placementEnvelopeMm, NEVER the definition bounds — the definition also
  # aggregates hardware/visual assets, so a handle protruding past the
  # cabinet side must not displace the side plane the snap aligns to.
  def test_provider_uses_the_persisted_envelope_not_the_definition_bounds
    protruding = add_managed_root('fi-protrude', 'Con herraje (fi-protrude)',
                                  [0.0, 0.0, 0.0], [600.0 / 25.4, 560.0 / 25.4, 720.0 / 25.4])
    # The definition ALSO contains a protruding asset 200mm past the right
    # side (host definition bounds grow; the placement envelope does not).
    definition_bounds = Geom::BoundingBox.new
    definition_bounds.min = Geom::Point3d.new(0.0, -100.0 / 25.4, 0.0)
    definition_bounds.max = Geom::Point3d.new(800.0 / 25.4, 660.0 / 25.4, 900.0 / 25.4)
    protruding.definition.bounds = definition_bounds

    targets = @controller.send(:placement_furniture_targets_provider, @model).call

    assert_equal(['fi-protrude'], targets.map { |t| t['furniture_instance_id'] })
    target = targets.first
    assert_in_delta 0.0, target['local_min_mm'][0], 1e-6
    assert_in_delta 600.0, target['local_max_mm'][0], 1e-6,
                    'the side plane stays at the CABINET side (envelope), not the asset extent'
    assert_in_delta 560.0, target['local_max_mm'][1], 1e-6
    assert_in_delta 720.0, target['local_max_mm'][2], 1e-6
  end

  # P1 (review): wall + floor must COMPOSE through the real tool — the
  # picked 30° wall constrains XY (orientation + normal) while the
  # gesture-scoped base-plane provider feeds the floor, and the commit
  # carries both: back face ON the rotated wall plane, base ON the floor.
  def test_wall_and_floor_compose_through_the_controller_tool_at_30_degrees
    mm = 25.4
    floor = @model.entities.add_face(
      [Geom::Point3d.new(0, 0, 0), Geom::Point3d.new(6000 / mm, 0, 0),
       Geom::Point3d.new(6000 / mm, 4000 / mm, 0), Geom::Point3d.new(0, 4000 / mm, 0)]
    )
    floor.normal = Geom::Vector3d.new(0, 0, 1)
    normal = [0.5, Math.sqrt(3.0) / 2.0, 0.0]
    aim = [-Math.sqrt(3.0) / 2.0 * 2000.0, 1000.0, 100.0] # on the wall, near the floor
    begin_preview(FI_1)
    tool = active_tool
    # Eye on the room side of the wall (the deterministic orientation
    # reference; the ViewStub exposes the host camera).
    eye_mm = [aim[0] + (normal[0] * 4000.0), aim[1] + (normal[1] * 4000.0), 1600.0]
    @model.active_view.camera = Struct.new(:eye).new(
      Geom::Point3d.new(eye_mm[0] / 25.4, eye_mm[1] / 25.4, eye_mm[2] / 25.4)
    )

    Sketchup::InputPoint.next_position_mm = aim
    Sketchup::InputPoint.next_face = wall_face_stub(normal)
    tool.onMouseMove(0, 50, 50, @model.active_view)

    assert tool.active_snap, 'the 30° wall must offer a snap'
    kinds = tool.active_snap[:components].map { |component| component[:kind] }.sort
    assert_equal %i[face floor], kinds, 'wall + floor compose through the REAL tool'
    transform = tool.current_transform
    [[0, 0, 0], [900.0, 0, 0]].each do |corner|
      placed = transform_point_mm(transform, corner)
      signed = ((placed[0] - aim[0]) * normal[0]) + ((placed[1] - aim[1]) * normal[1])
      assert_in_delta 0.0, signed, 1e-4, 'back face on the rotated wall plane'
    end
    assert_in_delta 0.0, transform_point_mm(transform, [0, 0, 0])[2], 1e-4,
                    'base sits on the floor plane (composed constraint)'

    tool.onLButtonDown(0, 50, 50, @model.active_view) # re-picks + revalidates

    assert_includes bridge_scripts('onPlaceFurnitureResult').last, '"ok":true'
    put = @transport.requests_for('PUT', %r{/working-copy}).first
    placed = put['body']['items'].find { |i| i['furniture_instance_id'] == FI_1 }
    translation = placed['transform']['translation_mm']
    signed_wall = ((translation[0] - aim[0]) * normal[0]) + ((translation[1] - aim[1]) * normal[1])
    assert_in_delta 0.0, signed_wall, 1e-2, 'committed back corner on the wall plane'
    assert_in_delta 0.0, translation[2], 1e-2, 'committed base on the floor'
  end

  # The provider scan is read-only: running it repeatedly issues no
  # transport request (cursor-loop safety).
  def test_provider_scan_issues_no_requests
    add_managed_root(FI_2, "Base 600 (#{FI_2})",
                     [0.0, 0.0, 0.0], [10.0, 10.0, 10.0])
    before = @transport.requests.length

    provider = @controller.send(:placement_furniture_targets_provider, @model)
    3.times { provider.call }

    assert_equal before, @transport.requests.length, 'target discovery is purely local'
  end

  private

  def begin_preview(furniture_instance_id)
    @dialog.callbacks.fetch('begin_placement_preview').call(
      nil, JSON.generate('furnitureInstanceId' => furniture_instance_id)
    )
  end

  # Hand-crafted Granete-managed root in the stub model: identity through
  # the metadata store (as the real builder writes) plus the PERSISTED
  # placement envelope (min/max in INCHES here, stored as the mm
  # placementEnvelopeMm the increment 3 commit writes — the provider's
  # side authority, never the definition bounds) and an identity frame
  # unless a rotated transformation is assigned afterwards by the test.
  # Set definition.bounds separately to model protruding assets.
  def add_managed_root(furniture_instance_id, name, min_in, max_in)
    definition = @model.definitions.add("Granete · #{name}")
    instance = @model.entities.add_instance(definition, Geom::Transformation.new)
    instance.name = name
    mm = 25.4
    MS.new(@model).write(instance, { 'namespace' => MS::NAMESPACE,
                                     'metadataVersion' => MS::METADATA_VERSION,
                                     'kind' => 'furnitureInstance',
                                     'identity' => { 'furnitureInstanceId' => furniture_instance_id },
                                     'placementEnvelopeMm' => {
                                       'min_mm' => min_in.map { |v| v * mm },
                                       'max_mm' => max_in.map { |v| v * mm }
                                     } })
    instance
  end

  def active_tool
    @model.selected_tools.last
  end

  # A picked-face stub with a world normal (mm) for the scripted
  # InputPoint#face surface.
  def wall_face_stub(normal_mm)
    face = SketchupStub::FaceStub.new([])
    face.normal = Geom::Vector3d.new(normal_mm[0], normal_mm[1], normal_mm[2])
    face
  end

  # Local mm box corner → world mm through a Geom::Transformation.
  def transform_point_mm(transform, corner_mm)
    local = Geom::Point3d.new(corner_mm[0] / 25.4, corner_mm[1] / 25.4, corner_mm[2] / 25.4)
    moved = local.transform(transform)
    [moved.x * 25.4, moved.y * 25.4, moved.z * 25.4]
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
        transport: @transport, auth_provider: @auth, logger: NullLogger.new
      ),
      service: PF::Service.new(transport: @transport, auth_provider: @auth, logger: NullLogger.new),
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
