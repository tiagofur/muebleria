# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/selection/hardware_inventory'

# HardwareInventory.scan (#1046 S2): the project hardware inventory is
# discovered from MANAGED METADATA ONLY — children whose intent entityClass
# is 'hardware' inside MANAGED furniture occurrences — grouped by catalog
# definition and occurrence, with one sample occurrence per entry. Negative
# proofs: unmanaged/foreign furniture stays out, corrupt child metadata is
# skipped (fail closed per child), children without a catalog
# hardwareDefinitionId stay out, and repeated occurrences accumulate counts.
class HardwareInventoryTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
  end

  def test_groups_hardware_by_definition_and_furniture_occurrence
    build_managed_furniture('mueble-1') do |definition|
      hinge_child(definition, 'hinge-1')
      hinge_child(definition, 'hinge-2')
      handle_child(definition, 'handle-1')
      board_child(definition, 'side-panel')
    end

    scanned = scan

    assert_equal 2, scanned.items.length
    hinge_entry = entry_for(scanned, 'hw-hinge-generic')
    assert_equal 2, hinge_entry.occurrences
    assert_equal 'mueble-1', hinge_entry.furniture_instance_ref
    assert_equal 'hw-inst-hinge-1', hinge_entry.hardware_placement_id
    assert_equal 1, entry_for(scanned, 'hw-pull-generic').occurrences
  end

  def test_two_occurrences_of_same_definition_accumulate_counts
    build_managed_furniture('mueble-1') do |definition|
      hinge_child(definition, 'hinge-1')
    end
    build_managed_furniture('mueble-2') do |definition|
      hinge_child(definition, 'hinge-1')
    end

    scanned = scan

    assert_equal 2, scanned.items.length
    mueble1 = scanned.items.find { |e| e.furniture_instance_ref == 'mueble-1' }
    mueble2 = scanned.items.find { |e| e.furniture_instance_ref == 'mueble-2' }
    assert_equal 1, mueble1.occurrences
    assert_equal 1, mueble2.occurrences
  end

  def test_unmanaged_furniture_is_never_scanned
    definition = @model.definitions.add('foreign-def')
    child = new_child(definition, 'stray-hinge')
    @store.write(child, child_metadata('stray-hinge', hardware_intent))
    definition.add_instance(Geom::Transformation.new) # NO managed metadata.

    scanned = scan

    assert_empty scanned.items
  end

  def test_child_without_catalog_definition_id_stays_out
    build_managed_furniture('mueble-1') do |definition|
      hinge_child(definition, 'hinge-1')
      anonymous = new_child(definition, 'hw-anon')
      @store.write(anonymous, child_metadata('hw-anon', { 'entityClass' => 'hardware' }))
    end

    scanned = scan

    assert_equal 1, scanned.items.length
  end

  def test_corrupt_child_metadata_is_skipped_fail_closed
    build_managed_furniture('mueble-1') do |definition|
      hinge_child(definition, 'hinge-1')
      corrupt = hinge_child(definition, 'corrupt')
      corrupt.set_attribute('com.granete.sketchup_extension', 'bootstrap_intent.v1', '{not-json')
    end

    scanned = scan

    assert_equal 1, scanned.items.length
    assert_equal 1, entry_for(scanned, 'hw-hinge-generic').occurrences
  end

  def test_parts_are_never_inventory
    build_managed_furniture('mueble-1') do |definition|
      board_child(definition, 'side-panel')
    end

    scanned = scan

    assert_empty scanned.items
  end

  # #1046 S3: groups_for_furniture collects ONLY the option-group hardware
  # of ONE furniture, with the chosen concrete and real counts. Concrete
  # placements, board children and corrupt metadata stay out per child.
  def test_groups_for_furniture_collects_group_placements_with_counts
    furniture = build_managed_furniture('mueble-grupos') do |definition|
      hinge_child(definition, 'bis-1', hardware_definition_id: 'hw-blum')
      store_group_hinge(definition, 'bis-2', 'BISAGRA', 'hw-blum')
      store_group_hinge(definition, 'bis-3', 'BISAGRA', 'hw-blum')
      store_group_hinge(definition, 'jal-1', 'JALADERA', 'hw-pull-generic')
      board_child(definition, 'side-panel')
    end

    groups = Granete::SketchUpExtension::Selection::HardwareInventory.groups_for_furniture(@store, furniture)

    assert_equal [
      { 'code' => 'BISAGRA', 'chosenHardwareId' => 'hw-blum', 'count' => 2 },
      { 'code' => 'JALADERA', 'chosenHardwareId' => 'hw-pull-generic', 'count' => 1 }
    ], groups
  end

  def test_groups_for_furniture_without_group_hardware_returns_empty
    furniture = build_managed_furniture('mueble-concreto') do |definition|
      hinge_child(definition, 'hinge-1')
      board_child(definition, 'side-panel')
    end

    assert_equal [], Granete::SketchUpExtension::Selection::HardwareInventory.groups_for_furniture(@store, furniture)
  end

  def test_groups_for_furniture_skips_corrupt_child_metadata
    furniture = build_managed_furniture('mueble-corrupto') do |definition|
      store_group_hinge(definition, 'bis-1', 'BISAGRA', 'hw-blum')
      corrupt = hinge_child(definition, 'corrupto')
      corrupt.set_attribute('com.granete.sketchup_extension', 'bootstrap_intent.v1', '{not-json')
    end

    groups = Granete::SketchUpExtension::Selection::HardwareInventory.groups_for_furniture(@store, furniture)

    assert_equal [{ 'code' => 'BISAGRA', 'chosenHardwareId' => 'hw-blum', 'count' => 1 }], groups
  end

  # #1258: la card del mueble ofrece la UNIÓN de los roles consumidos de la
  # definición (la misma proyección del Configurador) y el escaneo de hijos
  # colocados — un grupo sin colocaciones (herraje cost-only que no renderiza)
  # sigue siendo elegible, con la elección explícita del item como vigente.
  def test_groups_for_furniture_unions_definition_roles_with_placed_scan
    furniture = build_managed_furniture('mueble-union') do |definition|
      store_group_hinge(definition, 'bis-1', 'BISAGRA', 'hw-blum')
    end

    groups = Granete::SketchUpExtension::Selection::HardwareInventory.groups_for_furniture(
      @store, furniture,
      definition_roles: [
        { 'code' => 'BISAGRA', 'name' => 'Bisagras', 'required' => true,
          'optionIds' => %w[hw-blum hw-eco] },
        { 'code' => 'JALADERA', 'name' => 'Jaladeras', 'required' => true,
          'optionIds' => %w[hw-pull] }
      ],
      item_choices: { 'JALADERA' => 'hw-pull-elegida' }
    )

    assert_equal [
      { 'code' => 'BISAGRA', 'chosenHardwareId' => 'hw-blum', 'count' => 1 },
      { 'code' => 'JALADERA', 'chosenHardwareId' => 'hw-pull-elegida' }
    ], groups
  end

  def test_groups_for_furniture_item_choice_wins_over_placed_concrete
    furniture = build_managed_furniture('mueble-eleccion') do |definition|
      store_group_hinge(definition, 'bis-1', 'BISAGRA', 'hw-blum')
    end

    groups = Granete::SketchUpExtension::Selection::HardwareInventory.groups_for_furniture(
      @store, furniture,
      definition_roles: [{ 'code' => 'BISAGRA' }],
      item_choices: { 'BISAGRA' => 'hw-eco' }
    )

    assert_equal [{ 'code' => 'BISAGRA', 'chosenHardwareId' => 'hw-eco', 'count' => 1 }], groups
  end

  def test_groups_for_furniture_keeps_placed_only_groups_after_roles
    furniture = build_managed_furniture('mueble-manual') do |definition|
      store_group_hinge(definition, 'torn-1', 'TORNILLO', 'hw-screw')
    end

    groups = Granete::SketchUpExtension::Selection::HardwareInventory.groups_for_furniture(
      @store, furniture,
      definition_roles: [{ 'code' => 'BISAGRA' }],
      item_choices: {}
    )

    assert_equal [
      { 'code' => 'BISAGRA' },
      { 'code' => 'TORNILLO', 'chosenHardwareId' => 'hw-screw', 'count' => 1 }
    ], groups
  end

  def test_groups_for_furniture_roles_survive_without_placed_children
    furniture = build_managed_furniture('mueble-solo-roles') do |definition|
      board_child(definition, 'side-panel')
    end

    groups = Granete::SketchUpExtension::Selection::HardwareInventory.groups_for_furniture(
      @store, furniture,
      definition_roles: [{ 'code' => 'BISAGRA', 'optionIds' => %w[hw-blum] }],
      item_choices: {}
    )

    assert_equal [{ 'code' => 'BISAGRA' }], groups
  end

  def store_group_hinge(definition, id, option_role, hardware_definition_id)
    child = new_child(definition, id)
    intent = hardware_intent(hardware_definition_id).merge('optionRole' => option_role)
    @store.write(child, child_metadata(id, intent))
    child
  end

  private

  def scan
    Granete::SketchUpExtension::Selection::HardwareInventory.scan(@model, @store)
  end

  def entry_for(scanned, hardware_id)
    scanned.items.find { |e| e.hardware_definition_id == hardware_id }
  end

  # Builds a managed furniture occurrence at model top level (the inventory
  # scans model.entities) whose definition carries the yielded children.
  def build_managed_furniture(ref)
    definition = @model.definitions.add("furniture-def-#{ref}")
    yield definition
    furniture = @model.entities.add_instance(definition, Geom::Transformation.new)
    @store.write(furniture, {
                   'namespace' => 'com.granete.sketchup_extension',
                   'metadataVersion' => 1,
                   'kind' => 'furnitureInstance',
                   'identity' => { 'instanceRef' => ref, 'furnitureInstanceRef' => ref }
                 })
    furniture
  end

  def hinge_child(definition, id, hardware_definition_id: 'hw-hinge-generic')
    child = new_child(definition, id)
    @store.write(child, child_metadata(id, hardware_intent(hardware_definition_id)))
    child
  end

  def handle_child(definition, id, hardware_definition_id: 'hw-pull-generic')
    child = new_child(definition, id)
    @store.write(child, child_metadata(id, hardware_intent(hardware_definition_id)))
    child
  end

  def board_child(definition, id)
    child = new_child(definition, id)
    @store.write(child,
                 child_metadata(id, { 'entityClass' => 'part', 'placement' => 'lateral_izquierdo',
                                      'role' => 'LATERAL_IZQ' }))
    child
  end

  def hardware_intent(hardware_definition_id = 'hw-hinge-generic')
    { 'entityClass' => 'hardware', 'hardwareDefinitionId' => hardware_definition_id }
  end

  def child_metadata(id, intent)
    {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'componentInstance',
      'identity' => { 'instanceRef' => "hw-inst-#{id}", 'hardwarePlacementId' => "hw-inst-#{id}" },
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
