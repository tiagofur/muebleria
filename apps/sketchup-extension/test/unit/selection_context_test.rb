# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/resolver'

# Canonical SelectionContext contract (#476): stable Granete identity for
# furniture/aggregate/part/hardware, strictly separated ID namespaces,
# capability-driven inspector data and the negative proofs that forbid
# identity collapse, name/geometry-based identity, provenance guesses and
# silent owner ambiguity.
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

  def test_top_level_furniture_produces_furniture_kind_with_local_ref_identity
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition, { 'widthMm' => 700 })
    furniture = @model.active_entities.instances.first

    context = @resolver.resolve(furniture)
    payload = context.to_payload

    assert_equal 'furniture', context.kind
    # Until the server owns Project identity (#384), the business ID stays
    # nil and the LOCAL locator carries the truth — never an alias.
    assert_nil context.furniture_instance_id
    assert_equal result['instance_id'], context.furniture_instance_ref
    assert_equal result['instance_id'], payload['furnitureInstanceRef']
    assert_nil payload['furnitureInstanceId']
    assert_equal 'kitchen-base-standard', context.furniture_definition_id
    assert_equal 'native', context.representation
    assert_equal 700, context.parameters['widthMm']
    assert context.definition.is_a?(Hash)
    assert context.capabilities.supported?('canEditParameters')
    assert context.capabilities.supported?('canDelete')
    refute context.capabilities.supported?('canDuplicate')
    # #466: the preflight review is available for managed furniture with a
    # resolvable definition — it runs the AUTHORITATIVE resolve.
    assert context.capabilities.supported?('canReviewPreflight')
  end

  # NEGATIVE PROOF: no ID namespace may collapse into another. Every key
  # keeps its own value end-to-end through the payload.
  def test_identity_namespaces_never_collapse
    layout = native_layout(board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'))
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    metadata = @store.read(furniture)
    metadata['identity'] = {
      'instanceRef' => 'local-ref-1',
      'furnitureInstanceId' => 'server-fi-1',
      'projectRef' => 'local-project-ref-1',
      'projectId' => 'server-project-1',
      'designRef' => 'local-design-ref-1',
      'designId' => 'server-design-1',
      'sourceRevisionRef' => 'local-source-rev-1',
      'baseRevisionId' => 'server-base-rev-1'
    }
    @store.write(furniture, metadata)

    payload = @resolver.resolve(furniture).to_payload

    assert_equal 'local-ref-1', payload['furnitureInstanceRef']
    assert_equal 'server-fi-1', payload['furnitureInstanceId']
    assert_equal 'local-project-ref-1', payload['projectRef']
    assert_equal 'server-project-1', payload['projectId']
    assert_equal 'local-design-ref-1', payload['designRef']
    assert_equal 'server-design-1', payload['designId']
    assert_equal 'local-source-rev-1', payload['sourceRevisionRef']
    assert_equal 'server-base-rev-1', payload['baseRevisionId']
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
    assert_equal result['instance_id'], context_a.furniture_instance_ref
    assert_nil context_a.furniture_instance_id
    assert_equal 'scan', context_a.owner_recovery
    assert_equal 2, context_a.semantic_path.length
    assert_equal 'Entrepaño 1', context_a.semantic_path.last

    # NEGATIVE PROOF (execution plan §17): two occurrences sharing one
    # componentDefinitionId must NEVER collapse into one selection context.
    assert_equal 'st-comp-shelf', context_b.component_definition_id
    assert_equal 'shelf-b', context_b.component_instance_id
    refute context_a.same_identity_as?(context_b)
  end

  # NEGATIVE PROOF: occurrence identity excludes reusable definition IDs —
  # a definition revision never changes WHO the occurrence is.
  def test_identity_key_ignores_definition_ids_and_host_bindings
    context_a = Granete::SketchUpExtension::Selection::SelectionContext.new(
      kind: 'part', furniture_instance_ref: 'ref-1', component_instance_id: 'shelf-a',
      component_definition_id: 'st-comp-shelf', host_component_instance_id: 'host-1'
    )
    context_b = Granete::SketchUpExtension::Selection::SelectionContext.new(
      kind: 'part', furniture_instance_ref: 'ref-1', component_instance_id: 'shelf-a',
      component_definition_id: 'st-comp-shelf-v2', host_component_instance_id: 'host-9'
    )

    assert context_a.same_identity_as?(context_b)
  end

  def test_hardware_produces_hardware_kind_with_placement_and_host_occurrence_ids
    layout = native_layout(
      board('door-1', 'mod-comp-door', 'puerta', 'Puerta'),
      hardware('place-hw-1', 'hw-handle', 'Manija 160', 'door-1', 'manual')
    )
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    handle = furniture.definition.entities.instances.last

    context = @resolver.resolve(handle)

    assert_equal 'hardware', context.kind
    assert_equal 'place-hw-1', context.hardware_placement_id
    assert_equal 'hw-handle', context.hardware_definition_id
    assert_equal 'door-1', context.host_component_instance_id
    assert_equal 'manual', context.placement_kind
    # Hardware keeps its OWN occurrence namespace: a part's
    # componentInstanceId is never fabricated for a placement.
    assert_nil context.component_instance_id
    # Manual hardware supports move and replacement; rotation and handedness
    # are derived automatically.
    assert context.capabilities['canMove'].supported?
    assert context.capabilities['canReplaceDefinition'].supported?
    refute context.capabilities['canRotate'].supported?
    refute context.capabilities['canChangeHandedness'].supported?
  end

  def test_derived_hardware_explains_correction_through_its_source
    layout = native_layout(
      board('door-1', 'mod-comp-door', 'puerta', 'Puerta'),
      hardware('place-hw-1', 'hw-hinge', 'Bisagra', 'door-1', 'derived')
    )
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    handle = @model.active_entities.instances.first.definition.entities.instances.last

    context = @resolver.resolve(handle)

    assert_equal 'hardware', context.kind
    assert_equal 'derived', context.placement_kind
    refute context.capabilities['canMove'].supported?
    assert_includes context.capabilities['canMove'].reason, 'derivado'
  end

  # NEGATIVE PROOF: absent provenance fails closed as 'unknown' with its own
  # remediation — never guessed as derived (or manual).
  def test_missing_provenance_fails_closed_as_unknown
    layout = native_layout(
      board('door-1', 'mod-comp-door', 'puerta', 'Puerta'),
      hardware('place-hw-1', 'hw-handle', 'Manija 160', 'door-1', nil)
    )
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    handle = @model.active_entities.instances.first.definition.entities.instances.last
    payload = @store.read(handle)
    payload['intent'].delete('placementKind')
    @store.write(handle, payload)

    context = @resolver.resolve(handle)

    assert_equal 'unknown', context.placement_kind
    refute context.capabilities['canMove'].supported?
    assert_includes context.capabilities['canMove'].reason, 'sin determinar'
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
    assert_equal result['instance_id'], after.furniture_instance_ref
    refute_equal before.semantic_path.last, after.semantic_path.last
  end

  def test_child_regeneration_recovers_the_same_semantic_context_by_granete_identity
    layout = native_layout(
      board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'),
      hardware('place-hw-1', 'hw-handle', 'Manija 160', 'shelf-a', 'manual')
    )
    result = @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    old_shelf = furniture.definition.entities.instances.first
    context_before = @resolver.resolve(old_shelf)
    old_persistent_id = old_shelf.persistent_id

    @builder.update_furniture(@model, furniture, fixture_definition, {}, resolved_layout: layout)

    new_shelf = furniture.definition.entities.instances.find do |instance|
      @store.read(instance).dig('identity', 'componentInstanceId') == 'shelf-a'
    end
    refute_nil new_shelf
    context_after = @resolver.resolve(new_shelf)

    assert context_after.same_identity_as?(context_before)
    assert_equal result['instance_id'], context_after.furniture_instance_ref
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
    assert_includes context.capabilities['canEditParameters'].reason, 'representación anterior'
    refute context.capabilities.supported?('canDelete')
  end

  def test_legacy_child_metadata_without_entity_class_uses_structured_host_binding_only
    layout = native_layout(
      board('door-1', 'mod-comp-door', 'puerta', 'Puerta'),
      hardware('place-hw-1', 'hw-handle', 'Manija 160', 'door-1', nil)
    )
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    handle = furniture.definition.entities.instances.last

    # Simulate metadata written before #476: drop the explicit discriminator.
    legacy_payload = @store.read(handle)
    legacy_payload['intent'].delete('entityClass')
    legacy_payload['intent'].delete('hardwareDefinitionId')
    legacy_payload['intent'].delete('placementKind')
    legacy_payload['identity'].delete('hardwarePlacementId')
    @store.write(handle, legacy_payload)

    context = @resolver.resolve(handle)

    # The structured hardware host binding (never the name) keeps hardware
    # resolution working until #416 migrates old models; provenance without
    # contract data fails closed.
    assert_equal 'hardware', context.kind
    assert_equal 'place-hw-1', context.hardware_placement_id
    assert_nil context.hardware_definition_id
    assert_equal 'unknown', context.placement_kind
  end

  def test_entity_names_never_drive_semantic_class
    layout = native_layout(board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'))
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf = furniture.definition.entities.instances.first

    shelf.name = 'Herraje bisagra especial'
    context = @resolver.resolve(shelf)

    assert_equal 'part', context.kind
    assert_nil context.hardware_placement_id
  end

  # --- #467 direct internal authoring: movability comes from the published
  # domain placement (layout slotId stored as intent `placement`), never
  # from names; missing placement data fails closed. ---

  def test_movable_internal_part_exposes_authoring_capabilities
    shelf_board = board('shelf-a', 'st-comp-shelf', 'interno', 'Entrepaño 1')
                  .merge('transform' => { 'translationMm' => [18, 18, 150] },
                         'authoringCapability' => { 'movable' => true, 'axis' => 'z' })
    layout = native_layout(shelf_board)
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf = furniture.definition.entities.instances.first

    context = @resolver.resolve(shelf)

    assert_equal 'part', context.kind
    assert_equal 'interno', context.component_placement
    assert_equal({ 'movable' => true, 'axis' => 'z' }, context.authoring_capability)
    assert_equal [18.0, 18.0, 150.0], context.assembly_translation_mm
    assert context.capabilities.supported?('canMoveWithinConstraint')
    assert context.capabilities.supported?('canDuplicate')
    assert context.capabilities.supported?('canAddRelated')
    assert context.capabilities.supported?('canRemove')
    refute context.capabilities.supported?('canChangeJoinery')
    assert context.capabilities.supported?('canInspectManufacturing')
  end

  def test_structural_part_keeps_authoring_capabilities_disabled_with_reason
    # The engine publishes NO authoring capability for structural parts —
    # the plugin fails closed on absence instead of inferring rights.
    layout = native_layout(board('door-a', 'st-comp-door', 'puerta', 'Puerta'))
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    door = furniture.definition.entities.instances.first

    context = @resolver.resolve(door)

    assert_equal 'part', context.kind
    assert_equal 'puerta', context.component_placement
    assert_nil context.authoring_capability
    refute context.capabilities.supported?('canMoveWithinConstraint')
    refute context.capabilities.supported?('canRemove')
    reason = context.capabilities['canMoveWithinConstraint'].reason
    assert reason, 'structural parts explain why direct authoring is off'
    assert_includes reason, 'estructurales'
  end

  def test_part_without_published_capability_fails_closed
    layout = native_layout(board('shelf-a', 'st-comp-shelf', 'interno', 'Entrepaño 1'))
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf = furniture.definition.entities.instances.first
    payload = @store.read(shelf)
    payload['intent'].delete('placement')
    @store.write(shelf, payload)

    context = @resolver.resolve(shelf)

    assert_equal 'part', context.kind
    assert_nil context.component_placement
    assert_nil context.authoring_capability
    refute context.capabilities.supported?('canMoveWithinConstraint')
    assert context.capabilities['canMoveWithinConstraint'].reason
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

  # --- owner recovery (#476 review): path > scan, ambiguity is honest ---

  def test_owner_recovery_prefers_the_real_active_path_over_a_scan
    layout = native_layout(board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'))
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf = furniture.definition.entities.instances.first

    # A native copy shares the definition AND (pre-#391) the metadata ref.
    copy = @model.active_entities.add_instance(furniture.definition, Geom::Transformation.new)
    metadata = @store.read(furniture)
    @store.write(copy, JSON.parse(JSON.generate(metadata)))
    copy.name = 'Copia del mueble'

    # Scan alone is ambiguous: two root entities carry the same ref.
    ambiguous = @resolver.resolve(shelf)
    assert_equal 'ambiguous', ambiguous.owner_recovery
    assert_nil ambiguous.host_locator['furniturePersistentId']
    assert_equal 1, ambiguous.semantic_path.length

    # The user inside the copy's editing context disambiguates via the real
    # host path — no silent first-match. Host reality: active_path holds the
    # OPEN instance chain only; the selected child belongs to
    # active_entities and is NOT a path member.
    path_model = PathModelStub.new(@model, [copy])
    path_resolver = Granete::SketchUpExtension::Selection::Resolver.new(
      metadata_store: @store, catalog_provider: @provider,
      model_provider: -> { path_model }
    )
    resolved = path_resolver.resolve(shelf)

    assert_equal 'path', resolved.owner_recovery
    assert_equal copy.persistent_id, resolved.host_locator['furniturePersistentId']
    assert_equal copy.name, resolved.semantic_path.first
  end

  def test_owner_recovery_reports_none_when_owner_entity_is_gone
    layout = native_layout(board('shelf-a', 'st-comp-shelf', 'shelf_1', 'Entrepaño 1'))
    @builder.insert_furniture(@model, fixture_definition, {}, resolved_layout: layout)
    furniture = @model.active_entities.instances.first
    shelf = furniture.definition.entities.instances.first

    @model.active_entities.erase_entities([furniture])

    context = @resolver.resolve(shelf)
    assert_equal 'none', context.owner_recovery
    assert_nil context.host_locator['furniturePersistentId']
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
    assert_equal 'scan', payload['ownerRecovery']
    assert payload['capabilities'].is_a?(Hash)
    # #470: board-level manufacturing inspection is a supported read-only
    # capability for managed parts (`Ver fabricación` overlay).
    assert_equal true, payload['capabilities']['canInspectManufacturing']['supported']
    assert payload['hostLocator']['entityPersistentId']
  end

  private

  # Minimal host-model double exposing an active editing path (the real
  # SketchUp concept Model#active_path) over the stub model's entities.
  class PathModelStub
    def initialize(model, active_path)
      @model = model
      @active_path = active_path
    end

    attr_reader :active_path

    def entities
      @model.entities
    end
  end

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

  def hardware(placement_id, hardware_id, name, host_component_instance_id, placement_kind)
    {
      'placementId' => placement_id,
      'hardwareId' => hardware_id,
      'name' => name,
      'hostComponentInstanceId' => host_component_instance_id,
      'placementKind' => placement_kind,
      'transform' => { 'translationMm' => [10, 20, 30] },
      'dimensionsMm' => [32, 37, 160],
      'colorHex' => '#c0c0c0'
    }.compact
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
