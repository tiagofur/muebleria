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

  def test_insertion_selects_the_new_furniture_and_activates_move_tool
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition,
                                       { 'widthMm' => 600, 'shelfCount' => 2, 'doorCount' => 1 })

    assert result['success']
    # Placement assist: the fresh group stays selected and the Move tool is
    # activated so the user lands it where intended (interim north-star step).
    main_group = @model.active_entities.groups.first
    assert_equal [main_group], @model.selection.items
    assert_includes SketchupStub.send_actions, 'selectMoveTool:'
    # Selection is UI state, not an undoable model operation.
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

  def test_inserts_resolved_composition_with_long_composite_hardware_id
    definition = @provider.find_definition('kitchen-base-standard')
    long_hw_layout = JSON.parse(JSON.generate(RESOLVED_LAYOUT))
    long_hw_layout['hardware'] = [
      {
        'placementId' => 'agr-agr-1786465647616-8jgc-u0-a0000008-0000-0000-0000-000000000001-copy-0-hw-0',
        'hardwareId' => 'a0000003-0000-0000-0000-000000000002',
        'name' => 'Jaladera Acero Inox',
        'shape' => 'bar-pull',
        'hostComponentInstanceId' => 'agr-agr-1786465647616-8jgc-u0-a0000008-0000-0000-0000-000000000001-copy-0',
        'anchorFace' => 'front',
        'transform' => { 'translationMm' => [552, 578, 592] },
        'dimensionsMm' => [32, 25, 96],
        'colorHex' => '#1a1a1a'
      }
    ]

    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: long_hw_layout)

    assert result['success'], "insert failed with: #{result['error']}"
    assert_equal 4, result['component_count']
    assert_equal 1, result['hardware_count']

    main_group = @model.active_entities.groups.first
    hw_group = main_group.entities.groups.find { |g| g.name == 'Jaladera Acero Inox' }
    refute_nil hw_group
    hw_meta = @store.read(hw_group)
    assert_equal 'componentInstance', hw_meta['kind']
    assert_equal 'hardware_agr-agr-1786465647616-8jgc-u0-a0000008-0000-0000-0000-000000000001-copy-0-hw-0',
                 hw_meta['intent']['semanticRole']
  end

  def test_ensures_downward_normal_faces_are_reversed_upwards
    # In SketchUp, ground plane faces often default to downward normal (-Z).
    # Builder must reverse them so pushpull extrudes upwards (+Z).
    custom_entities = SketchupStub::EntitiesStub.new
    class << custom_entities
      def add_face(_pts)
        face = SketchupStub::FaceStub.new
        face.normal = Geom::Vector3d.new(0, 0, -1)
        @faces << face
        face
      end
    end
    group = SketchupStub::GroupStub.new('TestGroup')
    group.instance_variable_set(:@entities, custom_entities)

    @builder.send(:build_box_geometry, group, 0, 0, 0, 600, 500, 720)

    face = custom_entities.faces.first
    refute_nil face
    assert face.normal.z.positive?, 'Face normal must be reversed to point upwards (+Z)'
  end

  def test_resolved_components_apply_physical_scale_texture
    definition = @provider.find_definition('kitchen-base-standard')
    fake_texture_file = File.expand_path('../support/fixtures/oak_test.jpg', __dir__)
    FileUtils.mkdir_p(File.dirname(fake_texture_file))
    File.write(fake_texture_file, 'fake-image-data')

    cache_mock = Object.new
    cache_mock.define_singleton_method(:resolve_texture) { |_url| fake_texture_file }

    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: @store,
      texture_cache: cache_mock
    )

    textured_layout = JSON.parse(JSON.generate(RESOLVED_LAYOUT))
    textured_layout['components'].last['materialTextureUrl'] = '/api/media/oak_test.jpg'
    textured_layout['components'].last['materialTextureTileWidthMm'] = 1830.0
    textured_layout['components'].last['materialTextureTileLengthMm'] = 2440.0

    builder.insert_furniture(@model, definition, {}, resolved_layout: textured_layout)

    door = @model.active_entities.groups.first.entities.groups.find { |g| g.name == 'Puerta' }
    refute_nil door.material
    refute_nil door.material.texture
    assert_equal fake_texture_file, door.material.texture.filename
    assert_in_delta 72.047, door.material.texture.size[0], 0.01
    assert_in_delta 96.063, door.material.texture.size[1], 0.01
  ensure
    FileUtils.rm_f(fake_texture_file)
  end

  def test_resolved_hardware_uses_asset_loader_when_asset_available
    definition = @provider.find_definition('kitchen-base-standard')
    loader_mock = Object.new
    loaded_instances = []
    loader_mock.define_singleton_method(:load_asset_instance) do |_model, asset_id, _target_group, pos|
      loaded_instances << { asset_id: asset_id, pos: pos }
      true
    end

    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: @store,
      asset_loader: loader_mock
    )

    layout_with_hardware = JSON.parse(JSON.generate(RESOLVED_LAYOUT))
    layout_with_hardware['hardware'] = [
      {
        'name' => 'Tirador Perfil',
        'assetId' => 'handle_profile_96',
        'transform' => { 'translationMm' => [100, 20, 700] },
        'dimensionsMm' => [96, 32, 25]
      }
    ]

    builder.insert_furniture(@model, definition, {}, resolved_layout: layout_with_hardware)

    assert_equal 1, loaded_instances.length
    assert_equal 'handle_profile_96', loaded_instances.first[:asset_id]
    assert_equal [100, 20, 700], loaded_instances.first[:pos]
  end
end
