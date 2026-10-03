# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/selection/door_actors'

# DoorActors.scan (#529): the opening door actors of a managed furniture are
# discovered from MANAGED METADATA ONLY (placement slot 'puerta' or a
# door/front role) and hardware siblings group by their structured host
# binding. Negative proofs: unmanaged/foreign children never become doors,
# corrupt child metadata is skipped (fail closed per child), and a
# non-definitional entity yields an empty set.
class DoorActorsTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
  end

  def test_discovers_door_actors_and_groups_hardware_by_host
    furniture = build_furniture do |definition|
      door_child(definition, 'door-left', placement: 'puerta', role: 'FRENTE')
      hinge_child(definition, 'hinge-1', host: 'door-left')
      handle_child(definition, 'handle-1', host: 'door-left')
      board_child(definition, 'side-panel')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 1, scanned.doors.length
    assert_equal [furniture.definition.entities.to_a.first], scanned.doors
    mounted = scanned.hardware_by_host['door-comp-0']
    assert_equal 2, mounted.length
  end

  def test_two_door_slots_map_to_separate_actors
    furniture = build_furniture do |definition|
      door_child(definition, 'door-left', placement: 'puerta', role: 'FRENTE')
      door_child(definition, 'door-right', placement: 'puerta', role: 'FRENTE')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 2, scanned.doors.length
  end

  def test_corrupt_child_metadata_is_skipped_fail_closed
    furniture = build_furniture do |definition|
      door_child(definition, 'door-left', placement: 'puerta', role: 'FRENTE')
      corrupt = door_child(definition, 'corrupt', placement: 'puerta', role: 'FRENTE')
      corrupt.set_attribute('com.granete.sketchup_extension', 'bootstrap_intent.v1', '{not-json')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 1, scanned.doors.length
  end

  def test_non_definitional_entity_yields_empty_set
    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(nil, @store)

    assert_empty scanned.doors
    assert_empty scanned.hardware_by_host
  end

  # NEGATIVE PROOF (#529 regression, owner smoke 2026-10-03): a drawer front
  # (placement frente_cajon, role FRENTE_CAJON) and a plain front must NEVER
  # become door actors — substring matching on 'frente' over-detected them,
  # shifted the real door to slot 1 and flipped its swing to right.
  def test_drawer_front_and_plain_front_are_never_door_actors
    furniture = build_furniture do |definition|
      door_child(definition, 'drawer-front', placement: 'frente_cajon', role: 'FRENTE_CAJON')
      door_child(definition, 'plain-front', placement: 'frontal', role: 'FRENTE')
      door_child(definition, 'the-door', placement: 'puerta', role: 'FRENTE')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 1, scanned.doors.length
    the_door = furniture.definition.entities.to_a[2]
    assert_equal [the_door], scanned.doors
  end

  def test_door_actor_via_door_role_only_is_detected
    furniture = build_furniture do |definition|
      door_child(definition, 'pilot-door', placement: 'door', role: 'door')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 1, scanned.doors.length
  end

  private

  # Yields the furniture definition so the test can add children; returns the
  # furniture occurrence whose definition carries those children.
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

  def hinge_child(definition, id, host:, hardware_definition_id: 'hw-hinge-generic')
    child = new_child(definition, id)
    @store.write(child, child_metadata(id, { 'entityClass' => 'hardware',
                                             'hostComponentInstanceId' => host,
                                             'hardwareDefinitionId' => hardware_definition_id }))
    child
  end

  def handle_child(definition, id, host:, hardware_definition_id: 'hw-pull-generic')
    child = new_child(definition, id)
    @store.write(child, child_metadata(id, { 'entityClass' => 'hardware',
                                             'hostComponentInstanceId' => host,
                                             'hardwareDefinitionId' => hardware_definition_id }))
    child
  end

  def board_child(definition, id)
    child = new_child(definition, id)
    @store.write(child,
                 child_metadata(id, { 'entityClass' => 'part', 'placement' => 'lateral_izquierdo',
                                      'role' => 'LATERAL_IZQ' }, identity_id: id))
    child
  end

  def child_metadata(id, intent, identity_id: "hw-inst-#{id}")
    {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'componentInstance',
      'identity' => { 'instanceRef' => identity_id, 'componentInstanceId' => identity_id,
                      'componentDefinitionId' => "def-#{id}" },
      'intent' => intent
    }
  end

  def new_child(definition, id)
    child_definition = @model.definitions.add("child-def-#{id}")
    child = definition.entities.add_instance(child_definition, Geom::Transformation.new)
    child.name = id
    child
  end
end
