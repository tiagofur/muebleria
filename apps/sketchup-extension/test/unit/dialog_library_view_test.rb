# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/library/catalog_parameter_contract'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'
require_relative '../../src/granete_for_sketchup/assets/media_authorizer'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'

class DialogLibraryViewTest < Minitest::Test
  class FakeTransport
    attr_accessor :response

    def initialize(response = nil)
      @response = response
    end

    def configured?
      !@response.nil?
    end

    def request(_payload, **_kwargs)
      @response
    end
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-token'
    end
  end

  class StatusProvider
    def call
      { heading: 'Conectado', message: 'Listo', state: 'configured' }
    end
  end

  def setup
    SketchupStub.reset!
    @html_path = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
    @html_content = File.read(@html_path, encoding: 'UTF-8')
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
  end

  def test_dialog_html_contains_library_browser_elements
    assert_includes @html_content, 'id="library-browser-view"'
    assert_includes @html_content, 'id="library-configurator-view"'
    assert_includes @html_content, 'id="library-search-input"'
    assert_includes @html_content, 'id="library-search-clear"'
    assert_includes @html_content, 'id="library-categories-container"'
    assert_includes @html_content, 'id="library-category-l1"'
    assert_includes @html_content, 'id="library-category-l2"'
    assert_includes @html_content, 'id="library-category-l3"'
    assert_includes @html_content, 'id="library-cards-grid"'
    assert_includes @html_content, 'id="btn-back-to-library"'
    assert_includes @html_content, 'Volver a Biblioteca'
  end

  def test_dialog_html_contains_required_visual_states
    assert_includes @html_content, 'id="library-loading-state"'
    assert_includes @html_content, 'id="library-empty-state"'
    assert_includes @html_content, 'id="library-no-results-state"'
    assert_includes @html_content, 'id="btn-clear-search"'
  end

  def test_dialog_html_contains_modular_functions
    assert_includes @html_content, 'function renderLibraryBrowser('
    assert_includes @html_content, 'function renderCategoryFilters('
    assert_includes @html_content, 'function renderFurnitureCards('
    assert_includes @html_content, 'function showLibraryView('
    assert_includes @html_content, 'function showConfiguratorView('
    assert_includes @html_content, 'function renderLibraryState('
  end

  def test_category_filter_cascades_over_the_workshop_tree
    # Same pattern as the web app library: cascading L1/L2/L3 selects over
    # the catalog category tree, with subtree-inclusive filtering and a
    # "Sin categoría" bucket.
    assert_includes @html_content, '<select id="library-category-l1"'
    assert_includes @html_content, 'Todas las categorías'
    assert_includes @html_content, 'Sin categoría'
    assert_includes @html_content, 'function subtreeCategoryIds('
    assert_includes @html_content, 'function countModulesInSubtree('
    assert_includes @html_content, 'function fillCascadeLevel('
    assert_includes @html_content, 'catalogCategories = payload.categories'
  end

  def test_measures_use_text_fields_with_registered_defaults_button
    assert_includes @html_content, 'id="btn-registered-measures"'
    assert_includes @html_content, 'function renderRegisteredMeasuresButton('
    assert_includes @html_content, 'function registeredMeasureParams('
    assert_includes @html_content, 'Medidas registradas: '
    # Sliders are gone: measures are precise mm text fields.
    refute_includes @html_content, '"range"'
    refute_includes @html_content, 'slider-row'
    assert_includes @html_content, 'dim-input-row'
  end

  def test_dialog_html_contains_svg_placeholder_fallback
    assert_includes @html_content, 'function createFurniturePlaceholderSvg('
    assert_includes @html_content, 'furniture-card-svg'
    assert_includes @html_content, 'furniture-card-placeholder'
  end

  def test_dialog_html_contains_category_labels_mapping
    assert_includes @html_content, 'var CATEGORY_LABELS ='
    assert_includes @html_content, '"kitchen_base": "Bases"'
    assert_includes @html_content, '"kitchen_wall": "Alacenas"'
    assert_includes @html_content, '"closet": "Torres / Closets"'
    assert_includes @html_content, '"desk": "Escritorios"'
  end

  def test_remote_catalog_provider_serves_hierarchical_categories_and_images
    contract = {
      'categories' => [
        { 'categoryId' => 'cat-1', 'name' => 'Cocinas', 'sortOrder' => 0 },
        { 'categoryId' => 'cat-2', 'name' => 'Inferiores', 'parentId' => 'cat-1', 'sortOrder' => 0 },
        { 'categoryId' => 'cat-3', 'name' => 'Puertas', 'parentId' => 'cat-2', 'sortOrder' => 1 }
      ],
      'definitions' => {
        'def-1' => {
          'furnitureDefinitionId' => 'def-1',
          'code' => 'BASE-450',
          'name' => 'Gabinete Base 1 Puerta',
          'category' => 'Cocinas › Inferiores › Puertas',
          'categoryId' => 'cat-3',
          'version' => '1.0.0',
          'schemaRevision' => 1,
          'definitionHash' => "sha256-#{'1' * 64}",
          'description' => 'Módulo inferior',
          'imageUrl' => 'https://cdn.granete.com/previews/base-450.png',
          'parameters' => [
            { 'name' => 'widthMm', 'label' => 'Ancho (mm)', 'type' => 'number', 'defaultValue' => 450,
              'required' => true, 'unit' => 'mm', 'category' => 'dimension', 'integer' => true,
              'binding' => { 'version' => 1, 'kind' => 'dimensionColumn', 'dimension' => 'widthMm' } }
          ]
        },
        'def-2' => {
          'furnitureDefinitionId' => 'def-2',
          'code' => 'WALL-450',
          'name' => 'Alacena 1 Puerta',
          'category' => 'Sin categoría',
          'version' => '1.0.0',
          'schemaRevision' => 1,
          'definitionHash' => "sha256-#{'2' * 64}",
          'thumbnailUrl' => 'https://cdn.granete.com/previews/wall-450.png',
          'parameters' => []
        }
      }
    }

    transport = FakeTransport.new('status' => 200, 'body' => contract)
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: transport,
      auth_provider: FakeAuth.new
    )

    categories = provider.all_categories
    assert_equal 3, categories.length
    assert_equal 'Cocinas', categories.first['name']
    assert_nil categories.first['parentId']
    assert_equal 'cat-1', categories[1]['parentId']

    definitions = provider.all_definitions
    assert_equal 2, definitions.length

    def1 = definitions.find { |d| d['furniture_definition_id'] == 'def-1' }
    assert_equal 'https://cdn.granete.com/previews/base-450.png', def1['imageUrl']
    assert_equal 'Cocinas › Inferiores › Puertas', def1['category']
    assert_equal 'cat-3', def1['categoryId']

    def2 = definitions.find { |d| d['furniture_definition_id'] == 'def-2' }
    assert_equal 'https://cdn.granete.com/previews/wall-450.png', def2['imageUrl']
    assert_nil def2['categoryId']
  end

  def test_dialog_controller_serves_catalog_payload_to_visual_browser
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store
    )

    dialog = controller.show
    dialog.callbacks.fetch('dialog_ready').call(nil)

    catalog_script = dialog.executed_scripts.find { |s| s.include?('setCatalog') }
    refute_nil catalog_script
    assert_includes catalog_script, 'kitchen-base-standard'
    assert_includes catalog_script, 'Gabinete Base Estándar'
    assert_includes catalog_script, 'kitchen_base'
  end

  def test_pieces_summary_prefers_the_server_estimated_composition
    # The "piezas" summary must come from the definition's real composition
    # (estimatedPartCount/estimatedHardwareCount resolved server-side) and only
    # fall back to the 2+shelfCount+doorCount heuristic for static catalogs.
    assert_includes @html_content, 'function estimatedPartsLabel('
    assert_includes @html_content, 'estimatedPartCount'
    assert_includes @html_content, 'estimatedHardwareCount'
    assert_includes @html_content, 'libSummaryParts.textContent = estimatedPartsLabel(activeLibDef);'
    assert_includes @html_content, 'inspectorSummaryParts.textContent = estimatedPartsLabel(inspectorDef);'
  end

  def test_insertion_result_reports_resolved_component_counts
    assert_includes @html_content, 'result.component_count'
    assert_includes @html_content, 'result.hardware_count'
    assert_includes @html_content, 'inspectorDef = def || null;'
  end

  def test_material_selectors_ride_the_configurator_and_payloads
    # Per-role board selectors backed by the workshop's option groups, sent to
    # the layout resolution as materialChoices.
    assert_includes @html_content, 'id="library-materials-card"'
    assert_includes @html_content, 'id="library-materials-container"'
    assert_includes @html_content, 'id="inspector-materials-card"'
    assert_includes @html_content, 'id="inspector-materials-container"'
    assert_includes @html_content, 'function renderMaterialSelectors('
    assert_includes @html_content, 'function defaultMaterialChoices('
    assert_includes @html_content, 'catalogMaterials = payload.materials || [];'
    assert_includes @html_content, 'materialChoices: libMaterialChoices'
    assert_includes @html_content, 'materialChoices: inspectorMaterialChoices'
    assert_includes @html_content, 'Materiales del Taller'
  end
end
