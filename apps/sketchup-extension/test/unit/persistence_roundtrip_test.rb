# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

class PersistenceRoundtripTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
  end

  def test_reconstructs_full_semantic_hierarchy_from_stored_attributes_without_relying_on_geometry
    definition = @provider.find_definition('kitchen-base-standard')
    insert_result = @builder.insert_furniture(
      @model,
      definition,
      { 'widthMm' => 800, 'heightMm' => 720, 'depthMm' => 590, 'shelfCount' => 2, 'doorCount' => 1 }
    )

    main_group = @model.active_entities.groups.first
    instance_id = insert_result['instance_id']

    # 1. Verify Root FurnitureInstance persistence
    restored_furniture_meta = @store.read(main_group)
    refute_nil restored_furniture_meta
    assert_equal 'com.granete.sketchup_extension', restored_furniture_meta['namespace']
    assert_equal 'furnitureInstance', restored_furniture_meta['kind']
    assert_equal instance_id, restored_furniture_meta.dig('identity', 'instanceRef')
    assert_equal 'kitchen-base-standard',
                 restored_furniture_meta.dig('intent', 'furnitureDefinitionId')
    assert_equal 800, restored_furniture_meta.dig('intent', 'parameters', 'widthMm')
    assert_equal 2, restored_furniture_meta.dig('intent', 'parameters', 'shelfCount')

    # 2. Verify Subgroup ComponentInstance persistence
    components = main_group.entities.groups
    refute_empty components
    shelf_components = components.select do |g|
      meta = @store.read(g)
      meta && meta['kind'] == 'componentInstance' && meta.dig('intent',
                                                              'semanticRole')&.start_with?('shelf')
    end
    assert_equal 2, shelf_components.length
  end
end
