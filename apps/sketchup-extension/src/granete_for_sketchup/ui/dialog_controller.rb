# frozen_string_literal: true

require "json"
require_relative "../library/catalog_provider"
require_relative "../model/furniture_builder"
require_relative "../observers/selection_observer"

module Granete
  module SketchUpExtension
    module UserInterface
      class DialogController
        attr_reader :selection_observer

        def initialize(logger:, status_provider:, catalog_provider: nil, furniture_builder: nil, metadata_store: nil)
          @logger = logger
          @status_provider = status_provider
          @catalog_provider = catalog_provider || Library::CatalogProvider.new
          @furniture_builder = furniture_builder || Model::FurnitureBuilder.new
          @metadata_store = metadata_store
          @dialog = nil

          @selection_observer = Observers::SelectionObserver.new(
            metadata_store: @metadata_store,
            catalog_provider: @catalog_provider,
            on_selection_change: method(:handle_selection_change)
          )
        end

        def show
          if @dialog&.visible?
            @dialog.bring_to_front
            return @dialog
          end

          @dialog ||= build_dialog
          @dialog.show
          attach_selection_observer
          @dialog
        end

        def close
          detach_selection_observer
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
            height: 720,
            min_width: 380,
            min_height: 480,
            style: ::UI::HtmlDialog::STYLE_DIALOG
          )
          dialog.set_file(resource_path)
          bind_callbacks(dialog)
          dialog.set_on_closed do
            detach_selection_observer
            @dialog = nil if @dialog.equal?(dialog)
          end
          dialog
        end

        def bind_callbacks(dialog)
          dialog.add_action_callback("dialog_ready") do |_context|
            update_status(dialog)
            send_catalog(dialog)
            check_current_selection(dialog)
            @logger.info("dialog_ready")
          end

          dialog.add_action_callback("get_catalog") do |_context|
            send_catalog(dialog)
          end

          dialog.add_action_callback("insert_furniture") do |_context, payload_json|
            handle_insert_furniture(dialog, payload_json)
          end

          dialog.add_action_callback("update_furniture") do |_context, payload_json|
            handle_update_furniture(dialog, payload_json)
          end

          dialog.add_action_callback("delete_selected_furniture") do |_context|
            handle_delete_selected(dialog)
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

        def handle_update_furniture(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : payload_json
          definition_id = payload["definitionId"]
          params = payload["parameters"] || {}

          definition = @catalog_provider.find_definition(definition_id)
          if definition.nil?
            result = { "success" => false, "error" => "Definición #{definition_id} no encontrada" }
          else
            model = defined?(Sketchup) && Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
            selected_entity = model&.selection&.first

            result = if model && selected_entity
                       @furniture_builder.update_furniture(model, selected_entity, definition, params)
                     else
                       { "success" => true, "instance_id" => payload["instanceId"], "name" => definition["name"], "parameters" => params }
                     end
          end

          script = "window.GraneteDialog && window.GraneteDialog.onUpdateResult(#{JSON.generate(result)})"
          dialog.execute_script(script)
          @logger.info("furniture_updated", definition_id: definition_id, success: result["success"])
        rescue StandardError => e
          @logger.error("furniture_update_failed", error: e)
          err_result = { "success" => false, "error" => e.message }
          dialog.execute_script("window.GraneteDialog && window.GraneteDialog.onUpdateResult(#{JSON.generate(err_result)})")
        end

        def handle_delete_selected(dialog)
          model = defined?(Sketchup) && Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
          selected_entity = model&.selection&.first

          if model && selected_entity
            model.start_operation("Eliminar Mueble", true)
            model.active_entities.erase_entities(selected_entity)
            model.commit_operation
          end

          script = "window.GraneteDialog && window.GraneteDialog.onSelectionChange(null)"
          dialog.execute_script(script)
        end

        def handle_selection_change(instance_data)
          return unless @dialog&.visible?

          script = "window.GraneteDialog && window.GraneteDialog.onSelectionChange(#{JSON.generate(instance_data)})"
          @dialog.execute_script(script)
        rescue StandardError => e
          @logger.error("selection_change_failed", error: e)
        end

        def check_current_selection(dialog)
          model = defined?(Sketchup) && Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
          first = model&.selection&.first
          data = @selection_observer.inspect_entity(first)
          script = "window.GraneteDialog && window.GraneteDialog.onSelectionChange(#{JSON.generate(data)})"
          dialog.execute_script(script)
        end

        def attach_selection_observer
          model = defined?(Sketchup) && Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
          model&.selection&.add_observer(@selection_observer) if model&.selection&.respond_to?(:add_observer)
        end

        def detach_selection_observer
          model = defined?(Sketchup) && Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
          model&.selection&.remove_observer(@selection_observer) if model&.selection&.respond_to?(:remove_observer)
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
