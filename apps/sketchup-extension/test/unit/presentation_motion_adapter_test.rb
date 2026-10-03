# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/motion/presentation_motion_adapter'

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

    def initialize(persistent_id, transformation, width = 10.0)
      @persistent_id = persistent_id
      @transformation = transformation
      @definition = Struct.new(:bounds).new(FakeBounds.new(width))
    end
  end

  def setup
    SketchupStub.reset! if defined?(SketchupStub)
    @door_closed = Geom::Transformation.translation(Geom::Vector3d.new(0, 0, 0))
    @door = FakeComponentInstance.new('door-1', @door_closed, 15.0) # width 15 inches

    @handle_closed = Geom::Transformation.translation(Geom::Vector3d.new(13.0, 1.0, 15.0))
    @handle = FakeComponentInstance.new('handle-1', @handle_closed)

    @hinge_closed = Geom::Transformation.translation(Geom::Vector3d.new(1.0, 0.5, 2.0))
    @hinge = FakeComponentInstance.new('hinge-1', @hinge_closed)
  end

  def test_open_left_door_rotates_door_and_hardware_solidarily
    motions = [
      {
        'id' => 'slot-0',
        'doorSlotIndex' => 0,
        'componentInstanceIds' => ['door-1'],
        'motion' => {
          'kind' => 'rotate',
          'pivotSide' => 'left',
          'openAngleDeg' => 90.0,
          'axisLocal' => { 'x' => 0, 'y' => 0, 'z' => 1 }
        }
      }
    ]
    component_map = { 'door-1' => @door }
    hardware_by_host = { 'door-1' => [@handle, @hinge] }

    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      motions, component_map, hardware_by_host
    )

    # Initially closed
    assert_equal @door_closed.to_a, @door.transformation.to_a
    assert_equal @handle_closed.to_a, @handle.transformation.to_a
    refute adapter.open?('slot-0')

    # Apply 100% open
    adapter.apply_motion('slot-0', 1.0)
    assert adapter.open?('slot-0')

    # Door moved from closed pose
    refute_equal @door_closed.to_a, @door.transformation.to_a
    # Handle moved from closed pose
    refute_equal @handle_closed.to_a, @handle.transformation.to_a
    # Hinge moved from closed pose
    refute_equal @hinge_closed.to_a, @hinge.transformation.to_a

    # Now close
    adapter.apply_motion('slot-0', 0.0)
    refute adapter.open?('slot-0')

    # EXACT restitution of closed pose (zero drift)
    assert_equal @door_closed.to_a, @door.transformation.to_a
    assert_equal @handle_closed.to_a, @handle.transformation.to_a
    assert_equal @hinge_closed.to_a, @hinge.transformation.to_a
  end

  def test_zero_drift_after_repeated_open_close_cycles
    motions = [
      {
        'id' => 'slot-0',
        'componentInstanceIds' => ['door-1'],
        'motion' => {
          'kind' => 'rotate',
          'pivotSide' => 'left',
          'openAngleDeg' => 110.0
        }
      }
    ]
    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      motions, { 'door-1' => @door }, { 'door-1' => [@handle] }
    )

    initial_door = @door.transformation.to_a
    initial_handle = @handle.transformation.to_a

    50.times do
      adapter.apply_motion('slot-0', 1.0)
      adapter.apply_motion('slot-0', 0.0)
    end

    assert_equal initial_door, @door.transformation.to_a
    assert_equal initial_handle, @handle.transformation.to_a
  end

  def test_right_door_rotates_around_right_edge
    door_closed = Geom::Transformation.translation(Geom::Vector3d.new(10.0, 0, 0))
    right_door = FakeComponentInstance.new('door-right', door_closed, 15.0) # width 15 inches

    motions = [
      {
        'id' => 'right-door',
        'componentInstanceIds' => ['door-right'],
        'motion' => {
          'kind' => 'rotate',
          'pivotSide' => 'right',
          'openAngleDeg' => 90.0
        }
      }
    ]
    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      motions, { 'door-right' => right_door }
    )

    adapter.apply_motion('right-door', 1.0)
    refute_equal door_closed.to_a, right_door.transformation.to_a

    adapter.apply_motion('right-door', 0.0)
    assert_equal door_closed.to_a, right_door.transformation.to_a
  end

  def test_close_all_restores_all_actors
    motions = [
      {
        'id' => 'door-left',
        'componentInstanceIds' => ['door-1'],
        'motion' => { 'kind' => 'rotate', 'pivotSide' => 'left', 'openAngleDeg' => 110.0 }
      }
    ]
    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      motions, { 'door-1' => @door }, { 'door-1' => [@handle] }
    )

    adapter.apply_motion('door-left', 1.0)
    assert adapter.open?('door-left')

    adapter.close_all
    refute adapter.open?('door-left')
    assert_equal @door_closed.to_a, @door.transformation.to_a
    assert_equal @handle_closed.to_a, @handle.transformation.to_a
  end
end
