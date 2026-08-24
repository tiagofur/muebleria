# frozen_string_literal: true

require_relative "../test_helper"
require_relative "../../src/granete_for_sketchup/library/catalog_provider"

class CatalogProviderTest < Minitest::Test
  class FakeTransport
    attr_accessor :configured

    def initialize(configured: true)
      @configured = configured
    end

    def configured?
      @configured
    end
  end

  def setup
    @static_provider = Granete::SketchUpExtension::Library::StaticCatalogProvider.new
  end

  def test_static_provider_returns_standard_definitions
    definitions = @static_provider.all_definitions

    refute_empty definitions
    ids = definitions.map { |d| d["furniture_definition_id"] }
    assert_includes ids, "kitchen-base-standard"
    assert_includes ids, "kitchen-wall-standard"
    assert_includes ids, "closet-tower-open"
    assert_includes ids, "workstation-desk-01"
  end

  def test_find_definition_by_id
    base = @static_provider.find_definition("kitchen-base-standard")

    refute_nil base
    assert_equal "Gabinete Base Estándar", base["name"]
    assert_equal "kitchen_base", base["category"]
  end

  def test_remote_provider_falls_back_to_static_when_transport_not_configured
    transport = FakeTransport.new(configured: false)
    remote_provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(transport: transport)

    definitions = remote_provider.all_definitions
    refute_empty definitions
    assert_equal 4, definitions.length
  end
end
