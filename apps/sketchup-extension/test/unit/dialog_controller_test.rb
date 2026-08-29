# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/resolver'
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

  # Catalog double whose server resolves layouts (RemoteCatalogProvider
  # shape). The body carries the #414 transform contract the controller's
  # resolved_native_layout path requires — no AABB-only legacy bodies.
  class LayoutResolvingCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
    attr_reader :requested_definition_id, :requested_parameters, :requested_choices

    def resolved_layout(definition_id, parameters = {}, choices = {})
      @requested_definition_id = definition_id
      @requested_parameters = parameters
      @requested_choices = choices
      { 'transformContract' => 'granete.local-basis.v1',
        'components' => [
          { 'componentInstanceId' => 'st-door-0', 'componentDefinitionId' => 'st-door',
            'slotId' => 'puerta', 'name' => 'Puerta',
            'transform' => { 'translationMm' => [2, 560, 2] }, 'dimensionsMm' => [596, 18, 716],
            'localTransform' => {
              'translationMm' => [2, 560, 2],
              'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
            },
            'lengthMm' => 716, 'widthMm' => 596, 'thicknessMm' => 18 }
        ],
        'hardware' => [] }
    end
  end

  # Builder double capturing the resolved layout kwarg.
  class BuilderSpy
    attr_reader :insert_layout, :update_layout, :material_choices

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
    assert_equal 'granete.local-basis.v1', builder.insert_layout.transform_contract
    assert_equal ['puerta'], builder.insert_layout.boards.map(&:slot_id)
  end

  # Managed furniture in the native representation: top-level
  # ComponentInstance with furniture metadata, as the real builder inserts.
  def native_furniture(instance_ref, definition_id = 'kitchen-base-standard')
    definition = @model.definitions.add("Granete · Mueble · #{instance_ref}")
    furniture = @model.active_entities.add_instance(definition, Geom::Transformation.identity)
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, furniture, instance_ref,
      { 'furniture_definition_id' => definition_id }, {}
    )
    furniture
  end

  def test_update_fetches_and_forwards_the_server_resolved_layout
    catalog = LayoutResolvingCatalog.new
    builder = BuilderSpy.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: catalog, furniture_builder: builder, metadata_store: @store
    )
    dialog = controller.show
    @model.selection.add(native_furniture('inst-01'))

    dialog.callbacks.fetch('update_furniture').call(
      nil,
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 900 }
    )

    assert_equal 'kitchen-base-standard', catalog.requested_definition_id
    assert_equal({ 'widthMm' => 900 }, catalog.requested_parameters)
    refute_nil builder.update_layout
  end

  def test_material_update_merges_changed_role_with_persisted_choices_before_resolving
    catalog = LayoutResolvingCatalog.new
    builder = BuilderSpy.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: catalog, furniture_builder: builder,
      metadata_store_factory: ->(_model) { @store }
    )
    furniture = native_furniture('inst-material-01')
    metadata = @store.read(furniture)
    metadata['intent']['materialChoices'] = {
      'BODY' => 'mat-white-16', 'FRONT' => 'mat-white-16', 'BACK' => 'mat-back-6'
    }
    @store.write(furniture, metadata)
    @model.selection.add(furniture)

    dialog = controller.show
    dialog.callbacks.fetch('update_furniture').call(
      nil,
      'instanceId' => 'inst-material-01',
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 600 },
      'materialChoices' => { 'FRONT' => 'mat-oak-18' }
    )

    expected = {
      'BODY' => 'mat-white-16', 'FRONT' => 'mat-oak-18', 'BACK' => 'mat-back-6'
    }
    assert_equal expected, catalog.requested_choices
    assert_equal expected, builder.material_choices
  end

  class FailingLayoutCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
    def resolved_layout(_definition_id, _parameters = {}, _choices = {})
      raise Granete::SketchUpExtension::Library::LayoutResolutionError.new(
        'Composición no resoluble (HTTP 422)', status: 422
      )
    end
  end

  def test_update_fails_closed_when_layout_resolution_errors
    catalog = FailingLayoutCatalog.new
    builder = BuilderSpy.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: catalog, furniture_builder: builder, metadata_store: @store
    )
    dialog = controller.show
    group = SketchupStub::GroupStub.new('cabinet')
    @model.entities.add(group)
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, group, 'inst-01', { 'furniture_definition_id' => 'kitchen-base-standard' }, {}
    )

    dialog.callbacks.fetch('update_furniture').call(
      nil,
      'instanceId' => 'inst-01',
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 900 }
    )

    scripts = dialog.executed_scripts
    update_script = scripts.find { |s| s.include?('onUpdateResult') }
    refute_nil update_script
    assert_includes update_script, '"success":false'
    assert_includes update_script, 'Composición no resoluble'
    assert_nil builder.update_layout
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
    native_furniture('inst-01')

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

  def test_update_furniture_fails_closed_when_instance_not_found
    dialog = @controller.show
    unrelated = SketchupStub::GroupStub.new('unrelated-cabinet')
    @model.selection.add(unrelated)
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, unrelated, 'other-inst', { 'furniture_definition_id' => 'kitchen-wall-standard' }, {}
    )

    payload = {
      'instanceId' => 'missing-inst-999',
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 900 }
    }

    dialog.callbacks.fetch('update_furniture').call(nil, payload)

    scripts = dialog.executed_scripts
    update_script = scripts.find { |s| s.include?('onUpdateResult') }

    refute_nil update_script
    assert_includes update_script, '"success":false'
    assert_includes update_script, 'Instancia no encontrada'
    # The unrelated selected entity must NOT be modified
    meta = @store.read(unrelated)
    assert_equal 'other-inst', meta.dig('identity', 'instanceRef')
    assert_equal 'kitchen-wall-standard', meta.dig('intent', 'furnitureDefinitionId')
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
    payload = {
      'role' => 'FRENTES', 'roleName' => 'Frentes', 'currentMaterialId' => 'mat-01',
      'context' => 'inspector', 'instanceId' => 'inst-01', 'definitionId' => 'def-01'
    }

    dialog.callbacks.fetch('open_material_selector').call(nil, JSON.generate(payload))

    selector_dialog = @controller.send(:option_selector).dialog
    refute_nil selector_dialog
    assert @controller.send(:option_selector).open?

    # Apply through selector
    selector_dialog.callbacks.fetch('apply_selection').call(
      selector_dialog,
      JSON.generate({ 'role' => 'FRENTES', 'materialId' => 'mat-02', 'scope' => 'furniture' })
    )

    script = dialog.executed_scripts.find { |s| s.include?('onMaterialChoiceApplied') }
    refute_nil script
    assert_includes script, '"materialId":"mat-02"'
    assert_includes script, '"context":"inspector"'
    assert_includes script, '"instanceId":"inst-01"'
    assert_includes script, '"definitionId":"def-01"'
  end

  def test_rebinds_selection_observer_when_model_switches
    dialog = @controller.show
    new_model = SketchupStub::ModelStub.new

    app_observer = SketchupStub.observers.find do |o|
      o.is_a?(Granete::SketchUpExtension::UserInterface::AppModelObserver)
    end
    refute_nil app_observer, 'AppModelObserver must be registered when dialog opens'

    # Add a furniture group in new model
    group = SketchupStub::GroupStub.new('new_cabinet')
    new_model.entities.add(group)
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, group, 'new-inst-01', { 'furniture_definition_id' => 'kitchen-base-standard' }, {}
    )
    new_model.selection.add(group)

    # Fire onActivateModel on app observer
    app_observer.onActivateModel(new_model)

    # New model selection change should now reach the dialog
    script = dialog.executed_scripts.find { |s| s.include?('new-inst-01') }
    refute_nil script, 'Selection in new model must reach the dialog after model switch'
  end

  def test_open_material_selector_filters_materials_by_explicit_allowed_material_ids
    fake_catalog = Class.new(Granete::SketchUpExtension::Library::CatalogProvider) do
      def all_materials
        [
          { 'materialId' => 'mat-01', 'name' => 'Roble 18mm' },
          { 'materialId' => 'mat-02', 'name' => 'Blanco 15mm' }
        ]
      end
    end.new

    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      catalog_provider: fake_catalog
    )

    dialog = controller.show
    payload = {
      'role' => 'FRENTES', 'roleName' => 'Frentes', 'currentMaterialId' => 'mat-01',
      'context' => 'inspector', 'instanceId' => 'inst-01', 'definitionId' => 'def-01',
      'allowedMaterialIds' => ['mat-01']
    }

    dialog.callbacks.fetch('open_material_selector').call(nil, JSON.generate(payload))

    selector = controller.send(:option_selector)
    refute_nil selector.dialog
    selector.dialog.callbacks.fetch('selector_ready').call(nil)
    init_script = selector.dialog.executed_scripts.find { |s| s.include?('initOptionSelector') }
    refute_nil init_script
    assert_includes init_script, '"materialId":"mat-01"'
    refute_includes init_script, '"materialId":"mat-02"'
  end

  def test_open_material_selector_filters_materials_by_definition_material_roles
    fake_catalog = Class.new(Granete::SketchUpExtension::Library::CatalogProvider) do
      def all_materials
        [
          { 'materialId' => 'mat-01', 'name' => 'Roble 18mm' },
          { 'materialId' => 'mat-02', 'name' => 'Blanco 15mm' }
        ]
      end

      def find_definition(id)
        return nil unless id == 'def-curated'

        {
          'furniture_definition_id' => 'def-curated',
          'materialRoles' => [
            { 'role' => 'FRENTES', 'label' => 'Frentes', 'optionIds' => ['mat-02'] }
          ]
        }
      end
    end.new

    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      catalog_provider: fake_catalog
    )

    dialog = controller.show
    payload = {
      'role' => 'FRENTES', 'roleName' => 'Frentes', 'currentMaterialId' => 'mat-02',
      'context' => 'configurator', 'definitionId' => 'def-curated'
    }

    dialog.callbacks.fetch('open_material_selector').call(nil, JSON.generate(payload))

    selector = controller.send(:option_selector)
    refute_nil selector.dialog
    selector.dialog.callbacks.fetch('selector_ready').call(nil)
    init_script = selector.dialog.executed_scripts.find { |s| s.include?('initOptionSelector') }
    refute_nil init_script
    assert_includes init_script, '"materialId":"mat-02"'
    refute_includes init_script, '"materialId":"mat-01"'
  end

  def test_delete_selected_furniture_erases_target_with_granete_metadata
    group = @model.active_entities.add_group
    @store.write(
      group,
      {
        'namespace' => 'com.granete.sketchup_extension',
        'metadataVersion' => 1,
        'kind' => 'furnitureInstance',
        'identity' => {
          'instanceRef' => 'inst-del-1',
          'projectRef' => 'proj-active'
        },
        'intent' => {
          'semanticRole' => 'furniture-instance',
          'furnitureDefinitionId' => 'kitchen-base-standard',
          'parameters' => { 'widthMm' => 600 }
        }
      }
    )
    @model.selection.add(group)

    dialog = @controller.show
    dialog.callbacks.fetch('delete_selected_furniture').call(nil, JSON.generate({ 'instanceId' => 'inst-del-1' }))

    assert_empty @model.active_entities.groups
    assert(dialog.executed_scripts.any? { |s| s.include?('onSelectionChange(null)') })
  end

  def test_delete_selected_furniture_rejects_entity_without_granete_metadata
    group = @model.active_entities.add_group
    @model.selection.add(group)

    dialog = @controller.show
    dialog.callbacks.fetch('delete_selected_furniture').call(nil, JSON.generate({}))

    assert_includes @model.active_entities.groups, group
  end

  def test_dialog_ready_publishes_furniture_selection_context_payload
    definition = @controller.instance_variable_get(:@catalog_provider).find_definition('kitchen-base-standard')
    Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
                                                       .insert_furniture(@model, definition, { 'widthMm' => 600 })
    furniture = @model.active_entities.instances.first
    @model.selection.add(furniture)

    dialog = @controller.show
    dialog.callbacks.fetch('dialog_ready').call(nil)

    script = dialog.executed_scripts.find do |s|
      s.include?('onSelectionChange') && s.include?('"kind":"furniture"')
    end
    refute_nil script, 'the furniture SelectionContext payload must reach the dialog'
    assert_includes script, '"furnitureDefinitionId":"kitchen-base-standard"'
    assert_includes script, '"canEditParameters"'
  end

  def test_selection_change_publishes_part_context_with_owner_breadcrumb
    definition = @controller.instance_variable_get(:@catalog_provider).find_definition('kitchen-base-standard')
    result = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
                                                                .insert_furniture(@model, definition,
                                                                                  { 'widthMm' => 600 })
    furniture = @model.active_entities.instances.first
    left_panel = furniture.definition.entities.instances.first
    @model.selection.clear
    @model.selection.add(left_panel)

    dialog = @controller.show
    dialog.callbacks.fetch('dialog_ready').call(nil)

    script = dialog.executed_scripts.find do |s|
      s.include?('onSelectionChange') && s.include?('"kind":"part"')
    end
    refute_nil script, 'the part SelectionContext payload must reach the dialog'
    assert_includes script, JSON.generate(result['instance_id'])
    assert_includes script, '"semanticPath"'
    assert_includes script, '"capabilities"'
  end

  def test_select_furniture_callback_selects_the_owning_furniture_entity
    definition = @controller.instance_variable_get(:@catalog_provider).find_definition('kitchen-base-standard')
    result = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
                                                                .insert_furniture(@model, definition,
                                                                                  { 'widthMm' => 600 })
    furniture = @model.active_entities.instances.first
    left_panel = furniture.definition.entities.instances.first
    @model.selection.clear
    @model.selection.add(left_panel)
    refute_same furniture, @model.selection.first

    dialog = @controller.show
    dialog.callbacks.fetch('select_furniture').call(
      nil, JSON.generate({ 'furnitureInstanceRef' => result['instance_id'] })
    )

    assert_same furniture, @model.selection.first
    assert(dialog.executed_scripts.any? do |s|
      s.include?('onSelectionChange') && s.include?('"kind":"furniture"')
    end, 'selecting the furniture must publish its context')
  end

  def test_select_furniture_rejects_a_part_instance_id
    definition = @controller.instance_variable_get(:@catalog_provider).find_definition('kitchen-base-standard')
    Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
                                                       .insert_furniture(@model, definition, { 'widthMm' => 600 })
    furniture = @model.active_entities.instances.first
    left_panel = furniture.definition.entities.instances.first
    part_id = @store.read(left_panel).dig('identity', 'instanceRef')
    @model.selection.clear
    @model.selection.add(left_panel)

    dialog = @controller.show
    dialog.callbacks.fetch('select_furniture').call(
      nil, JSON.generate({ 'furnitureInstanceId' => part_id })
    )

    assert_same left_panel, @model.selection.first,
                'a part occurrence id must never select/retarget as furniture'
  end
end
