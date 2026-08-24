# frozen_string_literal: true

require_relative "../test_helper"
require_relative "../../src/granete_for_sketchup/library/catalog_provider"
require_relative "../../src/granete_for_sketchup/model/furniture_builder"
require_relative "../../src/granete_for_sketchup/metadata/store"

class FurnitureBuilderTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
  end

  def test_inserts_kitchen_base_cabinet_with_panels_and_metadata
    definition = @provider.find_definition("kitchen-base-standard")
    result = @builder.insert_furniture(@model, definition, { "widthMm" => 600, "shelfCount" => 2, "doorCount" => 1 })

    assert result["success"]
    assert_equal "Gabinete Base Estándar", result["name"]
    # 2 laterals + 2 shelves + 1 door = 5 components
    assert_equal 5, result["component_count"]

    assert_equal 1, @model.active_entities.groups.length
    main_group = @model.active_entities.groups.first
    assert_includes main_group.name, "Gabinete Base Estándar"

    metadata = @store.read(main_group)
    refute_nil metadata
    assert_equal "com.granete.sketchup_extension", metadata["namespace"]
    assert_equal "furniture-instance", metadata["intent"]["semanticRole"]
  end

  def test_inserts_workstation_desk_with_worktop_and_legs
    definition = @provider.find_definition("workstation-desk-01")
    result = @builder.insert_furniture(@model, definition, { "widthMm" => 1400, "heightMm" => 750, "depthMm" => 700 })

    assert result["success"]
    assert_equal "Escritorio de Trabajo", result["name"]
    # 1 worktop + 2 legs = 3 components
    assert_equal 3, result["component_count"]
  end
end
