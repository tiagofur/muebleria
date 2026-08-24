# frozen_string_literal: true

require_relative "../test_helper"
require_relative "../../src/granete_for_sketchup/library/catalog_provider"

class CatalogProviderTest < Minitest::Test
  def setup
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
  end

  def test_returns_standard_furniture_definitions
    definitions = @provider.all_definitions

    refute_empty definitions
    ids = definitions.map { |d| d["furniture_definition_id"] }
    assert_includes ids, "kitchen-base-standard"
    assert_includes ids, "kitchen-wall-standard"
    assert_includes ids, "closet-tower-open"
    assert_includes ids, "workstation-desk-01"
  end

  def test_find_definition_by_id
    base = @provider.find_definition("kitchen-base-standard")

    refute_nil base
    assert_equal "Gabinete Base Estándar", base["name"]
    assert_equal "kitchen_base", base["category"]

    param_names = base["parameters"].map { |p| p["name"] }
    assert_includes param_names, "widthMm"
    assert_includes param_names, "heightMm"
    assert_includes param_names, "depthMm"
    assert_includes param_names, "shelfCount"
    assert_includes param_names, "doorCount"
  end
end
