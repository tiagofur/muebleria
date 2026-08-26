# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'

class DialogControllerTest < Minitest::Test
  class StatusProvider
    def call
      { heading: 'Conectado', message: 'Listo', state: 'configured' }
    end
  end

  class FakeSession
    attr_accessor :login_result

    def initialize
      @login_result = { 'success' => true, 'user' => { 'name' => 'Ana' }, 'license' => { 'plan' => 'pro' } }
    end

    def login(_email, _password, _server_url)
      @login_result
    end

    def logout
      nil
    end
  end

  # Session double that also exposes the configured-transport surface the
  # media payload reads (configured?/status/authorization_header).
  class MediaEnabledSession < FakeSession
    def configured?
      true
    end

    def status
      { 'state' => 'logged_in', 'server_url' => 'http://taller.local:8080/api' }
    end

    def authorization_header
      'Bearer media-token-123'
    end
  end

  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store
    )
  end

  def test_dialog_ready_sends_status_and_catalog
    dialog = @controller.show
    dialog.callbacks.fetch('dialog_ready').call(nil)

    scripts = dialog.executed_scripts
    assert scripts.length >= 2

    assert_includes scripts[0], 'window.GraneteDialog && window.GraneteDialog.setStatus'
    assert_includes scripts[1], 'window.GraneteDialog && window.GraneteDialog.setCatalog'
    catalog_script = scripts[1]
    assert_includes catalog_script, '"source":"local"'
    assert_includes catalog_script, '"presets":[]'
    assert_includes catalog_script, '"materialCategories":[]'
  end

  def test_insert_furniture_callback_invokes_builder_and_returns_result
    dialog = @controller.show
    payload = {
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 800, 'shelfCount' => 1, 'doorCount' => 1 }
    }

    dialog.callbacks.fetch('insert_furniture').call(nil, payload)

    scripts = dialog.executed_scripts
    insert_script = scripts.find { |s| s.include?('onInsertionResult') }

    refute_nil insert_script
    assert_includes insert_script, '"success":true'
    assert_includes insert_script, 'Gabinete Base Estándar'
  end

  # Catalog double whose server resolves layouts (RemoteCatalogProvider shape).
  class LayoutResolvingCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
    attr_reader :requested_definition_id, :requested_parameters, :requested_choices

    def resolved_layout(definition_id, parameters = {}, choices = {})
      @requested_definition_id = definition_id
      @requested_parameters = parameters
      @requested_choices = choices
      { 'components' => [{ 'slotId' => 'puerta', 'name' => 'Puerta',
                           'transform' => { 'translationMm' => [2, 560, 2] },
                           'dimensionsMm' => [596, 18, 716] }],
        'hardware' => [] }
    end
  end

  # Builder double capturing the resolved layout kwarg.
  class BuilderSpy
    attr_reader :insert_layout, :update_layout

    def insert_furniture(_model, _definition, _parameters = {}, resolved_layout: nil, material_choices: nil)
      @insert_layout = resolved_layout
      @material_choices = material_choices
      { 'success' => true, 'name' => 'Base Una Puerta', 'component_count' => 1,
        'board_count' => 1, 'hardware_count' => 0 }
    end

    def update_furniture(_model, _group, _definition, _parameters = {}, resolved_layout: nil, material_choices: nil)
      @update_layout = resolved_layout
      @material_choices = material_choices
      { 'success' => true, 'name' => 'Base Una Puerta', 'component_count' => 1 }
    end
  end

  def test_insert_fetches_and_forwards_the_server_resolved_layout
    catalog = LayoutResolvingCatalog.new
    builder = BuilderSpy.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: catalog, furniture_builder: builder, metadata_store: @store
    )
    dialog = controller.show

    dialog.callbacks.fetch('insert_furniture').call(
      nil,
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
      'materialChoices' => { 'FRENTE' => 'mat-oak' }
    )

    assert_equal 'kitchen-base-standard', catalog.requested_definition_id
    assert_equal({ 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 }, catalog.requested_parameters)
    assert_equal({ 'FRENTE' => 'mat-oak' }, catalog.requested_choices)
    refute_nil builder.insert_layout
    slots = builder.insert_layout['components'].map { |c| c['slotId'] }
    assert_equal ['puerta'], slots
  end

  def test_update_fetches_and_forwards_the_server_resolved_layout
    catalog = LayoutResolvingCatalog.new
    builder = BuilderSpy.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: catalog, furniture_builder: builder, metadata_store: @store
    )
    dialog = controller.show
    target = Sketchup.active_model.selection
    target.add(SketchupStub::GroupStub.new('selected'))

    dialog.callbacks.fetch('update_furniture').call(
      nil,
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 900 }
    )

    assert_equal 'kitchen-base-standard', catalog.requested_definition_id
    assert_equal({ 'widthMm' => 900 }, catalog.requested_parameters)
    refute_nil builder.update_layout
  end

  def test_insert_without_layout_support_passes_nil_to_the_builder
    builder = BuilderSpy.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: Granete::SketchUpExtension::Library::StaticCatalogProvider.new,
      furniture_builder: builder, metadata_store: @store
    )
    dialog = controller.show

    dialog.callbacks.fetch('insert_furniture').call(
      nil, 'definitionId' => 'kitchen-base-standard', 'parameters' => { 'widthMm' => 600 }
    )

    assert_nil builder.insert_layout
  end

  def test_update_furniture_callback_updates_instance
    dialog = @controller.show
    payload = {
      'instanceId' => 'inst-01',
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 900, 'shelfCount' => 2 }
    }

    dialog.callbacks.fetch('update_furniture').call(nil, payload)

    scripts = dialog.executed_scripts
    update_script = scripts.find { |s| s.include?('onUpdateResult') }

    refute_nil update_script
    assert_includes update_script, '"success":true'
  end

  def test_login_callback_reports_result_and_refreshes_status
    session = FakeSession.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      session: session
    )
    dialog = controller.show

    dialog.callbacks.fetch('login').call(
      nil,
      'email' => 'ana@taller.com', 'password' => 'secret123', 'serverUrl' => 'http://taller.local:8080/api'
    )

    scripts = dialog.executed_scripts
    login_script = scripts.find { |s| s.include?('onLoginResult') }
    refute_nil login_script
    assert_includes login_script, '"success":true'
    assert_includes login_script, 'Ana'
    # dialog_ready was never fired in this test, so this setCatalog is the
    # catalog refresh pushed by the successful login.
    catalog_scripts = scripts.select { |s| s.include?('setCatalog') }
    assert_equal 1, catalog_scripts.length
  end

  def test_login_callback_failure_only_reports_result
    session = FakeSession.new
    session.login_result = { 'success' => false, 'error' => 'Email o contraseña incorrectos.' }
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      session: session
    )
    dialog = controller.show
    before = dialog.executed_scripts.length

    dialog.callbacks.fetch('login').call(nil, 'email' => 'a', 'password' => 'b', 'serverUrl' => 'c')

    assert_equal before + 1, dialog.executed_scripts.length
    assert_includes dialog.executed_scripts.last, 'onLoginResult'
    assert_includes dialog.executed_scripts.last, 'contraseña'
  end

  def test_catalog_payload_carries_media_origin_and_token_for_session
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      session: MediaEnabledSession.new
    )
    dialog = controller.show

    dialog.callbacks.fetch('dialog_ready').call(nil)

    catalog_script = dialog.executed_scripts.find { |s| s.include?('setCatalog') }
    refute_nil catalog_script
    # Workshop previews are server-relative; the dialog needs the origin
    # (without the /api suffix) plus the media token to load them.
    assert_includes catalog_script, '"media":{'
    assert_includes catalog_script, '"baseUrl":"http://taller.local:8080"'
    assert_includes catalog_script, '"token":"media-token-123"'
  end

  def test_catalog_payload_without_session_omits_media
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store
    )
    dialog = controller.show

    dialog.callbacks.fetch('dialog_ready').call(nil)

    catalog_script = dialog.executed_scripts.find { |s| s.include?('setCatalog') }
    refute_nil catalog_script
    refute_includes catalog_script, '"media"'
  end

  def test_open_material_selector_callback_opens_option_selector
    dialog = @controller.show
    payload = { 'role' => 'FRENTES', 'roleName' => 'Frentes', 'currentMaterialId' => 'mat-01' }

    dialog.callbacks.fetch('open_material_selector').call(nil, JSON.generate(payload))

    selector_dialog = @controller.send(:option_selector).dialog
    refute_nil selector_dialog
    assert @controller.send(:option_selector).open?

    # Apply through selector
    selector_dialog.callbacks.fetch('apply_selection').call(
      selector_dialog,
      JSON.generate({ 'role' => 'FRENTES', 'materialId' => 'mat-02' })
    )

    script = dialog.executed_scripts.find { |s| s.include?('onMaterialChoiceApplied') }
    refute_nil script
    assert_includes script, '"materialId":"mat-02"'
  end
end
