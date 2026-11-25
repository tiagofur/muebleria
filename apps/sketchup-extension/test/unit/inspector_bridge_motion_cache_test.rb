# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/motion/presentation_motion_adapter'
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
  # sweep is observable without a real Geom layer.
  class TrackedDoor
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

  # #1393 — entities report valid?, but reading the pose explodes mid
  # close_all (the real host can raise between the validity check and the
  # transform write).
  class ExplodingDoor < TrackedDoor
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

# #1717 — the Apertura card's button state rides the SelectionContext
# payload: Ruby decorates every doorActors entry with the pose its
# furniture REALLY has (cached adapter open states, keyed by the raw slot
# string exactly as toggle_motion receives it). The dialog-side slot map
# this replaces was shared across furniture and never reset on selection,
# so a closed door inherited another furniture's "open" and the button
# both labelled and acted inverted.
class InspectorBridgeDoorMotionStateDecorationTest < Minitest::Test
  # A real Geom::Transformation: the decoration roundtrip drives the REAL
  # toggle path, which multiplies and writes transforms (the Object.new
  # pose of the #1387 fixtures would explode there).
  LiveDoor = Struct.new(:persistent_id, :valid?, :transformation)
  FakeFurniture = Struct.new(:persistent_id)
  DrawerStub = Struct.new(:components, :hardware, :distance_mm, :name)

  class FakeLogger
    attr_reader :events

    def initialize
      @events = []
    end

    %i[info warn error].each do |level|
      define_method(level) { |event, context = {}| @events << [level, event, context] }
    end
  end

  class FakeModel
    def selection
      []
    end
  end

  # Host stubbing the furniture scan with the FULL 3-element shape
  # (doors, hardware, drawers) so door+drawer adapters build for real.
  class MotionScanHost
    include Granete::SketchUpExtension::UserInterface::InspectorBridge

    attr_reader :scan_count, :logger

    def initialize(scanned_by_furniture)
      @scanned_by_furniture = scanned_by_furniture
      @entity_by_ref = {}
      @logger = FakeLogger.new
      @scan_count = 0
    end

    def inspect_furniture_door_actors(furniture_entity)
      @scan_count += 1
      @scanned_by_furniture.fetch(furniture_entity.persistent_id, [[], {}, []])
    end

    def search_entities_for_instance(instance_ref)
      @entity_by_ref[instance_ref]
    end

    def register_entity(ref, entity)
      @entity_by_ref[ref] = entity
    end

    def active_model
      FakeModel.new
    end

    def furniture_metadata?(_model, _target)
      true
    end

    def execute_bridge(_dialog, _function_name, _payload); end
  end

  # ObserverBridge host proving the selection publish runs the decoration
  # and forwards its payload. The decoration CONTRACT is covered by
  # MotionScanHost above; here the call is stubbed to keep the wiring
  # test independent of the adapter machinery.
  class SelectionPublishHost
    include Granete::SketchUpExtension::UserInterface::ObserverBridge

    attr_reader :bridge_calls, :decorated_with

    def initialize(context)
      @context = context
      @dialog = VisibleDialog.new
      @bridge_calls = []
      @decorated_with = []
    end

    VisibleDialog = Struct.new(:id) do
      def visible?
        true
      end

      def execute_script(_script); end
    end

    def execute_bridge(_dialog, function_name, payload)
      @bridge_calls << [function_name, payload]
    end

    def rescope_overlay_from_selection(_payload); end

    def decorate_door_motion_state(payload)
      @decorated_with << payload
    end
  end

  def furniture
    @furniture ||= FakeFurniture.new(4_242)
  end

  def live_door(persistent_id)
    LiveDoor.new(persistent_id, true, ::Geom::Transformation.new)
  end

  def door_actor(slot)
    { 'slotIndex' => slot, 'kind' => 'door' }
  end

  def toggle(host, slot)
    host.handle_toggle_door_motion(
      nil, JSON.generate({ 'doorSlotIndex' => slot, 'swingSide' => 'left', 'furnitureInstanceRef' => 'ref-1' })
    )
  end

  def test_decoration_reports_the_real_pose_after_a_toggle
    doors = [live_door(1), live_door(2)]
    host = MotionScanHost.new(4_242 => [doors, {}, []])
    host.register_entity('ref-1', furniture)
    toggle(host, 0)
    payload = {
      'kind' => 'furniture',
      'furnitureInstanceRef' => 'ref-1',
      'doorActors' => [door_actor(0), door_actor(1)]
    }

    host.send(:decorate_door_motion_state, payload)

    assert payload['doorActors'][0]['isOpen'],
           'la puerta togglada debe publicar abierta (la clave de estado es el slot crudo)'
    refute payload['doorActors'][1]['isOpen'], 'la puerta intacta debe publicar cerrada'
  end

  def test_decoration_covers_drawer_slots_with_the_same_slot_key
    drawer = DrawerStub.new([live_door(9)], [], 400.0, 'Cajón 1')
    host = MotionScanHost.new(4_242 => [[live_door(1)], {}, [drawer]])
    host.register_entity('ref-1', furniture)
    toggle(host, 1)
    payload = {
      'kind' => 'furniture',
      'furnitureInstanceRef' => 'ref-1',
      'doorActors' => [door_actor(0), { 'slotIndex' => 1, 'kind' => 'drawer', 'label' => 'Cajón 1' }]
    }

    host.send(:decorate_door_motion_state, payload)

    refute payload['doorActors'][0]['isOpen']
    assert payload['doorActors'][1]['isOpen'], 'el cajón togglado debe publicar abierto'
  end

  def test_decoration_defaults_to_closed_and_never_scans_without_cached_adapter
    host = MotionScanHost.new({})
    host.register_entity('ref-1', furniture)
    payload = {
      'kind' => 'furniture',
      'furnitureInstanceRef' => 'ref-1',
      'doorActors' => [door_actor(0), door_actor(1)]
    }

    host.send(:decorate_door_motion_state, payload)

    refute payload['doorActors'][0]['isOpen'], 'un mueble recién seleccionado se construye cerrado'
    refute payload['doorActors'][1]['isOpen']
    assert_equal 0, host.scan_count, 'la decoración es read-only: una selección nunca construye adapter'
    assert_empty host.instance_variable_get(:@motion_adapters) || {},
                 'la decoración no debe sembrar la caché de adapters'
  end

  def test_decoration_evicts_a_dead_adapter_and_reports_closed
    old_door = live_door(1)
    host = MotionScanHost.new(4_242 => [[old_door], {}, []])
    host.register_entity('ref-1', furniture)
    toggle(host, 0)
    refute_empty host.instance_variable_get(:@motion_adapters), 'precondición: el toggle cacheó el adapter'
    old_door[:valid?] = false # the apply rebuild deleted the door (#1387)
    payload = {
      'kind' => 'furniture',
      'furnitureInstanceRef' => 'ref-1',
      'doorActors' => [door_actor(0)]
    }

    host.send(:decorate_door_motion_state, payload)

    refute payload['doorActors'][0]['isOpen'], 'el mueble reconstruido está cerrado'
    assert_empty host.instance_variable_get(:@motion_adapters), 'el adapter muerto se evicta'
  end

  def test_decoration_ignores_batch_and_actorless_payloads
    host = MotionScanHost.new({})
    batch = { 'kind' => 'batch', 'furniture' => [{ 'doorActors' => [door_actor(0)] }] }
    host.send(:decorate_door_motion_state, batch)
    actorless = { 'kind' => 'furniture', 'furnitureInstanceRef' => 'ref-1' }
    host.send(:decorate_door_motion_state, actorless)

    refute batch['furniture'][0].key?('isOpen')
    refute actorless.key?('doorActors')
    assert_empty host.instance_variable_get(:@motion_adapters) || {}
  end

  def test_decoration_survives_a_missing_entity_and_logs
    host = MotionScanHost.new({})
    payload = { 'kind' => 'furniture', 'furnitureInstanceRef' => 'ghost', 'doorActors' => [door_actor(0)] }

    host.send(:decorate_door_motion_state, payload)

    refute payload['doorActors'][0]['isOpen']
    assert(host.logger.events.none? { |(level, _event, _)| level == :error },
           'una referencia sin entidad no es error: es un mueble sin poses de sesión')
  end

  def test_selection_publish_runs_the_decoration_before_executing
    context = Object.new
    context.define_singleton_method(:to_payload) do
      @to_payload ||= { 'kind' => 'furniture', 'furnitureInstanceRef' => 'ref-1',
                        'doorActors' => [{ 'slotIndex' => 0, 'kind' => 'door' }] }
    end
    host = SelectionPublishHost.new(context)

    host.handle_selection_change(context)

    published = host.bridge_calls.select { |(name, _)| name == 'onSelectionChange' }
    assert_equal 1, published.length
    assert_same context.to_payload, host.decorated_with.first,
                'el payload publicado es el mismo objeto que pasó por la decoración'
    assert_same host.decorated_with.first, published.first[1]
  end
end
