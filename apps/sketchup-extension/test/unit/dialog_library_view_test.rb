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
require_relative '../../src/granete_for_sketchup/tools/internal_component_move_tool'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
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
    # #848 Phase B C4.3: la implementación del browser de Biblioteca vive en
    # js/granete-library.js — los asserts de implementación apuntan al módulo.
    @library_js = File.read(
      File.expand_path('../../src/granete_for_sketchup/resources/js/granete-library.js', __dir__),
      encoding: 'UTF-8'
    )
    # #848: los estilos del panel viven en css/*.css.
    css_dir = File.expand_path('../../src/granete_for_sketchup/resources/css', __dir__)
    @css_content = Dir.children(css_dir).sort.map { |f| File.read(File.join(css_dir, f), encoding: 'UTF-8') }.join("\n")
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
    # #848 C4.3: las funciones del browser de Biblioteca viven en el módulo;
    # el bootstrap inline conserva la transición browser↔configurator.
    assert_includes @library_js, 'function renderLibraryBrowser('
    assert_includes @library_js, 'function renderCategoryFilters('
    assert_includes @library_js, 'function renderFurnitureCards('
    assert_includes @library_js, 'function renderLibraryState('
    assert_includes @html_content, 'function showLibraryView('
    assert_includes @html_content, 'function showConfiguratorView('
  end

  def test_category_filter_cascades_over_the_workshop_tree
    # Same pattern as the web app library: cascading L1/L2/L3 selects over
    # the catalog category tree, with subtree-inclusive filtering and a
    # "Sin categoría" bucket.
    assert_includes @html_content, '<select id="library-category-l1"'
    assert_includes @library_js, 'Todas las categorías'
    assert_includes @library_js, 'Sin categoría'
    assert_includes @library_js, 'function subtreeCategoryIds('
    assert_includes @library_js, 'function countModulesInSubtree('
    assert_includes @library_js, 'function fillCascadeLevel('
    assert_includes @library_js, 'catalogCategories = payload.categories'
  end

  def test_measures_use_text_fields_with_registered_defaults_button
    assert_includes @html_content, 'id="btn-registered-measures"'
    assert_includes @html_content, 'function renderRegisteredMeasuresButton('
    assert_includes @html_content, 'function registeredMeasureParams('
    assert_includes @html_content, 'Medidas registradas: '
    # Sliders are gone: measures are precise mm text fields.
    refute_includes @html_content, '"range"'
    refute_includes @html_content, 'slider-row'
    assert_includes @html_content, 'className = "dim-input"',
                    'el JS crea el input mm (la clase dim-input-row murió con las filas compactas #847)'
    assert_includes @css_content, '.param-control .dim-input',
                    'el estilo del input mm vive en css/configurator.css (#848)'
  end

  def test_configurator_contract_preview_summary_and_sticky_action
    # El configurador nunca opera a ciegas: preview del mueble, una fila
    # compacta por parámetro y cotas vivas junto a la acción primaria.
    assert_includes @html_content, 'id="library-selected-preview"'
    assert_includes @html_content, 'function renderConfiguratorPreview('
    assert_includes @html_content, 'id="configurator-actionbar"'
    assert_includes @html_content, 'id="library-summary-dims"'
    assert_includes @html_content, 'id="library-summary-parts"'
    assert_includes @html_content, 'Medidas y Opciones'
    # Una línea por parámetro: etiqueta a la izquierda, control a la derecha.
    assert_includes @html_content, 'param-control'
    # Los botones "Catálogo" por rol murieron: la fila es el control y el
    # chevron comunica la navegación.
    refute_includes @html_content, 'btn-picker-open'
    assert_includes @html_content, 'material-chevron'
    # El inspector comparte el patrón: dock con cotas junto a la acción
    # primaria, DENTRO del fieldset fail-closed (#476), y delete fuera.
    assert_includes @html_content, 'id="inspector-actionbar"'
    assert_includes @html_content, 'class="action-dock"'
    assert_includes @html_content, 'id="inspector-summary-dims"'
    # btn-update dentro del fieldset del inspector; btn-delete después de cerrarlo.
    fieldset_open = @html_content.index('id="inspector-edit-fieldset"')
    fieldset_close = @html_content.index('</fieldset>', fieldset_open)
    update_pos = @html_content.index('id="btn-update"', fieldset_open)
    delete_pos = @html_content.index('id="btn-delete"', fieldset_open)
    assert update_pos < fieldset_close, 'btn-update pertenece al fieldset de mutación'
    assert fieldset_close < delete_pos, 'btn-delete queda fuera del fieldset (boundary de capability)'
  end

  def test_dialog_html_contains_svg_placeholder_fallback
    # El SVG isométrico es un helper compartido (cards + preview del
    # configurador): sigue inline y el módulo lo recibe inyectado.
    assert_includes @html_content, 'function createFurniturePlaceholderSvg('
    assert_includes @html_content, 'furniture-card-svg'
    assert_includes @library_js, 'furniture-card-placeholder'
    assert_includes @library_js, 'createFurniturePlaceholderSvg()'
  end

  def test_dialog_html_contains_category_labels_mapping
    # Las categorías son dominio de Library (#848 C4.3): el mapping vive en
    # el módulo y el configurador consume su API pública.
    assert_includes @library_js, 'var CATEGORY_LABELS ='
    assert_includes @library_js, '"kitchen_base": "Bases"'
    assert_includes @library_js, '"kitchen_wall": "Alacenas"'
    assert_includes @library_js, '"closet": "Torres / Closets"'
    assert_includes @library_js, '"desk": "Escritorios"'
    assert_includes @html_content, 'window.GraneteUI.library.formatCategoryLabel('
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
    # Review #847: the dock count stays honest — the definition's server-side
    # estimate (estimatedPartCount/estimatedHardwareCount) only applies while
    # the counting params sit at their defaults, the heuristic reads the
    # CURRENT values, every local number is labeled "Aprox." and nothing is
    # invented when no estimate exists ("se calculan al resolver").
    assert_includes @html_content, 'function estimatedPartsLabel('
    assert_includes @html_content, 'estimatedPartCount'
    assert_includes @html_content, 'estimatedHardwareCount'
    assert_includes @html_content,
                    'libSummaryParts.textContent = estimatedPartsLabel(activeLibDef, libParams);'
    assert_includes @html_content,
                    'inspectorSummaryParts.textContent = estimatedPartsLabel(inspectorDef, inspectorParams);'
    assert_includes @html_content, '"Aprox. "'
    assert_includes @html_content, 'Piezas: se calculan al resolver'
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
