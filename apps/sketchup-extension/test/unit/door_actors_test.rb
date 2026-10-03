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

  # #529: door_payloads carry the per-door hardware with hinge/handle
  # classified from the CATALOG category — never from names. Unresolvable
  # hardware stays 'other'.
  def test_door_payloads_classify_hardware_via_catalog
    catalog = lambda do |hw_id|
      case hw_id
      when 'hw-hinge-35' then { 'category' => 'Hinge' }
      when 'hw-pull-128' then { 'previewShape' => 'bar-pull' }
      end
    end
    furniture = build_furniture do |definition|
      door_child(definition, 'door-left', placement: 'puerta', role: 'FRENTE')
      hinge_child(definition, 'hinge-1', host: 'door-left', hardware_definition_id: 'hw-hinge-35')
      hinge_child(definition, 'hinge-2', host: 'door-left', hardware_definition_id: 'hw-hinge-35')
      handle_child(definition, 'handle-1', host: 'door-left', hardware_definition_id: 'hw-pull-128')
      hinge_child(definition, 'mystery-1', host: 'door-left', hardware_definition_id: 'hw-unknown')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store, catalog_hardware: catalog)

    payload = scanned.door_payloads.first
    assert_equal 0, payload['slotIndex']
    categories = payload['hardware'].map { |entry| entry['category'] }
    assert_equal %w[hinge hinge handle other], categories
    assert(payload['hardware'].all? { |entry| entry['id'].to_s.start_with?('hw-inst-') })
  end

  def test_door_payloads_without_catalog_lookup_classify_as_other
    furniture = build_furniture do |definition|
      door_child(definition, 'door-left', placement: 'puerta', role: 'FRENTE')
      hinge_child(definition, 'hinge-1', host: 'door-left', hardware_definition_id: 'hw-hinge-35')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal(['other'], scanned.door_payloads.first['hardware'].map { |entry| entry['category'] })
  end

  def test_find_hardware_entity_resolves_navigation_target
    furniture = build_furniture do |definition|
      door_child(definition, 'door-left', placement: 'puerta', role: 'FRENTE')
      hinge_child(definition, 'hinge-1', host: 'door-left')
    end

    entity = Granete::SketchUpExtension::Selection::DoorActors.find_hardware_entity(furniture, @store,
                                                                                    'hw-inst-hinge-1')
    refute_nil entity

    assert_nil Granete::SketchUpExtension::Selection::DoorActors.find_hardware_entity(furniture, @store, 'hw-inst-nope')
    assert_nil Granete::SketchUpExtension::Selection::DoorActors.find_hardware_entity(furniture, @store, nil)
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
