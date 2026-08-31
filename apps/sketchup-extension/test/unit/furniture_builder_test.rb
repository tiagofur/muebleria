# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'

class FurnitureBuilderTest < Minitest::Test
  MM = 1.0 / 25.4

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
  end

  def furniture_instance
    @model.active_entities.instances.first
  end

  def part_instances
    furniture_instance.definition.entities.instances
  end

  # The server-resolved layout in the #414 contract shape: local box extents
  # + authoritative local→furniture transform (right-handed basis). The AABB
  # fields are optional passthrough the renderer must not depend on.
  RESOLVED_LAYOUT_BODY = {
    'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
    'definitionName' => 'Base Una Puerta 600',
    'transformContract' => 'granete.local-basis.v1',
    'dimensionsMm' => [600, 720, 560],
    'components' => [
      { 'componentInstanceId' => 'st-side-l', 'componentDefinitionId' => 'st-side',
        'slotId' => 'lateral_izquierdo', 'role' => 'LATERAL',
        'name' => 'Lateral', 'kind' => 'board',
        'transform' => { 'translationMm' => [0, 0, 0] }, 'dimensionsMm' => [18, 560, 684],
        'localTransform' => {
          'translationMm' => [0, 560, 0],
          'basis' => { 'x' => [0, -1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }
        },
        'lengthMm' => 684, 'widthMm' => 560, 'thicknessMm' => 18,
        'optionRole' => 'LATERAL', 'materialColorHex' => '#c8b89a' },
      { 'componentInstanceId' => 'st-side-r', 'componentDefinitionId' => 'st-side',
        'slotId' => 'lateral_derecho', 'role' => 'LATERAL',
        'name' => 'Lateral', 'kind' => 'board',
        'transform' => { 'translationMm' => [582, 0, 0] }, 'dimensionsMm' => [18, 560, 684],
        'localTransform' => {
          'translationMm' => [582, 560, 0],
          'basis' => { 'x' => [0, -1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }
        },
        'lengthMm' => 684, 'widthMm' => 560, 'thicknessMm' => 18,
        'optionRole' => 'LATERAL', 'materialColorHex' => '#c8b89a' },
      { 'componentInstanceId' => 'mod-door', 'componentDefinitionId' => 'mod-door',
        'slotId' => 'puerta', 'role' => 'FRENTE',
        'name' => 'Puerta', 'kind' => 'board',
        'transform' => { 'translationMm' => [2, 560, 2] }, 'dimensionsMm' => [596, 18, 716],
        'localTransform' => {
          'translationMm' => [2, 560, 2],
          'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
        },
        'lengthMm' => 716, 'widthMm' => 596, 'thicknessMm' => 18,
        'optionRole' => 'FRENTE', 'materialId' => 'mat-oak', 'materialCode' => 'ROBLE-CLARO',
        'materialName' => 'Roble Claro', 'materialColorHex' => '#c4a574' }
    ],
    'hardware' => [
      { 'placementId' => 'mod-door-hw-0', 'hardwareId' => 'hw-handle', 'name' => 'Manija 160',
        'shape' => 'bar-pull', 'hostComponentInstanceId' => 'mod-door', 'anchorFace' => 'front',
        'placementKind' => 'manual',
        'transform' => { 'translationMm' => [542, 578, 282] }, 'dimensionsMm' => [32, 25, 160],
        'colorHex' => '#c0c0c0' }
    ]
  }.freeze

  def native_layout(body = RESOLVED_LAYOUT_BODY)
    Granete::SketchUpExtension::Library::LayoutContract.parse!(JSON.parse(JSON.generate(body)))
  end

  def test_inserts_native_furniture_hierarchy_with_components_and_metadata
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition,
                                       { 'widthMm' => 600, 'shelfCount' => 2, 'doorCount' => 1 })

    assert result['success']
    assert_equal 'Gabinete Base Estándar', result['name']
    assert_equal 5, result['component_count']

    # Top level: one native ComponentInstance, no Group wrapper anywhere.
    furniture = furniture_instance
    assert_instance_of SketchupStub::ComponentInstanceStub, furniture
    assert_empty @model.active_entities.groups
    assert_includes furniture.name, 'Gabinete Base Estándar'
    assert furniture.definition.name.start_with?('Granete · Mueble · ')

    # Furniture metadata
    furniture_meta = @store.read(furniture)
    assert_equal 'furnitureInstance', furniture_meta['kind']
    assert_equal 'kitchen-base-standard', furniture_meta['intent']['furnitureDefinitionId']
    assert_equal 600, furniture_meta['intent']['parameters']['widthMm']

    # Children: native ComponentInstances with local geometry at origin.
    assert_equal 5, part_instances.length
    part_instances.each do |part|
      assert_instance_of SketchupStub::ComponentInstanceStub, part
      assert_empty part.definition.entities.groups
      refute_empty part.definition.entities.faces
    end

    first_part = part_instances.first
    comp_meta = @store.read(first_part)
    assert_equal 'componentInstance', comp_meta['kind']
    assert_equal 'left_side', comp_meta['intent']['semanticRole']
    assert_equal comp_meta.dig('identity', 'instanceRef'),
                 comp_meta.dig('identity', 'componentInstanceId')

    # One flat undoable gesture per interaction: exactly one start/commit pair,
    # no nested operations from metadata writes.
    assert_equal [[:start, 'Insertar Mueble Gabinete Base Estándar', true], :commit],
                 @model.operations
  end

  def test_insertion_selects_the_new_furniture_and_activates_move_tool
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition,
                              { 'widthMm' => 600, 'shelfCount' => 2, 'doorCount' => 1 })

    # Placement assist: the fresh furniture stays selected and the Move tool is
    # activated so the user lands it where intended (interim north-star step).
    assert_equal [furniture_instance], @model.selection.items
    assert_includes SketchupStub.send_actions, 'selectMoveTool:'
    # Selection is UI state, not an undoable model operation.
    assert_equal [[:start, 'Insertar Mueble Gabinete Base Estándar', true], :commit],
                 @model.operations
  end

  def test_preserves_false_and_omits_missing_optional_parameters_in_authoritative_intent
    definition = JSON.parse(JSON.generate(@provider.find_definition('kitchen-base-standard')))
    definition['parameters'] << {
      'name' => 'softClose', 'label' => 'Cierre suave', 'type' => 'boolean',
      'defaultValue' => true, 'category' => 'metadata'
    }
    definition['parameters'] << {
      'name' => 'note', 'label' => 'Nota', 'type' => 'string', 'category' => 'metadata'
    }

    result = @builder.insert_furniture(@model, definition, { 'softClose' => false },
                                       resolved_layout: native_layout)

    assert result['success']
    assert_equal false, result['parameters']['softClose']
    refute_includes result['parameters'], 'note'
    metadata = @store.read(furniture_instance)
    assert_equal false, metadata.dig('intent', 'parameters', 'softClose')
    refute_includes metadata.dig('intent', 'parameters'), 'note'
  end

  def test_updates_furniture_in_place_regenerating_components_and_preserving_identity
    definition = @provider.find_definition('kitchen-base-standard')
    insert_result = @builder.insert_furniture(@model, definition,
                                              { 'widthMm' => 600, 'shelfCount' => 1, 'doorCount' => 1 })
    furniture = furniture_instance
    initial_id = insert_result['instance_id']
    # User moved/rotated the furniture after insertion: the rebuild must keep
    # the world transform untouched.
    moved = Geom::Transformation.axes(Geom::Point3d.new(120 * MM, 40 * MM, 0),
                                      Geom::Vector3d.new(0, 1, 0),
                                      Geom::Vector3d.new(-1, 0, 0),
                                      Geom::Vector3d.new(0, 0, 1))
    furniture.transformation = moved

    update_result = @builder.update_furniture(@model, furniture, definition,
                                              { 'widthMm' => 900, 'shelfCount' => 3, 'doorCount' => 1 })

    assert update_result['success']
    assert_equal initial_id, update_result['instance_id']
    # 2 laterals + 3 shelves + 1 door = 6 components
    assert_equal 6, update_result['component_count']
    assert_equal 6, part_instances.length
    # Same host instance object, same world transform.
    assert_same furniture, furniture_instance
    assert_equal moved, furniture_instance.transformation

    updated_meta = @store.read(furniture)
    assert_equal 900, updated_meta['intent']['parameters']['widthMm']
    assert_equal 3, updated_meta['intent']['parameters']['shelfCount']
  end

  def test_inserts_the_full_resolved_composition_with_hardware
    definition = @provider.find_definition('kitchen-base-standard')

    result = @builder.insert_furniture(@model, definition,
                                       { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
                                       resolved_layout: native_layout)

    assert result['success']
    # Every resolved element materializes: 3 boards + 1 handle. This is the
    # regression behind "solo se generan los laterales / 2 piezas".
    assert_equal 4, result['component_count']
    assert_equal 3, result['board_count']
    assert_equal 1, result['hardware_count']

    assert_equal 4, part_instances.length
    names = part_instances.map(&:name)
    assert_includes names, 'Lateral'
    assert_includes names, 'Puerta'
    assert_includes names, 'Manija 160'

    # The handle keeps its host identity in the component metadata.
    handle = part_instances.find { |p| p.name == 'Manija 160' }
    handle_meta = @store.read(handle)
    assert_equal 'componentInstance', handle_meta['kind']
    assert_equal 'hardware_mod-door-hw-0', handle_meta['intent']['semanticRole']
    assert_equal 'mod-door', handle_meta['intent']['hostComponentInstanceId']
    # #476 explicit semantic discriminators: entity class, hardware
    # definition and the contract's placement provenance are stored data —
    # never name-derived. Hardware owns its occurrence namespace.
    assert_equal 'hardware', handle_meta['intent']['entityClass']
    assert_equal 'hw-handle', handle_meta['intent']['hardwareDefinitionId']
    assert_equal 'manual', handle_meta['intent']['placementKind']
    assert_equal 'mod-door-hw-0', handle_meta.dig('identity', 'hardwarePlacementId')
    assert_nil handle_meta['identity']['componentInstanceId']

    door = part_instances.find { |p| p.name == 'Puerta' }
    door_meta = @store.read(door)
    assert_equal 'part', door_meta['intent']['entityClass']
    assert_equal 'mod-door', door_meta.dig('identity', 'componentInstanceId')

    assert_equal [[:start, 'Insertar Mueble Gabinete Base Estándar', true], :commit],
                 @model.operations
  end

  def test_resolved_components_are_painted_with_material_colors
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition, {}, resolved_layout: native_layout)

    # The chosen board becomes a namespaced SketchUp material with its color,
    # and the component instance is painted with it.
    door = part_instances.find { |p| p.name == 'Puerta' }
    refute_nil door.material
    assert_equal 'Granete · Roble Claro', door.material.name
    assert_equal '#c4a574', door.material.color

    # Roles without an explicit choice keep the palette fallback color.
    lateral = part_instances.find { |p| p.name == 'Lateral' }
    assert_equal 'Granete · LATERAL', lateral.material.name
    assert_equal '#c8b89a', lateral.material.color

    # Hardware paints with its own preview color.
    handle = part_instances.find { |p| p.name == 'Manija 160' }
    assert_equal '#c0c0c0', handle.material.color

    # Same role reuses one material (no duplicates per copy).
    assert_equal 3, @model.materials.materials.length
  end

  def test_updates_furniture_with_a_new_resolved_composition
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition, {}, resolved_layout: native_layout)

    shrunk = JSON.parse(JSON.generate(RESOLVED_LAYOUT_BODY))
    shrunk['components'] = shrunk['components'].first(2)
    shrunk['hardware'] = []

    result = @builder.update_furniture(@model, furniture_instance, definition, {},
                                       resolved_layout: native_layout(shrunk))

    assert result['success']
    assert_equal 2, result['component_count']
    assert_equal 2, part_instances.length
    # Definitions orphaned by the rebuild are cleaned up, scoped to Granete
    # part/hardware definitions with zero live instances.
    orphan = @model.definitions.find { |d| d.name.include?('mod-door') }
    assert_nil orphan
  end

  def test_inserts_resolved_composition_with_long_composite_hardware_id
    definition = @provider.find_definition('kitchen-base-standard')
    long_hw_layout = JSON.parse(JSON.generate(RESOLVED_LAYOUT_BODY))
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

    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: native_layout(long_hw_layout))

    assert result['success'], "insert failed with: #{result['error']}"
    assert_equal 4, result['component_count']
    assert_equal 1, result['hardware_count']

    hw_instance = part_instances.find { |p| p.name == 'Jaladera Acero Inox' }
    refute_nil hw_instance
    assert_instance_of SketchupStub::ComponentInstanceStub, hw_instance
    hw_meta = @store.read(hw_instance)
    assert_equal 'componentInstance', hw_meta['kind']
    assert_equal 'hardware_agr-agr-1786465647616-8jgc-u0-a0000008-0000-0000-0000-000000000001-copy-0-hw-0',
                 hw_meta['intent']['semanticRole']
  end

  def test_ensures_downward_normal_faces_are_reversed_upwards
    # In SketchUp, ground plane faces often default to downward normal (-Z).
    # Builder must reverse them so pushpull extrudes upwards (+Z).
    definition = @model.definitions.add('test-board')

    Granete::SketchUpExtension::Model::LocalGeometry.build_local_box(definition, 600, 500, 720)

    face = definition.entities.faces.first
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

    textured_layout = JSON.parse(JSON.generate(RESOLVED_LAYOUT_BODY))
    textured_layout['components'].last['materialTextureUrl'] = '/api/media/oak_test.jpg'
    textured_layout['components'].last['materialTextureTileWidthMm'] = 1830.0
    textured_layout['components'].last['materialTextureTileLengthMm'] = 2440.0

    builder.insert_furniture(@model, definition, {}, resolved_layout: native_layout(textured_layout))

    door = part_instances.find { |p| p.name == 'Puerta' }
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
    loaded = []
    loader_mock = Object.new
    loader_mock.define_singleton_method(:load_asset_instance) do |_model, asset_id, target, pos|
      loaded << { asset_id: asset_id, target: target, pos: pos }
      hardware_def = SketchupStub.active_model.definitions.add('loaded-asset')
      target.entities.add_instance(hardware_def, Geom::Transformation.identity)
    end

    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: @store,
      asset_loader: loader_mock
    )

    layout_with_hardware = JSON.parse(JSON.generate(RESOLVED_LAYOUT_BODY))
    layout_with_hardware['hardware'] = [
      {
        'placementId' => 'hw-profile-0',
        'assetId' => 'handle_profile_96',
        'name' => 'Tirador Perfil',
        'hostComponentInstanceId' => 'mod-door',
        'transform' => { 'translationMm' => [100, 20, 700] },
        'dimensionsMm' => [96, 32, 25]
      }
    ]

    builder.insert_furniture(@model, definition, {}, resolved_layout: native_layout(layout_with_hardware))

    assert_equal 1, loaded.length
    assert_equal 'handle_profile_96', loaded.first[:asset_id]
    assert_equal [100, 20, 700], loaded.first[:pos]
    # The asset lands INSIDE the furniture's isolated definition, as a native
    # instance carrying Granete metadata.
    assert_equal furniture_instance.definition, loaded.first[:target]
    asset_instance = part_instances.find { |p| p.name == 'Tirador Perfil' }
    refute_nil asset_instance
    meta = @store.read(asset_instance)
    assert_equal 'componentInstance', meta['kind']
    assert_equal 'hardware_hw-profile-0', meta['intent']['semanticRole']
  end
end
