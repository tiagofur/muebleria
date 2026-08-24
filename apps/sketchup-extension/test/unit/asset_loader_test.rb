# frozen_string_literal: true

require_relative "../test_helper"
require_relative "../../src/granete_for_sketchup/assets/asset_resolver"
require_relative "../../src/granete_for_sketchup/assets/asset_loader"

class AssetLoaderTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @target_group = @model.active_entities.add_group
  end

  def test_asset_resolver_returns_nil_for_missing_asset
    resolver = Granete::SketchUpExtension::Assets::AssetResolver.new
    assert_nil resolver.resolve_skp_path("non_existent_asset_xyz")
  end

  def test_asset_loader_returns_false_for_unresolvable_asset
    loader = Granete::SketchUpExtension::Assets::AssetLoader.new
    result = loader.load_asset_instance(@model, "missing_asset", @target_group)
    refute result
  end
end
