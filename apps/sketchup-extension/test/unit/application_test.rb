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
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/host_reconciliation'
require_relative '../../src/granete_for_sketchup/connection/host_restore'
require_relative '../../src/granete_for_sketchup/connection/panel_state'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/connection/commercial_projection'
require_relative '../../src/granete_for_sketchup/connection/project_bootstrap'
require_relative '../../src/granete_for_sketchup/connection/initial_quote'
require_relative '../../src/granete_for_sketchup/connection/commercial_entry'
require_relative '../../src/granete_for_sketchup/connection/duplicate_resolver'
require_relative '../../src/granete_for_sketchup/connection/design_publish'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/observers/entities_observer'
require_relative '../../src/granete_for_sketchup/assets/media_authorizer'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_grant_manager'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_downloader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'
require_relative '../support/host_runtime'
require_relative '../../src/granete_for_sketchup/tools/internal_component_move_tool'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'
require_relative '../../src/granete_for_sketchup/lifecycle'
require_relative '../../src/granete_for_sketchup/host/save_awareness'
require_relative '../../src/granete_for_sketchup/host/position_sync_observer'
require_relative '../../src/granete_for_sketchup/connection/position_sync_coordinator'
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
      adopt_binding_base authoring_mutation bootstrap_project_design cancel_placement_instance close_dialog
      component_viewport_move
      confirm_placement_instance
      connect_model connect_with_code create_project_furniture delete_selected_furniture dialog_ready
      emit_initial_quote enroll
      get_catalog get_commercial_projection get_model_binding get_project_furniture insert_furniture
      list_binding_designs list_binding_projects list_bootstrap_customers logout
      manufacturing_inspection open_external_url open_material_selector
      place_furniture_instance poll_enrollment preflight_review publish_design_revision
      refresh_media_url refresh_model_binding
      rescan_duplicates restore_furniture_instance select_furniture select_project_furniture update_furniture
      validate_design_revision validate_managed_furniture_identity
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

  def test_save_observer_remains_active_after_dialog_closes_and_shutdown_detaches_it
    model = SketchupStub.active_model
    binding = Granete::SketchUpExtension::Connection::ModelBinding::Binding.new(
      project_id: '41000000-0000-0000-0000-000000000001',
      design_id: '52000000-0000-0000-0000-000000000001',
      base_revision_id: '53000000-0000-0000-0000-000000000001'
    )
    Granete::SketchUpExtension::Connection::ModelBinding::Store.new(model).write!(binding)
    state = @application.instance_variable_get(:@save_awareness)
    @application.start
    state.mark_synced(model)
    dialog = @application.open_dialog
    dialog.close

    assert_equal 1, model.observers.length
    assert state.projection(model)['needsSave']
    model.notify_post_save
    refute state.projection(model)['needsSave']

    reopened = @application.open_dialog
    reopened.callbacks.fetch('dialog_ready').call(nil)
    awareness = reopened.executed_scripts.reverse.find { |script| script.include?('onHostSaveAwareness') }
    assert_includes awareness, '"needsSave":false'

    @application.shutdown
    assert_empty model.observers
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

  class RecordingSessionTransport
    attr_reader :requests

    def initialize(grant_response = nil)
      @grant_response = grant_response
      @requests = []
    end

    def configured?
      true
    end

    def base_url
      'http://taller.local:8080/api'
    end

    def request(payload, authorization_header: nil)
      @requests << { 'payload' => payload, 'authorization_header' => authorization_header }
      @grant_response || { 'status' => 200, 'body' => {} }
    end
  end

  class AuthenticatedHermeticSession < HermeticDeviceProvider
    attr_accessor :org_id, :auth_token

    def initialize(logger:, transport:, org_id: 'org-workshop-1', auth_token: 'Bearer test-session-token')
      super(
        logger: logger,
        transport: transport,
        store_path: File.join(Dir.mktmpdir('granete-auth-test'), 'session.json')
      )
      @org_id = org_id
      @auth_token = auth_token
    end

    def current_organization_id
      @org_id
    end

    def authorization_header
      @auth_token
    end

    def configured?
      !@org_id.nil? && !@auth_token.nil?
    end
  end

  class FakeCatalogTransportWithHardware
    def initialize(sha256:, expected_bytes:)
      @sha256 = sha256
      @expected_bytes = expected_bytes
    end

    def configured?
      true
    end

    def request(req = {}, *)
      if req['path'].to_s.include?('/layout')
        {
          'status' => 200,
          'body' => {
            'furnitureDefinitionId' => 'kitchen-base-standard',
            'definitionName' => 'Gabinete Base Estándar',
            'transformContract' => 'granete.local-basis.v1',
            'dimensionsMm' => [800, 720, 590],
            'components' => [
              {
                'componentInstanceId' => 'st-side-copy-0',
                'componentDefinitionId' => 'st-side',
                'slotId' => 'lateral_izquierdo',
                'name' => 'Lateral',
                'kind' => 'board',
                'transform' => { 'translationMm' => [0, 0, 0] },
                'dimensionsMm' => [18, 590, 720],
                'localTransform' => {
                  'translationMm' => [0, 590, 0],
                  'basis' => { 'x' => [0, -1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }
                },
                'lengthMm' => 720, 'widthMm' => 590, 'thicknessMm' => 18,
                'optionRole' => 'LATERAL', 'materialColorHex' => '#c8b89a'
              }
            ],
            'hardware' => [
              {
                'placementId' => 'hw-pull-0',
                'hardwareId' => 'pull-96',
                'assetId' => 'ast-pull-96',
                'assetRevisionId' => 'rev-001',
                'name' => 'Tirador 96',
                'sha256' => @sha256,
                'expectedBytes' => @expected_bytes,
                'representation' => 'skp',
                'placementKind' => 'derived',
                'hostComponentInstanceId' => 'st-side-copy-0',
                'dimensionsMm' => [96, 32, 25],
                'localTransform' => {
                  'translationMm' => [100, 20, 700],
                  'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
                }
              }
            ]
          }
        }
      else
        { 'status' => 200, 'body' => WORKSHOP_CONTRACT }
      end
    end
  end

  def test_library_hardware_asset_downloader_wiring_authorizes_skp_and_avoids_fallback_proxy
    logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    model_data = 'FAKE SKP BINARY CONTENT FOR HARDWARE'
    model_sha = Digest::SHA256.hexdigest(model_data)
    model_size = model_data.bytesize

    grant_response = {
      'status' => 200,
      'body' => {
        'representation' => 'skp',
        'sha256' => model_sha,
        'sizeBytes' => model_size,
        'url' => '/api/hardware-assets/files/key?grant=signed-grant-token',
        'expiresAt' => (Time.now + 300).utc.iso8601
      }
    }
    session_transport = RecordingSessionTransport.new(grant_response)
    session = AuthenticatedHermeticSession.new(logger: logger, transport: session_transport)

    catalog_transport = FakeCatalogTransportWithHardware.new(
      sha256: model_sha,
      expected_bytes: model_size
    )

    application = Granete::SketchUpExtension::Application.new(
      logger: logger,
      session_provider: session,
      transport: catalog_transport,
      auth_provider: FakeCatalogAuth.new
    )
    controller = application.instance_variable_get(:@dialog)
    dialog = application.open_dialog

    # 1 & 2. Verify real production hierarchy wiring
    model = SketchupStub.active_model
    builder = controller.send(:furniture_builder_for, model)
    asset_loader = builder.instance_variable_get(:@asset_loader)
    downloader = asset_loader.instance_variable_get(:@downloader)

    assert_same session.transport, downloader.instance_variable_get(:@transport)
    assert_same session, downloader.instance_variable_get(:@auth_provider)

    # Seed the cache so valid authorized grant serves the asset without network fetch
    downloader.cache.put(
      asset_id: 'ast-pull-96',
      revision_id: 'rev-001',
      data: model_data,
      sha256: model_sha,
      expected_bytes: model_size,
      org_id: session.current_organization_id
    )

    # 3. Insert furniture from Library with layout containing assetId + assetRevisionId
    dialog.callbacks.fetch('insert_furniture').call(
      nil,
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 800 }
    )

    # Verify authorized path was attempted through session transport
    grant_request = session_transport.requests.find do |req|
      req['payload'].is_a?(Hash) && req['payload']['path'].to_s.include?('hardware-assets')
    end
    refute_nil grant_request, 'must attempt authorized SKP grant request through session transport'
    assert_equal session.authorization_header, grant_request['authorization_header'],
                 'must authenticate grant request with session authorization header'

    # Verify fallback proxy was not used
    fallback_definitions = model.definitions.select do |d|
      d.name.start_with?(Granete::SketchUpExtension::Model::FurnitureBuilder::HARDWARE_DEFINITION_PREFIX)
    end
    assert_empty fallback_definitions,
                 'must not fall back to proxy geometry when session is configured and authorized'
  end
end
