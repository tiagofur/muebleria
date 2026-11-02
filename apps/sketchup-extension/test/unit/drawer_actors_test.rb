# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/selection/door_actors'

# #1377 Slice 1 — Drawer actors discovery from MANAGED METADATA ONLY:
# - Clusters drawer front, drawer box pieces (assemblyInstanceId),
#   handles (hostComponentInstanceId == front), and moving slide rails
#   (actorMembership 'actor:drawer').
# - Leaves fixed rails (actorMembership 'body') un-moved on the cabinet body.
# - Sorts and pairs multi-drawer units (e.g. 2CAJ, 3CAJ) by vertical Z coordinate.
class DrawerActorsTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
  end

  def test_discovers_drawer_subassembly_and_moving_hardware
    furniture = build_furniture do |definition|
      # 1. Drawer front with handle
      drawer_front_child(definition, 'front-1', pos_z: 30.0)
      handle_child(definition, 'handle-1', host: 'front-1')

      # 2. Drawer box parts with assemblyInstanceId 'asm-1'
      drawer_box_child(definition, 'box-lat-l', assembly_id: 'asm-1', pos_z: 30.0)
      drawer_box_child(definition, 'box-lat-r', assembly_id: 'asm-1', pos_z: 30.0)
      drawer_box_child(definition, 'box-bottom', assembly_id: 'asm-1', pos_z: 30.0)

      # 3. Slide rails: moving ('actor:drawer') vs fixed ('body')
      slide_rail_child(definition, 'slide-mov-l', assembly_id: 'asm-1', membership: 'actor:drawer')
      slide_rail_child(definition, 'slide-fix-l', assembly_id: 'asm-1', membership: 'body')

      # 4. Unrelated cabinet body board
      board_child(definition, 'cabinet-side')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_empty scanned.doors
    assert_equal 1, scanned.drawers.length

    drawer = scanned.drawers.first
    assert_equal 'drawer-slot-0', drawer.id
    assert_equal 0, drawer.slot_index
    assert_equal 'Cajón', drawer.name
    assert_equal 400.0, drawer.distance_mm

    # Moving components: front + 3 box parts = 4
    assert_equal 4, drawer.components.length
    component_names = drawer.components.map(&:name)
    assert_includes component_names, 'front-1'
    assert_includes component_names, 'box-lat-l'
    assert_includes component_names, 'box-lat-r'
    assert_includes component_names, 'box-bottom'

    # Moving hardware: handle on front + moving slide rail
    assert_equal 2, drawer.hardware.length
    hw_names = drawer.hardware.map(&:name)
    assert_includes hw_names, 'handle-1'
    assert_includes hw_names, 'slide-mov-l'

    # Fixed rail must NOT be included in moving hardware
    refute_includes hw_names, 'slide-fix-l'
  end

  def test_pairs_multiple_drawers_by_vertical_z_order
    furniture = build_furniture do |definition|
      # Lower drawer (Z = 30)
      drawer_front_child(definition, 'front-lower', pos_z: 30.0)
      drawer_box_child(definition, 'box-lower', assembly_id: 'asm-lower', pos_z: 30.0)
      slide_rail_child(definition, 'slide-lower', assembly_id: 'asm-lower', membership: 'actor:drawer')

      # Upper drawer (Z = 350)
      drawer_front_child(definition, 'front-upper', pos_z: 350.0)
      drawer_box_child(definition, 'box-upper', assembly_id: 'asm-upper', pos_z: 350.0)
      slide_rail_child(definition, 'slide-upper', assembly_id: 'asm-upper', membership: 'actor:drawer')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 2, scanned.drawers.length

    d0 = scanned.drawers[0]
    assert_equal 'Cajón 1', d0.name
    assert_equal 0, d0.slot_index
    assert_includes d0.components.map(&:name), 'front-lower'
    assert_includes d0.components.map(&:name), 'box-lower'
    assert_includes d0.hardware.map(&:name), 'slide-lower'

    d1 = scanned.drawers[1]
    assert_equal 'Cajón 2', d1.name
    assert_equal 1, d1.slot_index
    assert_includes d1.components.map(&:name), 'front-upper'
    assert_includes d1.components.map(&:name), 'box-upper'
    assert_includes d1.hardware.map(&:name), 'slide-upper'
  end

  # #1377 acceptance: 3 drawers with independent subassembly discovery (MOD-BAJ-3CAJ)
  def test_pairs_three_drawers_in_mod_baj_3caj_pattern
    furniture = build_furniture do |definition|
      # Lower drawer (Z = 30) — cacerolero inferior
      drawer_front_child(definition, 'front-0', pos_z: 30.0)
      drawer_box_child(definition, 'box-0', assembly_id: 'asm-0', pos_z: 30.0)
      slide_rail_child(definition, 'slide-0', assembly_id: 'asm-0', membership: 'actor:drawer')

      # Middle drawer (Z = 380) — cacerolero medio
      drawer_front_child(definition, 'front-1', pos_z: 380.0)
      drawer_box_child(definition, 'box-1', assembly_id: 'asm-1', pos_z: 380.0)
      slide_rail_child(definition, 'slide-1', assembly_id: 'asm-1', membership: 'actor:drawer')

      # Upper drawer (Z = 540) — cubiertero superior
      drawer_front_child(definition, 'front-2', pos_z: 540.0)
      drawer_box_child(definition, 'box-2', assembly_id: 'asm-2', pos_z: 540.0)
      slide_rail_child(definition, 'slide-2', assembly_id: 'asm-2', membership: 'actor:drawer')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 3, scanned.drawers.length

    assert_equal 'Cajón 1', scanned.drawers[0].name
    assert_equal 0, scanned.drawers[0].slot_index
    assert_includes scanned.drawers[0].components.map(&:name), 'front-0'
    assert_includes scanned.drawers[0].components.map(&:name), 'box-0'
    assert_includes scanned.drawers[0].hardware.map(&:name), 'slide-0'

    assert_equal 'Cajón 2', scanned.drawers[1].name
    assert_equal 1, scanned.drawers[1].slot_index
    assert_includes scanned.drawers[1].components.map(&:name), 'front-1'
    assert_includes scanned.drawers[1].components.map(&:name), 'box-1'
    assert_includes scanned.drawers[1].hardware.map(&:name), 'slide-1'

    assert_equal 'Cajón 3', scanned.drawers[2].name
    assert_equal 2, scanned.drawers[2].slot_index
    assert_includes scanned.drawers[2].components.map(&:name), 'front-2'
    assert_includes scanned.drawers[2].components.map(&:name), 'box-2'
    assert_includes scanned.drawers[2].hardware.map(&:name), 'slide-2'
  end

  def test_cabinet_with_both_door_and_drawer
    furniture = build_furniture do |definition|
      door_child(definition, 'door-1', placement: 'puerta', role: 'FRENTE')
      drawer_front_child(definition, 'drawer-front-1', pos_z: 400.0)
      drawer_box_child(definition, 'drawer-box-1', assembly_id: 'asm-1', pos_z: 400.0)
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 1, scanned.doors.length
    assert_equal 1, scanned.drawers.length
    assert_equal 'door-1', scanned.doors.first.name
    assert_equal 'Cajón', scanned.drawers.first.name
  end

  private

  def build_furniture
    definition = @model.definitions.add('furniture-def')
    yield definition
    definition.add_instance(Geom::Transformation.new)
  end

  def door_child(definition, id, placement:, role:)
    child = new_child(definition, id)
    @store.write(child, child_metadata(id, { 'entityClass' => 'part', 'placement' => placement, 'role' => role },
                                       identity_id: id))
    child
  end

  def drawer_front_child(definition, id, pos_z: 0.0)
    t = Geom::Transformation.translation(Geom::Vector3d.new(0, 0, pos_z / 25.4))
    child = new_child(definition, id, transform: t)
    @store.write(child, child_metadata(id, {
                                         'entityClass' => 'part',
                                         'placement' => 'frente_cajon',
                                         'role' => 'FRENTES'
                                       }, identity_id: id))
    child
  end

  def drawer_box_child(definition, id, assembly_id:, pos_z: 0.0)
    t = Geom::Transformation.translation(Geom::Vector3d.new(0, 0, pos_z / 25.4))
    child = new_child(definition, id, transform: t)
    @store.write(child, child_metadata(id, {
                                         'entityClass' => 'part',
                                         'placement' => 'lateral_izquierdo',
                                         'role' => 'INTERIOR',
                                         'assemblyInstanceId' => assembly_id
                                       }, identity_id: id))
    child
  end

  def slide_rail_child(definition, id, assembly_id:, membership:)
    child = new_child(definition, id)
    @store.write(child, child_metadata(id, {
                                         'entityClass' => 'hardware',
                                         'assemblyInstanceId' => assembly_id,
                                         'actorMembership' => membership
                                       }, identity_id: id))
    child
  end

  def handle_child(definition, id, host:)
    child = new_child(definition, id)
    @store.write(child, child_metadata(id, {
                                         'entityClass' => 'hardware',
                                         'hostComponentInstanceId' => host,
                                         'hardwareDefinitionId' => 'hw-pull-generic'
                                       }, identity_id: id))
    child
  end

  def board_child(definition, id)
    child = new_child(definition, id)
    @store.write(child, child_metadata(id, {
                                         'entityClass' => 'part',
                                         'placement' => 'lateral_izquierdo',
                                         'role' => 'LATERAL_IZQ'
                                       }, identity_id: id))
    child
  end

  def child_metadata(id, intent, identity_id: "hw-inst-#{id}")
    {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'componentInstance',
      'identity' => {
        'instanceRef' => identity_id,
        'componentInstanceId' => identity_id,
        'componentDefinitionId' => "def-#{id}",
        'assemblyInstanceId' => intent['assemblyInstanceId']
      },
      'intent' => intent
    }
  end

  def new_child(definition, id, transform: nil)
    t = transform || Geom::Transformation.new
    child_definition = @model.definitions.add("child-def-#{id}")
    child = definition.entities.add_instance(child_definition, t)
    child.name = id
    child
  end
end
