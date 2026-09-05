# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/overlay_runtime'

# #470: viewport picking works on projected markers + view.project — screen
# proximity only, no picking geometry ever enters the model.
class OverlayScreenPickerTest < Minitest::Test
  Overlay = Granete::SketchUpExtension::Overlay

  # Minimal view double: project() maps world points to screen coordinates.
  FakeView = Struct.new(:projection) do
    def project(point)
      projection.call(point)
    end
  end

  def marker(visual_id:, center:, radius: 20)
    ring = Array.new(8) do |i|
      angle = (Math::PI * 2 * i) / 8
      Geom::Point3d.new(center.x + (radius * Math.cos(angle)),
                        center.y + (radius * Math.sin(angle)),
                        center.z)
    end
    Overlay::FeatureProjector::ProjectedFeature.new(
      visual_id: visual_id, center: center, ring_points: ring,
      depth_end: center, radius_in: radius
    )
  end

  def identity_projection(point)
    [point.x, point.y]
  end

  def test_click_on_ring_picks_the_feature
    view = FakeView.new(->(point) { identity_projection(point) })
    features = [marker(visual_id: 'a', center: Geom::Point3d.new(100, 100, 0))]
    picked = Overlay::ScreenPicker.pick(100 + 20, 100, features, view)
    assert_equal 'a', picked.visual_id
  end

  def test_click_inside_the_circle_picks_the_feature
    view = FakeView.new(->(point) { identity_projection(point) })
    features = [marker(visual_id: 'a', center: Geom::Point3d.new(100, 100, 0), radius: 40)]
    picked = Overlay::ScreenPicker.pick(105, 108, features, view)
    assert_equal 'a', picked.visual_id
  end

  def test_nearest_feature_wins_when_markers_overlap
    view = FakeView.new(->(point) { identity_projection(point) })
    features = [
      marker(visual_id: 'far', center: Geom::Point3d.new(140, 100, 0)),
      marker(visual_id: 'near', center: Geom::Point3d.new(104, 100, 0))
    ]
    picked = Overlay::ScreenPicker.pick(110, 100, features, view)
    assert_equal 'near', picked.visual_id
  end

  def test_click_far_from_every_marker_picks_nothing
    view = FakeView.new(->(point) { identity_projection(point) })
    features = [marker(visual_id: 'a', center: Geom::Point3d.new(100, 100, 0))]
    assert_nil Overlay::ScreenPicker.pick(500, 500, features, view)
  end

  def test_marker_behind_the_camera_is_not_pickable
    view = FakeView.new(->(_point) {})
    features = [marker(visual_id: 'a', center: Geom::Point3d.new(1, 1, 1))]
    assert_nil Overlay::ScreenPicker.pick(10, 10, features, view)
  end
end
