# frozen_string_literal: true

require 'stringio'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/auth/device_provider'
require_relative '../../src/granete_for_sketchup/metadata/store'
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
require_relative '../../src/granete_for_sketchup/assets/media_authorizer'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'
require_relative '../support/host_runtime'
require_relative '../../src/granete_for_sketchup/tools/internal_component_move_tool'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'
require_relative '../../src/granete_for_sketchup/lifecycle'
require_relative '../../src/granete_for_sketchup/application'

class ApplicationTest < Minitest::Test
  class ReadyPort
    def configured?
      true
    end
  end

  # Configured transport/auth pair serving a one-definition workshop
  # contract, so production wiring exercises the remote catalog path
  # instead of the old silent static fallback.
  class FakeCatalogTransport
    def configured?
      true
    end

    def request(req = {}, *)
      if req['path'].to_s.include?('/layout')
        # Contract-shaped layout (#414): the native renderer path requires
        # granete.local-basis.v1 and fails closed on legacy AABB bodies.
        { 'status' => 200, 'body' => LAYOUT_CONTRACT_BODY }
      else
        { 'status' => 200, 'body' => WORKSHOP_CONTRACT }
      end
    end
  end

  LAYOUT_CONTRACT_BODY = {
    'furnitureDefinitionId' => 'kitchen-base-standard',
    'definitionName' => 'Gabinete Base Estándar',
    'transformContract' => 'granete.local-basis.v1',
    'dimensionsMm' => [800, 720, 590],
    'components' => [
      { 'componentInstanceId' => 'st-side-copy-0', 'componentDefinitionId' => 'st-side',
        'slotId' => 'lateral_izquierdo', 'name' => 'Lateral', 'kind' => 'board',
        'transform' => { 'translationMm' => [0, 0, 0] }, 'dimensionsMm' => [18, 590, 720],
        'localTransform' => {
          'translationMm' => [0, 590, 0],
          'basis' => { 'x' => [0, -1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }
        },
        'lengthMm' => 720, 'widthMm' => 590, 'thicknessMm' => 18,
        'optionRole' => 'LATERAL', 'materialColorHex' => '#c8b89a' }
    ],
    'hardware' => []
  }.freeze

  class FakeCatalogAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-session'
    end
  end

  WORKSHOP_CONTRACT = {
    'definitions' => {
      'kitchen-base-standard' => {
        'furnitureDefinitionId' => 'kitchen-base-standard',
        'code' => 'KITCHEN-BASE-600',
        'name' => 'Gabinete Base Estándar',
        'category' => 'kitchen_base',
        'version' => '1.0.0',
        'schemaRevision' => 1,
        'definitionHash' => "sha256-#{'3' * 64}",
        'description' => 'Módulo inferior de cocina.',
        'parameters' => [
          { 'name' => 'widthMm', 'label' => 'Ancho (mm)', 'type' => 'number',
            'defaultValue' => 600, 'min' => 300, 'max' => 1200, 'step' => 50, 'unit' => 'mm',
            'required' => true, 'category' => 'dimension', 'integer' => true,
            'binding' => { 'version' => 1, 'kind' => 'dimensionColumn', 'dimension' => 'widthMm' } },
          { 'name' => 'heightMm', 'label' => 'Alto (mm)', 'type' => 'number',
            'defaultValue' => 720, 'min' => 600, 'max' => 900, 'step' => 10, 'unit' => 'mm',
            'required' => true, 'category' => 'dimension', 'integer' => true,
            'binding' => { 'version' => 1, 'kind' => 'dimensionColumn', 'dimension' => 'heightMm' } },
          { 'name' => 'depthMm', 'label' => 'Fondo (mm)', 'type' => 'number',
            'defaultValue' => 590, 'min' => 300, 'max' => 700, 'step' => 10, 'unit' => 'mm',
            'required' => true, 'category' => 'dimension', 'integer' => true,
            'binding' => { 'version' => 1, 'kind' => 'dimensionColumn', 'dimension' => 'depthMm' } },
          { 'name' => 'shelfCount', 'label' => 'Entrepaños', 'type' => 'number',
            'defaultValue' => 1, 'min' => 0, 'max' => 4, 'step' => 1, 'unit' => 'count',
            'required' => false, 'category' => 'configuration', 'integer' => true,
            'binding' => { 'version' => 1, 'kind' => 'componentQuantity', 'componentId' => 'shelf' } },
          { 'name' => 'doorCount', 'label' => 'Puertas', 'type' => 'number',
            'defaultValue' => 1, 'min' => 0, 'max' => 2, 'step' => 1, 'unit' => 'count',
            'required' => false, 'category' => 'configuration', 'integer' => true,
            'binding' => { 'version' => 1, 'kind' => 'componentQuantity', 'componentId' => 'door' } }
        ]
      }
    },
    'presets' => []
  }.freeze

  # Hermetic device provider: file store under a temp dir and the secure
  # secret storage overridden so the tests never touch the host Keychain.
  class HermeticDeviceProvider < Granete::SketchUpExtension::Auth::DeviceProvider
    def secure_store_secret(_secret); end

    def secure_read_secret; end
  end

  def setup
    SketchupStub.reset!
    logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    session = HermeticDeviceProvider.new(
      logger: logger,
      store_path: File.join(Dir.mktmpdir('granete-app-test'), 'session.json')
    )
    @application = Granete::SketchUpExtension::Application.new(logger: logger, session_provider: session)
  end

  def test_start_is_idempotent_and_registers_one_menu_action
    @application.start
    @application.start

    labels = SketchupStub.menus['Extensions'].items.map(&:first)
    assert_equal ['Abrir Granete', 'Migrar modelos anteriores…'], labels
  end

  def test_dialog_close_and_reopen_recreates_callbacks_without_duplicates
    @application.start
    first_dialog = @application.open_dialog

    expected_callbacks = %w[
      adopt_binding_base authoring_mutation cancel_placement_instance close_dialog component_viewport_move
      confirm_placement_instance
      connect_model create_project_furniture delete_selected_furniture dialog_ready enroll
      get_catalog get_model_binding get_project_furniture insert_furniture
      list_binding_designs list_binding_projects logout manufacturing_inspection open_external_url open_material_selector
      place_furniture_instance poll_enrollment preflight_review publish_design_revision
      refresh_media_url refresh_model_binding
      rescan_duplicates select_furniture select_project_furniture update_furniture
      validate_managed_furniture_identity
    ]
    assert_equal expected_callbacks, first_dialog.callbacks.keys.sort
    first_dialog.callbacks.fetch('dialog_ready').call(nil)
    status_script = first_dialog.executed_scripts.find { |s| s.include?('setStatus') }
    refute_nil status_script
    assert_includes status_script, 'Sin sesión iniciada'
    assert_includes status_script, 'Iniciá sesión con tu cuenta del taller'
    assert_includes status_script, '"state":"disabled"'

    first_dialog.close
    second_dialog = @application.open_dialog

    refute_same first_dialog, second_dialog
    assert_equal expected_callbacks, second_dialog.callbacks.keys.sort
    assert_equal 2, UI::HtmlDialog.instances.length
  end

  def test_replaceable_ports_drive_status_without_performing_a_request
    logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    application = Granete::SketchUpExtension::Application.new(
      transport: ReadyPort.new,
      auth_provider: ReadyPort.new,
      logger: logger,
      session_provider: HermeticDeviceProvider.new(
        logger: logger,
        store_path: File.join(Dir.mktmpdir('granete-app-test'), 'session.json')
      )
    )

    dialog = application.open_dialog
    dialog.callbacks.fetch('dialog_ready').call(nil)
    status_script = dialog.executed_scripts.find { |s| s.include?('setStatus') }
    refute_nil status_script

    assert_includes status_script, 'La conexión está configurada'
    assert_includes status_script, 'Conexión configurada'
    assert_includes status_script, '"state":"configured"'
  end

  def test_shutdown_closes_dialog_without_adding_another_menu_item_on_restart
    @application.start
    @application.open_dialog
    @application.shutdown
    @application.start

    labels = SketchupStub.menus['Extensions'].items.map(&:first)
    assert_equal ['Abrir Granete', 'Migrar modelos anteriores…'], labels
    refute UI::HtmlDialog.instances.first.visible?
  end

  def test_production_wiring_writes_metadata_and_rehydrates_selection
    logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    session = HermeticDeviceProvider.new(
      logger: logger,
      store_path: File.join(Dir.mktmpdir('granete-app-test'), 'session.json')
    )
    application = Granete::SketchUpExtension::Application.new(
      logger: logger,
      session_provider: session,
      transport: FakeCatalogTransport.new,
      auth_provider: FakeCatalogAuth.new
    )
    application.start
    dialog = application.open_dialog

    dialog.callbacks.fetch('insert_furniture').call(
      nil,
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 800, 'shelfCount' => 1, 'doorCount' => 1 }
    )

    model = SketchupStub.active_model
    furniture = model.active_entities.instances.first
    refute_nil furniture, 'insert must create furniture geometry in the active model'
    assert_instance_of SketchupStub::ComponentInstanceStub, furniture

    raw = furniture.get_attribute('com.granete.sketchup_extension', 'bootstrap_intent.v1')
    refute_nil raw, 'production wiring must persist furniture metadata without manual injection'
    metadata = JSON.parse(raw)
    assert_equal 'furnitureInstance', metadata['kind']
    assert_equal 'kitchen-base-standard', metadata.dig('intent', 'furnitureDefinitionId')
    assert_equal 800, metadata.dig('intent', 'parameters', 'widthMm')

    model.selection.add(furniture)

    selection_script = dialog.executed_scripts.reverse.find { |s| s.include?('onSelectionChange') }
    refute_nil selection_script, 'selecting inserted furniture must reach the dialog'
    assert_includes selection_script, '"kind":"furniture"'
    assert_includes selection_script, '"furnitureDefinitionId":"kitchen-base-standard"'
    assert_includes selection_script, '"canEditParameters"'
  end

  def test_offline_application_serves_local_fallback_definitions
    @application.start
    dialog = @application.open_dialog
    dialog.callbacks.fetch('get_catalog').call(nil)

    catalog_script = dialog.executed_scripts.reverse.find { |s| s.include?('setCatalog') }
    refute_nil catalog_script, 'get_catalog must respond with catalog definitions'
    assert_includes catalog_script, 'kitchen-base-standard'
    assert_includes catalog_script, 'Gabinete Base Estándar'
  end
end
