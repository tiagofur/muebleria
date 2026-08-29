# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/resolver'

# Canonical SelectionContext contract (#476): stable Granete identity for
# furniture/aggregate/part/hardware, capability-driven inspector data and the
# negative proofs that forbid name/geometry-based identity, occurrence
# collapsing and guessed managed entities.
class SelectionContextTest < Minitest::Test
  IDENTITY_BASIS = {
    'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1]
  }.freeze

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @resolver = Granete::SketchUpExtension::Selection::Resolver.new(
      metadata_store: @store,
      catalog_provider: @provider
    )
  end

  def test_top_level_furniture_produces_furniture_kind_with_granete_identity
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition, { 'widthMm' => 700 })
    furniture = @model.active_entities.instances.first

    context = @resolver.resolve(furniture)

    assert_equal 'furniture', context.kind
    assert_equal result['instance_id'], context.furniture_instance_id
    assert_equal result['instance_id'], context.to_payload['furnitureInstanceRef']
    assert_equal 'kitchen-base-standard', context.furniture_definition_id
    assert_equal 'native', context.representation
    assert_equal 700, context.parameters['widthMm']
    assert context.definition.is_a?(Hash)
    assert context.capabilities.supported?('canEditParameters')
    assert context.capabilities.supported?('canDelete')
    refute context.capabilities.supported?('canDuplicate')
    refute context.capabilities.supported?('canReviewPreflight')
  end

  def test_managed_shelf_produces_part_kind_with_occurrence_and_definition_identity
    layout = native_layout(
      board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'),
      board('shelf-b', 'st-comp-shelf', 'shelf_2', 'Entrepaño 2')
    )
    result = @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf_a, shelf_b = furniture.definition.entities.instances.first(2)

    context_a = @resolver.resolve(shelf_a)
    context_b = @resolver.resolve(shelf_b)

    assert_equal 'part', context_a.kind
    assert_equal 'shelf-a', context_a.component_instance_id
    assert_equal 'st-comp-shelf', context_a.component_definition_id
    assert_equal result['instance_id'], context_a.furniture_instance_id
    assert_equal 2, context_a.semantic_path.length
    assert_equal 'Entrepaño 1', context_a.semantic_path.last

    # NEGATIVE PROOF (execution plan §17): two occurrences sharing one
    # componentDefinitionId must NEVER collapse into one selection context.
    assert_equal 'st-comp-shelf', context_b.component_definition_id
    assert_equal 'shelf-b', context_b.component_instance_id
    refute context_a.same_identity_as?(context_b)
    refute context_a.to_payload['componentInstanceId'] == context_b.to_payload['componentInstanceId']
  end

  def test_hardware_produces_hardware_kind_with_placement_and_host_occurrence_ids
    layout = native_layout(
      board('door-1', 'mod-comp-door', 'puerta', 'Puerta'),
      hardware('place-hw-1', 'hw-handle', 'Manija 160', 'door-1')
    )
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    handle = furniture.definition.entities.instances.last

    context = @resolver.resolve(handle)

    assert_equal 'hardware', context.kind
    assert_equal 'place-hw-1', context.hardware_placement_id
    assert_equal 'hw-handle', context.hardware_definition_id
    assert_equal 'door-1', context.host_component_instance_id
    assert_equal 'resolved', context.origin
    # Derived hardware never exposes manual-edit capabilities.
    refute context.capabilities['canMove'].supported?
    refute context.capabilities['canRotate'].supported?
    refute context.capabilities['canChangeHandedness'].supported?
    refute context.capabilities['canReplaceDefinition'].supported?
    assert context.capabilities['canMove'].reason
  end

  def test_rename_and_world_move_never_change_selection_identity
    layout = native_layout(board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'))
    result = @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf = furniture.definition.entities.instances.first

    before = @resolver.resolve(shelf)
    furniture.name = 'Módulo rotado y renombrado'
    shelf.name = 'Estante superior renombrado'
    furniture.transformation = Geom::Transformation.translation(Geom::Vector3d.new(120.0, 40.0, 9.0))

    after = @resolver.resolve(shelf)

    assert after.same_identity_as?(before)
    assert_equal result['instance_id'], after.furniture_instance_id
    refute_equal before.semantic_path.last, after.semantic_path.last
  end

  def test_child_regeneration_recovers_the_same_semantic_context_by_granete_identity
    layout = native_layout(
      board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'),
      hardware('place-hw-1', 'hw-handle', 'Manija 160', 'shelf-a')
    )
    result = @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    old_shelf = furniture.definition.entities.instances.first
    context_before = @resolver.resolve(old_shelf)
    old_persistent_id = old_shelf.persistent_id

    # Rebuild regenerates every child (new persistent_ids) while the server
    # keeps contract componentInstanceIds stable.
    @builder.update_furniture(@model, furniture, fixture_definition, {}, resolved_layout: layout)

    new_shelf = furniture.definition.entities.instances.find do |instance|
      @store.read(instance).dig('identity', 'componentInstanceId') == 'shelf-a'
    end
    refute_nil new_shelf
    context_after = @resolver.resolve(new_shelf)

    assert context_after.same_identity_as?(context_before)
    assert_equal result['instance_id'], context_after.furniture_instance_id
    refute_equal old_persistent_id, new_shelf.persistent_id
    assert_equal old_persistent_id, context_before.host_locator['entityPersistentId']
    assert_equal new_shelf.persistent_id, context_after.host_locator['entityPersistentId']
  end

  def test_arbitrary_user_geometry_stays_unmanaged
    user_group = @model.active_entities.add_group
    user_definition = @model.definitions.add('User Component')
    user_instance = @model.active_entities.add_instance(user_definition, Geom::Transformation.new)
    raw_face = @model.active_entities.add_face([
                                                 Geom::Point3d.new(0, 0, 0), Geom::Point3d.new(10, 0, 0),
                                                 Geom::Point3d.new(10, 10, 0), Geom::Point3d.new(0, 10, 0)
                                               ])

    [user_group, user_instance, raw_face].each do |entity|
      context = @resolver.resolve(entity)
      assert_equal 'unmanaged', context.kind, "expected unmanaged for #{entity.class}"
      assert_empty context.capabilities.to_h
    end

    # NEGATIVE PROOF: a Group merely responding to #definition is never a
    # native managed entity without metadata/type rules.
    assert user_group.respond_to?(:definition)
  end

  def test_legacy_group_furniture_is_furniture_but_fails_closed_to_edit
    group = @model.active_entities.add_group
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, group, 'inst-legacy', fixture_definition, {}
    )

    context = @resolver.resolve(group)

    assert_equal 'furniture', context.kind
    assert_equal 'legacy-group', context.representation
    refute context.capabilities.supported?('canEditParameters')
    assert_includes context.capabilities['canEditParameters'].reason, '416'
    refute context.capabilities.supported?('canDelete')
  end

  def test_legacy_child_metadata_without_entity_class_uses_structured_host_binding_only
    layout = native_layout(
      board('door-1', 'mod-comp-door', 'puerta', 'Puerta'),
      hardware('place-hw-1', 'hw-handle', 'Manija 160', 'door-1')
    )
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    handle = furniture.definition.entities.instances.last

    # Simulate metadata written before #476: drop the explicit discriminator.
    legacy_payload = @store.read(handle)
    legacy_payload['intent'].delete('entityClass')
    legacy_payload['intent'].delete('hardwareDefinitionId')
    legacy_payload['intent'].delete('placementOrigin')
    @store.write(handle, legacy_payload)

    context = @resolver.resolve(handle)

    # The structured hardware host binding (never the name) keeps hardware
    # resolution working until #416 migrates old models.
    assert_equal 'hardware', context.kind
    assert_equal 'place-hw-1', context.hardware_placement_id
    assert_nil context.hardware_definition_id
    assert_equal 'resolved', context.origin
  end

  def test_entity_names_never_drive_semantic_class
    layout = native_layout(board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'))
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf = furniture.definition.entities.instances.first

    # A part named like hardware must stay a part: no name heuristics.
    shelf.name = 'Herraje bisagra especial'
    context = @resolver.resolve(shelf)

    assert_equal 'part', context.kind
    assert_nil context.hardware_placement_id
  end

  def test_aggregate_metadata_resolves_aggregate_kind
    layout = native_layout(board('agg-1', 'st-comp-drawer', 'cajon', 'Cajón'))
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    aggregate = furniture.definition.entities.instances.first
    payload = @store.read(aggregate)
    payload['intent']['entityClass'] = 'aggregate'
    @store.write(aggregate, payload)

    context = @resolver.resolve(aggregate)

    assert_equal 'aggregate', context.kind
    assert_equal 'agg-1', context.component_instance_id
    refute context.capabilities.supported?('canMoveWithinConstraint')
  end

  def test_manual_placement_origin_blocks_manual_edit_explanation_consistently
    context = Granete::SketchUpExtension::Selection::SelectionContext.new(
      kind: 'hardware', origin: 'manual', hardware_placement_id: 'place-manual-1'
    )
    context.capabilities = Granete::SketchUpExtension::Selection::CapabilityPolicy.compute(context)

    refute context.capabilities['canMove'].supported?
    assert_includes context.capabilities['canMove'].reason, '468'
  end

  def test_furniture_without_catalog_definition_disables_edit_with_reason
    missing = { 'furniture_definition_id' => 'gone-def', 'name' => 'Mueble desaparecido',
                'parameters' => [] }
    layout = native_layout(board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'))
    @builder.insert_furniture(@model, missing, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first

    context = @resolver.resolve(furniture)

    assert_equal 'furniture', context.kind
    assert_nil context.definition
    refute context.capabilities.supported?('canEditParameters')
    assert context.capabilities['canEditParameters'].reason
  end

  def test_nil_entity_resolves_to_nil_context
    assert_nil @resolver.resolve(nil)
  end

  def test_payload_exposes_contract_keys_and_capabilities
    layout = native_layout(
      board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1', 'cat-shelf-1')
    )
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf = furniture.definition.entities.instances.first

    payload = @resolver.resolve(shelf).to_payload

    assert_equal 'part', payload['kind']
    assert_equal 'shelf-a', payload['componentInstanceId']
    assert_equal 'st-comp-shelf', payload['componentDefinitionId']
    assert_equal 'cat-shelf-1', payload['catalogComponentId']
    assert payload['capabilities'].is_a?(Hash)
    assert payload['capabilities']['canInspectManufacturing']['supported'] == false
    assert payload['capabilities']['canInspectManufacturing']['reason']
    assert payload['hostLocator']['entityPersistentId']
  end

  private

  def fixture_definition
    {
      'furniture_definition_id' => 'mod-1',
      'name' => 'Base Una Puerta 600',
      'parameters' => [
        { 'name' => 'widthMm', 'defaultValue' => 600 },
        { 'name' => 'heightMm', 'defaultValue' => 720 },
        { 'name' => 'depthMm', 'defaultValue' => 560 }
      ]
    }
  end

  def board(component_instance_id, component_definition_id, slot_id, name, catalog_component_id = nil)
    {
      'componentInstanceId' => component_instance_id,
      'componentDefinitionId' => component_definition_id,
      'slotId' => slot_id,
      'name' => name,
      'widthMm' => 560, 'thicknessMm' => 18, 'lengthMm' => 684,
      'localTransform' => { 'translationMm' => [0, 0, 0], 'basis' => IDENTITY_BASIS }
    }.tap do |body|
      body['catalogComponentId'] = catalog_component_id if catalog_component_id
    end
  end

  def hardware(placement_id, hardware_id, name, host_component_instance_id)
    {
      'placementId' => placement_id,
      'hardwareId' => hardware_id,
      'name' => name,
      'hostComponentInstanceId' => host_component_instance_id,
      'transform' => { 'translationMm' => [10, 20, 30] },
      'dimensionsMm' => [32, 37, 160],
      'colorHex' => '#c0c0c0'
    }
  end

  def native_layout(*components)
    body = {
      'furnitureDefinitionId' => 'mod-1',
      'definitionName' => 'Base Una Puerta 600',
      'transformContract' => 'granete.local-basis.v1',
      'dimensionsMm' => [600, 720, 560],
      'components' => components.select { |c| c.key?('componentInstanceId') },
      'hardware' => components.select { |c| c.key?('placementId') }
    }
    Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
  end
end
