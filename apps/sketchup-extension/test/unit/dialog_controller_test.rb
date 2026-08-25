# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/metadata/store'
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
end
