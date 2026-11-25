# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/motion/presentation_pose_store'
require_relative '../../src/granete_for_sketchup/motion/presentation_motion_adapter'
require_relative '../../src/granete_for_sketchup/host/operation_journal'
require_relative '../../src/granete_for_sketchup/ui/bridges/inspector_bridge'
require_relative '../../src/granete_for_sketchup/ui/bridges/observer_bridge'

# #1387 — the Inspector caches one motion adapter per furniture entity. A
# rebuild (Inspector apply) DELETES the door/hardware entities the cached
# adapter tracks: the bridge must re-scan instead of toggling dead entities
# (whose Ruby wrappers still respond to :transformation but raise on use),
# and a failed toggle must reach the dialog instead of dying silently.
# #1393 — the close-all sweep isolates adapter failures, evicts dead cache
# entries, and a model rebind drops the whole map.
class InspectorBridgeMotionCacheTest < Minitest::Test
  PoseStore = Granete::SketchUpExtension::Motion::PresentationPoseStore
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

  # #1393 — a door that records every closed-pose write so the close-all
  # sweep is observable without a real Geom layer. It carries the entity's
  # attribute dictionaries: the sweep only closes a door left OPEN, i.e.
  # one carrying its pose record (#1717).
  class TrackedDoor
    include SketchupStub::AttributeContainer

    attr_reader :transform_writes

    def initialize(persistent_id, valid: true)
      @persistent_id = persistent_id
      @valid = valid
      @transform_writes = []
    end

    def valid?
      @valid
    end

    def transformation
      'canonical-closed-pose'
    end

    def transformation=(transform)
      @transform_writes << transform
    end
  end

  # #1393 — entities report valid?, but the transform write explodes mid
  # close_all (the real host can raise between the validity check and the
  # write).
  class ExplodingDoor < TrackedDoor
    def transformation=(_transform)
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

  # #1393 — one cached adapter per furniture entity, each with its own door
  # set, so the close-all sweep can be exercised over several entries.
  class MultiFurnitureHost < MotionHost
    def initialize(doors_by_furniture)
      super(doors: [], hardware_by_host: {})
      @doors_by_furniture = doors_by_furniture
    end

    def inspect_furniture_door_actors(furniture_entity)
      @scan_count += 1
      [@doors_by_furniture.fetch(furniture_entity.persistent_id, []), {}]
    end
  end

  # #1393 — ObserverBridge host: enough surface for rebind_model to run and
  # prove the motion cache is dropped when the document changes.
  class FakeSelection
    def add_observer(_observer); end

    def remove_observer(_observer); end
  end

  class FakeRebindModel
    def selection
      @selection ||= FakeSelection.new
    end
  end

  class RebindHost
    include Granete::SketchUpExtension::UserInterface::ObserverBridge

    def initialize
      @observed_model = FakeRebindModel.new
      @selection_observer = Object.new
      @motion_adapters = { 4_242 => :adapter_of_the_old_model }
    end

    def refresh_binding_status; end

    def refresh_project_furniture; end

    def offer_migration_if_legacy(_model); end
  end

  def furniture
    @furniture ||= FakeFurniture.new(4_242)
  end

  def host_with(doors, hardware_by_host = {})
    host = MotionHost.new(doors: doors, hardware_by_host: hardware_by_host)
    host.instance_variable_set(:@dialog, FakeDialog.new('d1'))
    host
  end

  # A door an earlier action left open: it carries its pose record (#1717).
  def leave_open(door)
    PoseStore.write(door, 1.0, Geom::Transformation.new)
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

  # #1393 — the sweep closes every LIVING adapter, evicts the dead entry
  # (tracked entities deleted by a rebuild) without touching it, and still
  # reports success to the dialog because everything audible did close.
  def test_close_all_closes_only_the_live_adapter_and_evicts_the_dead_one
    dead_door = TrackedDoor.new(1, valid: false)
    live_door = TrackedDoor.new(2)
    leave_open(live_door)
    host = MultiFurnitureHost.new(111 => [dead_door], 222 => [live_door])
    host.send(:presentation_motion_adapter_for, FakeFurniture.new(111), 110.0)
    host.send(:presentation_motion_adapter_for, FakeFurniture.new(222), 110.0)
    cache = host.instance_variable_get(:@motion_adapters)
    assert_equal [111, 222], cache.keys.sort

    host.handle_close_all_doors(FakeDialog.new('d1'))

    cache = host.instance_variable_get(:@motion_adapters)
    assert_equal [222], cache.keys, 'el sweep debe evictar la entrada con entidades muertas'
    assert_empty dead_door.transform_writes, 'las entidades borradas nunca reciben poses'
    assert_equal 1, live_door.transform_writes.length, 'el mueble vivo debe recibir su pose cerrada'
    assert(host.bridge_calls.any? { |(name, _)| name == 'onAllDoorsClosed' })
  end

  # #1393 — one adapter raising must not abort the rest: the healthy doors
  # still close, the dialog is notified (Spanish toast via the existing
  # onDoorMotionFailed callback) and onAllDoorsClosed is NOT announced,
  # because not everything actually closed.
  def test_close_all_isolates_a_raising_adapter_and_notifies_the_dialog
    exploding_door = ExplodingDoor.new(3)
    live_door = TrackedDoor.new(4)
    leave_open(exploding_door)
    leave_open(live_door)
    host = MultiFurnitureHost.new(333 => [exploding_door], 444 => [live_door])
    host.send(:presentation_motion_adapter_for, FakeFurniture.new(333), 110.0)
    host.send(:presentation_motion_adapter_for, FakeFurniture.new(444), 110.0)

    host.handle_close_all_doors(FakeDialog.new('d1'))

    assert_equal 1, live_door.transform_writes.length,
                 'la excepción de un adaptador no debe abortar el cierre de los demás'
    failed = host.bridge_calls.select { |(name, _)| name == 'onDoorMotionFailed' }
    assert_equal 1, failed.length, "expected onDoorMotionFailed, got #{host.bridge_calls.inspect}"
    assert_instance_of String, failed.first[1]['message']
    refute_empty failed.first[1]['message']
    refute(host.bridge_calls.any? { |(name, _)| name == 'onAllDoorsClosed' },
           'con fallo parcial no puede anunciarse que todo quedó cerrado')
    assert(host.logger.events.any? { |(level, event, _)| level == :error && event == 'close_all_doors_adapter_failed' })
  end

  # #1393 — a model switch/reopen invalidates every cached adapter at once:
  # they all track entities of the OLD model, so rebind drops the whole map
  # and the next toggle re-scans the fresh document.
  def test_rebind_model_drops_cached_motion_adapters_of_the_old_model
    host = RebindHost.new

    host.rebind_model(FakeRebindModel.new)

    assert_empty host.instance_variable_get(:@motion_adapters)
  end
end

# #1717 — the pose lives in the model. A reopened SKP carries open actors
# whose furniture has NO adapter in this session: the bridge reads the pose
# from the record on the entity, sweeps «Cerrar todas» over the WHOLE
# document, and changes pose and record inside ONE undo operation.
class InspectorBridgePersistedMotionStateTest < Minitest::Test
  PoseStore = Granete::SketchUpExtension::Motion::PresentationPoseStore
  TOGGLE_OPERATION = 'Abrir/Cerrar apertura (presentación)'
  CLOSE_ALL_OPERATION = 'Cerrar todas las aperturas (presentación)'

  # A real Geom::Transformation pose plus the entity's attribute
  # dictionaries: the toggle path multiplies transforms and writes the
  # record on the entity (the Object.new pose of the #1387 fixtures would
  # explode there).
  class PoseDoor
    include SketchupStub::AttributeContainer

    attr_accessor :transformation
    attr_reader :persistent_id

    def initialize(persistent_id, transformation)
      @persistent_id = persistent_id
      @transformation = transformation
    end

    def valid?
      true
    end
  end

  class ExplodingDoor < PoseDoor
    def transformation=(_transform)
      raise TypeError, 'reference to deleted Entity'
    end
  end

  PoseFurniture = Struct.new(:persistent_id)

  class FakeLogger
    attr_reader :events

    def initialize
      @events = []
    end

    %i[info warn error].each do |level|
      define_method(level) { |event, context = {}| @events << [level, event, context] }
    end
  end

  # The host model as the bridge sees it for presentation motion: the root
  # entities (managed furniture) and the undo operations it is asked for.
  # commit_result lets a test make the host refuse the commit.
  class FakeModel
    attr_reader :entities, :operations
    attr_accessor :commit_result

    def initialize(entities)
      @entities = entities
      @operations = []
      @commit_result = true
    end

    def selection
      []
    end

    # Same positional signature as Model#start_operation in the host.
    def start_operation(name, disable_ui)
      @operations << [:start, name, disable_ui]
    end

    def commit_operation
      @operations << [:commit]
      @commit_result
    end

    def abort_operation
      @operations << [:abort]
    end
  end

  # Host stubbing only the furniture scan: the toggle, the pose record and
  # the close-all sweep run for real.
  class PersistedHost
    include Granete::SketchUpExtension::UserInterface::InspectorBridge

    attr_reader :logger, :bridge_calls, :scan_count, :model

    def initialize(doors_by_furniture)
      @doors_by_furniture = doors_by_furniture
      @furniture_by_ref = {}
      @logger = FakeLogger.new
      @bridge_calls = []
      @scan_count = 0
      @model = FakeModel.new(doors_by_furniture.keys.map { |pid| PoseFurniture.new(pid) })
    end

    def register(ref, furniture)
      @furniture_by_ref[ref] = furniture
    end

    def inspect_furniture_door_actors(furniture_entity)
      @scan_count += 1
      [@doors_by_furniture.fetch(furniture_entity.persistent_id, []), {}, []]
    end

    def search_entities_for_instance(instance_ref)
      @furniture_by_ref[instance_ref]
    end

    def active_model
      @model
    end

    def furniture_metadata?(_model, target)
      @doors_by_furniture.key?(target.persistent_id)
    end

    def execute_bridge(_dialog, function_name, payload)
      @bridge_calls << [function_name, payload]
    end
  end

  # ObserverBridge host: the selection publish forwards the resolver payload.
  class SelectionPublishHost
    include Granete::SketchUpExtension::UserInterface::ObserverBridge

    attr_reader :bridge_calls

    VisibleDialog = Struct.new(:id) do
      def visible?
        true
      end

      def execute_script(_script); end
    end

    def initialize
      @dialog = VisibleDialog.new('d1')
      @bridge_calls = []
    end

    def execute_bridge(_dialog, function_name, payload)
      @bridge_calls << [function_name, payload]
    end

    def rescope_overlay_from_selection(_payload); end
  end

  def door(persistent_id, offset_x = 10.0)
    PoseDoor.new(persistent_id, Geom::Transformation.translation(Geom::Vector3d.new(offset_x, 1.0, 0.0)))
  end

  # An earlier session left this door open in the saved SKP: moved, and
  # carrying the record of the pose it closes to.
  def leave_saved_open(entity)
    closed_transform = entity.transformation
    entity.transformation = Geom::Transformation.translation(Geom::Vector3d.new(12.0, 3.0, 0.0))
    PoseStore.write(entity, 1.0, closed_transform)
    closed_transform.to_a
  end

  def toggle(host, slot)
    host.handle_toggle_door_motion(
      nil,
      JSON.generate({ 'doorSlotIndex' => slot, 'swingSide' => 'left', 'furnitureInstanceRef' => 'ref-1' })
    )
  end

  def calls(host, function_name)
    host.bridge_calls.select { |(name, _)| name == function_name }
  end

  def cache(host)
    host.instance_variable_get(:@motion_adapters)
  end

  def test_toggle_on_a_reopened_model_closes_the_actor_saved_open
    saved_door = door(1)
    host = PersistedHost.new(4_242 => [saved_door])
    host.register('ref-1', PoseFurniture.new(4_242))
    closed_pose = leave_saved_open(saved_door)
    assert_nil cache(host), 'precondición: el SKP reabierto no trae adapters de sesión'

    toggle(host, 0)

    payload = calls(host, 'onDoorMotionToggled').first.last
    refute payload['isOpen'], 'sobre un actor guardado abierto el toggle cierra'
    assert_equal closed_pose, saved_door.transformation.to_a, 'cierra en la pose cerrada exacta'
    refute PoseStore.open?(saved_door)
    assert_equal [[:start, TOGGLE_OPERATION, true], [:commit]], host.model.operations,
                 'pose y registro cambian dentro de una sola operación'
  end

  def test_toggle_after_closing_reopens_from_the_closed_pose
    saved_door = door(1)
    host = PersistedHost.new(4_242 => [saved_door])
    host.register('ref-1', PoseFurniture.new(4_242))
    closed_pose = leave_saved_open(saved_door)
    toggle(host, 0)
    toggle(host, 0)

    assert calls(host, 'onDoorMotionToggled').last.last['isOpen']
    refute_equal closed_pose, saved_door.transformation.to_a
    assert PoseStore.open?(saved_door)
    assert_equal 1, host.scan_count, 'both toggles reuse the one adapter of the furniture'
  end

  def test_close_all_sweeps_the_whole_document_not_only_this_session_adapters
    session_door = door(1)
    saved_door = door(2)
    untouched_door = door(3)
    host = PersistedHost.new(111 => [session_door], 222 => [saved_door], 333 => [untouched_door])
    host.register('ref-1', PoseFurniture.new(111))
    toggle(host, 0)
    saved_closed_pose = leave_saved_open(saved_door)
    untouched_closed_pose = untouched_door.transformation.to_a
    assert_equal [111], cache(host).keys, 'precondición: sólo el mueble togglado tiene adapter'
    assert PoseStore.open?(session_door)

    host.handle_close_all_doors(nil)

    [session_door, saved_door, untouched_door].each { |entity| refute PoseStore.open?(entity) }
    assert_equal saved_closed_pose, saved_door.transformation.to_a
    assert_equal untouched_closed_pose, untouched_door.transformation.to_a
    assert_equal [111, 222, 333], cache(host).keys.sort
    assert_equal 1, calls(host, 'onAllDoorsClosed').length
    assert_equal [[:start, CLOSE_ALL_OPERATION, true], [:commit]], host.model.operations.last(2)
  end

  def test_failed_toggle_aborts_the_operation_and_reaches_the_dialog
    host = PersistedHost.new(4_242 => [ExplodingDoor.new(1, Geom::Transformation.new)])
    host.register('ref-1', PoseFurniture.new(4_242))

    toggle(host, 0)

    assert_equal [[:start, TOGGLE_OPERATION, true], [:abort]], host.model.operations,
                 'un fallo a mitad de camino no deja la operación abierta ni la confirma'
    assert_empty calls(host, 'onDoorMotionToggled')
    assert_equal 1, calls(host, 'onDoorMotionFailed').length
  end

  def test_toggle_is_reported_as_failed_when_the_host_refuses_the_commit
    saved_door = door(1)
    host = PersistedHost.new(4_242 => [saved_door])
    host.register('ref-1', PoseFurniture.new(4_242))
    leave_saved_open(saved_door)
    host.model.commit_result = false

    toggle(host, 0)

    assert_equal [[:start, TOGGLE_OPERATION, true], [:commit], [:abort]], host.model.operations,
                 'una operación que el host no confirma se aborta'
    assert_empty calls(host, 'onDoorMotionToggled')
    assert_equal 1, calls(host, 'onDoorMotionFailed').length
  end

  def test_close_all_aborts_the_operation_when_the_sweep_itself_fails
    host = PersistedHost.new(111 => [door(1)])
    host.define_singleton_method(:furniture_metadata?) do |_model, _target|
      raise TypeError, 'reference to deleted Entity'
    end

    host.handle_close_all_doors(nil)

    assert_equal [[:start, CLOSE_ALL_OPERATION, true], [:abort]], host.model.operations
    assert_empty calls(host, 'onAllDoorsClosed')
    assert_equal 1, calls(host, 'onDoorMotionFailed').length
  end

  def test_selection_publish_forwards_the_resolver_payload_untouched
    payload = {
      'kind' => 'furniture', 'furnitureInstanceRef' => 'ref-1',
      'doorActors' => [{ 'slotIndex' => 0, 'kind' => 'door', 'isOpen' => true }]
    }
    context = Object.new
    context.define_singleton_method(:to_payload) { payload }
    host = SelectionPublishHost.new

    host.handle_selection_change(context)

    assert_same payload, calls(host, 'onSelectionChange').first.last
    refute host.respond_to?(:decorate_door_motion_state, true),
           'la pose ya viaja en el payload del resolver: no hay segunda pasada de decoración'
  end
end
