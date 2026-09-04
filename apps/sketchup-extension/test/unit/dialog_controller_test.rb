# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/auth/provider'
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
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'
require_relative '../support/host_runtime'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'
require_relative '../../src/granete_for_sketchup/assets/media_authorizer'

class DialogControllerTest < Minitest::Test
  class StatusProvider
    def call
      { heading: 'Conectado', message: 'Listo', state: 'configured' }
    end
  end

  # Session double for the #460 SEC-6 device enrollment flow:
  # enroll → poll_enrollment → exchange_enrollment. Result shapes mirror
  # Auth::DeviceProvider.
  class FakeSession
    attr_accessor :enroll_result, :poll_result, :exchange_result
    attr_reader :enroll_args, :polled_enrollment_ids, :exchanged_enrollment_ids

    def initialize
      @enroll_result = {
        'success' => true, 'id' => 'enr-1', 'code' => 'GRAN-1234',
        'expires_at' => '2026-09-02T05:00:00Z'
      }
      @poll_result = { 'success' => true, 'status' => 'approved' }
      @exchange_result = { 'success' => true, 'user' => { 'name' => 'Ana' } }
      @enroll_args = []
      @polled_enrollment_ids = []
      @exchanged_enrollment_ids = []
    end

    def enroll(server_url, display_name)
      @enroll_args << [server_url, display_name]
      @enroll_result
    end

    def poll_enrollment(enrollment_id)
      @polled_enrollment_ids << enrollment_id
      @poll_result
    end

    def exchange_enrollment(enrollment_id)
      @exchanged_enrollment_ids << enrollment_id
      @exchange_result
    end

    def logout
      nil
    end
  end

  # Session double that also exposes the configured-transport surface the
  # media grants flow reads (configured?/transport/authorization_header).
  class MediaEnabledSession < FakeSession
    attr_reader :media_requests

    def initialize
      super
      @media_requests = []
    end

    def configured?
      true
    end

    def authorization_header
      'Bearer media-token-123'
    end

    # Transport double answering POST /media:authorize with signed grants
    # (#460 SEC-3). Records every request so tests can prove the session
    # credential stayed in the Authorization header of the authorize call.
    def transport
      session = self
      @transport ||= Class.new do
        def initialize(session)
          @session = session
        end

        def configured?
          true
        end

        def base_url
          'http://taller.local:8080/api'
        end

        def request(payload, authorization_header: nil)
          @session.media_requests << { 'payload' => payload, 'authorization_header' => authorization_header }
          { 'status' => 200, 'body' => {
            'grants' => payload['body']['resources'].map do |filename|
              { 'filename' => filename,
                'url' => "/api/media/#{filename}?grant=signed-#{filename[0, 6]}",
                'expiresAt' => '2026-09-01T12:03:00Z' }
            end
          } }
        end
      end.new(session)
    end
  end

  # Catalog double whose definitions reference server media previews.
  class MediaCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
    MEDIA_FILE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'

    def all_definitions
      super.map do |definition|
        definition.merge('imageUrl' => "/api/media/#{MEDIA_FILE}")
      end
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

  # Builder double capturing the resolved layout kwarg. Mirrors the real
  # builder's host contract (#498): an update runs as exactly ONE SketchUp
  # operation through the coordinator's journal.
  class BuilderSpy
    attr_reader :insert_layout, :update_layout, :material_choices

    def insert_furniture(_model, _definition, _parameters = {}, resolved_layout: nil, material_choices: nil)
      @insert_layout = resolved_layout
      @material_choices = material_choices
      { 'success' => true, 'name' => 'Base Una Puerta', 'component_count' => 1,
        'board_count' => 1, 'hardware_count' => 0 }
    end

    def update_furniture(model, _group, _definition, _parameters = {}, resolved_layout: nil, material_choices: nil)
      @update_layout = resolved_layout
      @material_choices = material_choices
      model.start_operation('Editar Mueble', true)
      model.commit_operation
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

  class StructuredIssueError < StandardError
    attr_reader :issues

    def initialize
      super('authoring rejected')
      issue = Struct.new(:code, :message, :severity, :path, :details).new(
        'PARAMETER_STRING_TOO_LONG', 'too long', 'error', 'furniture.parameters.customerNote',
        { 'maxLength' => 80, 'receivedType' => 'string' }
      )
      @issues = [issue]
    end
  end

  class StructuredFailingCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
    def resolved_native_layout(_definition_id, _parameters = {}, _choices = {})
      raise StructuredIssueError
    end
  end

  def test_insert_preserves_structured_parameter_issues_for_the_html_dialog
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: StructuredFailingCatalog.new, furniture_builder: BuilderSpy.new,
      metadata_store: @store
    )
    dialog = controller.show

    dialog.callbacks.fetch('insert_furniture').call(
      nil, 'definitionId' => 'kitchen-base-standard', 'parameters' => { 'customerNote' => 'too long' }
    )

    script = dialog.executed_scripts.find { |entry| entry.include?('onInsertionResult') }
    assert_includes script, '"code":"PARAMETER_STRING_TOO_LONG"'
    assert_includes script, '"maxLength":80'
    assert_includes script, '"receivedType":"string"'
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

  # #460 SEC-6: login por contraseña fue reemplazado por enrollment de
  # dispositivo. El callback enroll inicia el flujo, el código corto se
  # muestra al usuario y poll_enrollment completa el intercambio cuando la
  # aprobación llega desde la web.
  def test_enroll_then_poll_approval_reports_login_and_refreshes_catalog
    session = FakeSession.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      session: session
    )
    dialog = controller.show

    dialog.callbacks.fetch('enroll').call(
      nil,
      'serverUrl' => 'http://taller.local:8080/api', 'displayName' => 'Mac del taller'
    )

    assert_equal [['http://taller.local:8080/api', 'Mac del taller']], session.enroll_args
    scripts = dialog.executed_scripts
    enroll_script = scripts.find { |s| s.include?('onEnrollResult') }
    refute_nil enroll_script
    assert_includes enroll_script, '"success":true'
    assert_includes enroll_script, 'GRAN-1234'

    dialog.callbacks.fetch('poll_enrollment').call(nil, 'enrollmentId' => 'enr-1')

    assert_equal ['enr-1'], session.polled_enrollment_ids
    assert_equal ['enr-1'], session.exchanged_enrollment_ids
    scripts = dialog.executed_scripts
    login_script = scripts.find { |s| s.include?('onLoginResult') }
    refute_nil login_script
    assert_includes login_script, '"success":true'
    # dialog_ready was never fired in this test, so this setCatalog is the
    # catalog refresh pushed by the completed enrollment exchange.
    catalog_scripts = scripts.select { |s| s.include?('setCatalog') }
    assert_equal 1, catalog_scripts.length
  end

  def test_enroll_failure_only_reports_result
    session = FakeSession.new
    session.enroll_result = { 'success' => false, 'error' => 'El servidor rechazó el registro (503).' }
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      session: session
    )
    dialog = controller.show
    before = dialog.executed_scripts.length

    dialog.callbacks.fetch('enroll').call(nil, 'serverUrl' => 'http://taller.local:8080/api', 'displayName' => '')

    # The controller owns the display-name default for the device label.
    assert_equal [['http://taller.local:8080/api', 'SketchUp']], session.enroll_args
    # A failed enrollment must not start polling nor report login: the dialog
    # only receives the enroll result so the user can retry.
    assert_equal before + 1, dialog.executed_scripts.length
    assert_includes dialog.executed_scripts.last, 'onEnrollResult'
    assert_includes dialog.executed_scripts.last, 'rechazó el registro'
    assert_includes dialog.executed_scripts.last, '"success":false'
  end

  def test_poll_pending_reports_poll_result_without_login_or_catalog
    session = FakeSession.new
    session.poll_result = { 'success' => true, 'status' => 'pending' }
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      session: session
    )
    dialog = controller.show
    before = dialog.executed_scripts.length

    dialog.callbacks.fetch('poll_enrollment').call(nil, 'enrollmentId' => 'enr-1')

    assert_empty session.exchanged_enrollment_ids
    assert_equal before + 1, dialog.executed_scripts.length
    assert_includes dialog.executed_scripts.last, 'onPollResult'
    assert_includes dialog.executed_scripts.last, 'pending'
    refute_includes dialog.executed_scripts.last, 'onLoginResult'
  end

  def test_poll_approved_but_exchange_failure_reports_poll_error
    session = FakeSession.new
    session.exchange_result = { 'success' => false, 'error' => 'Error al intercambiar credencial (409).' }
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      session: session
    )
    dialog = controller.show
    before = dialog.executed_scripts.length

    dialog.callbacks.fetch('poll_enrollment').call(nil, 'enrollmentId' => 'enr-1')

    assert_equal ['enr-1'], session.exchanged_enrollment_ids
    scripts = dialog.executed_scripts
    assert_equal before + 1, scripts.length
    assert_includes scripts.last, 'onPollResult'
    assert_includes scripts.last, 'intercambiar credencial'
    assert_nil(scripts.find { |s| s.include?('onLoginResult') })
    assert_empty(scripts.select { |s| s.include?('setCatalog') })
  end

  # #460 SEC-3: the dialog never receives the session credential. The media
  # payload carries per-file signed grant URLs minted through the authorize
  # endpoint, with the bearer confined to that request's Authorization header.
  def test_catalog_payload_carries_signed_media_urls_without_session_token
    session = MediaEnabledSession.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      catalog_provider: MediaCatalog.new,
      session: session
    )
    dialog = controller.show

    dialog.callbacks.fetch('dialog_ready').call(nil)

    catalog_script = dialog.executed_scripts.find { |s| s.include?('setCatalog') }
    refute_nil catalog_script
    assert_includes catalog_script, '"media":{"baseUrl":"http://taller.local:8080"'
    signed_url = '"http://taller.local:8080/api/media/' \
                 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png?grant=signed-aaaaaa"'
    assert_includes catalog_script, "\"urls\":{\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png\":#{signed_url}"
    # The session credential must NOT cross into the webview.
    refute_includes catalog_script, '"token"'
    refute_includes catalog_script, 'media-token-123'

    # The authorize call kept the bearer in the header and requested typed
    # resource ids — never an arbitrary URL to sign.
    assert_equal 1, session.media_requests.length
    request = session.media_requests.first
    assert_equal 'POST', request['payload']['method']
    assert_equal '/media:authorize', request['payload']['path']
    assert_equal ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'],
                 request['payload']['body']['resources']
    assert_equal 'Bearer media-token-123', request['authorization_header']
  end

  # Webviews re-mint expired grants on demand through the refresh callback;
  # Ruby pushes the fresh signed URL back via the updateMediaUrl bridge.
  def test_refresh_media_url_callback_mints_grant_and_pushes_bridge
    session = MediaEnabledSession.new
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      catalog_provider: MediaCatalog.new,
      session: session
    )
    dialog = controller.show

    dialog.callbacks.fetch('refresh_media_url').call(nil, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png')

    update_script = dialog.executed_scripts.find { |s| s.include?('updateMediaUrl') }
    refute_nil update_script
    assert_includes update_script, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'
    assert_includes update_script, 'grant=signed-bbbbbb'
    refute_includes update_script, 'media-token-123'
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
