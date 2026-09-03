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
        def handle_enroll(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : payload_json
          server_url = payload['serverUrl'].to_s
          display_name = payload['displayName'].to_s
          display_name = 'SketchUp' if display_name.empty?

          result = if @session.respond_to?(:enroll)
                     @session.enroll(server_url, display_name)
                   else
                     { 'success' => false, 'error' => 'Enroll no soportado.' }
                   end

          execute_bridge(dialog, 'onEnrollResult', result)
          @logger.info('session_enroll', success: result['success'])
        rescue StandardError => e
          @logger.error('session_enroll_failed', error: e)
          execute_bridge(dialog, 'onEnrollResult', { 'success' => false, 'error' => e.message })
        end

        def handle_poll_enrollment(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : payload_json
          enrollment_id = payload['enrollmentId'].to_s

          result = if @session.respond_to?(:poll_enrollment)
                     @session.poll_enrollment(enrollment_id)
                   else
                     { 'success' => false, 'error' => 'Poll no soportado.' }
                   end

          if result['success'] && result['status'] == 'approved'
            exchange_res = @session.exchange_enrollment(enrollment_id)
            if exchange_res['success']
              @catalog_provider.reset if @catalog_provider.respond_to?(:reset)
              update_status(dialog)
              send_catalog(dialog)
              execute_bridge(dialog, 'onLoginResult', { 'success' => true })
            else
              execute_bridge(dialog, 'onPollResult', exchange_res)
            end
          else
            execute_bridge(dialog, 'onPollResult', result)
          end
        rescue StandardError => e
          @logger.error('session_poll_failed', error: e)
          execute_bridge(dialog, 'onPollResult', { 'success' => false, 'error' => e.message })
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

      # #388 / DT-4 model binding callback handlers: the dialog never touches
      # business identity directly — every action goes through the connector,
      # which validates against the backend before any metadata write.
      module ModelBindingBridge
        # Registers the binding action callbacks. Kept in the bridge so the
        # controller class body stays within its length budget and every
        # binding concern lives in one place.
        def register_model_binding_callbacks(dialog)
          # #388 / DT-4: model ↔ Project/Design binding surface. The dialog
          # only ever sees connector results — never raw business identity.
          dialog.add_action_callback('get_model_binding') { handle_get_model_binding(dialog) }
          dialog.add_action_callback('list_binding_projects') { handle_list_binding_projects(dialog) }
          dialog.add_action_callback('list_binding_designs') { |_c, p| handle_list_binding_designs(dialog, p) }
          dialog.add_action_callback('connect_model') { |_c, p| handle_connect_model(dialog, p) }
          dialog.add_action_callback('refresh_model_binding') { handle_refresh_model_binding(dialog) }
          dialog.add_action_callback('adopt_binding_base') { handle_adopt_binding_base(dialog) }
        end

        def handle_get_model_binding(dialog)
          execute_bridge(dialog, 'onModelBindingStatus', model_binding_connector.status)
        rescue StandardError => e
          @logger.error('model_binding_status_failed', error: e)
          execute_bridge(dialog, 'onModelBindingStatus', { 'state' => 'invalid', 'reason' => e.message })
        end

        # Pushes the current binding status when a visible dialog exists —
        # used at dialog ready and on active-document switches (#388: the
        # binding follows whichever model is open).
        def refresh_binding_status
          handle_get_model_binding(@dialog) if @dialog&.visible?
        end

        def handle_list_binding_projects(dialog)
          result = model_binding_service_list(:list_projects)
          execute_bridge(dialog, 'onBindingProjects', result)
        end

        def handle_list_binding_designs(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = model_binding_service_list(:list_designs, payload['projectId'])
          execute_bridge(dialog, 'onBindingDesigns', result)
        rescue StandardError => e
          @logger.error('model_binding_list_failed', error: e)
          execute_bridge(dialog, 'onBindingDesigns', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Connect/rebind the active model. confirmRebind rides the explicit
        # reviewed switch flow: without it, a different target answers
        # rebind_required and NOTHING is written.
        def handle_connect_model(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = model_binding_connector.bind(
            project_id: payload['projectId'].to_s,
            design_id: payload['designId'].to_s,
            confirm_rebind: payload['confirmRebind'] == true
          )
          execute_bridge(dialog, 'onModelBindingResult', result)
        rescue StandardError => e
          @logger.error('model_binding_connect_failed', error: e)
          execute_bridge(dialog, 'onModelBindingResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Revalidate the stored binding (drift/archived/valid refresh).
        def handle_refresh_model_binding(dialog)
          execute_bridge(dialog, 'onModelBindingStatus', model_binding_connector.status)
        rescue StandardError => e
          @logger.error('model_binding_refresh_failed', error: e)
          execute_bridge(dialog, 'onModelBindingStatus', { 'state' => 'unreachable', 'reason' => e.message })
        end

        # Explicit base-drift remediation: adopt the authoritative working base.
        def handle_adopt_binding_base(dialog)
          execute_bridge(dialog, 'onModelBindingResult', model_binding_connector.adopt_authoritative_base)
        rescue StandardError => e
          @logger.error('model_binding_adopt_failed', error: e)
          execute_bridge(dialog, 'onModelBindingResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        private

        def model_binding_service_list(method, argument = nil)
          entries = if argument
                      model_binding_service.public_send(method,
                                                        argument)
                    else
                      model_binding_service.public_send(method)
                    end
          { 'ok' => true, 'entries' => entries }
        rescue Connection::ModelBinding::Service::Error => e
          { 'ok' => false, 'code' => e.kind.to_s, 'reason' => e.message }
        end

        def model_binding_connector
          @model_binding_connector
        end

        def model_binding_service
          @model_binding_connector&.service
        end
      end

      # Insert/update callback handlers, extracted to keep DialogController
      # within the class-length budget. Both resolve the furniture's real
      # composition server-side before touching the model.
      module FurnitureBridge # rubocop:disable Metrics/ModuleLength
        # Shared texture cache for furniture builders: lives in the bridge so
        # the controller class stays within its length budget (file pattern).
        def texture_cache
          return @texture_cache if @texture_cache

          transport = @session&.transport
          auth_provider = @session
          @texture_cache = Assets::TextureCache.new(
            transport: transport,
            auth_provider: auth_provider
          )
        end

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
          payload = e.respond_to?(:issues) ? authoring_error_payload(e) : { 'success' => false, 'error' => e.message }
          execute_bridge(dialog, 'onInsertionResult', payload)
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
          payload = e.respond_to?(:issues) ? authoring_error_payload(e) : { 'success' => false, 'error' => e.message }
          execute_bridge(dialog, 'onUpdateResult', payload)
        end

        def execute_furniture_update(definition, target_entity, payload)
          if definition.nil?
            { 'success' => false, 'error' => 'Definición no encontrada' }
          elsif target_entity
            params = payload['parameters'] || payload[:parameters] || {}
            choices = merged_material_choices(target_entity, payload)
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

        # A selector changes one role, while the server must resolve the whole
        # furniture with the complete accepted authoring intent. Preserve every
        # persisted role that was not included in this edit; never make an omitted
        # role silently fall back to nominal geometry.
        def merged_material_choices(target_entity, payload)
          store = @metadata_store_factory.call(active_model)
          persisted = store.read(target_entity)&.dig('intent', 'materialChoices') || {}
          requested = payload['materialChoices'] || payload[:materialChoices] || {}
          unless persisted.is_a?(Hash) && requested.is_a?(Hash)
            raise ArgumentError, 'materialChoices debe ser un objeto role → materialId'
          end

          persisted.merge(requested)
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
        # dialog's current parameters and board choices (role → material id),
        # parsed through the authoritative #414 transform contract. Granete
        # resolves the real furniture (boards + hardware); nil falls back to
        # the generic authoring path (offline/static catalogs). A server body
        # the contract parser rejects fails loudly — never a local AABB guess.
        def resolve_layout_for(definition, parameters, material_choices = nil)
          return nil unless @catalog_provider.respond_to?(:resolved_native_layout)

          @catalog_provider.resolved_native_layout(definition['furniture_definition_id'],
                                                   parameters || {}, material_choices || {})
        end

        def mock_result(name, params, instance_id = 'mock-inst-01')
          { 'success' => true, 'instance_id' => instance_id, 'name' => name,
            'parameters' => params }
        end

        def authoring_error_payload(error)
          issues = error.issues.map do |issue|
            {
              'code' => issue.code,
              'message' => issue.message,
              'severity' => issue.severity,
              'path' => issue.path,
              'details' => issue.details
            }.compact
          end
          { 'success' => false, 'error' => error.message, 'issues' => issues }
        end
      end # rubocop:enable Metrics/ModuleLength

      # Material finish picker bridge for opening the dedicated floating dialog.
      module OptionSelectorBridge
        def handle_open_material_selector(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          params = extract_selector_params(payload)
          allowed_materials = selector_allowed_materials(params)
          categories = selector_categories

          option_selector.show_selector(
            role: params[:role],
            role_name: params[:role_name],
            current_material_id: params[:current_material_id],
            allowed_materials: allowed_materials,
            categories: categories,
            media: media_authorizer.media_payload_for(
              'materials' => allowed_materials, 'categories' => categories
            ),
            media_refresher: ->(filename) { media_authorizer.refresh_url(filename) },
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

      # Contextual-inspector callback handlers (#476): breadcrumb navigation
      # back to the owning furniture. View state only.
      module InspectorBridge
        FURNITURE_KINDS = %w[furnitureInstance bootstrapIntent].freeze

        def handle_select_furniture(raw_payload = nil)
          payload = parse_payload(raw_payload)
          # The breadcrumb locates the host by its LOCAL ref — never by the
          # future server business ID (#384), which nothing owns yet.
          instance_ref = payload['furnitureInstanceRef'] || payload['instanceId']
          model = active_model
          target = instance_ref && search_entities_for_instance(instance_ref)

          if model && target && furniture_metadata?(model, target)
            select_entity(model, target)
            @logger.info('inspector_select_furniture', instance_ref: instance_ref)
          else
            @logger.warn('inspector_select_furniture_rejected',
                         instance_ref: instance_ref)
          end
        rescue StandardError => e
          @logger.error('inspector_select_furniture_failed', error: e)
        end

        private

        def parse_payload(raw_payload)
          if raw_payload.is_a?(String) && !raw_payload.strip.empty?
            JSON.parse(raw_payload)
          else
            raw_payload || {}
          end
        end

        # Only a furniture occurrence may be selected as furniture: a part or
        # hardware id must never retarget the breadcrumb as its own owner.
        def furniture_metadata?(model, target)
          store = @metadata_store_factory.call(model)
          metadata = store.read(target)
          FURNITURE_KINDS.include?(metadata && metadata['kind'])
        rescue Metadata::InvalidMetadataError
          false
        end

        # Selecting is viewport view state: no SketchUp operation, no
        # metadata mutation — the selection observer then publishes the
        # furniture SelectionContext.
        def select_entity(model, target)
          selection = model.selection
          selection.clear
          selection.add(target)
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
        def handle_selection_change(context)
          return unless @dialog&.visible?

          payload = context.respond_to?(:to_payload) ? context.to_payload : context
          execute_bridge(@dialog, 'onSelectionChange', payload)
        rescue StandardError => e
          @logger.error('selection_change_failed', error: e)
        end

        def check_current_selection(dialog)
          selection = (@observed_model || active_model)&.selection
          context = @selection_observer.resolve(selection&.first, selection: selection)
          execute_bridge(dialog, 'onSelectionChange', context && context.to_payload)
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
          refresh_binding_status
          offer_migration_if_legacy(new_model)
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

      # Migration review wiring (#416): bridges the scanner/migrator with
      # the review HtmlDialog. Included by DialogController so the migration
      # flow reuses the same catalog provider, metadata store factory and
      # furniture builder as insertion/edition — never a parallel resolution
      # path.
      module MigrationBridge
        # Menu entry (Granete → Migrar modelos anteriores): always opens the
        # review so the user sees the current classification — even a clean
        # "0 detectados" is honest feedback, not an error.
        def handle_migration_review
          model = active_model
          return unless model

          scan = scan_legacy_model(model)
          show_migration_review(model, scan)
        end

        private

        # Non-blocking offer on model open/activate (#416): the dialog only
        # appears when the scan actually finds legacy furniture. After a
        # successful migration no Groups remain, so save/reopen stays quiet
        # without extra model-level state.
        def offer_migration_if_legacy(model)
          return unless model.respond_to?(:entities)

          scan = scan_legacy_model(model)
          return unless scan.any_legacy?
          return if migration_review_controller.open?

          show_migration_review(model, scan)
        rescue StandardError => e
          @logger.error('migration_offer_failed', error: e)
        end

        def show_migration_review(model, scan)
          migration_review_controller.show_review(
            scan_result: scan,
            on_migrate: -> { run_legacy_migration(model) }
          )
        end

        def migration_review_controller
          @migration_review_controller ||= MigrationReviewController.new(logger: @logger)
        end

        def scan_legacy_model(model)
          Migration::Scanner.new(metadata_store: @metadata_store_factory.call(model)).scan(model)
        end

        # Fresh scan inside the callback: the review snapshot shown to the
        # user may be outdated by the time they press the button.
        def run_legacy_migration(model)
          scan = scan_legacy_model(model)
          Migration::Migrator.new(
            metadata_store: @metadata_store_factory.call(model),
            furniture_builder: furniture_builder_for(model),
            catalog_provider: @catalog_provider
          ).migrate(model, scan)
        end
      end

      class DialogController
        include SessionBridge
        include ModelBindingBridge
        include FurnitureBridge
        include OptionSelectorBridge
        include InspectorBridge
        include ObserverBridge
        include MigrationBridge

        attr_reader :selection_observer

        def initialize(logger:, status_provider:, catalog_provider: nil, furniture_builder: nil,
                       metadata_store: nil, metadata_store_factory: nil, session: nil,
                       migration_review_controller: nil, model_binding_connector: nil)
          @logger = logger
          @status_provider = status_provider
          @model_binding_connector = model_binding_connector
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
          # #416: injectable for tests; production builds it lazily.
          @migration_review_controller = migration_review_controller

          @selection_observer = Observers::SelectionObserver.new(
            metadata_store: metadata_store || ActiveModelMetadataStore.new(@metadata_store_factory),
            catalog_provider: @catalog_provider,
            on_selection_change: method(:handle_selection_change),
            model_provider: method(:active_model)
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
          @migration_review_controller&.close
          @dialog&.close
        end

        def open?
          @dialog&.visible? || false
        end

        private

        def option_selector
          @option_selector ||= OptionSelectorController.new(logger: @logger)
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
            @migration_review_controller&.close
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
          dialog.add_action_callback('select_furniture') { |_c, p| handle_select_furniture(p) }
          dialog.add_action_callback('delete_selected_furniture') { |_c, p| handle_delete(dialog, p) }
          dialog.add_action_callback('close_dialog') { dialog.close }
          dialog.add_action_callback('enroll') { |_c, p| handle_enroll(dialog, p) }
          dialog.add_action_callback('poll_enrollment') { |_c, p| handle_poll_enrollment(dialog, p) }
          dialog.add_action_callback('logout') { handle_logout(dialog) }
          register_model_binding_callbacks(dialog)
          # #460 SEC-3: webviews re-mint expired media grants on demand; the
          # session credential itself never crosses into the dialog.
          dialog.add_action_callback('refresh_media_url') { |_c, p| handle_refresh_media_url(dialog, p) }
        end

        def handle_dialog_ready(dialog)
          update_status(dialog)
          send_catalog(dialog)
          check_current_selection(dialog)
          refresh_binding_status
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
          media = media_authorizer.media_payload_for(payload)
          payload['media'] = media if media
          execute_bridge(dialog, 'setCatalog', payload)
        rescue StandardError => e
          @logger.error('dialog_catalog_failed', error: e)
        end

        # The workshop catalog references module previews with server-relative
        # paths (/api/media/...). #460 SEC-3: the webview receives per-file
        # SHORT-LIVED signed URLs minted here — never the extension session
        # credential, and never a `?token=` query authentication.
        def media_authorizer
          @media_authorizer ||= Assets::MediaAuthorizer.new(
            transport: @session.respond_to?(:transport) ? @session.transport : nil,
            auth_provider: @session,
            logger: @logger
          )
        end

        def handle_refresh_media_url(dialog, filename)
          refresh = media_authorizer.refresh_url(filename)
          return if refresh.nil?

          execute_bridge(dialog, 'updateMediaUrl', refresh)
        rescue StandardError => e
          @logger.error('dialog_media_refresh_failed', error: e)
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
