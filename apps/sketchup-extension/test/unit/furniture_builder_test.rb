# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'

class FurnitureBuilderTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
  end

  def test_inserts_hierarchical_furniture_with_components_and_metadata
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition,
                                       { 'widthMm' => 600, 'shelfCount' => 2, 'doorCount' => 1 })

    assert result['success']
    assert_equal 'Gabinete Base Estándar', result['name']
    assert_equal 5, result['component_count']

    assert_equal 1, @model.active_entities.groups.length
    main_group = @model.active_entities.groups.first
    assert_includes main_group.name, 'Gabinete Base Estándar'

    # Level 1 Furniture metadata
    furniture_meta = @store.read(main_group)
    refute_nil furniture_meta
    assert_equal 'furnitureInstance', furniture_meta['kind']
    assert_equal 'kitchen-base-standard', furniture_meta['intent']['furnitureDefinitionId']
    assert_equal 600, furniture_meta['intent']['parameters']['widthMm']

    # Level 2 Component metadata
    assert_equal 5, main_group.entities.groups.length
    first_comp = main_group.entities.groups.first
    comp_meta = @store.read(first_comp)
    refute_nil comp_meta
    assert_equal 'componentInstance', comp_meta['kind']
    assert_equal 'left_side', comp_meta['intent']['semanticRole']

    # One flat undoable gesture per interaction: exactly one start/commit pair,
    # no nested operations from metadata writes.
    assert_equal [[:start, 'Insertar Mueble Gabinete Base Estándar', true], :commit],
                 @model.operations
  end

  def test_updates_furniture_in_place_regenerating_components_and_preserving_identity
    definition = @provider.find_definition('kitchen-base-standard')
    insert_result = @builder.insert_furniture(@model, definition,
                                              { 'widthMm' => 600, 'shelfCount' => 1, 'doorCount' => 1 })
    main_group = @model.active_entities.groups.first
    initial_id = insert_result['instance_id']

    # Update: Increase width to 900mm and shelfCount to 3
    update_result = @builder.update_furniture(@model, main_group, definition,
                                              { 'widthMm' => 900, 'shelfCount' => 3, 'doorCount' => 1 })

    assert update_result['success']
    assert_equal initial_id, update_result['instance_id']
    # 2 laterals + 3 shelves + 1 door = 6 components
    assert_equal 6, update_result['component_count']
    assert_equal 6, main_group.entities.groups.length

    # Verify updated metadata
    updated_meta = @store.read(main_group)
    assert_equal 900, updated_meta['intent']['parameters']['widthMm']
    assert_equal 3, updated_meta['intent']['parameters']['shelfCount']
  end

  # The server-resolved layout shape (granete.resolvedFurnitureLayout served by
  # GET /furniture/definitions/{id}/layout): pre-baked AABBs, min-corner
  # translations, boards + visible hardware, real board materials.
  RESOLVED_LAYOUT = {
    'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
    'definitionName' => 'Base Una Puerta 600',
    'dimensionsMm' => [600, 720, 560],
    'components' => [
      { 'componentInstanceId' => 'st-side-l', 'slotId' => 'lateral_izquierdo', 'role' => 'LATERAL',
        'name' => 'Lateral', 'kind' => 'board',
        'transform' => { 'translationMm' => [0, 0, 0] }, 'dimensionsMm' => [18, 560, 684],
        'optionRole' => 'LATERAL', 'materialColorHex' => '#c8b89a' },
      { 'componentInstanceId' => 'st-side-r', 'slotId' => 'lateral_derecho', 'role' => 'LATERAL',
        'name' => 'Lateral', 'kind' => 'board',
        'transform' => { 'translationMm' => [582, 0, 0] }, 'dimensionsMm' => [18, 560, 684],
        'optionRole' => 'LATERAL', 'materialColorHex' => '#c8b89a' },
      { 'componentInstanceId' => 'mod-door', 'slotId' => 'puerta', 'role' => 'FRENTE',
        'name' => 'Puerta', 'kind' => 'board',
        'transform' => { 'translationMm' => [2, 560, 2] }, 'dimensionsMm' => [596, 18, 716],
        'optionRole' => 'FRENTE', 'materialId' => 'mat-oak', 'materialCode' => 'ROBLE-CLARO',
        'materialName' => 'Roble Claro', 'materialColorHex' => '#c4a574' }
    ],
    'hardware' => [
      { 'placementId' => 'mod-door-hw-0', 'hardwareId' => 'hw-handle', 'name' => 'Manija 160',
        'shape' => 'bar-pull', 'hostComponentInstanceId' => 'mod-door', 'anchorFace' => 'front',
        'transform' => { 'translationMm' => [542, 578, 282] }, 'dimensionsMm' => [32, 25, 160],
        'colorHex' => '#c0c0c0' }
    ]
  }.freeze

  def test_inserts_the_full_resolved_composition_with_hardware
    definition = @provider.find_definition('kitchen-base-standard')

    result = @builder.insert_furniture(@model, definition,
                                       { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
                                       resolved_layout: RESOLVED_LAYOUT)

    assert result['success']
    # Every resolved element materializes: 3 boards + 1 handle. This is the
    # regression behind "solo se generan los laterales / 2 piezas".
    assert_equal 4, result['component_count']
    assert_equal 3, result['board_count']
    assert_equal 1, result['hardware_count']

    main_group = @model.active_entities.groups.first
    assert_equal 4, main_group.entities.groups.length

    names = main_group.entities.groups.map(&:name)
    assert_includes names, 'Lateral'
    assert_includes names, 'Puerta'
    assert_includes names, 'Manija 160'

    # The handle keeps its host identity in the component metadata.
    handle_group = main_group.entities.groups.find { |g| g.name == 'Manija 160' }
    handle_meta = @store.read(handle_group)
    assert_equal 'componentInstance', handle_meta['kind']
    assert_equal 'hardware_mod-door-hw-0', handle_meta['intent']['semanticRole']

    assert_equal [[:start, 'Insertar Mueble Gabinete Base Estándar', true], :commit],
                 @model.operations
  end

  def test_resolved_components_are_painted_with_material_colors
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition, {}, resolved_layout: RESOLVED_LAYOUT)

    main_group = @model.active_entities.groups.first

    # The chosen board becomes a namespaced SketchUp material with its color,
    # and the component group is painted with it.
    door = main_group.entities.groups.find { |g| g.name == 'Puerta' }
    refute_nil door.material
    assert_equal 'Granete · Roble Claro', door.material.name
    assert_equal '#c4a574', door.material.color

    # Roles without an explicit choice keep the palette fallback color.
    lateral = main_group.entities.groups.find { |g| g.name == 'Lateral' }
    assert_equal 'Granete · LATERAL', lateral.material.name
    assert_equal '#c8b89a', lateral.material.color

    # Hardware paints with its own preview color.
    handle = main_group.entities.groups.find { |g| g.name == 'Manija 160' }
    assert_equal '#c0c0c0', handle.material.color

    # Same role reuses one material (no duplicates per copy).
    assert_equal 3, @model.materials.materials.length
  end

  def test_updates_furniture_with_a_new_resolved_composition
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition, {}, resolved_layout: RESOLVED_LAYOUT)
    main_group = @model.active_entities.groups.first

    shrunk = JSON.parse(JSON.generate(RESOLVED_LAYOUT))
    shrunk['components'] = shrunk['components'].first(2)
    shrunk['hardware'] = []

    result = @builder.update_furniture(@model, main_group, definition, {},
                                       resolved_layout: shrunk)

    assert result['success']
    assert_equal 2, result['component_count']
    assert_equal 2, main_group.entities.groups.length
  end
end
