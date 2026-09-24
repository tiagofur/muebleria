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

# Host-faithful InputPoint stub shared with the connected-lane suite.
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

# #469 increment 4 — the local/disconnected Biblioteca lane: the SAME
# shared FurniturePlacementTool built by the SAME controller authority as
# the Project/connected-catalog lanes, committing with LOCAL semantics
# (instanceRef identity, zero project side effects) at the accepted
# transform. Entry point under test: the real dialog callback
# begin_catalog_placement_preview on an UNBOUND model.
class LocalCatalogPlacementPreviewTest < Minitest::Test
  DEFINITION_ID = 'local-def-1'
  CLICK_POSITION_MM = [1000.0, 200.0, 30.0].freeze

  class PreviewModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  class FakeAuth
    def configured?
      false
    end

    def session_context_id
      nil
    end
  end

  # Transport with NO routes: any request would raise — the local lane must
  # issue ZERO requests (no POST /furniture-instances, no working-copy PUT,
  # no layout GET offline).
  class NullTransport
    attr_reader :requests

    def initialize
      @requests = []
      @base_url = 'http://taller.local:8080/api'
    end

    def request(payload, _authorization_header = nil)
      @requests << payload
      raise Granete::SketchUpExtension::Transport::RequestError,
            "local lane must not talk to the server: #{payload['method']} #{payload['path']}"
    end
  end

  # Local catalog double: static definition; resolved_native_layout nil
  # (offline) unless layout_mode is :online. `width_default_override`
  # simulates catalog drift between preview and click.
  class LocalCatalog
    attr_accessor :width_default_override, :definition_gone, :layout_mode, :dims_mutable

    def initialize
      @width_default_override = nil
      @definition_gone = false
      @layout_mode = :offline
      @dims_mutable = nil
    end

    def find_definition(id)
      return nil if @definition_gone
      return nil unless id == DEFINITION_ID

      width = @width_default_override || 600
      { 'furniture_definition_id' => DEFINITION_ID, 'code' => 'LOCAL-600', 'name' => 'Bajo Local',
        'category' => 'kitchen_base', 'version' => '1.0.0',
        'parameters' => [
          { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => width,
            'min' => 300, 'max' => 1200, 'step' => 50, 'unit' => 'mm' },
          { 'name' => 'heightMm', 'label' => 'Alto', 'type' => 'number', 'defaultValue' => 720, 'unit' => 'mm' },
          { 'name' => 'depthMm', 'label' => 'Fondo', 'type' => 'number', 'defaultValue' => 590, 'unit' => 'mm' },
          { 'name' => 'shelfCount', 'label' => 'Entrepaños', 'type' => 'number', 'defaultValue' => 1,
            'unit' => 'count' }
        ] }
    end

    def resolved_native_layout(_definition_id, _params = {}, _choices = {})
      return nil unless @layout_mode == :online

      body = {
        'furnitureDefinitionId' => DEFINITION_ID, 'definitionName' => 'Bajo Local',
        'transformContract' => 'granete.local-basis.v1', 'dimensionsMm' => @dims_mutable || [900, 800, 500],
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
      LIB::LayoutContract.parse!(body)
    end
  end

  class NullLogger
    def info(_event, _context = {}); end

    def warn(_event, _context = {}); end

    def error(_event, _context = {}); end
  end

  class StatusProvider
    def call
      { heading: 'Local', message: 'Sin proyecto', state: 'configured' }
    end
  end

  def setup
    SketchupStub.reset!
    Sketchup::InputPoint.next_position_mm = nil
    Sketchup::InputPoint.next_face = nil
    @model = PreviewModel.new
    SketchupStub.active_model = @model
    @transport = NullTransport.new
    @catalog = LocalCatalog.new
    @auth = FakeAuth.new
    @placer = PF::Placer.new(
      model_provider: -> { Sketchup.active_model },
      binding_store_factory: ->(m) { MB::Store.new(m) },
      model_binding_service: MB::Service.new(transport: @transport, auth_provider: @auth,
                                             logger: NullLogger.new),
      service: PF::Service.new(transport: @transport, auth_provider: @auth, logger: NullLogger.new),
      metadata_store_factory: ->(m) { MS.new(m) },
      catalog_provider: @catalog,
      furniture_builder_factory: ->(m) { FBUILDER.new(metadata_store: MS.new(m)) },
      logger: NullLogger.new
    )
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new),
      status_provider: StatusProvider.new,
      catalog_provider: @catalog,
      project_furniture_placer: @placer
    )
    @dialog = @controller.show
  end

  def teardown
    Sketchup::InputPoint.next_position_mm = nil
    Sketchup::InputPoint.next_face = nil
    SketchupStub.reset!
  end

  # B — zero residue BEFORE the click: no root, no definitions, no
  # metadata, no server request. The preview is view-drawing only.
  def test_begin_local_preview_leaves_zero_residue
    begin_local_preview

    assert active_tool.active?
    assert(bridge_scripts('onPlacementPreviewStarted').any? { |s| s.include?('"preview_active"') })
    assert_empty @model.entities.instances, 'no furniture root before the click'
    assert_empty @model.definitions.to_a, 'no generated productive definitions before the click'
    assert_empty @transport.requests, 'the local lane talks to no server'
    assert_nil active_preview_session['binding'], 'the local session carries no binding'
    assert_equal 'catalog_local', active_preview_session['kind']
  end

  # C + E + F + I — the click commits ONE local furniture at the ACCEPTED
  # transform with the configured parameters/materials intact, one undoable
  # operation, no Move handoff and zero project side effects.
  def test_click_commits_local_furniture_at_accepted_transform
    begin_local_preview('parameters' => { 'widthMm' => 750 },
                        'materialChoices' => { 'INTERIOR' => 'mat-roble', 'FRENTES' => 'mat-blanco' })
    click(active_tool)

    result = bridge_scripts('onInsertionResult').last
    assert_includes result, '"success":true'
    assert_includes result, '"placed_via_preview":true', 'the UI must not advertise a Move handoff'

    assert_equal 1, @model.entities.instances.length, 'exactly one local furniture root'
    root = @model.entities.instances.first
    assert_in_delta CLICK_POSITION_MM[0] / 25.4, root.transformation.origin.x, 1e-6
    assert_in_delta CLICK_POSITION_MM[1] / 25.4, root.transformation.origin.y, 1e-6
    assert_in_delta CLICK_POSITION_MM[2] / 25.4, root.transformation.origin.z, 1e-6

    metadata = MS.new(@model).read(root)
    assert_equal 'furnitureInstance', metadata['kind']
    assert metadata['identity']['instanceRef'].to_s.start_with?('inst-'), 'local identity is a local ref'
    assert_nil metadata['identity']['furnitureInstanceId'], 'NO server identity is invented'
    # E — non-default intent survives exactly.
    assert_equal 750, metadata['intent']['parameters']['widthMm']
    assert_equal 1, metadata['intent']['parameters']['shelfCount'], 'undeclared defaults normalize'
    assert_equal({ 'INTERIOR' => 'mat-roble', 'FRENTES' => 'mat-blanco' },
                 metadata['intent']['materialChoices'])
    # Same shared envelope authority as the preview box (generic composition).
    envelope = metadata['placementEnvelopeMm']
    assert_equal [0.0, 0.0, 0.0], envelope['min_mm']
    assert_equal [750.0, 590.0, 720.0], envelope['max_mm']

    # I — one undoable operation covering creation AND transform; the
    # click IS the placement (no Move tool handoff, no selection hijack).
    starts = @model.operations.count { |op| op.is_a?(Array) && op.first == :start }
    assert_equal 1, starts, 'one placement = one host operation'
    assert_includes @model.operations.map { |op| op.is_a?(Array) ? op[1] : nil }, 'Insertar Mueble Bajo Local'
    assert_empty SketchupStub.send_actions, 'no selectMoveTool handoff'
    assert @model.selection.empty?, 'the click does not hijack the selection'

    # Undo removes the complete unit.
    SketchupStub.undo
    assert_empty @model.entities.instances, 'undo removes the whole root'

    # F — zero project side effects the whole way.
    assert_empty @transport.requests
    assert_nil active_preview_session
  end

  # D — Esc: zero furniture, zero generated productive residue, session
  # consumed, and the NEXT attempt works (entry point re-armed).
  def test_escape_cancels_with_zero_residue_and_next_attempt_works
    begin_local_preview
    tool = active_tool

    tool.onKeyDown(27, false, 0, @model.active_view)

    cancelled = bridge_scripts('onPlacementPreviewCancelled').last
    assert_includes cancelled, '"code":"preview_cancelled"'
    assert_includes cancelled, DEFINITION_ID
    assert tool.cancelled?
    assert_nil active_preview_session
    assert_empty @model.entities.instances
    assert_empty @model.definitions.to_a
    assert_empty @transport.requests

    begin_local_preview
    click(active_tool)
    assert_includes bridge_scripts('onInsertionResult').last, '"success":true'
  end

  # Catalog drift between preview and click (offline generic composition)
  # fails closed: the accepted transform never lands on other geometry.
  def test_generic_composition_drift_between_preview_and_click_fails_closed
    begin_local_preview('parameters' => {})
    tool = active_tool

    @catalog.width_default_override = 800 # the catalog re-composed the default
    click(tool)

    result = bridge_scripts('onInsertionResult').last
    assert_includes result, '"code":"composition_changed"', result
    assert_includes result, 'la composición del mueble cambió'
    assert_empty @model.entities.instances, 'nothing may be inserted against the stale preview'
    assert_empty @transport.requests
    assert_nil active_preview_session
  end

  # The definition disappearing from the local catalog answers honestly
  # (correlated definitionId) and inserts nothing.
  def test_definition_gone_at_commit_answers_definition_unavailable
    begin_local_preview
    tool = active_tool

    @catalog.definition_gone = true
    click(tool)

    result = bridge_scripts('onInsertionResult').last
    assert_includes result, '"code":"definition_unavailable"', result
    assert_includes result, DEFINITION_ID
    assert_empty @model.entities.instances
    assert_nil active_preview_session
  end

  # The gesture captured on an unbound model cannot commit once the model
  # gets bound mid-gesture: the binding triple changes, the answer is the
  # honest context_changed and the model stays untouched.
  def test_model_bound_mid_gesture_fails_closed
    begin_local_preview
    tool = active_tool

    write_binding
    click(tool)

    result = bridge_scripts('onInsertionResult').last
    assert_includes result, '"code":"context_changed"', result
    assert_empty @model.entities.instances
    assert_empty @transport.requests
    assert_nil active_preview_session
  end

  # A second click of the same gesture is ignored; a forged stale gesture
  # reaches nothing.
  def test_second_commit_of_the_same_gesture_is_ignored
    begin_local_preview
    tool = active_tool
    click(tool)
    click(tool) # late duplicate: tool already terminal

    assert_equal 1, @model.entities.instances.length
    @controller.handle_commit_local_catalog_preview(@dialog, 'bogus-gesture',
                                                    Geom::Transformation.new)
    assert_equal 1, @model.entities.instances.length
    assert_equal 1, bridge_scripts('onInsertionResult').length
  end

  # The local lane with a resolvable server layout uses the SAME
  # layout authority (dimensionsMm extents + layout_signature) as the
  # connected lane, and drift still fails closed.
  def test_local_lane_with_server_layout_uses_layout_authority
    @catalog.layout_mode = :online
    begin_local_preview
    tool = active_tool

    extents = tool.instance_variable_get(:@extents_mm)
    assert_in_delta 900.0, extents[:x], 1e-6, 'extents come from dimensionsMm, not the generic box'
    assert_in_delta 500.0, extents[:y], 1e-6
    assert_in_delta 800.0, extents[:z], 1e-6

    click(tool)

    root = @model.entities.instances.first
    refute_nil root
    envelope = MS.new(@model).read(root)['placementEnvelopeMm']
    assert_equal [900.0, 500.0, 800.0], envelope['max_mm'], 'envelope follows the layout authority'
    assert_nil active_preview_session
  end

  def test_local_lane_with_server_layout_drift_fails_closed
    @catalog.layout_mode = :online
    begin_local_preview
    tool = active_tool

    @catalog.dims_mutable = [1200, 800, 500]
    click(tool)

    assert_includes bridge_scripts('onInsertionResult').last, '"code":"composition_changed"'
    assert_empty @model.entities.instances
  end

  # H + rule 11 — the local lane traverses the SHARED snap engine and a
  # placed LOCAL root is a side-to-side target resolved by its local ref
  # (no server identity invented for snapping).
  def test_local_lane_snaps_to_placed_local_neighbor_and_commits_the_snapped_transform
    add_local_root('inst-left', 'Bajo Local (inst-left)', [0.0, 0.0, 0.0],
                   [600.0 / 25.4, 560.0 / 25.4, 720.0 / 25.4])
    begin_local_preview('parameters' => { 'widthMm' => 750 })
    tool = active_tool

    # Provider wiring: the local root must be offered through the same
    # shared provider the connected lanes use.
    targets = @controller.send(:placement_furniture_targets_provider, @model).call
    assert_equal ['inst-left'], targets.map { |t| t['furniture_instance_id'] },
                 'local identity comes from instanceRef metadata, never a name/GUID'

    Sketchup::InputPoint.next_position_mm = [700.0, 280.0, 0.0]
    tool.onMouseMove(0, 50, 50, @model.active_view)

    side = tool.active_snap[:components].find { |c| c[:kind] == :furniture_side }
    assert side, 'the local lane must resolve the same semantic snap targets'
    assert_equal 'inst-left', side[:furniture_instance_id]

    tool.onLButtonDown(0, 50, 50, @model.active_view)

    assert_includes bridge_scripts('onInsertionResult').last, '"success":true'
    new_root = @model.entities.instances.reject { |e| e.name.include?('inst-left') }.first
    refute_nil new_root
    assert_in_delta 600.0 / 25.4, new_root.transformation.origin.x, 1e-6,
                    'the new left side sits on the neighbor right side (x=600mm)'
    assert_in_delta 0.0, new_root.transformation.origin.z, 1e-6
    assert_empty @transport.requests
  end

  # Negative provider proof for the local stream: duplicated local refs and
  # roots without a persisted envelope never become snap targets, and the
  # server stream keeps its exact semantics (the invalid classification the
  # server lanes consume is unchanged).
  def test_local_provider_stream_excludes_duplicates_and_envelopeless_roots
    dup_a = add_local_root('inst-dup', 'A (inst-dup)', [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    add_local_root('inst-dup', 'B (inst-dup)', [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    no_envelope = add_local_root('inst-noenv', 'Sin envelope (inst-noenv)',
                                 [0.0, 0.0, 0.0], [50.0, 50.0, 50.0])
    MS.new(@model).write(no_envelope, { 'namespace' => MS::NAMESPACE,
                                        'metadataVersion' => MS::METADATA_VERSION,
                                        'kind' => 'furnitureInstance',
                                        'identity' => { 'instanceRef' => 'inst-noenv' } })

    targets = @controller.send(:placement_furniture_targets_provider, @model).call
    assert_empty targets.map { |t| t['furniture_instance_id'] },
                 'duplicated/envelopeless local roots offer no candidate'

    index = PF::ManagedFurniture.index(@model, MS.new(@model))
    assert_equal 2, index[:local_by_ref]['inst-dup'].length,
                 'the index groups local roots; duplicate EXCLUSION happens in the provider'
    assert_equal 1, index[:local_by_ref]['inst-noenv'].length
    reasons = index[:invalid].map { |entry| entry[:reason] }
    assert reasons.include?('missing_furniture_instance_id'),
           'the server lanes keep failing closed on local furniture (bound-model guards)'
    assert(index[:invalid].any? { |entry| entry[:entity].equal?(dup_a) })
    assert_empty index[:by_id], 'no local root is promoted to server identity'
  end

  # A local root and a server root coexist: both are targets, each under
  # its own identity stream.
  def test_provider_merges_server_and_local_targets
    add_local_root('inst-local', 'Local (inst-local)', [0.0, 0.0, 0.0], [40.0, 40.0, 40.0])
    add_managed_root('51000000-0000-0000-0000-0000000000f9', 'Server (fi)',
                     [0.0, 0.0, 0.0], [60.0, 60.0, 60.0])

    targets = @controller.send(:placement_furniture_targets_provider, @model).call
    assert_equal %w[51000000-0000-0000-0000-0000000000f9 inst-local],
                 targets.map { |t| t['furniture_instance_id'] }.sort
  end

  private

  def begin_local_preview(payload_overrides = {})
    payload = { 'definitionId' => DEFINITION_ID, 'parameters' => {},
                'materialChoices' => {} }.merge(payload_overrides)
    @dialog.callbacks.fetch('begin_catalog_placement_preview').call(nil, JSON.generate(payload))
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

  def write_binding
    MB::Store.new(@model).write!(
      MB::Binding.new(project_id: '41000000-0000-0000-0000-000000000001',
                      design_id: '52000000-0000-0000-0000-000000000001',
                      base_revision_id: '53000000-0000-0000-0000-000000000001')
    )
  end

  # Hand-crafted LOCAL managed root: kind furnitureInstance + instanceRef
  # identity (exactly what insert_furniture writes) plus a persisted
  # placement envelope in mm.
  def add_local_root(instance_ref, name, min_in, max_in)
    definition = @model.definitions.add("Granete · #{name}")
    instance = @model.entities.add_instance(definition, Geom::Transformation.new)
    instance.name = name
    mm = 25.4
    MS.new(@model).write(instance, { 'namespace' => MS::NAMESPACE,
                                     'metadataVersion' => MS::METADATA_VERSION,
                                     'kind' => 'furnitureInstance',
                                     'identity' => { 'instanceRef' => instance_ref },
                                     'placementEnvelopeMm' => {
                                       'min_mm' => min_in.map { |v| v * mm },
                                       'max_mm' => max_in.map { |v| v * mm }
                                     } })
    instance
  end

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
end
