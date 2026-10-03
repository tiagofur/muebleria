# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/motion/presentation_motion_adapter'

# PresentationMotionAdapter (#529). Geometry contract under test (#414
# furniture frame: X width, Y depth with FRONT at +Y, Z height): a viewer
# FACING the furniture front has +X on their LEFT, so hinge-left = the
# door's MAX-X edge and hinge-right = the origin (MIN-X) edge; the free
# edge must sweep toward +Y (outward). Direction is asserted through
# concrete points: the hinge point stays fixed and the free edge moves
# out. Plus the owner regressions: zero drift over many cycles, mounted
# hardware moves solidary, closing restores the exact closed matrices,
# and the swing side is per-call (never frozen by the first toggle).
class PresentationMotionAdapterTest < Minitest::Test
  class FakeBounds
    attr_reader :width

    def initialize(width)
      @width = width
    end
  end

  class FakeComponentInstance
    attr_accessor :transformation, :persistent_id
    attr_reader :definition

    def initialize(persistent_id, transformation, width = 15.0)
      @persistent_id = persistent_id
      @transformation = transformation
      @definition = Struct.new(:bounds).new(FakeBounds.new(width))
    end
  end

  def setup
    SketchupStub.reset! if defined?(SketchupStub)
    # Door closed pose: panel x∈[10,25] (width 15), at the front y=1,
    # z∈[0,10]. Hinge-left edge = x=25; hinge-right edge = x=10.
    @door_closed = Geom::Transformation.translation(Geom::Vector3d.new(10.0, 1.0, 0.0))
    @door = FakeComponentInstance.new('door-1', @door_closed, 15.0)

    @handle_closed = Geom::Transformation.translation(Geom::Vector3d.new(12.0, 1.5, 5.0))
    @handle = FakeComponentInstance.new('handle-1', @handle_closed)

    @hinge_closed = Geom::Transformation.translation(Geom::Vector3d.new(24.0, 0.5, 2.0))
    @hinge = FakeComponentInstance.new('hinge-1', @hinge_closed)
  end

  def motions
    [{
      'id' => 'slot-0',
      'doorSlotIndex' => 0,
      'componentInstanceIds' => ['door-1'],
      'motion' => { 'kind' => 'rotate', 'openAngleDeg' => 90.0 }
    }]
  end

  # One adapter per test: a fresh adapter would register whatever pose the
  # door currently has as its canonical closed transform.
  def adapter
    @adapter ||= Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      motions, { 'door-1' => @door }, { 'door-1' => [@handle, @hinge] }
    )
  end

  def point_at(coord_x, coord_y, coord_z)
    Geom::Point3d.new(coord_x, coord_y, coord_z)
  end

  def assert_close(expected_point, actual_point, msg, epsilon = 1e-6)
    assert_in_delta expected_point.x, actual_point.x, epsilon, "#{msg} (x)"
    assert_in_delta expected_point.y, actual_point.y, epsilon, "#{msg} (y)"
    assert_in_delta expected_point.z, actual_point.z, epsilon, "#{msg} (z)"
  end

  def test_open_left_hinges_max_x_edge_and_sweeps_outward
    adapter.apply_motion('slot-0', 1.0, nil, side: 'left')
    posed = @door.transformation

    # Door LOCAL corners (box x∈[0,15]); closed pose maps them to
    # definition space x∈[10,25]. Hinge-left local corner (15,0,0) —
    # definition x=25 — must stay exactly fixed.
    assert_close point_at(15.0, 0.0, 0.0).transform(posed), point_at(25.0, 1.0, 0.0),
                 'bisagra izquierda debe quedar fija'
    assert_close point_at(15.0, 0.0, 10.0).transform(posed), point_at(25.0, 1.0, 10.0),
                 'arista superior de bisagra fija'
    # Free edge local (0,0,0) — definition x=10 — sweeps toward +Y (out).
    free = point_at(0.0, 0.0, 0.0).transform(posed)
    assert_operator free.y, :>, 1.0, 'borde libre debe salir hacia +Y'
  end

  def test_open_right_hinges_origin_edge_and_sweeps_outward
    adapter.apply_motion('slot-0', 1.0, nil, side: 'right')
    posed = @door.transformation

    # Hinge-right local corner (0,0,0) — definition x=10, the origin
    # edge — stays fixed.
    assert_close point_at(0.0, 0.0, 0.0).transform(posed), point_at(10.0, 1.0, 0.0), 'bisagra derecha debe quedar fija'
    # Free edge local (15,0,0) — definition x=25 — sweeps toward +Y.
    free = point_at(15.0, 0.0, 0.0).transform(posed)
    assert_operator free.y, :>, 1.0, 'borde libre debe salir hacia +Y'
  end

  def test_side_is_per_call_never_frozen_by_first_toggle
    a = adapter
    a.apply_motion('slot-0', 1.0, nil, side: 'left')
    a.apply_motion('slot-0', 0.0)
    # Second open with the OTHER side must hinge the other edge: the
    # origin-edge local corner stays fixed now.
    a.apply_motion('slot-0', 1.0, nil, side: 'right')
    posed = @door.transformation
    assert_close point_at(0.0, 0.0, 0.0).transform(posed), point_at(10.0, 1.0, 0.0),
                 'segundo toggle con right debe bisagrar en x=10'
  end

  def test_hardware_moves_solidary_and_close_restores_exactly
    adapter.apply_motion('slot-0', 1.0, nil, side: 'left')
    refute_equal @handle_closed.to_a, @handle.transformation.to_a
    refute_equal @hinge_closed.to_a, @hinge.transformation.to_a

    adapter.apply_motion('slot-0', 0.0)
    assert_equal @door_closed.to_a, @door.transformation.to_a
    assert_equal @handle_closed.to_a, @handle.transformation.to_a
    assert_equal @hinge_closed.to_a, @hinge.transformation.to_a
  end

  def test_zero_drift_after_repeated_open_close_cycles
    50.times do
      adapter.apply_motion('slot-0', 1.0, nil, side: 'left')
      adapter.apply_motion('slot-0', 0.0)
    end
    assert_equal @door_closed.to_a, @door.transformation.to_a
    assert_equal @handle_closed.to_a, @handle.transformation.to_a
  end

  def test_close_all_restores_all_actors
    a = adapter
    a.apply_motion('slot-0', 1.0, nil, side: 'left')
    assert a.open?('slot-0')

    a.close_all
    refute a.open?('slot-0')
    assert_equal @door_closed.to_a, @door.transformation.to_a
    assert_equal @handle_closed.to_a, @handle.transformation.to_a
  end
end
