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
end
