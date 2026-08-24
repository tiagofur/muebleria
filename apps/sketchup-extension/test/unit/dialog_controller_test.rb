# frozen_string_literal: true

require "stringio"
require_relative "../test_helper"
require_relative "../../src/granete_for_sketchup/logging"
require_relative "../../src/granete_for_sketchup/metadata/store"
require_relative "../../src/granete_for_sketchup/ui/dialog_controller"

class DialogControllerTest < Minitest::Test
  class StatusProvider
    def call
      { heading: "Conectado", message: "Listo", state: "configured" }
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
    dialog.callbacks.fetch("dialog_ready").call(nil)

    scripts = dialog.executed_scripts
    assert scripts.length >= 2

    assert_includes scripts[0], "window.GraneteDialog && window.GraneteDialog.setStatus"
    assert_includes scripts[1], "window.GraneteDialog && window.GraneteDialog.setCatalog"
  end

  def test_insert_furniture_callback_invokes_builder_and_returns_result
    dialog = @controller.show
    payload = {
      "definitionId" => "kitchen-base-standard",
      "parameters" => { "widthMm" => 800, "shelfCount" => 1, "doorCount" => 1 }
    }

    dialog.callbacks.fetch("insert_furniture").call(nil, payload)

    scripts = dialog.executed_scripts
    insert_script = scripts.find { |s| s.include?("onInsertionResult") }

    refute_nil insert_script
    assert_includes insert_script, '"success":true'
    assert_includes insert_script, "Gabinete Base Estándar"
  end

  def test_update_furniture_callback_updates_instance
    dialog = @controller.show
    payload = {
      "instanceId" => "inst-01",
      "definitionId" => "kitchen-base-standard",
      "parameters" => { "widthMm" => 900, "shelfCount" => 2 }
    }

    dialog.callbacks.fetch("update_furniture").call(nil, payload)

    scripts = dialog.executed_scripts
    update_script = scripts.find { |s| s.include?("onUpdateResult") }

    refute_nil update_script
    assert_includes update_script, '"success":true'
  end
end
