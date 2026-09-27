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
    @manager = Overlay::Manager.new(
      resolver: Overlay::InspectionResolver.new(
        catalog_provider: @provider,
        metadata_store_factory: ->(m) { Metadata::Store.new(m) }
      ),
      locator: Overlay::EntityLocator.new(
        metadata_store_factory: ->(m) { Metadata::Store.new(m) },
        model_provider: -> { @model }
      ),
      model_provider: -> { @model },
      preflight_tracker: Host::PreflightTracker.new
    )
    # Native-like start: the part is the SOLE selection exactly as when the
    # user enabled `Ver fabricación` from its contextual inspector (the
    # fixture builder leaves the placed furniture root selected).
    @model.selection.clear
    @model.selection.add(part_by_ref('side-left-01'))
    @manager.enable('furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID,
                    'componentInstanceId' => 'side-left-01')
    @tool = @model.selected_tools.first
    @view = PickableView.new
    attach_dialog_selection_flow
  end

  # The dialog's selection flow (#476 observer → payload + overlay
  # re-scope), mirroring ObserverBridge#handle_selection_change: this is
  # the ONLY wiring through which a viewport click may re-scope the overlay.
  def attach_dialog_selection_flow
    observer = Observers::SelectionObserver.new(
      metadata_store: @store,
      catalog_provider: @provider,
      on_selection_change: lambda do |payload|
        @payloads << payload
        @manager.rescope(scope_of(payload)) if @manager.mode_on?
      end
    )
    @model.selection.add_observer(observer)
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
