# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/motion/presentation_motion_adapter'
require_relative '../../src/granete_for_sketchup/ui/bridges/inspector_bridge'

# #1387 — the Inspector caches one motion adapter per furniture entity. A
# rebuild (Inspector apply) DELETES the door/hardware entities the cached
# adapter tracks: the bridge must re-scan instead of toggling dead entities
# (whose Ruby wrappers still respond to :transformation but raise on use),
# and a failed toggle must reach the dialog instead of dying silently.
class InspectorBridgeMotionCacheTest < Minitest::Test
  LiveDoor = Struct.new(:persistent_id, :valid?, :transformation)
  FakeFurniture = Struct.new(:persistent_id)

  class DeletedDoor
    def persistent_id
      9_001
    end

    def valid?
      true
    end

    def respond_to_missing?(name, _include_private = false)
      name == :transformation || super
    end

    def transformation
      raise TypeError, 'reference to deleted Entity'
    end
  end

  class FakeLogger
    attr_reader :events

    def initialize
      @events = []
    end

    %i[info warn error].each do |level|
      define_method(level) { |event, context = {}| @events << [level, event, context] }
    end
  end

  FakeDialog = Struct.new(:id) do
    def execute_script(_script); end
  end

  class FakeModel
    def selection
      []
    end
  end

  # Host including the bridge; the host-side scan and lookup are stubbed so
  # the unit exercises ONLY the cache/invalidation contract.
  class MotionHost
    include Granete::SketchUpExtension::UserInterface::InspectorBridge

    attr_accessor :doors, :hardware_by_host, :logger
    attr_reader :scan_count, :bridge_calls

    def initialize(doors:, hardware_by_host: {})
      @doors = doors
      @hardware_by_host = hardware_by_host
      @logger = FakeLogger.new
      @scan_count = 0
      @bridge_calls = []
    end

    def inspect_furniture_door_actors(_furniture_entity)
      @scan_count += 1
      [@doors, @hardware_by_host]
    end

    def execute_bridge(_dialog, function_name, payload)
      @bridge_calls << [function_name, payload]
    end

    def active_model
      FakeModel.new
    end

    def search_entities_for_instance(_instance_ref)
      FakeFurniture.new(7_777)
    end

    def furniture_metadata?(_model, _target)
      true
    end
  end

  def furniture
    @furniture ||= FakeFurniture.new(4_242)
  end

  def host_with(doors, hardware_by_host = {})
    host = MotionHost.new(doors: doors, hardware_by_host: hardware_by_host)
    host.instance_variable_set(:@dialog, FakeDialog.new('d1'))
    host
  end

  def test_entities_valid_is_true_over_living_entities
    door = LiveDoor.new(1, true, Object.new)
    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      [], { 'd0' => door }, { 'd0' => [door] }
    )
    assert adapter.entities_valid?
  end

  def test_entities_valid_is_false_when_any_tracked_entity_died
    door = LiveDoor.new(1, true, Object.new)
    hardware = LiveDoor.new(2, true, Object.new)
    adapter = Granete::SketchUpExtension::Motion::PresentationMotionAdapter.new(
      [], { 'd0' => door }, { 'd0' => [hardware] }
    )
    door[:valid?] = false
    refute adapter.entities_valid?
  end

  def test_bridge_reuses_a_live_cached_adapter_without_rescanning
    host = host_with([LiveDoor.new(1, true, Object.new)])
    first = host.send(:presentation_motion_adapter_for, furniture, 110.0)
    second = host.send(:presentation_motion_adapter_for, furniture, 110.0)

    assert_same first, second
    assert_equal 1, host.scan_count
  end

  def test_bridge_rescans_and_rebuilds_when_a_tracked_entity_died
    old_door = LiveDoor.new(1, true, Object.new)
    host = host_with([old_door])
    stale = host.send(:presentation_motion_adapter_for, furniture, 110.0)
    assert_equal 1, host.scan_count

    # The rebuild deletes the old door (its wrapper stops being valid) and
    # the scan now sees the new one.
    old_door[:valid?] = false
    new_door = LiveDoor.new(3, true, Object.new)
    host.doors = [new_door]
    fresh = host.send(:presentation_motion_adapter_for, furniture, 110.0)

    refute_same stale, fresh
    assert_equal 2, host.scan_count
    assert_equal [new_door], fresh.component_map.values
    assert fresh.entities_valid?
  end

  # #1387 review: el bridge emite hacia window.<callback> pero quien
  # delega a GraneteUI.inspector es dialog.html — un callback nuevo sin su
  # wrapper allá es código muerto (fue exactamente el blocker de la ronda 1).
  MOTION_CALLBACKS = %w[onDoorMotionToggled onDoorMotionFailed onAllDoorsClosed].freeze

  def test_dialog_html_delegates_every_motion_callback
    dialog_html = File.read(
      File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
    )
    inspector_js = File.read(
      File.expand_path('../../src/granete_for_sketchup/resources/js/granete-inspector.js', __dir__)
    )
    MOTION_CALLBACKS.each do |callback|
      assert_includes inspector_js, "#{callback}: function", "el inspector JS debe consumir #{callback}"
      assert_includes dialog_html, "#{callback}: function", "dialog.html debe delegar #{callback} a GraneteUI.inspector"
    end
  end

  def test_failed_toggle_reaches_the_dialog_instead_of_dying_silently
    host = host_with([DeletedDoor.new])
    dialog = FakeDialog.new('d1')

    host.handle_toggle_door_motion(
      dialog,
      JSON.generate({ 'doorSlotIndex' => 0, 'swingSide' => 'left', 'furnitureInstanceRef' => 'ref-1' })
    )

    failed = host.bridge_calls.select { |(name, _)| name == 'onDoorMotionFailed' }
    assert_equal 1, failed.length, "expected onDoorMotionFailed, got #{host.bridge_calls.inspect}"
    assert(host.logger.events.any? { |(level, event, _)| level == :error && event == 'toggle_door_motion_failed' })
  end
end
