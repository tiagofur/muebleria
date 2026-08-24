# frozen_string_literal: true

require "stringio"
require_relative "../test_helper"
require_relative "../../src/granete_for_sketchup/logging"
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
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new
    )
  end

  def test_dialog_ready_sends_status_and_catalog
    dialog = @controller.show
    dialog.callbacks.fetch("dialog_ready").call(nil)

    scripts = dialog.executed_scripts
    assert_equal 2, scripts.length

    # Status script
    assert_includes scripts[0], "window.GraneteDialog && window.GraneteDialog.setStatus"
    assert_includes scripts[0], "Conectado"

    # Catalog script
    assert_includes scripts[1], "window.GraneteDialog && window.GraneteDialog.setCatalog"
    assert_includes scripts[1], "kitchen-base-standard"
  end

  def test_insert_furniture_callback_invokes_builder_and_returns_result
    dialog = @controller.show
    payload = {
      "definitionId" => "kitchen-base-standard",
      "parameters" => { "widthMm" => 800, "shelfCount" => 1, "doorCount" => 1 }
    }

    dialog.callbacks.fetch("insert_furniture").call(nil, payload)

    scripts = dialog.executed_scripts
    last_script = scripts.last

    assert_includes last_script, "window.GraneteDialog && window.GraneteDialog.onInsertionResult"
    assert_includes last_script, success:true
    assert_includes last_script, "Gabinete Base Estándar"
  end
end
