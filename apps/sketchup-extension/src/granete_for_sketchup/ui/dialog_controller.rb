# frozen_string_literal: true

require "json"
require_relative "../library/catalog_provider"
require_relative "../model/furniture_builder"

module Granete
  module SketchUpExtension
    module UserInterface
      class DialogController
        def initialize(logger:, status_provider:, catalog_provider: nil, furniture_builder: nil)
          @logger = logger
          @status_provider = status_provider
          @catalog_provider = catalog_provider || Library::CatalogProvider.new
          @furniture_builder = furniture_builder || Model::FurnitureBuilder.new
          @dialog = nil
        end

        def show
          if @dialog&.visible?
            @dialog.bring_to_front
            return @dialog
          end

          @dialog ||= build_dialog
          @dialog.show
          @dialog
        end

        def close
          @dialog&.close
        end

        def open?
          @dialog&.visible? || false
        end

        private

        def build_dialog
          dialog = ::UI::HtmlDialog.new(
            dialog_title: "Granete for SketchUp",
            preferences_key: "com.granete.sketchup_extension.dialog",
            scrollable: true,
            resizable: true,
            width: 480,
            height: 680,
            min_width: 380,
            min_height: 480,
            style: ::UI::HtmlDialog::STYLE_DIALOG
          )
          dialog.set_file(resource_path)
          bind_callbacks(dialog)
          dialog.set_on_closed { @dialog = nil if @dialog.equal?(dialog) }
          dialog
        end

        def bind_callbacks(dialog)
          dialog.add_action_callback("dialog_ready") do |_context|
            update_status(dialog)
            send_catalog(dialog)
            @logger.info("dialog_ready")
          end

          dialog.add_action_callback("get_catalog") do |_context|
            send_catalog(dialog)
          end

          dialog.add_action_callback("insert_furniture") do |_context, payload_json|
            handle_insert_furniture(dialog, payload_json)
          end

          dialog.add_action_callback("close_dialog") { |_context| dialog.close }
        end

        def update_status(dialog)
          status = @status_provider.call
          script = "window.GraneteDialog && window.GraneteDialog.setStatus(#{JSON.generate(status)})"
          dialog.execute_script(script)
        rescue StandardError => e
          @logger.error("dialog_status_failed", error: e)
        end

        def send_catalog(dialog)
          definitions = @catalog_provider.all_definitions
          script = "window.GraneteDialog && window.GraneteDialog.setCatalog(#{JSON.generate(definitions)})"
          dialog.execute_script(script)
        rescue StandardError => e
          @logger.error("dialog_catalog_failed", error: e)
        end

        def handle_insert_furniture(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : payload_json
          definition_id = payload["definitionId"]
          params = payload["parameters"] || {}

          definition = @catalog_provider.find_definition(definition_id)
          if definition.nil?
            result = { "success" => false, "error" => "Definición #{definition_id} no encontrada" }
          else
            model = defined?(Sketchup) && Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
            result = if model
                       @furniture_builder.insert_furniture(model, definition, params)
                     else
                       { "success" => true, "instance_id" => "mock-instance-01", "name" => definition["name"], "parameters" => params }
                     end
          end

          script = "window.GraneteDialog && window.GraneteDialog.onInsertionResult(#{JSON.generate(result)})"
          dialog.execute_script(script)
          @logger.info("furniture_inserted", definition_id: definition_id, success: result["success"])
        rescue StandardError => e
          @logger.error("furniture_insert_failed", error: e)
          err_result = { "success" => false, "error" => e.message }
          dialog.execute_script("window.GraneteDialog && window.GraneteDialog.onInsertionResult(#{JSON.generate(err_result)})")
        end

        def resource_path
          directory = __dir__.dup
          directory.force_encoding("UTF-8")
          File.expand_path("../resources/dialog.html", directory)
        end
      end
    end
  end
end
