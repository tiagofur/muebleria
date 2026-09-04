# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'

# #470: the viewport tool draws ephemeral markers and picks them by screen
# proximity — drawing/picking never mutates the productive model.
class OverlayInspectionToolTest < Minitest::Test
  Overlay = Granete::SketchUpExtension::Overlay

  # Records every draw call; project() maps world→screen with an offset so
  # picking coordinates are derivable in tests.
  class DrawSpyView
    attr_reader :draw_calls, :texts

    def initialize
      @draw_calls = []
      @texts = []
      @invalidations = 0
    end

    def invalidate
      @invalidations += 1
    end

    attr_reader :invalidations

    def drawing_color=(_color); end

    def line_width=(_width); end

    def line_stipple=(_stipple); end

    def draw(mode, points)
      @draw_calls << [mode, points.is_a?(Array) ? points.length : 1]
    end

    def draw_text(_point, text, _options = {})
      @texts << text
    end

    def project(point)
      [point.x * 10 + 50, point.y * 10 + 40]
    end
  end

  def setup
    SketchupStub.reset!
    @model = OverlayFixture.build_model
    @provider = OverlayFixture::FakeCatalogProvider.new
    @manager = Overlay::Manager.new(
      resolver: Overlay::InspectionResolver.new(
        catalog_provider: @provider,
        metadata_store_factory: ->(m) { Granete::SketchUpExtension::Metadata::Store.new(m) }
      ),
      locator: Overlay::EntityLocator.new(
        metadata_store_factory: ->(m) { Granete::SketchUpExtension::Metadata::Store.new(m) },
        model_provider: -> { @model }
      ),
      model_provider: -> { @model },
      preflight_tracker: Granete::SketchUpExtension::Host::PreflightTracker.new
    )
    @manager.enable('furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID,
                    'componentInstanceId' => 'side-left-01')
    @tool = @model.selected_tools.first
    @view = DrawSpyView.new
  end

  def test_draw_renders_ring_and_depth_indicator_per_marker
    @tool.draw(@view)

    markers = @manager.projected_features
    loops = @view.draw_calls.count { |mode, _| mode == GL_LINE_LOOP }
    lines = @view.draw_calls.count { |mode, _| mode == GL_LINES }
    points = @view.draw_calls.count { |mode, _| mode == GL_POINTS }

    assert_equal markers.length, loops, 'one ring per feature'
    assert_equal markers.length, lines, 'one depth indicator per feature'
    assert_equal markers.length, points, 'one center point per feature'
  end

  def test_active_feature_gets_a_dimension_label
    first = @manager.scoped_features.first
    @manager.select_feature(first.visual_id)
    @view = DrawSpyView.new
    @tool.draw(@view)

    assert(@view.texts.any? { |text| text.include?('Ø') && text.include?('prof.') })
  end

  def test_stale_overlay_draws_dimmed_and_labels_the_state
    @manager.mutation_started('furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID)
    @tool.draw(@view)

    assert(@view.texts.any? { |text| text.include?('desactualizada') })
  end

  def test_click_on_a_marker_selects_the_feature
    marker = @manager.projected_features.first
    screen_x, screen_y = @view.project(marker.center)

    handled = @tool.onLButtonDown(0, screen_x, screen_y, @view)

    assert handled
    assert_equal marker.visual_id, @manager.active_feature_id
  end

  def test_click_away_falls_through_without_selecting
    handled = @tool.onLButtonDown(0, 5000, 5000, @view)

    refute handled
    assert_nil @manager.active_feature_id
  end

  def test_drawing_and_picking_never_touch_the_model
    operations_before = @model.operations.length
    entities_before = @model.active_entities.to_a.length

    @tool.draw(@view)
    marker = @manager.projected_features.first
    screen_x, screen_y = @view.project(marker.center)
    @tool.onLButtonDown(0, screen_x, screen_y, @view)

    assert_equal operations_before, @model.operations.length
    assert_equal entities_before, @model.active_entities.to_a.length
  end

  def test_deactivate_invalidates_the_view
    @tool.deactivate(@view)
    assert @view.invalidations.positive?
  end
end
