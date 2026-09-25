# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module UserInterface
      # Resolves the metadata store for whichever model is active at call time,
      # so observers and builders stay valid when the user switches documents.
      class DialogController # rubocop:disable Metrics/ClassLength
        include SessionBridge
        include ModelBindingBridge
        include CommercialProjectionBridge
        include CommercialBootstrapBridge
        include ProjectFurnitureBridge
        include FurnitureBridge
        include HostMutationBridge
        include ComponentAuthoringBridge
        include OptionSelectorBridge
        include InspectorBridge
        include ObserverBridge
        include ManufacturingInspectionBridge
        include PreflightReviewBridge
        include MigrationBridge
        include HardwareMountBridge

        attr_reader :selection_observer, :entities_observer, :duplicate_resolver

        # #498: the shared coordinator is injectable (application/tests)
        # and lazily built when absent — one construction shape everywhere.
        def mutation_coordinator
          @mutation_coordinator ||= build_default_mutation_coordinator
        end

        # #810: the explicit "Sincronizar diseño" operation. Injectable for
        # tests; lazily built over the placer's shared working-copy service.
        def design_sync_synchronizer
          @design_sync_synchronizer ||= Connection::DesignSync::Synchronizer.new(
            model_provider: method(:active_model),
            binding_store_factory: ->(model) { Connection::ModelBinding::Store.new(model) },
            model_binding_service: @model_binding_connector.service,
            service: @project_furniture_placer.service,
            metadata_store_factory: @metadata_store_factory,
            logger: @logger
          )
        end

        # rubocop:disable Metrics/ParameterLists
        def initialize(logger:, status_provider:, catalog_provider: nil, furniture_builder: nil,
                       metadata_store: nil, metadata_store_factory: nil, session: nil,
                       migration_review_controller: nil, model_binding_connector: nil,
                       project_furniture_placer: nil, duplicate_resolver: nil, entities_observer: nil,
                       design_publisher: nil, mutation_coordinator: nil, manufacturing_overlay: nil,
                       publication_gate: nil, commercial_projection_service: nil,
                       host_reconciliation: nil, save_awareness: nil,
                       position_sync_coordinator: nil,
                       publication_scope_provider: nil,
                       project_bootstrap: nil, initial_quote: nil,
                       mount_frame_preparer_controller: nil,
                       design_sync_synchronizer: nil)
          # rubocop:enable Metrics/ParameterLists
          @logger = logger
          @status_provider = status_provider
          @model_binding_connector = model_binding_connector
          @project_furniture_placer = project_furniture_placer
          @duplicate_resolver = duplicate_resolver
          @entities_observer = entities_observer
          @position_sync_coordinator = position_sync_coordinator
          wire_observer_callbacks
          @design_publisher = design_publisher
          @mutation_coordinator = mutation_coordinator
          @manufacturing_overlay = manufacturing_overlay
          @publication_gate = publication_gate
          @host_reconciliation = host_reconciliation
          @publication_scope_provider = publication_scope_provider
          @design_workflow = nil
          @save_awareness = save_awareness
          @commercial_projection_service = commercial_projection_service
          @project_bootstrap = project_bootstrap
          @initial_quote = initial_quote
          @design_sync_synchronizer = design_sync_synchronizer
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
          @mount_frame_preparer_controller = mount_frame_preparer_controller

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
          # #469: closing the dialog ends any live placement-preview
          # gesture — no ghost tool keeps following the cursor afterwards.
          cancel_active_placement_preview
          # Overlay lifecycle (#470 §43): closing the dialog turns the
          # inspection mode off — no orphan markers, zero model impact.
          @manufacturing_overlay&.disable
          @option_selector&.close
          @migration_review_controller&.close
          @mount_frame_preparer_controller&.close
          @dialog&.close
        end

        def open?
          @dialog&.visible? || false
        end
        alias visible? open?

        private

        def wire_observer_callbacks
          if @entities_observer.respond_to?(:on_working_copy_committed=)
            @entities_observer.on_working_copy_committed = method(:handle_observed_working_copy_commit)
          end
          if @entities_observer.respond_to?(:on_host_inventory_changed=)
            @entities_observer.on_host_inventory_changed = method(:handle_host_inventory_change)
          end
          if @position_sync_coordinator.respond_to?(:on_sync_outcome=)
            @position_sync_coordinator.on_sync_outcome = method(:handle_observed_position_sync_outcome)
          elsif @position_sync_coordinator.respond_to?(:on_sync_complete=)
            @position_sync_coordinator.on_sync_complete = method(:handle_observed_position_sync_complete)
          end
        end

        # #498 shared coordinator: built lazily when not injected so tests
        # and the application wiring share one construction shape.
        def build_default_mutation_coordinator
          Host::AuthoringMutationCoordinator.new(
            model_provider: method(:active_model),
            logger: @logger,
            selection_restorer: Host::SelectionRestore.new(
              metadata_store_factory: @metadata_store_factory,
              model_provider: method(:active_model),
              logger: @logger
            ),
            preflight_tracker: Host::PreflightTracker.new
          )
        end

        def option_selector
          @option_selector ||= OptionSelectorController.new(logger: @logger)
        end

        def furniture_builder_for(model)
          return @furniture_builder if @furniture_builder

          if @model_builder.nil? || @builder_model != model
            @builder_model = model
            hardware_downloader = Assets::HardwareAssetDownloader.new(
              transport: @session.respond_to?(:transport) ? @session.transport : nil,
              auth_provider: @session,
              logger: @logger
            )
            asset_loader = Assets::AssetLoader.new(
              downloader: hardware_downloader,
              logger: @logger
            )
            @model_builder = Model::FurnitureBuilder.new(
              metadata_store: @metadata_store_factory.call(model),
              asset_loader: asset_loader,
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
            # #469: the dialog's own close (native X, close_dialog callback
            # or controller.close) ends any live placement-preview gesture —
            # idempotent, no recursion, no pushes to a closed dialog.
            cancel_active_placement_preview
            detach_selection_observer
            @manufacturing_overlay&.disable
            @option_selector&.close
            @migration_review_controller&.close
            @mount_frame_preparer_controller&.close
            @dialog = nil if @dialog.equal?(dialog)
          end
          dialog
        end

        def register_auth_callbacks(dialog)
          dialog.add_action_callback('enroll') { |_c, p| handle_enroll(dialog, p) }
          dialog.add_action_callback('poll_enrollment') { |_c, p| handle_poll_enrollment(dialog, p) }
          dialog.add_action_callback('logout') { handle_logout(dialog) }
          dialog.add_action_callback('open_external_url') { |_c, p| handle_open_external_url(p) }
        end

        def bind_callbacks(dialog)
          dialog.add_action_callback('dialog_ready') { handle_dialog_ready(dialog) }
          dialog.add_action_callback('get_catalog') { send_catalog(dialog) }
          dialog.add_action_callback('insert_furniture') { |_c, p| handle_insert(dialog, p) }
          dialog.add_action_callback('update_furniture') { |_c, p| handle_update(dialog, p) }
          register_authoring_callbacks(dialog)
          dialog.add_action_callback('manufacturing_inspection') { |_c, p| handle_manufacturing_inspection(dialog, p) }
          dialog.add_action_callback('preflight_review') { |_c, p| handle_preflight_review(dialog, p) }
          dialog.add_action_callback('open_material_selector') { |_c, p| handle_open_material_selector(dialog, p) }
          dialog.add_action_callback('prepare_hardware_mount') { |_c, p| handle_prepare_hardware_mount(dialog, p) }
          dialog.add_action_callback('select_furniture') { |_c, p| handle_select_furniture(dialog, p) }
          dialog.add_action_callback('delete_selected_furniture') { |_c, p| handle_delete(dialog, p) }
          dialog.add_action_callback('close_dialog') { dialog.close }
          register_auth_callbacks(dialog)
          register_model_binding_callbacks(dialog)
          register_commercial_projection_callbacks(dialog) if @commercial_projection_service
          register_commercial_bootstrap_callbacks(dialog) if @project_bootstrap && @initial_quote
          register_project_furniture_callbacks(dialog)
          # #460 SEC-3: webviews re-mint expired media grants on demand; the
          # session credential itself never crosses into the dialog.
          dialog.add_action_callback('refresh_media_url') { |_c, p| handle_refresh_media_url(dialog, p) }
          register_selection_context_menu
        end

        # Native reachability for the designer's right click (UX review
        # 2026-09): when the current selection resolves to a MANAGED
        # furniture, Granete adds its panel actions to the host context
        # menu. The items reuse the existing seams — select pushes the
        # SelectionContext (the panel opens the Inspector), delete rides
        # the same honest handle_delete with its onDeleteResult close.
        # Selection-only resolution: no geometry, no metadata write here.
        def register_selection_context_menu
          return unless defined?(::UI) && ::UI.respond_to?(:add_context_menu_handler)
          return if @selection_context_menu_registered

          @selection_context_menu_registered = true
          ::UI.add_context_menu_handler do |menu|
            dialog = @dialog
            next unless dialog&.visible?

            context = begin
              selection = (@observed_model || active_model)&.selection
              @selection_observer.resolve(selection&.first, selection: selection)
            rescue StandardError
              nil
            end
            next unless context && context.kind == 'furniture' && context.furniture_instance_ref

            menu.add_separator
            menu.add_item('Granete: editar en el panel') do
              handle_select_furniture(dialog, JSON.generate('furnitureInstanceRef' => context.furniture_instance_ref))
            end
            delete_cap = context.capabilities.to_h['canDelete']
            if delete_cap && delete_cap['supported']
              menu.add_item('Granete: eliminar mueble') do
                handle_delete(dialog, JSON.generate('instanceId' => context.furniture_instance_ref))
              end
            end
          end
        end

        # #467/#498 authoring channels: the versioned mutation bridge plus
        # the constrained viewport gesture activation.
        def register_authoring_callbacks(dialog)
          dialog.add_action_callback('authoring_mutation') { |_c, p| handle_authoring_mutation(dialog, p) }
          dialog.add_action_callback('component_viewport_move') { |_c, p| handle_component_viewport_move(dialog, p) }
        end

        def handle_dialog_ready(dialog)
          update_status(dialog)
          # The dialog footer's version comes from the EXTENSION the host
          # actually loaded (identity.rb) — never a hardcoded page string.
          execute_bridge(dialog, 'setPluginVersion',
                         { 'version' => Granete::SketchUpExtension::EXTENSION_VERSION })
          send_catalog(dialog)
          check_current_selection(dialog)
          refresh_binding_status
          refresh_project_furniture
          push_host_save_awareness(dialog)
          push_degraded_state(dialog)
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
            'hardware' => @catalog_provider.respond_to?(:all_hardware) ? @catalog_provider.all_hardware : [],
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
          payload = parse_payload(raw_payload)
          instance_id = payload['instanceId'] || payload[:instanceId]

          deleted = false
          failure_reason = nil
          target = find_target_furniture_entity(instance_id)
          if target && active_model
            deleted, failure_reason = erase_furniture_target!(target, instance_id)
          else
            failure_reason = 'el mueble no se encontró en el modelo'
            @logger.warn('furniture_delete_target_not_found', instance_id: instance_id)
          end

          # Cierre honesto del gesto (peak-end): el panel necesita saber si la
          # eliminación ocurrió para confirmar con la red de seguridad (Undo)
          # o explicar por qué no — un panel en blanco no es feedback.
          execute_bridge(dialog, 'onDeleteResult',
                         { 'ok' => deleted, 'instanceId' => instance_id, 'reason' => failure_reason })
          execute_bridge(dialog, 'onSelectionChange', nil)
          refresh_after_local_delete(dialog) if deleted
        rescue StandardError => e
          @logger.error('furniture_delete_failed', error: e)
          execute_bridge(dialog, 'onDeleteResult', { 'ok' => false, 'reason' => e.message })
          execute_bridge(dialog, 'onSelectionChange', nil)
        end

        # One undoable SketchUp operation erasing a managed furniture with
        # Granete metadata. Returns [deleted, failure_reason].
        def erase_furniture_target!(target, instance_id)
          store = @metadata_store_factory.call(active_model)
          meta = store.read(target)
          return [false, 'la entidad no tiene metadatos de Granete'] unless meta && meta['identity']

          active_model.start_operation('Eliminar Mueble', true)
          active_model.active_entities.erase_entities([target])
          active_model.commit_operation
          @logger.info('furniture_deleted', instance_id: instance_id || meta.dig('identity', 'instanceRef'))
          [true, nil]
        rescue StandardError => e
          @logger.warn('furniture_delete_rejected_no_metadata', target_class: target.class.name, error: e)
          [false, 'la entidad no tiene metadatos de Granete']
        end

        def notify_commercial_projection_local_delete(dialog)
          mark_commercial_projection_local_work
          execute_bridge(dialog, 'onCommercialProjectionLocalMutation', {})
        end

        def refresh_after_local_delete(dialog)
          notify_commercial_projection_local_delete(dialog)
          handle_get_project_furniture(dialog) if @project_furniture_placer
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
