# frozen_string_literal: true

require 'stringio'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'
require_relative '../../src/granete_for_sketchup/lifecycle'
require_relative '../../src/granete_for_sketchup/application'

class ApplicationTest < Minitest::Test
  class ReadyPort
    def configured?
      true
    end
  end

  def setup
    SketchupStub.reset!
    logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @application = Granete::SketchUpExtension::Application.new(logger: logger)
  end

  def test_start_is_idempotent_and_registers_one_menu_action
    @application.start
    @application.start

    assert_equal 1, SketchupStub.menus['Extensions'].items.length
    assert_equal 'Abrir Granete', SketchupStub.menus['Extensions'].items.first.first
  end

  def test_dialog_close_and_reopen_recreates_callbacks_without_duplicates
    @application.start
    first_dialog = @application.open_dialog

    expected_callbacks = %w[
      close_dialog delete_selected_furniture dialog_ready get_catalog insert_furniture update_furniture
    ]
    assert_equal expected_callbacks, first_dialog.callbacks.keys.sort
    first_dialog.callbacks.fetch('dialog_ready').call(nil)
    status_script = first_dialog.executed_scripts.find { |s| s.include?('setStatus') }
    refute_nil status_script
    assert_includes status_script, 'La conexión está desactivada'
    assert_includes status_script, 'Conexión no configurada'
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
      logger: logger
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

    assert_equal 1, SketchupStub.menus['Extensions'].items.length
    refute UI::HtmlDialog.instances.first.visible?
  end

  def test_production_wiring_writes_metadata_and_rehydrates_selection
    @application.start
    dialog = @application.open_dialog

    dialog.callbacks.fetch('insert_furniture').call(
      nil,
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 800, 'shelfCount' => 1, 'doorCount' => 1 }
    )

    model = SketchupStub.active_model
    group = model.active_entities.groups.first
    refute_nil group, 'insert must create furniture geometry in the active model'

    raw = group.get_attribute('com.granete.sketchup_extension', 'bootstrap_intent.v1')
    refute_nil raw, 'production wiring must persist furniture metadata without manual injection'
    metadata = JSON.parse(raw)
    assert_equal 'furnitureInstance', metadata['kind']
    assert_equal 'kitchen-base-standard', metadata.dig('intent', 'furnitureDefinitionId')
    assert_equal 800, metadata.dig('intent', 'parameters', 'widthMm')

    model.selection.add(group)

    selection_script = dialog.executed_scripts.reverse.find { |s| s.include?('onSelectionChange') }
    refute_nil selection_script, 'selecting inserted furniture must reach the dialog'
    assert_includes selection_script, '"type":"furniture"'
    assert_includes selection_script, '"definitionId":"kitchen-base-standard"'
  end
end
