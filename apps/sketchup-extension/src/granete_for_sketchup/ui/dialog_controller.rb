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
          model = if target.respond_to?(:model) && target.model
                    target.model
                  elsif Sketchup.respond_to?(:active_model)
                    Sketchup.active_model
                  end
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
                                                           payload['materialChoices']),
                       material_choices: payload['materialChoices']
                     )
                   else
                     mock_result(definition['name'], payload['parameters'])
                   end

          execute_bridge(dialog, 'onInsertionResult', result)
          log_operation_result('furniture_inserted', payload['definitionId'], result)
        rescue StandardError => e
          @logger.error('furniture_insert_failed', error: e)
          execute_bridge(dialog, 'onInsertionResult', { 'success' => false, 'error' => e.message })
        end

        def handle_update(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          definition_id = payload['definitionId'] || payload[:definitionId]
          definition = @catalog_provider.find_definition(definition_id)
          target_entity = find_target_furniture_entity(payload['instanceId'] || payload[:instanceId])

          result = execute_furniture_update(definition, target_entity, payload)

          execute_bridge(dialog, 'onUpdateResult', result)
          log_operation_result('furniture_updated', definition_id, result)
        rescue StandardError => e
          @logger.error('furniture_update_failed', error: e)
          execute_bridge(dialog, 'onUpdateResult', { 'success' => false, 'error' => e.message })
        end

        def execute_furniture_update(definition, target_entity, payload)
          if definition.nil?
            { 'success' => false, 'error' => 'Definición no encontrada' }
          elsif target_entity
            params = payload['parameters'] || payload[:parameters] || {}
            choices = payload['materialChoices'] || payload[:materialChoices]
            layout = resolve_layout_for(definition, params, choices)
            furniture_builder_for(active_model).update_furniture(
              active_model, target_entity, definition, params,
              resolved_layout: layout, material_choices: choices
            )
          elsif active_model.nil?
            mock_result(definition['name'], payload['parameters'], payload['instanceId'])
          else
            { 'success' => false, 'error' => 'Instancia no encontrada en el modelo' }
          end
        end

        def find_target_furniture_entity(instance_id)
          return nil unless active_model

          first = active_model.selection&.first
          if instance_id
            if first
              meta = @metadata_store_factory.call(active_model).read(first)
              return first if meta&.dig('identity', 'instanceRef') == instance_id
            end
            return search_entities_for_instance(instance_id)
          end

          first
        end

        def search_entities_for_instance(instance_id)
          return nil unless instance_id && active_model.respond_to?(:entities)

          store = @metadata_store_factory.call(active_model)
          active_model.entities.find do |entity|
            meta = store.read(entity)
            meta&.dig('identity', 'instanceRef') == instance_id
          end
        end

        def log_operation_result(event, definition_id, result)
          ctx = {
            definition_id: definition_id,
            success: result['success'],
            components: result['component_count']
          }
          ctx[:error] = result['error'] unless result['success']
          @logger.info(event, ctx)
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

      # Material finish picker bridge for opening the dedicated floating dialog.
      module OptionSelectorBridge
        def handle_open_material_selector(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          params = extract_selector_params(payload)

          option_selector.show_selector(
            role: params[:role],
            role_name: params[:role_name],
            current_material_id: params[:current_material_id],
            allowed_materials: selector_allowed_materials(params),
            categories: selector_categories,
            media: build_media_payload,
            on_apply: lambda do |selected_role, selected_material_id, scope|
              execute_bridge(dialog, 'onMaterialChoiceApplied', {
                               'role' => selected_role,
                               'materialId' => selected_material_id,
                               'scope' => scope,
                               'context' => params[:context],
                               'instanceId' => params[:instance_id],
                               'definitionId' => params[:definition_id]
                             })
            end
          )
        rescue StandardError => e
          @logger&.error('open_material_selector_failed', error: e)
        end

        private

        def extract_selector_params(payload)
          mat_id = payload['currentMaterialId'] || payload[:currentMaterialId] ||
                   payload['current_material_id'] || payload[:current_material_id]
          allowed_ids = payload['allowedMaterialIds'] || payload[:allowedMaterialIds] ||
                        payload['optionIds'] || payload[:optionIds]
          {
            role: payload['role'] || payload[:role],
            role_name: payload['roleName'] || payload[:roleName] || payload['role_name'] || payload[:role_name],
            current_material_id: mat_id,
            context: payload['context'] || payload[:context],
            instance_id: payload['instanceId'] || payload[:instanceId],
            definition_id: payload['definitionId'] || payload[:definitionId],
            allowed_material_ids: allowed_ids
          }
        end

        def selector_allowed_materials(params)
          all = @catalog_provider.respond_to?(:all_materials) ? @catalog_provider.all_materials : []
          filter_ids = resolve_allowed_material_ids(params)
          return all if filter_ids.nil? || filter_ids.empty?

          all.select do |mat|
            mat_id = mat['materialId'] || mat[:materialId] || mat['id'] || mat[:id]
            filter_ids.include?(mat_id)
          end
        end

        def resolve_allowed_material_ids(params)
          if params[:allowed_material_ids].is_a?(Array) && !params[:allowed_material_ids].empty?
            return params[:allowed_material_ids]
          end

          return nil unless params[:definition_id] && params[:role] && @catalog_provider.respond_to?(:find_definition)

          definition = @catalog_provider.find_definition(params[:definition_id])
          return nil unless definition

          roles = definition['materialRoles'] || definition[:materialRoles] || []
          role_entry = roles.find { |r| (r['role'] || r[:role]) == params[:role] }
          role_entry ? (role_entry['optionIds'] || role_entry[:optionIds]) : nil
        end

        def selector_categories
          @catalog_provider.respond_to?(:all_material_categories) ? @catalog_provider.all_material_categories : []
        end
      end

      # Observes SketchUp application events (new, open, activate model) to re-bind
      # selection observers when the user switches documents.
      class AppModelObserver < (defined?(::Sketchup::AppObserver) ? ::Sketchup::AppObserver : Object)
        def initialize(on_model_change:)
          super() if defined?(::Sketchup::AppObserver)
          @on_model_change = on_model_change
        end

        def onNewModel(model)
          @on_model_change.call(model)
        end

        def onOpenModel(model)
          @on_model_change.call(model)
        end

        def onActivateModel(model)
          @on_model_change.call(model)
        end
      end

      # Selection and model lifecycle observer bridge for keeping the dialog in sync with SketchUp.
      module ObserverBridge
        def handle_selection_change(instance_data)
          return unless @dialog&.visible?

          execute_bridge(@dialog, 'onSelectionChange', instance_data)
        rescue StandardError => e
          @logger.error('selection_change_failed', error: e)
        end

        def check_current_selection(dialog)
          first = (@observed_model || active_model)&.selection&.first
          data = @selection_observer.inspect_entity(first)
          execute_bridge(dialog, 'onSelectionChange', data)
        end

        def attach_selection_observer
          @observed_model = active_model
          @observed_model&.selection&.add_observer(@selection_observer)
          attach_app_observer
        end

        def detach_selection_observer
          @observed_model&.selection&.remove_observer(@selection_observer)
          @observed_model = nil
          detach_app_observer
        end

        def rebind_model(new_model)
          return if @observed_model.equal?(new_model)

          @observed_model&.selection&.remove_observer(@selection_observer)
          @observed_model = new_model
          @observed_model&.selection&.add_observer(@selection_observer)
          @builder_model = nil
          check_current_selection(@dialog) if @dialog&.visible?
        end

        def attach_app_observer
          return unless defined?(::Sketchup) && ::Sketchup.respond_to?(:add_observer)
          return if @app_observer

          @app_observer = AppModelObserver.new(on_model_change: method(:rebind_model))
          ::Sketchup.add_observer(@app_observer)
        end

        def detach_app_observer
          return unless defined?(::Sketchup) && ::Sketchup.respond_to?(:remove_observer) && @app_observer

          ::Sketchup.remove_observer(@app_observer)
          @app_observer = nil
        end
      end

      class DialogController
        include SessionBridge
        include FurnitureBridge
        include OptionSelectorBridge
        include ObserverBridge

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
          @observed_model = nil
          @app_observer = nil

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
          @option_selector&.close
          @dialog&.close
        end

        def open?
          @dialog&.visible? || false
        end

        private

        def option_selector
          @option_selector ||= OptionSelectorController.new(logger: @logger)
        end

        def texture_cache
          return @texture_cache if @texture_cache

          transport = @session&.transport
          auth_provider = @session
          @texture_cache = Assets::TextureCache.new(
            transport: transport,
            auth_provider: auth_provider
          )
        end

        def furniture_builder_for(model)
          return @furniture_builder if @furniture_builder

          if @model_builder.nil? || @builder_model != model
            @builder_model = model
            @model_builder = Model::FurnitureBuilder.new(
              metadata_store: @metadata_store_factory.call(model),
              asset_loader: Assets::AssetLoader.new,
              texture_cache: texture_cache
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
            @option_selector&.close
            @dialog = nil if @dialog.equal?(dialog)
          end
          dialog
        end

        def bind_callbacks(dialog)
          dialog.add_action_callback('dialog_ready') { handle_dialog_ready(dialog) }
          dialog.add_action_callback('get_catalog') { send_catalog(dialog) }
          dialog.add_action_callback('insert_furniture') { |_c, p| handle_insert(dialog, p) }
          dialog.add_action_callback('update_furniture') { |_c, p| handle_update(dialog, p) }
          dialog.add_action_callback('open_material_selector') { |_c, p| handle_open_material_selector(dialog, p) }
          dialog.add_action_callback('delete_selected_furniture') { |_c, p| handle_delete(dialog, p) }
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
          material_categories = if @catalog_provider.respond_to?(:all_material_categories)
                                  @catalog_provider.all_material_categories
                                else
                                  []
                                end
          payload = {
            'definitions' => definitions,
            'presets' => @catalog_provider.respond_to?(:all_presets) ? @catalog_provider.all_presets : [],
            'categories' => @catalog_provider.respond_to?(:all_categories) ? @catalog_provider.all_categories : [],
            'materialCategories' => material_categories,
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

        def handle_delete(dialog, raw_payload = nil)
          payload = if raw_payload.is_a?(String) && !raw_payload.strip.empty?
                      JSON.parse(raw_payload)
                    else
                      raw_payload || {}
                    end
          instance_id = payload['instanceId'] || payload[:instanceId]

          target = find_target_furniture_entity(instance_id)
          if target && active_model
            store = @metadata_store_factory.call(active_model)
            meta = store.read(target)
            if meta && meta['identity']
              active_model.start_operation('Eliminar Mueble', true)
              active_model.active_entities.erase_entities([target])
              active_model.commit_operation
              @logger.info('furniture_deleted', instance_id: instance_id || meta.dig('identity', 'instanceRef'))
            else
              @logger.warn('furniture_delete_rejected_no_metadata', target_class: target.class.name)
            end
          else
            @logger.warn('furniture_delete_target_not_found', instance_id: instance_id)
          end

          execute_bridge(dialog, 'onSelectionChange', nil)
        rescue StandardError => e
          @logger.error('furniture_delete_failed', error: e)
          execute_bridge(dialog, 'onSelectionChange', nil)
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
