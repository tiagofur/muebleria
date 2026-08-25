# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module UserInterface
      # Resolves the metadata store for whichever model is active at call time,
      # so observers and builders stay valid when the user switches documents.
      class ActiveModelMetadataStore
        def initialize(factory)
          @factory = factory
        end

        def read(target)
          model = Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
          return nil unless model

          @factory.call(model).read(target)
        end
      end

      # Login/logout callback handlers, extracted to keep DialogController
      # within the class-length budget.
      module SessionBridge
        def handle_login(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : payload_json
          result = if @session
                     @session.login(payload['email'].to_s, payload['password'].to_s, payload['serverUrl'].to_s)
                   else
                     { 'success' => false, 'error' => 'Sesión no disponible en esta compilación.' }
                   end

          if result['success']
            @catalog_provider.reset if @catalog_provider.respond_to?(:reset)
            update_status(dialog)
            send_catalog(dialog)
          end
          execute_bridge(dialog, 'onLoginResult', result)
          @logger.info('session_login', success: result['success'])
        rescue StandardError => e
          @logger.error('session_login_failed', error: e)
          execute_bridge(dialog, 'onLoginResult', { 'success' => false, 'error' => e.message })
        end

        def handle_logout(dialog)
          @session&.logout
          @catalog_provider.reset if @catalog_provider.respond_to?(:reset)
          update_status(dialog)
          send_catalog(dialog)
          execute_bridge(dialog, 'onLoginResult', { 'success' => true, 'loggedOut' => true })
          @logger.info('session_logout')
        rescue StandardError => e
          @logger.error('session_logout_failed', error: e)
        end
      end

      # Insert/update callback handlers, extracted to keep DialogController
      # within the class-length budget. Both resolve the furniture's real
      # composition server-side before touching the model.
      module FurnitureBridge
        def handle_insert(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : payload_json
          definition = @catalog_provider.find_definition(payload['definitionId'])

          result = if definition.nil?
                     { 'success' => false, 'error' => 'Definición no encontrada' }
                   elsif active_model
                     furniture_builder_for(active_model).insert_furniture(
                       active_model, definition, payload['parameters'] || {},
                       resolved_layout: resolve_layout_for(definition, payload['parameters'],
                                                           payload['materialChoices'])
                     )
                   else
                     mock_result(definition['name'], payload['parameters'])
                   end

          execute_bridge(dialog, 'onInsertionResult', result)
          @logger.info('furniture_inserted', definition_id: payload['definitionId'],
                                             success: result['success'],
                                             components: result['component_count'])
        rescue StandardError => e
          @logger.error('furniture_insert_failed', error: e)
          execute_bridge(dialog, 'onInsertionResult', { 'success' => false, 'error' => e.message })
        end

        def handle_update(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : payload_json
          definition = @catalog_provider.find_definition(payload['definitionId'])

          result = if definition.nil?
                     { 'success' => false, 'error' => 'Definición no encontrada' }
                   elsif active_model&.selection&.first
                     furniture_builder_for(active_model).update_furniture(
                       active_model, active_model.selection.first, definition, payload['parameters'] || {},
                       resolved_layout: resolve_layout_for(definition, payload['parameters'],
                                                           payload['materialChoices'])
                     )
                   else
                     mock_result(definition['name'], payload['parameters'], payload['instanceId'])
                   end

          execute_bridge(dialog, 'onUpdateResult', result)
          @logger.info('furniture_updated', definition_id: payload['definitionId'],
                                            success: result['success'],
                                            components: result['component_count'])
        rescue StandardError => e
          @logger.error('furniture_update_failed', error: e)
          execute_bridge(dialog, 'onUpdateResult', { 'success' => false, 'error' => e.message })
        end

        # Fetches the server-resolved composition for a definition at the
        # dialog's current parameters and board choices (role → material id).
        # Granete resolves the real furniture (boards + hardware); nil falls
        # back to the generic authoring path (offline/static catalogs).
        def resolve_layout_for(definition, parameters, material_choices = nil)
          return nil unless @catalog_provider.respond_to?(:resolved_layout)

          @catalog_provider.resolved_layout(definition['furniture_definition_id'],
                                            parameters || {}, material_choices || {})
        end

        def mock_result(name, params, instance_id = 'mock-inst-01')
          { 'success' => true, 'instance_id' => instance_id, 'name' => name,
            'parameters' => params }
        end
      end

      class DialogController
        include SessionBridge
        include FurnitureBridge

        attr_reader :selection_observer

        def initialize(logger:, status_provider:, catalog_provider: nil, furniture_builder: nil,
                       metadata_store: nil, metadata_store_factory: nil, session: nil)
          @logger = logger
          @status_provider = status_provider
          @catalog_provider = catalog_provider || Library::CatalogProvider.new
          @furniture_builder = furniture_builder
          @metadata_store = metadata_store
          @metadata_store_factory = metadata_store_factory || ->(model) { Metadata::Store.new(model) }
          @builder_model = nil
          @model_builder = nil
          @session = session
          @dialog = nil

          @selection_observer = Observers::SelectionObserver.new(
            metadata_store: metadata_store || ActiveModelMetadataStore.new(@metadata_store_factory),
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

        def furniture_builder_for(model)
          return @furniture_builder if @furniture_builder

          if @model_builder.nil? || @builder_model != model
            @builder_model = model
            @model_builder = Model::FurnitureBuilder.new(
              metadata_store: @metadata_store_factory.call(model)
            )
          end
          @model_builder
        end

        def build_dialog
          dialog = ::UI::HtmlDialog.new(
            dialog_title: 'Granete for SketchUp',
            preferences_key: 'com.granete.sketchup_extension.dialog',
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
          dialog.add_action_callback('dialog_ready') { handle_dialog_ready(dialog) }
          dialog.add_action_callback('get_catalog') { send_catalog(dialog) }
          dialog.add_action_callback('insert_furniture') { |_c, p| handle_insert(dialog, p) }
          dialog.add_action_callback('update_furniture') { |_c, p| handle_update(dialog, p) }
          dialog.add_action_callback('delete_selected_furniture') { handle_delete(dialog) }
          dialog.add_action_callback('close_dialog') { dialog.close }
          dialog.add_action_callback('login') { |_c, p| handle_login(dialog, p) }
          dialog.add_action_callback('logout') { handle_logout(dialog) }
        end

        def handle_dialog_ready(dialog)
          update_status(dialog)
          send_catalog(dialog)
          check_current_selection(dialog)
          @logger.info('dialog_ready')
        end

        def update_status(dialog)
          status = @status_provider.call
          execute_bridge(dialog, 'setStatus', status)
        rescue StandardError => e
          @logger.error('dialog_status_failed', error: e)
        end

        def send_catalog(dialog)
          definitions = @catalog_provider.all_definitions
          payload = {
            'definitions' => definitions,
            'presets' => @catalog_provider.respond_to?(:all_presets) ? @catalog_provider.all_presets : [],
            'categories' => @catalog_provider.respond_to?(:all_categories) ? @catalog_provider.all_categories : [],
            'materials' => @catalog_provider.respond_to?(:all_materials) ? @catalog_provider.all_materials : [],
            'source' => @catalog_provider.respond_to?(:last_source) ? @catalog_provider.last_source : 'local',
            'licenseBlocked' => @catalog_provider.respond_to?(:last_license_blocked) &&
                                @catalog_provider.last_license_blocked
          }
          media = build_media_payload
          payload['media'] = media if media
          execute_bridge(dialog, 'setCatalog', payload)
        rescue StandardError => e
          @logger.error('dialog_catalog_failed', error: e)
        end

        # The workshop catalog references module previews with server-relative
        # paths (/api/media/...); the webview needs the origin plus the media
        # token (GET media accepts ?token=) to render them.
        def build_media_payload
          return nil unless @session.respond_to?(:configured?) && @session.configured?

          server_url = @session.respond_to?(:status) ? @session.status['server_url'].to_s : ''
          base = server_url.sub(%r{/api/?\z}, '').sub(%r{/+\z}, '')
          return nil if base.empty?

          token = @session.authorization_header.to_s.sub(/\ABearer\s+/, '')
          return nil if token.empty?

          { 'baseUrl' => base, 'token' => token }
        rescue Auth::NotConfiguredError, StandardError => e
          @logger.error('dialog_media_payload_failed', error: e)
          nil
        end

        def handle_delete(dialog)
          target = active_model&.selection&.first
          if target
            active_model.start_operation('Eliminar Mueble', true)
            active_model.active_entities.erase_entities([target])
            active_model.commit_operation
          end

          execute_bridge(dialog, 'onSelectionChange', nil)
        end

        def handle_selection_change(instance_data)
          return unless @dialog&.visible?

          execute_bridge(@dialog, 'onSelectionChange', instance_data)
        rescue StandardError => e
          @logger.error('selection_change_failed', error: e)
        end

        def check_current_selection(dialog)
          first = active_model&.selection&.first
          data = @selection_observer.inspect_entity(first)
          execute_bridge(dialog, 'onSelectionChange', data)
        end

        def attach_selection_observer
          active_model&.selection&.add_observer(@selection_observer)
        end

        def detach_selection_observer
          active_model&.selection&.remove_observer(@selection_observer)
        end

        def active_model
          defined?(Sketchup) && Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
        end

        def execute_bridge(dialog, method, payload)
          script = "window.GraneteDialog && window.GraneteDialog.#{method}(#{JSON.generate(payload)})"
          dialog.execute_script(script)
        end

        def resource_path
          directory = __dir__.dup
          directory.force_encoding('UTF-8')
          File.expand_path('../resources/dialog.html', directory)
        end
      end
    end
  end
end
