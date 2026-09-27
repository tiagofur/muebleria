# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'

# #470: while the inspection tool owns the viewport, clicks that do not hit
# a ManufacturingFeature marker must follow SketchUp's NATURAL selection —
# model.selection itself is written (replace with the host's
# select-tool-equivalent pick, clear on empty space) and the #476
# SelectionObserver flow, the same one that runs for clicks without the
# overlay, drives the dialog and re-scopes the overlay. The overlay tool
# must not resolve selection semantics on its own.
class OverlayNaturalSelectionTest < Minitest::Test
  Overlay = Granete::SketchUpExtension::Overlay
  Observers = Granete::SketchUpExtension::Observers
  Metadata = Granete::SketchUpExtension::Metadata
  Host = Granete::SketchUpExtension::Host

  # View double with a scriptable pick: #picked is the entity the host's
  # PickHelper#do_pick/#best_picked pair would resolve for the click point
  # (nil = click on empty space). Screen projection mirrors DrawSpyView so
  # marker clicks are derivable.
  class PickableView
    attr_reader :invalidations
    attr_accessor :picked

    def initialize
      @invalidations = 0
      @picked = nil
    end

    def invalidate
      @invalidations += 1
    end

    def pick_helper
      SketchupStub::PickHelperStub.new(@picked)
    end

    def screen_coords(point)
      Geom::Point3d.new((point.x * 10) + 50, (point.y * 10) + 40, 1)
    end
  end

  def setup
    SketchupStub.reset!
    @model = OverlayFixture.build_model
    @store = Metadata::Store.new(@model)
    @provider = OverlayFixture::FakeCatalogProvider.new
    @payloads = []
    # Production wiring order: the observer exists first; the manager then
    # delivers the canonical #476 bulk flow itself after its selection
    # writes (the real host defers/drops onSelectionBulkChange for Ruby
    # writes inside a tool event handler — the stuck-inspector bug).
    @observer = Observers::SelectionObserver.new(
      metadata_store: @store,
      catalog_provider: @provider,
      on_selection_change: lambda do |payload|
        @payloads << payload
        @manager.rescope(scope_of(payload)) if @manager&.mode_on?
      end
    )
    @manager = build_manager
    @model.selection.add_observer(@observer)
    # Native-like start: the part is the SOLE selection exactly as when the
    # user enabled `Ver fabricación` from its contextual inspector (the
    # fixture builder leaves the placed furniture root selected).
    @model.selection.clear
    @model.selection.add(part_by_ref('side-left-01'))
    @manager.enable('furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID,
                    'componentInstanceId' => 'side-left-01')
    @tool = @model.tools.pushes.first
    @view = PickableView.new
    # The observer is attached production-early, so the setup's own
    # selection writes publish payloads — tests start from a clean slate.
    @payloads.clear
  end

  def build_manager
    Overlay::Manager.new(
      resolver: Overlay::InspectionResolver.new(
        catalog_provider: @provider,
        metadata_store_factory: ->(m) { Metadata::Store.new(m) }
      ),
      locator: Overlay::EntityLocator.new(
        metadata_store_factory: ->(m) { Metadata::Store.new(m) },
        model_provider: -> { @model }
      ),
      model_provider: -> { @model },
      preflight_tracker: Host::PreflightTracker.new,
      on_selection_written: ->(selection) { @observer.onSelectionBulkChange(selection) }
    )
  end

  def test_click_on_furniture_geometry_selects_it_natively_and_re_scopes
    @view.picked = furniture_root

    handled = @tool.onLButtonDown(0, 9999, 9999, @view)

    assert handled, 'the tool owns the click and performs the selection itself'
    # Native authority: the model selection now holds the pick the host
    # resolved (the select-tool-equivalent entity), not a parallel state.
    assert_equal [furniture_root], @model.selection.to_a
    # The #476 observer flow published the semantic context.
    payload = @payloads.last
    assert_equal 'furniture', payload['kind']
    assert_equal OverlayFixture::FURNITURE_INSTANCE_ID, payload['furnitureInstanceRef']
    # The overlay followed through the SAME selection flow: furniture-level
    # scope shows every board, from the one authoritative snapshot family.
    assert_equal %w[shelf-01 side-left-01 side-right-01],
                 @manager.scoped_features.map(&:host_component_instance_id).uniq.sort
    assert_equal 'current', @manager.status
  end

  def test_click_on_empty_space_clears_selection_and_overlay_honestly
    @view.picked = nil

    @tool.onLButtonDown(0, 9999, 9999, @view)

    assert_empty @model.selection.to_a, 'empty click clears the native selection'
    assert_nil @payloads.last
    assert_equal 'unavailable', @manager.status
    assert_match 'pieza administrada', @manager.unavailable_reason
    assert_empty @manager.projected_features
  end

  # Case B of the reported UX: switching to another part of the SAME
  # furniture while `Ver fabricación` stays ON — no re-enable, no second
  # inspection system, exactly one self-heal re-resolve.
  def test_click_on_another_part_of_the_same_furniture_moves_the_scope
    part_b = part_by_ref('side-right-01')
    @view.picked = part_b
    resolves_before = @provider.resolved_layout_calls

    @tool.onLButtonDown(0, 9999, 9999, @view)

    assert_equal [part_b], @model.selection.to_a
    assert_equal 'side-right-01', @payloads.last['componentInstanceId']
    assert @manager.mode_on?, 'inspection stays ON for a same-furniture switch'
    assert_equal 'side-right-01', @manager.scope['componentInstanceId']
    assert_equal ['side-right-01'], @manager.scoped_features.map(&:host_component_instance_id).uniq
    assert_equal 'current', @manager.status
    # Single canonical path: the clear+add native pair drives ONE
    # self-heal resolve — never a duplicate rescope per click.
    assert_equal resolves_before + 1, @provider.resolved_layout_calls
  end

  # Case E of the reported UX: unmanaged geometry must be selected
  # honestly and the overlay must NOT keep presenting the previous
  # managed scope as if it were still selected.
  def test_click_on_unmanaged_geometry_clears_the_overlay_honestly
    stranger = @model.active_entities.add_group
    @view.picked = stranger

    @tool.onLButtonDown(0, 9999, 9999, @view)

    assert_equal [stranger], @model.selection.to_a, 'the host pick is selected natively'
    assert_equal 'unmanaged', @payloads.last['kind']
    assert_equal 'unavailable', @manager.status
    assert_match 'pieza administrada', @manager.unavailable_reason
    assert_empty @manager.projected_features
  end

  # One interaction, one canonical event path: the observer receives
  # exactly the native clear+add pair and nothing else (no manual context
  # fires, no duplicate rescope work).
  def test_natural_click_flows_only_through_the_selection_observer
    @view.picked = furniture_root
    resolves_before = @provider.resolved_layout_calls

    @tool.onLButtonDown(0, 9999, 9999, @view)

    # The cleared half fires synchronously; every delivered bulk (the
    # stub's own plus the manager's host-reality self-delivery) carries
    # the SAME context — no foreign kinds, one self-heal refresh at most.
    kinds = @payloads.map { |payload| payload && payload['kind'] }
    assert_nil kinds.first, 'the native clear half must arrive first'
    assert kinds.length >= 2, 'the bulk context must be delivered'
    assert kinds[1..].all? { |kind| kind == 'furniture' }, kinds.inspect
    assert_equal resolves_before + 1, @provider.resolved_layout_calls
  end

  def test_click_on_a_marker_keeps_native_selection_untouched
    marker = @manager.projected_features.first
    screen = @view.screen_coords(marker.center)

    handled = @tool.onLButtonDown(0, screen.x, screen.y, @view)

    assert handled
    assert_equal marker.visual_id, @manager.active_feature_id
    # The special ManufacturingFeature selection never touches the model.
    assert_equal [part_by_ref('side-left-01')], @model.selection.to_a
    assert_empty @payloads, 'no selection event may fire for a marker click'
  end

  def test_select_naturally_replaces_clears_and_is_idempotent
    @manager.select_naturally(furniture_root)
    assert_equal [furniture_root], @model.selection.to_a

    @manager.select_naturally(nil)
    assert_empty @model.selection.to_a

    @manager.select_naturally(furniture_root)
    events_before_noop = @payloads.length
    assert_equal [furniture_root], @model.selection.to_a

    # Re-selecting the entity that is already the sole selection is a
    # native no-op: no observer churn, no re-resolve.
    @manager.select_naturally(furniture_root)
    assert_equal events_before_noop, @payloads.length
  end

  # Self-healing (#470): after an honest clear (empty selection) the same
  # furniture coming back must re-resolve instead of staying dead.
  def test_rescope_same_furniture_after_clear_self_heals
    @manager.enable('furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID,
                    'componentInstanceId' => 'side-left-01')
    @manager.rescope({})
    assert_equal 'unavailable', @manager.status

    @manager.rescope('furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID,
                     'componentInstanceId' => 'side-right-01')

    assert_equal 'current', @manager.status
    refute_nil @manager.snapshot
    assert_equal ['side-right-01'], @manager.scoped_features.map(&:host_component_instance_id).uniq
  end

  # The parallel semantic-selection channel is gone: the overlay consumes
  # #476 SelectionContext via the model selection only.
  def test_manager_exposes_no_parallel_selection_channel
    refute_respond_to @manager, :on_viewport_selection
  end

  # Hiding the overlay hands the viewport back to whatever tool was active
  # before (the native Select in the normal flow) — the reported
  # "can't do anything anymore" freeze came from select_tool(nil) leaving
  # the host with no active tool at all.
  def test_disable_restores_the_tool_active_before_the_overlay
    previous = Object.new
    @model.tools.push_tool(previous)
    manager = build_manager
    manager.enable('furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID,
                   'componentInstanceId' => 'side-left-01')

    assert manager.mode_on?
    assert_instance_of Overlay::InspectionTool, @model.tools.active_tool

    manager.disable

    assert_equal 1, @model.tools.pops, 'the overlay popped its tool off the stack'
    assert_equal previous, @model.tools.active_tool, 'the previous tool is restored'
  end

  # Esc inside an open editing context leaves it one level — the native
  # Select behavior the trapped-editor bug report asked for.
  def test_escape_inside_an_open_context_leaves_it_one_level
    @model.active_path = [furniture_root, part_by_ref('shelf-01')]
    @tool.onCancel(0, @view)
    assert_equal [furniture_root], @model.active_path

    @tool.onCancel(0, @view)
    assert_empty @model.active_path
  end

  # Esc at the model root clears the selection, like the native first Esc.
  def test_escape_at_the_model_root_clears_the_selection
    refute_empty @model.selection.to_a

    @tool.onCancel(0, @view)

    assert_empty @model.selection.to_a
  end

  # Host contract: Tool#onCancel carries a REASON — 0 = the user pressed
  # Escape, 1 = the user re-selected this same tool, 2 = the user ran Undo
  # while the tool was active. Only a REAL Escape (0) may run the native
  # escape; the other reasons must leave selection, editing context and
  # overlay exactly as they were (the host does its own native behavior).
  def test_same_tool_reselection_cancel_does_not_touch_selection_or_context
    @model.active_path = [furniture_root]

    @tool.onCancel(1, @view)

    assert_equal [furniture_root], @model.active_path, 'reason 1 must not close the context'
    assert_equal [part_by_ref('side-left-01')], @model.selection.to_a, 'reason 1 must not clear the selection'
    assert @manager.mode_on?
  end

  def test_undo_cancel_does_not_touch_selection_or_context
    @model.active_path = [furniture_root]

    @tool.onCancel(2, @view)

    assert_equal [furniture_root], @model.active_path, 'reason 2 (Undo) must not close the context'
    assert_equal [part_by_ref('side-left-01')], @model.selection.to_a, 'reason 2 (Undo) must not clear the selection'
    assert @manager.mode_on?
  end

  # Double-click on the instance the first click just selected ENTERS its
  # editing context — the native way back into the furniture.
  def test_double_click_opens_the_context_of_the_selected_instance
    @manager.select_naturally(furniture_root)
    @view.picked = furniture_root

    handled = @tool.onLButtonDoubleClick(0, 9999, 9999, @view)

    assert handled
    assert_equal [furniture_root], @model.active_path
    assert_equal [furniture_root], @model.selection.to_a
  end

  # Double-click on empty space while a context is open LEAVES it one
  # level. Host-faithful outcome: leaving the context DROPS a selection
  # that lives inside it (the nested part), exactly like native SketchUp.
  def test_double_click_on_empty_space_leaves_the_open_context
    @model.active_path = [furniture_root]
    @view.picked = nil

    @tool.onLButtonDoubleClick(0, 9999, 9999, @view)

    assert_empty @model.active_path
    assert_empty @model.selection.to_a,
                 'leaving the context drops the nested selection, natively'
  end

  # Double-click on a marker stays special: feature selection only.
  def test_double_click_on_a_marker_keeps_the_special_selection
    marker = @manager.projected_features.first
    screen = @view.screen_coords(marker.center)

    handled = @tool.onLButtonDoubleClick(0, screen.x, screen.y, @view)

    assert handled
    assert_equal marker.visual_id, @manager.active_feature_id
    assert_equal [part_by_ref('side-left-01')], @model.selection.to_a
    assert_empty @model.active_path
    assert_empty @payloads
  end

  # Double-click on a non-selected or non-openable pick falls back to plain
  # natural selection instead of inventing navigation.
  def test_double_click_on_an_unselected_pick_falls_back_to_selection
    part_b = part_by_ref('side-right-01')
    @view.picked = part_b

    @tool.onLButtonDoubleClick(0, 9999, 9999, @view)

    assert_empty @model.active_path, 'nothing is opened for an unselected pick'
    assert_equal [part_b], @model.selection.to_a
  end

  private

  def furniture_root
    OverlayFixture.furniture_root(@model)
  end

  def part_by_ref(ref)
    root = furniture_root
    root.definition.entities.find do |entity|
      entity.respond_to?(:definition) && @store.read(entity)&.dig('identity', 'instanceRef') == ref
    end || raise("fixture part #{ref} not found")
  end

  def scope_of(payload)
    return {} unless payload.is_a?(Hash)

    scope = {}
    scope['furnitureInstanceId'] = payload['furnitureInstanceId'] if payload['furnitureInstanceId']
    scope['furnitureInstanceRef'] = payload['furnitureInstanceRef'] if payload['furnitureInstanceRef']
    scope['componentInstanceId'] = payload['componentInstanceId'] if payload['componentInstanceId']
    scope
  end
end
