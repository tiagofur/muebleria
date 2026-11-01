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

  def test_fixed_body_members_never_move_and_zero_drift_after_50_cycles
    # #1376: rigid member with actorMembership 'body' stays fixed to cabinet
    plate_closed = Geom::Transformation.translation(Geom::Vector3d.new(24.0, 0.5, 2.0))
    plate_fixed = FakeComponentInstance.new('plate-fixed', plate_closed)

    # Hardware mounted on door-1 only includes the moving member (@handle),
    # while plate_fixed belongs to body and is omitted from hardware_by_host
    a = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      motions, { 'door-1' => @door }, { 'door-1' => [@handle] }
    )

    50.times do
      a.apply_motion('slot-0', 1.0, nil, side: 'left')
      # During open: plate_fixed never moved
      assert_equal plate_closed.to_a, plate_fixed.transformation.to_a
      # While handle moved
      refute_equal @handle_closed.to_a, @handle.transformation.to_a

      a.apply_motion('slot-0', 0.0)
    end

    assert_equal @door_closed.to_a, @door.transformation.to_a
    assert_equal @handle_closed.to_a, @handle.transformation.to_a
    assert_equal plate_closed.to_a, plate_fixed.transformation.to_a
  end

  def test_two_instances_of_same_recipe_membership_does_not_interfere
    door_b_closed = Geom::Transformation.translation(Geom::Vector3d.new(10.0, 1.0, 300.0))
    door_b = FakeComponentInstance.new('door-2', door_b_closed, 15.0)
    handle_b_closed = Geom::Transformation.translation(Geom::Vector3d.new(12.0, 1.5, 305.0))
    handle_b = FakeComponentInstance.new('handle-2', handle_b_closed)

    two_motions = motions + [{
      'id' => 'slot-1',
      'doorSlotIndex' => 1,
      'componentInstanceIds' => ['door-2'],
      'motion' => { 'kind' => 'rotate', 'openAngleDeg' => 90.0 }
    }]

    a = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      two_motions,
      { 'door-1' => @door, 'door-2' => door_b },
      { 'door-1' => [@handle], 'door-2' => [handle_b] }
    )

    # Move only slot-0 (door A)
    a.apply_motion('slot-0', 1.0, nil, side: 'left')

    # Door A moved
    refute_equal @door_closed.to_a, @door.transformation.to_a
    refute_equal @handle_closed.to_a, @handle.transformation.to_a

    # Door B completely unmoved
    assert_equal door_b_closed.to_a, door_b.transformation.to_a
    assert_equal handle_b_closed.to_a, handle_b.transformation.to_a
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

  # #1377 Slice 1 — Drawer translate motion moves the entire sub-assembly forward (+Y)
  # by distanceMm (400 mm), leaves fixed body rails stationary, and restores exactly.
  def test_translate_motion_moves_drawer_subassembly_forward_along_y
    front_closed = Geom::Transformation.translation(Geom::Vector3d.new(1.0, 590.0 / 25.4, 2.0))
    front = FakeComponentInstance.new('drawer-front-1', front_closed)

    box_closed = Geom::Transformation.translation(Geom::Vector3d.new(1.0, 90.0 / 25.4, 2.0))
    box = FakeComponentInstance.new('drawer-box-1', box_closed)

    handle_closed = Geom::Transformation.translation(Geom::Vector3d.new(1.0, 605.0 / 25.4, 2.0))
    handle = FakeComponentInstance.new('handle-drawer-1', handle_closed)

    rail_mov_closed = Geom::Transformation.translation(Geom::Vector3d.new(1.5, 90.0 / 25.4, 2.0))
    rail_mov = FakeComponentInstance.new('rail-mov-1', rail_mov_closed)

    rail_fix_closed = Geom::Transformation.translation(Geom::Vector3d.new(0.5, 90.0 / 25.4, 2.0))
    rail_fix = FakeComponentInstance.new('rail-fix-1', rail_fix_closed)

    drawer_motion = [{
      'id' => 'drawer-slot-0',
      'doorSlotIndex' => 0,
      'componentInstanceIds' => %w[drawer-front-1 drawer-box-1],
      'motion' => {
        'kind' => 'translate',
        'distanceMm' => 400.0,
        'axisLocal' => { 'x' => 0, 'y' => 1, 'z' => 0 }
      }
    }]

    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      drawer_motion,
      { 'drawer-front-1' => front, 'drawer-box-1' => box },
      { 'drawer-front-1' => [handle, rail_mov] }
    )

    # 1. Open drawer
    adapter.apply_motion('drawer-slot-0', 1.0)
    assert adapter.open?('drawer-slot-0')

    dy_inches = 400.0 / 25.4
    # All moving parts translated forward (+Y) by 400 mm
    assert_in_delta (590.0 / 25.4) + dy_inches, front.transformation.origin.y, 1e-4,
                    'frente debe avanzar +400mm en Y'
    assert_in_delta (90.0 / 25.4) + dy_inches, box.transformation.origin.y, 1e-4,
                    'caja debe avanzar +400mm en Y'
    assert_in_delta (605.0 / 25.4) + dy_inches, handle.transformation.origin.y, 1e-4,
                    'jaladera debe avanzar +400mm en Y'
    assert_in_delta (90.0 / 25.4) + dy_inches, rail_mov.transformation.origin.y, 1e-4,
                    'riel móvil debe avanzar +400mm en Y'

    # Fixed rail never moved
    assert_equal rail_fix_closed.to_a, rail_fix.transformation.to_a

    # 2. Close drawer — restores exact canonical closed transforms
    adapter.apply_motion('drawer-slot-0', 0.0)
    refute adapter.open?('drawer-slot-0')
    assert_equal front_closed.to_a, front.transformation.to_a
    assert_equal box_closed.to_a, box.transformation.to_a
    assert_equal handle_closed.to_a, handle.transformation.to_a
    assert_equal rail_mov_closed.to_a, rail_mov.transformation.to_a
  end

  def test_drawer_50_cycles_zero_drift
    front_closed = Geom::Transformation.translation(Geom::Vector3d.new(1.0, 590.0 / 25.4, 2.0))
    front = FakeComponentInstance.new('drawer-front-1', front_closed)

    drawer_motion = [{
      'id' => 'drawer-slot-0',
      'doorSlotIndex' => 0,
      'componentInstanceIds' => ['drawer-front-1'],
      'motion' => { 'kind' => 'translate', 'distanceMm' => 400.0 }
    }]

    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      drawer_motion, { 'drawer-front-1' => front }
    )

    50.times do
      adapter.apply_motion('drawer-slot-0', 1.0)
      adapter.apply_motion('drawer-slot-0', 0.0)
    end

    assert_equal front_closed.to_a, front.transformation.to_a
  end

  def test_multiple_drawers_move_independently
    front0_closed = Geom::Transformation.translation(Geom::Vector3d.new(1.0, 590.0 / 25.4, 2.0))
    front0 = FakeComponentInstance.new('f-0', front0_closed)

    front1_closed = Geom::Transformation.translation(Geom::Vector3d.new(1.0, 590.0 / 25.4, 300.0 / 25.4))
    front1 = FakeComponentInstance.new('f-1', front1_closed)

    motions = [
      { 'id' => 'drawer-slot-0', 'doorSlotIndex' => 0, 'componentInstanceIds' => ['f-0'],
        'motion' => { 'kind' => 'translate', 'distanceMm' => 400.0 } },
      { 'id' => 'drawer-slot-1', 'doorSlotIndex' => 1, 'componentInstanceIds' => ['f-1'],
        'motion' => { 'kind' => 'translate', 'distanceMm' => 400.0 } }
    ]

    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      motions, { 'f-0' => front0, 'f-1' => front1 }
    )

    # Open only drawer 0
    adapter.apply_motion('drawer-slot-0', 1.0)
    assert adapter.open?('drawer-slot-0')
    refute adapter.open?('drawer-slot-1')

    refute_equal front0_closed.to_a, front0.transformation.to_a
    assert_equal front1_closed.to_a, front1.transformation.to_a

    # Open drawer 1
    adapter.apply_motion('drawer-slot-1', 1.0)
    assert adapter.open?('drawer-slot-0')
    assert adapter.open?('drawer-slot-1')

    # Close drawer 0
    adapter.apply_motion('drawer-slot-0', 0.0)
    refute adapter.open?('drawer-slot-0')
    assert adapter.open?('drawer-slot-1')
    assert_equal front0_closed.to_a, front0.transformation.to_a
    refute_equal front1_closed.to_a, front1.transformation.to_a
  end
end
