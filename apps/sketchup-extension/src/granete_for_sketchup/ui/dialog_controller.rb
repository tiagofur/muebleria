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

        def handle_open_external_url(payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          raw_url = payload['url'].to_s.strip
          return if raw_url.empty?

          uri = URI.parse(raw_url)
          if uri.is_a?(URI::HTTP) || uri.is_a?(URI::HTTPS)
            UI.openURL(uri.to_s) if defined?(UI) && UI.respond_to?(:openURL)
            @logger.info('open_external_url', url: uri.to_s)
          else
            @logger.warn('open_external_url_rejected', scheme: uri.scheme)
          end
        rescue StandardError => e
          @logger.warn('open_external_url_failed', error: e.message)
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
          # #499 Slice 3: one-time pairing code receive — the normal
          # Web→SketchUp handoff path. Converges into the same #388 binding.
          dialog.add_action_callback('connect_with_code') { |_c, p| handle_connect_with_code(dialog, p) }
          dialog.add_action_callback('refresh_model_binding') { handle_refresh_model_binding(dialog) }
          dialog.add_action_callback('adopt_binding_base') { handle_adopt_binding_base(dialog) }
        end

        def handle_get_model_binding(dialog)
          execute_bridge(dialog, 'onModelBindingStatus', model_binding_connector.status)
          # A binding change changes the #392 publication scope: refresh the
          # design-wide publish gate projection with it (#466).
          push_preflight_state(dialog)
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
          refresh_after_binding_mutation(dialog, result)
        rescue StandardError => e
          @logger.error('model_binding_connect_failed', error: e)
          execute_bridge(dialog, 'onModelBindingResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #499 Slice 3: consume a one-time pairing code. The connector is
        # the only binding writer; the raw code never reaches the model.
        def handle_connect_with_code(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = model_binding_connector.connect_with_code(payload['code'].to_s)
          execute_bridge(dialog, 'onModelBindingResult', result)
          push_preflight_state(dialog)
          refresh_after_binding_mutation(dialog, result)
        rescue StandardError => e
          @logger.error('pairing_connect_failed', error: e)
          execute_bridge(dialog, 'onModelBindingResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Revalidate the stored binding (drift/archived/valid refresh).
        def handle_refresh_model_binding(dialog)
          execute_bridge(dialog, 'onModelBindingStatus', model_binding_connector.status)
          handle_get_project_furniture(dialog) if @project_furniture_placer
          push_host_save_awareness(dialog)
        rescue StandardError => e
          @logger.error('model_binding_refresh_failed', error: e)
          execute_bridge(dialog, 'onModelBindingStatus', { 'state' => 'unreachable', 'reason' => e.message })
        end

        # Explicit base-drift remediation: adopt the authoritative working base.
        def handle_adopt_binding_base(dialog)
          result = model_binding_connector.adopt_authoritative_base
          execute_bridge(dialog, 'onModelBindingResult', result)
          refresh_after_binding_mutation(dialog, result)
        rescue StandardError => e
          @logger.error('model_binding_adopt_failed', error: e)
          execute_bridge(dialog, 'onModelBindingResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        private

        def refresh_after_binding_mutation(dialog, result)
          return unless result['ok']

          handle_get_model_binding(dialog)
          handle_get_project_furniture(dialog) if @project_furniture_placer
          push_host_save_awareness(dialog)
        end

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

      # #642 -> #677: credential-safe projection bridge. The HtmlDialog sends
      # only correlation metadata; Ruby resolves Project/Design exclusively
      # from the canonical binding before calling the backend.
      module CommercialProjectionBridge
        def register_commercial_projection_callbacks(dialog)
          dialog.add_action_callback('get_commercial_projection') do |_context, payload|
            handle_commercial_projection(dialog, payload)
          end
        end

        def handle_commercial_projection(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          request_id = payload['requestId'].to_s
          status = model_binding_connector.status
          result = commercial_projection_response(request_id, status)
          execute_bridge(dialog, 'onCommercialProjection', result)
        rescue Connection::CommercialProjection::Service::Error => e
          @logger.error('commercial_projection_failed', error: e)
          execute_bridge(dialog, 'onCommercialProjection', {
                           'requestId' => request_id, 'state' => e.kind.to_s, 'error' => e.message
                         })
        rescue StandardError => e
          @logger.error('commercial_projection_bridge_failed', error: e)
          error = 'no se pudo actualizar el presupuesto'
          execute_bridge(dialog, 'onCommercialProjection', {
                           'requestId' => request_id, 'state' => 'unavailable', 'error' => error
                         })
        end

        def commercial_projection_response(request_id, status)
          unless status['state'] == 'connected' && status['binding'].is_a?(Hash)
            error = 'el modelo debe estar conectado y actualizado para calcular el presupuesto'
            return { 'requestId' => request_id, 'state' => status['state'] || 'unavailable', 'error' => error }
          end

          binding = status['binding']
          project_id = binding['projectId']
          design_id = binding['designId']
          started_work = commercial_projection_local_work(project_id, design_id)
          if started_work['localChangesPending']
            return commercial_projection_stale_response(
              request_id, project_id, design_id, started_work,
              'hay cambios locales que todavía no están sincronizados'
            )
          end

          projection = @commercial_projection_service.fetch(project_id, design_id)
          finished_work = commercial_projection_local_work(project_id, design_id)
          if finished_work['localChangesPending'] ||
             finished_work['generation'] != started_work['generation'] ||
             finished_work['matchConfirmed'] != started_work['matchConfirmed']
            return commercial_projection_stale_response(
              request_id, project_id, design_id, finished_work,
              'el modelo cambió mientras se calculaba el presupuesto'
            )
          end

          { 'requestId' => request_id, 'projectId' => project_id, 'designId' => design_id,
            'state' => projection['status'], 'projection' => projection, 'workState' => finished_work }
        end

        def commercial_projection_stale_response(request_id, project_id, design_id, work_state, error)
          { 'requestId' => request_id, 'projectId' => project_id, 'designId' => design_id,
            'state' => 'stale', 'workState' => work_state, 'error' => error }
        end

        def commercial_projection_local_work(project_id, design_id)
          Connection::CommercialProjection::LocalWorkState.new(active_model).snapshot(
            project_id: project_id, design_id: design_id
          )
        end

        def mark_commercial_projection_local_work
          binding = commercial_projection_binding
          return nil unless binding

          Connection::CommercialProjection::LocalWorkState.new(active_model).mark_pending!(
            project_id: binding.project_id, design_id: binding.design_id
          )
        end

        def notify_commercial_projection_synchronization(scope = :partial)
          binding = commercial_projection_binding
          return nil unless binding

          state = Connection::CommercialProjection::LocalWorkState.new(active_model).record_sync!(
            project_id: binding.project_id, design_id: binding.design_id, scope: scope
          )
          execute_bridge(@dialog, 'onCommercialProjectionSynchronization', state) if @dialog&.visible?
          mark_host_save_pending
          state
        end

        def mark_host_save_pending
          return unless @save_awareness && active_model

          payload = @save_awareness.mark_synced(active_model)
          execute_bridge(@dialog, 'onHostSaveAwareness', payload) if @dialog&.visible?
          payload
        end

        private

        def commercial_projection_binding
          model = active_model
          return nil unless model

          Connection::ModelBinding::Store.new(model).read
        end
      end

      # #718 — bounded SketchUp-first commercial entry. Ruby owns binding,
      # local-work checks, credentials and the final server refetch; the
      # HtmlDialog receives presentation data only.
      module CommercialBootstrapBridge # rubocop:disable Metrics/ModuleLength
        def register_commercial_bootstrap_callbacks(dialog)
          dialog.add_action_callback('list_bootstrap_customers') { handle_bootstrap_customers(dialog) }
          dialog.add_action_callback('bootstrap_project_design') { |_c, p| handle_bootstrap_project(dialog, p) }
          dialog.add_action_callback('emit_initial_quote') { |_c, p| handle_initial_quote(dialog, p) }
        end

        def handle_bootstrap_customers(dialog)
          entries = @project_bootstrap.customers
          execute_bridge(dialog, 'onBootstrapCustomers', { 'ok' => true, 'entries' => entries })
        rescue Connection::ProjectBootstrap::Service::Error => e
          execute_bridge(dialog, 'onBootstrapCustomers', {
                           'ok' => false, 'code' => e.kind.to_s, 'reason' => e.message
                         })
        end

        def handle_bootstrap_project(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = @project_bootstrap.create(payload)
          execute_bridge(dialog, 'onBootstrapResult', result)
          handle_get_model_binding(dialog) if result['ok']
        rescue StandardError => e
          @logger.error('bootstrap_project_bridge_failed', error: e)
          execute_bridge(dialog, 'onBootstrapResult', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # rubocop:disable Metrics/AbcSize, Metrics/CyclomaticComplexity
        # rubocop:disable Metrics/MethodLength, Metrics/PerceivedComplexity
        def handle_initial_quote(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          model = active_model
          return initial_quote_failure(dialog, 'binding_changed', 'el modelo activo cambió') unless model

          status = model_binding_connector.status
          unless status['state'] == 'connected'
            return initial_quote_failure(dialog, 'binding_changed', 'el enlace del modelo cambió')
          end
          unless status.dig('capabilities', 'can_create_initial_quote') == true
            return initial_quote_failure(dialog, 'forbidden', 'no tenés permiso para emitir la cotización inicial')
          end
          if mutation_coordinator.busy?
            return initial_quote_failure(dialog, 'mutation_pending', 'hay una modificación en curso')
          end

          binding = status['binding']
          binding_value = Connection::ModelBinding::Binding.parse(binding)
          unless active_model.equal?(model) &&
                 Connection::ModelBinding::Store.new(model).read&.to_h == binding_value.to_h
            return initial_quote_failure(dialog, 'binding_changed', 'el modelo activo o su enlace cambió')
          end

          host_before = contextual_host_projection(model, binding_value)
          unless Connection::ProjectFurniture::HostReconciliation.clean_for?(host_before, binding_value)
            return initial_quote_failure(dialog, 'host_reconciliation_required',
                                         host_reconciliation_reason(host_before))
          end
          before = commercial_projection_local_work(binding['projectId'], binding['designId'])
          unless before['matchConfirmed'] == true && before['localChangesPending'] == false
            return initial_quote_failure(dialog, 'local_state_unconfirmed',
                                         'el diseño local no coincide con el servidor')
          end

          projection = @commercial_projection_service.fetch(binding['projectId'], binding['designId'])
          after = commercial_projection_local_work(binding['projectId'], binding['designId'])
          unless after == before && initial_quote_projection_valid?(projection)
            return initial_quote_refresh(dialog, 'el presupuesto dejó de estar listo; revisalo de nuevo')
          end

          displayed_total = payload['saleTotal']
          changed = payload['workingVersion'] != projection['workingVersion'] ||
                    payload['workingFingerprint'] != projection['workingFingerprint'] ||
                    !displayed_total.is_a?(Numeric) || displayed_total != projection.dig('amounts', 'saleTotal')
          return initial_quote_refresh(dialog, 'el presupuesto cambió; revisalo y volvé a emitir') if changed

          host_after = contextual_host_projection(model, binding_value)
          unless Connection::ProjectFurniture::HostReconciliation.clean_for?(host_after, binding_value) &&
                 host_after['snapshot'] == host_before['snapshot'] && active_model.equal?(model) &&
                 Connection::ModelBinding::Store.new(model).read&.to_h == binding_value.to_h
            reason = 'el archivo SketchUp dejó de coincidir con el diseño; revisalo de nuevo'
            return initial_quote_refresh(dialog, reason)
          end

          quote = @initial_quote.create(
            project_id: binding['projectId'], design_id: binding['designId'],
            working_version: projection['workingVersion'], working_fingerprint: projection['workingFingerprint']
          )
          execute_bridge(dialog, 'onInitialQuoteResult', {
                           'ok' => true, 'quote' => quote,
                           'webUrl' => initial_quote_web_url(binding['projectId'], quote['id'])
                         })
        rescue Connection::CommercialProjection::Service::Error, Connection::InitialQuote::Service::Error => e
          initial_quote_failure(dialog, e.kind.to_s, e.message)
        rescue StandardError => e
          @logger.error('initial_quote_bridge_failed', error: e)
          initial_quote_failure(dialog, 'error', 'no se pudo emitir la cotización')
        end
        # rubocop:enable Metrics/AbcSize, Metrics/CyclomaticComplexity
        # rubocop:enable Metrics/MethodLength, Metrics/PerceivedComplexity

        private

        def host_reconciliation_reason(projection)
          count = projection&.dig('summary', 'attention').to_i
          return "hay #{count} muebles que requieren reconciliación con este archivo SketchUp" if count.positive?

          projection&.dig('reason') || 'no se pudo confirmar que este archivo SketchUp coincida con el diseño'
        end

        def contextual_host_projection(model, binding)
          return nil unless @host_reconciliation

          method = @host_reconciliation.method(:projection)
          accepts_context = method.parameters.any? { |kind, _name| %i[key keyreq keyrest].include?(kind) }
          accepts_context ? method.call(model: model, binding: binding) : method.call
        end

        def initial_quote_projection_valid?(projection)
          projection['status'] == 'current' && projection['reference'].nil? &&
            projection['itemCount'].to_i.positive? && projection.dig('amounts', 'saleTotal').is_a?(Numeric) &&
            projection['workingVersion'].is_a?(String) && !projection['workingVersion'].empty? &&
            projection['workingFingerprint'].to_s.match?(Connection::CommercialProjection::SHA256_PATTERN)
        end

        def initial_quote_failure(dialog, code, reason)
          execute_bridge(dialog, 'onInitialQuoteResult', { 'ok' => false, 'code' => code, 'reason' => reason })
          nil
        end

        def initial_quote_refresh(dialog, reason)
          execute_bridge(dialog, 'onInitialQuoteResult', {
                           'ok' => false, 'code' => 'refresh_required', 'reason' => reason
                         })
          nil
        end

        def initial_quote_web_url(project_id, quote_id)
          base = @status_provider.call['server_url'].to_s.sub(%r{/api/?\z}, '')
          return nil unless base.match?(%r{\Ahttps?://})

          "#{base}/quotes?projectId=#{project_id}&quoteRevisionId=#{quote_id}"
        end
      end

      # #389 / DT-5 Project Furniture callback handlers: the panel never
      # touches business identity — listing and Place existing go through the
      # ProjectFurniture placer, which validates the binding and derives
      # host state from project membership, exact WorkingCopy intent and the
      # active model's top-level managed roots.
      module ProjectFurnitureBridge # rubocop:disable Metrics/ModuleLength
        # Unit-length/orthogonality tolerance for the oriented target
        # frames (#469 increment 3): host transform axes are floats.
        UNIT_EPSILON = 1e-6

        def register_project_furniture_callbacks(dialog)
          dialog.add_action_callback('get_project_furniture') { handle_get_project_furniture(dialog) }
          dialog.add_action_callback('place_furniture_instance') { |_c, p| handle_place_furniture_instance(dialog, p) }
          dialog.add_action_callback('create_project_furniture') { |_c, p| handle_create_project_furniture(dialog, p) }
          dialog.add_action_callback('confirm_placement_instance') do |_c, p|
            handle_confirm_placement_instance(dialog, p)
          end
          dialog.add_action_callback('cancel_placement_instance') do |_c, p|
            handle_cancel_placement_instance(dialog, p)
          end
          dialog.add_action_callback('restore_furniture_instance') do |_c, p|
            handle_restore_furniture_instance(dialog, p)
          end
          dialog.add_action_callback('select_project_furniture') { |_c, p| handle_select_project_furniture(p) }
          dialog.add_action_callback('validate_managed_furniture_identity') do
            handle_validate_managed_furniture_identity(dialog)
          end
          dialog.add_action_callback('rescan_duplicates') do
            handle_rescan_duplicates(dialog)
          end
          dialog.add_action_callback('publish_design_revision') do
            handle_publish_design_revision(dialog)
          end
          dialog.add_action_callback('validate_design_revision') do |_c, _p|
            handle_validate_design_revision(dialog)
          end
          dialog.add_action_callback('synchronize_design') do
            handle_synchronize_design(dialog)
          end
          # #469 — shared transient placement preview (Project + Library
          # consume the same FurniturePlacementTool; only identity
          # provenance differs at commit).
          dialog.add_action_callback('begin_placement_preview') do |_c, p|
            handle_begin_placement_preview(dialog, p)
          end
          dialog.add_action_callback('begin_catalog_placement_preview') do |_c, p|
            handle_begin_catalog_placement_preview(dialog, p)
          end
        end

        # Panel payload: binding-aware reconciliation per furnitureInstanceId.
        def handle_get_project_furniture(dialog)
          result = project_furniture_placer.panel
          execute_bridge(dialog, 'onProjectFurniture', result)
        rescue StandardError => e
          @logger.error('project_furniture_panel_failed', error: e)
          execute_bridge(dialog, 'onProjectFurniture', { 'state' => 'error', 'reason' => e.message })
        end

        # #810 — the explicit "Sincronizar diseño" operation: one conscious
        # add/update/delete sync through the conflict-safe frontier, verified
        # by authoritative readback. Success refreshes the panel and marks the
        # commercial projection synchronized; the HtmlDialog refetches the
        # confirmed total from the backend (no local price math).
        def handle_synchronize_design(dialog)
          result = design_sync_synchronizer.synchronize_design
          execute_bridge(dialog, 'onSynchronizeDesignResult', result)
          if result['ok']
            notify_commercial_projection_synchronization(:full)
            handle_get_project_furniture(dialog)
            push_preflight_state(dialog)
            mark_host_save_pending
          end
        rescue StandardError => e
          @logger.error('design_sync_handler_failed', error: e)
          execute_bridge(dialog, 'onSynchronizeDesignResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Place EXISTING FurnitureInstance: identity arrives from the server
        # list; the placer guarantees no new business object is created and
        # the working copy keeps every other item.
        def handle_place_furniture_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          fi_id = payload['furnitureInstanceId'].to_s
          result = project_furniture_placer.place(fi_id)
          result['instanceId'] ||= fi_id
          if result['ok'] && @position_sync_coordinator
            model = active_model
            binding = Connection::ModelBinding::Store.new(model).read
            if binding
              preflight_review_session
              converged = @position_sync_coordinator.converge_inserted_unit(model, binding, fi_id)
              result = converged if converged['ok']
            end
          end
          result['instanceId'] ||= fi_id
          execute_bridge(dialog, 'onPlaceFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => fi_id })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_place_failed', error: e)
          execute_bridge(dialog, 'onPlaceFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'instanceId' => fi_id,
                           'reason' => 'No se pudo colocar el mueble (error interno de SketchUp).' })
        end

        # #390 / DT-6: Create and place from Catalog in design-first flow.
        def handle_create_project_furniture(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = project_furniture_placer.create_and_place(
            definition_id: payload['definitionId'].to_s,
            parameters: payload['parameters'] || {},
            material_choices: payload['materialChoices'] || {},
            idempotency_key: payload['idempotencyKey']
          )
          if result['ok'] && result['instanceId'] && @position_sync_coordinator
            model = active_model
            binding = Connection::ModelBinding::Store.new(model).read
            if binding
              preflight_review_session
              converged = @position_sync_coordinator.converge_inserted_unit(model, binding, result['instanceId'])
              result = converged if converged['ok']
            end
          end
          execute_bridge(dialog, 'onCreateProjectFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok'] && result['instanceId']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => result['instanceId'] })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_create_failed', error: e)
          execute_bridge(dialog, 'onCreateProjectFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def handle_confirm_placement_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          fi_id = payload['furnitureInstanceId'].to_s
          result = project_furniture_placer.confirm_placement(fi_id)
          execute_bridge(dialog, 'onConfirmPlacementResult', result)
          notify_commercial_projection_synchronization(:partial) if result['ok']
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => fi_id })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('project_furniture_confirm_failed', error: e)
          execute_bridge(dialog, 'onConfirmPlacementResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def handle_cancel_placement_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          result = project_furniture_placer.cancel_placement(payload['furnitureInstanceId'].to_s)
          execute_bridge(dialog, 'onCancelPlacementResult', result)
          handle_get_project_furniture(dialog) if result['ok']
        rescue StandardError => e
          @logger.error('project_furniture_cancel_failed', error: e)
          execute_bridge(dialog, 'onCancelPlacementResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #469 — Proyecto: activate the shared transient placement tool for a
        # pending FurnitureInstance. All server resolution happens HERE,
        # outside the cursor loop; the tool itself holds no service. The
        # click revalidates everything through the canonical #place command
        # against the EXACT gesture context captured here (model, binding,
        # gesture id, composition fingerprint).
        def handle_begin_placement_preview(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          fi_id = payload['furnitureInstanceId'].to_s
          return if respond_placement_preview_busy(dialog, 'instanceId' => fi_id)

          model = active_model
          prepared = project_furniture_placer.prepare_placement_preview(fi_id)
          prepared = prepare_preview_extents(prepared, fi_id, 'instanceId') if prepared['ok']
          unless prepared['ok']
            prepared['instanceId'] ||= fi_id
            execute_bridge(dialog, 'onPlacementPreviewStarted', prepared)
            return
          end

          return unless placement_preview_auth_available?(dialog, 'instanceId' => fi_id)

          session = placement_preview_session('project', fi_id, model, prepared)
          tool = build_placement_preview_tool(
            label: prepared['definition']['name'], extents_mm: prepared['extents'],
            on_commit: lambda { |transform|
              handle_commit_placement_preview(dialog, fi_id, session['gesture_id'], transform)
            },
            on_cancel: lambda { |reason|
              handle_placement_preview_cancelled(dialog, fi_id, 'instanceId',
                                                 session['gesture_id'], reason)
            },
            model: model
          )
          return unless activate_placement_preview(dialog, session, tool, 'instanceId' => fi_id)

          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => true, 'code' => 'preview_active', 'instanceId' => fi_id })
        rescue StandardError => e
          @logger.error('placement_preview_begin_failed', error: e)
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'error', 'instanceId' => fi_id,
                           'reason' => e.message })
        end

        # #469 — Biblioteca (connected #390 lane): same shared tool; NO
        # backend identity is minted here — the FurnitureInstance is created
        # canonically only inside the commit gesture.
        def handle_begin_catalog_placement_preview(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          definition_id = payload['definitionId'].to_s
          return if respond_placement_preview_busy(dialog, 'definitionId' => definition_id)

          model = active_model
          prepared = begin_catalog_preview_preparation(payload, definition_id)
          unless prepared['ok']
            execute_bridge(dialog, 'onPlacementPreviewStarted', prepared)
            return
          end

          return unless placement_preview_auth_available?(dialog, 'definitionId' => definition_id)

          session = placement_preview_session('catalog', definition_id, model, prepared)
          session['idempotency_key'] = payload['idempotencyKey']
          session['payload'] = payload
          tool = build_placement_preview_tool(
            label: prepared['definition']['name'], extents_mm: prepared['extents'],
            on_commit: ->(transform) { handle_commit_catalog_preview(dialog, session['gesture_id'], transform) },
            on_cancel: lambda { |reason|
              handle_placement_preview_cancelled(dialog, definition_id, 'definitionId',
                                                 session['gesture_id'], reason)
            },
            model: model
          )
          return unless activate_placement_preview(dialog, session, tool, 'definitionId' => definition_id)

          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => true, 'code' => 'preview_active', 'definitionId' => definition_id })
        rescue StandardError => e
          @logger.error('catalog_placement_preview_begin_failed', error: e)
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'error', 'definitionId' => definition_id,
                           'reason' => e.message })
        end

        # Preview click for an EXISTING project unit: the canonical #place
        # command receives the accepted transform; identity is stamped
        # verbatim (no new unit, no commercial quantity change) and the
        # post-insert convergence syncs the working copy with readback. The
        # gesture must match the captured session: same gesture id, same
        # model AND same binding — anything else fails closed before
        # touching the host or the server, with a correlated answer.
        def handle_commit_placement_preview(dialog, furniture_instance_id, gesture_id, transformation)
          session = @active_placement_preview
          gesture_live = false
          return if placement_preview_reentry?(session, 'project', furniture_instance_id, gesture_id)

          gesture_live = true
          unless placement_preview_gesture_context_ok?(dialog, session, 'onPlaceFurnitureResult',
                                                       'instanceId' => furniture_instance_id)
            clear_placement_preview(session)
            return
          end

          @placement_preview_committing = true
          result = project_furniture_placer.place(
            furniture_instance_id, transformation: transformation,
                                   expected_layout_signature: session['layout_signature']
          )
          result = converge_preview_insert(dialog, result, furniture_instance_id) if result['ok']
          result['instanceId'] ||= furniture_instance_id
          execute_bridge(dialog, 'onPlaceFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => furniture_instance_id })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('placement_preview_commit_failed', error: e)
          execute_bridge(dialog, 'onPlaceFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'instanceId' => furniture_instance_id,
                           'reason' => 'No se pudo colocar el mueble (error interno de SketchUp).' })
        ensure
          @placement_preview_committing = false
          # Only a gesture that actually ran may consume the session: a
          # stale/re-entered return must leave the LIVE gesture untouched.
          clear_placement_preview(session) if gesture_live
        end

        # Preview click for the connected catalog lane: the #390 canonical
        # create happens HERE (identity minted at the explicit commit) and
        # the insertion lands at the accepted transform — under the same
        # gesture-context guards as the Project lane.
        def handle_commit_catalog_preview(dialog, gesture_id, transformation)
          session = @active_placement_preview
          gesture_live = false
          return if placement_preview_reentry?(session, 'catalog', session && session['key'], gesture_id)

          gesture_live = true
          unless placement_preview_gesture_context_ok?(dialog, session, 'onCreateProjectFurnitureResult',
                                                       'definitionId' => session['key'])
            clear_placement_preview(session)
            return
          end

          payload = session['payload'] || {}
          @placement_preview_committing = true
          result = project_furniture_placer.create_and_place(
            definition_id: payload['definitionId'].to_s,
            parameters: payload['parameters'] || {},
            material_choices: payload['materialChoices'] || {},
            idempotency_key: session['idempotency_key'],
            transformation: transformation,
            expected_layout_signature: session['layout_signature']
          )
          result = converge_preview_insert(dialog, result, result['instanceId']) if result['ok']
          execute_bridge(dialog, 'onCreateProjectFurnitureResult', result)
          handle_get_project_furniture(dialog) if result['ok']
          if result['ok'] && result['instanceId']
            scope = Host::CommandContract.furniture_scope({ 'furnitureInstanceId' => result['instanceId'] })
            push_preflight_state(dialog, scope)
          end
        rescue StandardError => e
          @logger.error('catalog_preview_commit_failed', error: e)
          execute_bridge(dialog, 'onCreateProjectFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        ensure
          @placement_preview_committing = false
          clear_placement_preview(session) if gesture_live
        end

        # Esc / tool switch / dialog close: the tool mutated nothing, so
        # cancellation is pure UI state — re-arm the entry point and tell
        # the user the unit stays pending. GESTURE-MATCHED: the late end of
        # an old gesture can never cancel or clear a newer one.
        def handle_placement_preview_cancelled(dialog, key, key_name, gesture_id, reason)
          session = @active_placement_preview
          @logger.info('placement_preview_cancelled', { 'reason' => reason.to_s, key => key })
          return unless session && session['gesture_id'] == gesture_id && session['key'] == key

          @active_placement_preview = nil
          payload = { 'ok' => true, 'code' => 'preview_cancelled', 'reason' => reason.to_s }
          payload[key_name] = key
          execute_bridge(dialog, 'onPlacementPreviewCancelled', payload)
        end

        # Closes any live preview gesture when the dialog closes. The
        # session is cleared FIRST so the tool's cancel callback cannot
        # re-enter controller state (and no bridge push is attempted on a
        # dialog that is going away).
        def cancel_active_placement_preview
          session = @active_placement_preview
          return unless session

          @active_placement_preview = nil
          session['tool']&.cancel_preview(:dialog_closed)
        rescue StandardError => e
          @logger&.error('placement_preview_close_cancel_failed', error: e)
        end

        # Another preview is already live: answer the NEW entry point
        # honestly instead of leaving its controls stuck — the active
        # gesture is untouched.
        # Returns the busy payload it answered (truthy), or nil when no
        # preview is live — callers early-return on the payload itself.
        def respond_placement_preview_busy(dialog, key_fields)
          return unless @active_placement_preview

          @logger.warn('placement_preview_busy', key_fields)
          busy = { 'ok' => false, 'code' => 'preview_busy',
                   'reason' => 'ya hay una colocación en curso; terminála con un clic o con Esc ' \
                               'antes de iniciar otra' }.merge(key_fields)
          execute_bridge(dialog, 'onPlacementPreviewStarted', busy)
          busy
        end

        # Catalog preparation + extents, answering definitionId on failure.
        def begin_catalog_preview_preparation(payload, definition_id)
          prepared = project_furniture_placer.prepare_catalog_preview(
            definition_id: definition_id,
            parameters: payload['parameters'] || {},
            material_choices: payload['materialChoices'] || {}
          )
          prepared = prepare_preview_extents(prepared, definition_id, 'definitionId') if prepared['ok']
          return prepared if prepared['ok']

          prepared['definitionId'] ||= definition_id
          prepared
        end

        # Gesture session: the exact context a later click must reproduce —
        # the model object, the binding triple, a unique gesture id and the
        # authoritative composition fingerprint the preview was built from.
        def placement_preview_session(kind, key, model, prepared)
          { 'kind' => kind, 'key' => key, 'model' => model,
            'binding' => placement_binding_triple(model),
            'auth' => project_furniture_placer.service.context_fingerprint,
            'gesture_id' => "preview-#{(Time.now.to_f * 1000).to_i}-#{rand(0xffff).to_s(16)}#{rand(0xffff).to_s(16)}",
            'layout_signature' => prepared['layout_signature'],
            'extents' => prepared['extents'] }
        end

        # Tool activation is part of the gesture: if select_tool or activate
        # fails, the session is discarded and the entry point is answered
        # with a correlated failure — a retry starts clean.
        # Returns the live session on success, nil after answering the
        # correlated failure (never a bare boolean: the session IS the proof
        # the gesture is running).
        def activate_placement_preview(dialog, session, tool, key_fields)
          model = session['model']
          model.select_tool(tool)
          tool.activate
          session['tool'] = tool
          @active_placement_preview = session
          session
        rescue StandardError => e
          @logger.error('placement_preview_activation_failed', { 'error' => e }.merge(key_fields))
          @active_placement_preview = nil
          # The failure may have happened AFTER select_tool pushed the
          # tool: put the model back so the retry starts clean.
          begin
            model&.select_tool(nil)
          rescue StandardError
            nil
          end
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'activation_failed',
                           'reason' => 'no se pudo activar la herramienta de colocación; inténtalo de nuevo' }
                           .merge(key_fields))
          nil
        end

        # True (and logs) when the commit must be ignored: a re-entered
        # gesture or a late commit from a gesture that already ended — its
        # controls were recovered when that gesture terminated, so there is
        # nothing to answer and a NEWER gesture must stay untouched.
        def placement_preview_reentry?(session, kind, key, gesture_id)
          if @placement_preview_committing
            @logger.warn('placement_preview_commit_reentered', { 'kind' => kind, 'key' => key })
            return true
          end
          return false if session && session['kind'] == kind && session['key'] == key &&
                          session['gesture_id'] == gesture_id

          @logger.warn('placement_preview_commit_stale',
                       { 'kind' => kind, 'key' => key, 'gesture_id' => gesture_id })
          true
        end

        # Combined gesture-context guard: model + binding + authenticated
        # context must all match the captured gesture.
        def placement_preview_gesture_context_ok?(dialog, session, bridge_method, key_fields)
          placement_preview_context_ok?(dialog, session, bridge_method, key_fields) &&
            placement_preview_auth_ok?(dialog, session, bridge_method, key_fields)
        end

        # Exact-context guard: the click must land on the SAME model and
        # the SAME binding the gesture captured. Otherwise nothing is
        # placed and the entry point gets a correlated, honest failure.
        def placement_preview_context_ok?(dialog, session, bridge_method, key_fields)
          unless active_model.equal?(session['model'])
            @logger.warn('placement_preview_model_changed', key_fields)
            execute_bridge(dialog, bridge_method,
                           { 'ok' => false, 'code' => 'context_changed',
                             'reason' => 'el modelo activo cambió durante la colocación; nada fue colocado' }
                           .merge(key_fields))
            return false
          end

          return true if placement_binding_triple(active_model) == session['binding']

          @logger.warn('placement_preview_binding_changed', key_fields)
          execute_bridge(dialog, bridge_method,
                         { 'ok' => false, 'code' => 'context_changed',
                           'reason' => 'el enlace del modelo cambió durante la colocación; nada fue colocado' }
                         .merge(key_fields))
          false
        end

        # Authenticated-context guard with explicit semantics: a TECHNICAL
        # token refresh keeps the same context identity (the gesture
        # survives); logout, a new enrollment/session or a backend switch
        # changes or voids it. An unknown/unreadable current context fails
        # closed — nil never equals nil.
        def placement_preview_auth_ok?(dialog, session, bridge_method, key_fields)
          current = project_furniture_placer.service.context_fingerprint
          return true if current && session['auth'] && current == session['auth']

          @logger.warn('placement_preview_auth_changed', key_fields)
          execute_bridge(dialog, bridge_method,
                         { 'ok' => false, 'code' => 'context_changed',
                           'reason' => 'la sesión o el servidor cambió durante la colocación; nada fue colocado' }
                         .merge(key_fields))
          false
        end

        # A gesture may only start under a PINNABLE auth context: when the
        # identity is unknown or unreadable there is nothing to verify the
        # click against, so the entry point fails closed up front.
        # Truthy when a pinnable context exists; false after answering the
        # correlated failure (callers early-return on the falsy answer).
        def placement_preview_auth_available?(dialog, key_fields)
          return true if project_furniture_placer.service.context_fingerprint

          @logger.warn('placement_preview_auth_unavailable', key_fields)
          execute_bridge(dialog, 'onPlacementPreviewStarted',
                         { 'ok' => false, 'code' => 'auth_context_unavailable',
                           'reason' => 'no se pudo confirmar la sesión para asegurar la colocación; reintentá' }
                         .merge(key_fields))
          false
        end

        def placement_binding_triple(model)
          binding = Connection::ModelBinding::Store.new(model).read
          return nil unless binding

          [binding.project_id, binding.design_id, binding.base_revision_id]
        end

        # The tool keeps the model captured at gesture time: ending an old
        # tool must never select_tool over the CURRENT dynamic model (which
        # may have moved on to another document). Extents carry their local
        # minimum (origin_mm) so the anchor maps the real furniture box.
        # The managed-neighbor provider is built HERE for both lanes —
        # Library and Project placement share the same tool, same engine
        # and the same target resolution; only identity provenance differs.
        def build_placement_preview_tool(label:, extents_mm:, on_commit:, on_cancel:, model:)
          Tools::FurniturePlacementTool.new(
            label: label, extents_mm: extents_mm,
            on_commit: on_commit, on_cancel: on_cancel,
            model_provider: -> { model },
            origin_mm: extents_mm[:origin_mm] || [0.0, 0.0, 0.0],
            logger: @logger,
            furniture_targets_provider: placement_furniture_targets_provider(model)
          )
        end

        # #469 increments 2+3 — pure-data provider of Granete-managed
        # neighbors for side-to-side snapping. Targets are resolved by
        # SERVER identity through ManagedFurniture metadata — never by
        # component name/GUID — and the scan is local/read-only (no
        # request, no mutation), so it is safe inside the cursor loop.
        # Ambiguous roots (duplicated furnitureInstanceId) and erased,
        # tilted, scaled or mirrored entities offer no candidate: an
        # unsafe target fails closed instead of guessing.
        def placement_furniture_targets_provider(model)
          lambda do
            index = Connection::ProjectFurniture::ManagedFurniture.index(
              model, @metadata_store_factory.call(model)
            )
            index[:by_id].flat_map do |furniture_instance_id, entries|
              next [] if entries.length != 1

              placement_target_descriptor(furniture_instance_id, entries.first[:entity])
            end
          end
        end

        # Oriented-frame descriptor of one managed root for the snap
        # engine (#469 increment 3). The frame comes from the entity's
        # REAL rigid transform (world origin + horizontal unit right/front
        # axes) and the LOCAL definition bounds — the materialized
        # resolved furniture box. The world AABB (entity.bounds) is
        # explicitly NOT the side authority: it is axis-aligned and stops
        # being the furniture's real sides at any non-quarter yaw.
        # Host transform axes are INCHES-direction vectors; the engine
        # works in mm. The label comes from the entity display name
        # (cosmetic only — identity stays the furnitureInstanceId above).
        def placement_target_descriptor(furniture_instance_id, entity)
          return [] unless entity.respond_to?(:transformation) && entity.respond_to?(:definition)
          return [] if entity.respond_to?(:valid?) && !entity.valid?

          frame = placement_target_frame(entity)
          return [] unless frame

          [{
            'furniture_instance_id' => furniture_instance_id,
            'label' => placement_target_label(entity),
            'origin_world_mm' => frame[:origin_world_mm],
            'front_dir_mm' => frame[:front_dir_mm],
            'right_dir_mm' => frame[:right_dir_mm],
            'local_min_mm' => frame[:local_min_mm],
            'local_max_mm' => frame[:local_max_mm]
          }]
        rescue StandardError => e
          @logger.warn('placement_target_skipped', { 'error' => e.message })
          []
        end

        # The root's oriented frame, validated fail-closed: horizontal
        # UNIT right/front (any yaw, but no tilt and no scaling — a scaled
        # instance's axis vectors leave unit length), mutually orthogonal
        # and right-handed (right × front = +Z: a mirrored frame is not
        # the furniture's own frame), with zaxis ≈ +Z (no tilt). nil when
        # any check fails — such a target offers no candidate.
        def placement_target_frame(entity)
          transform = entity.transformation
          right = horizontal_unit_dir_mm(transform.xaxis)
          front = horizontal_unit_dir_mm(transform.yaxis)
          return nil unless right && front
          return nil unless (right[0] * front[1]) - (right[1] * front[0]) > 1.0 - UNIT_EPSILON
          return nil unless vertical_up_axis?(transform.zaxis)

          bounds = entity.definition.bounds
          return nil unless bounds.respond_to?(:min) && bounds.respond_to?(:max)

          { origin_world_mm: point_mm(transform.origin),
            front_dir_mm: front, right_dir_mm: right,
            local_min_mm: point_mm(bounds.min), local_max_mm: point_mm(bounds.max) }
        end

        # Host Point3d (INCHES) → mm triple for frame/descriptor data.
        def point_mm(point)
          mm = 25.4
          [point.x.to_f * mm, point.y.to_f * mm, point.z.to_f * mm]
        end

        # A host axis vector as a horizontal UNIT mm direction — nil when
        # it tilts off the XY plane or leaves unit length (scaled).
        def horizontal_unit_dir_mm(vector)
          return nil unless vector.respond_to?(:x) && vector.respond_to?(:y) && vector.respond_to?(:z)

          x = vector.x.to_f
          y = vector.y.to_f
          z = vector.z.to_f
          return nil unless z.abs < UNIT_EPSILON
          return nil unless (Math.sqrt((x**2) + (y**2)) - 1.0).abs < UNIT_EPSILON

          [x, y, 0.0]
        end

        # zaxis must be exactly +Z: tilt or a flipped frame rejects.
        def vertical_up_axis?(vector)
          vector.respond_to?(:x) && vector.x.to_f.abs < UNIT_EPSILON &&
            vector.respond_to?(:y) && vector.y.to_f.abs < UNIT_EPSILON &&
            vector.respond_to?(:z) && ((vector.z.to_f - 1.0).abs < UNIT_EPSILON)
        end

        # Display label: the entity's human name without the technical id
        # suffix. Cosmetic only — never identity authority.
        def placement_target_label(entity)
          name = entity.respond_to?(:name) ? entity.name.to_s : ''
          label = name.sub(/\s*\([^()]*\)\s*\z/, '').strip
          label.empty? ? 'Mueble' : label
        end

        # Authoritative preview extents: the resolved layout's dimensionsMm
        # ([w, h, d]) or, when absent, the boards' local AABB — preview-only
        # derivation that never touches productive geometry.
        def prepare_preview_extents(prepared, key, key_name)
          extents = Tools::FurniturePlacementTool.extents_from_layout(prepared['layout'])
          return prepared.merge('extents' => extents) if extents

          { 'ok' => false, 'code' => 'preview_unavailable',
            'reason' => 'la composición resuelta no publicó dimensiones utilizables para la vista previa',
            key_name => key }
        end

        def converge_preview_insert(_dialog, result, furniture_instance_id)
          return result unless result['ok'] && furniture_instance_id && @position_sync_coordinator

          model = active_model
          binding = Connection::ModelBinding::Store.new(model).read
          return result unless binding

          preflight_review_session
          converged = @position_sync_coordinator.converge_inserted_unit(model, binding, furniture_instance_id)
          converged['ok'] ? converged : result
        end

        def clear_placement_preview(preview)
          @active_placement_preview = nil if @active_placement_preview.equal?(preview) ||
                                             @active_placement_preview == preview
        end

        def handle_restore_furniture_instance(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          furniture_instance_id = payload['furnitureInstanceId'].to_s
          result = if mutation_coordinator.busy?
                     {
                       'ok' => false, 'code' => 'action_in_progress',
                       'reason' => 'hay otra modificación del modelo en curso',
                       'instanceId' => furniture_instance_id
                     }
                   else
                     project_furniture_placer.restore(furniture_instance_id)
                   end
          execute_bridge(dialog, 'onRestoreFurnitureResult', result)
          mark_host_save_pending if result['ok'] && result['restored'] == true
          handle_get_project_furniture(dialog)
        rescue StandardError => e
          @logger.error('project_furniture_restore_failed', error: e)
          execute_bridge(dialog, 'onRestoreFurnitureResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Focus an already-placed unit: pure viewport selection state.
        def handle_select_project_furniture(raw_payload = nil)
          payload = if raw_payload.is_a?(String) && !raw_payload.strip.empty?
                      JSON.parse(raw_payload)
                    else
                      raw_payload || {}
                    end
          fi_id = payload['furnitureInstanceId'].to_s
          return if fi_id.empty?

          model = active_model
          located = Connection::ProjectFurniture::ManagedFurniture.locate(
            model, @metadata_store_factory.call(model), fi_id
          )
          if located['entity'] && model.respond_to?(:selection)
            model.selection.clear
            model.selection.add(located['entity'])
            @logger.info('project_furniture_selected', furniture_instance_id: fi_id)
          else
            @logger.warn('project_furniture_select_rejected', furniture_instance_id: fi_id)
          end
        rescue StandardError => e
          @logger.error('project_furniture_select_failed', error: e)
        end

        # Pushes a fresh panel payload when a visible dialog exists — used at
        # dialog ready and on active-document switches (the panel follows the
        # binding of whichever model is open).
        def refresh_project_furniture
          handle_get_project_furniture(@dialog) if @dialog&.visible?
        end

        def handle_observed_working_copy_commit
          notify_commercial_projection_synchronization(:partial)
          refresh_project_furniture
        end

        def handle_observed_position_sync_outcome(outcome = nil, **kwargs)
          return unless @dialog&.visible?

          outcome = kwargs if outcome.nil? || !outcome.is_a?(Hash)
          return unless outcome.is_a?(Hash)

          current = active_model
          return unless current
          return if outcome[:model] && !current.equal?(outcome[:model])
          return unless sync_outcome_binding_matches?(current, outcome[:binding])

          handle_get_project_furniture(@dialog)

          return unless outcome[:status] == :success

          push_preflight_state(@dialog)
          mark_host_save_pending
        end

        def sync_outcome_binding_matches?(current_model, outcome_binding)
          return true unless outcome_binding

          current_binding = if defined?(Connection::ModelBinding::Store)
                              Connection::ModelBinding::Store.new(current_model).read
                            end
          if current_binding
            return current_binding.project_id == outcome_binding.project_id &&
                   current_binding.design_id == outcome_binding.design_id &&
                   current_binding.base_revision_id == outcome_binding.base_revision_id
          end

          return true unless @model_binding_connector.respond_to?(:status)

          status = @model_binding_connector.status
          return true unless status.is_a?(Hash) && status['binding'].is_a?(Hash)

          b = status['binding']
          b['projectId'] == outcome_binding.project_id &&
            b['designId'] == outcome_binding.design_id &&
            b['baseRevisionId'] == outcome_binding.base_revision_id
        end

        def handle_observed_position_sync_complete(_event, _ids)
          return unless @dialog&.visible?

          handle_get_project_furniture(@dialog)
          push_preflight_state(@dialog)
          mark_host_save_pending
        end

        def handle_host_inventory_change
          refresh_project_furniture
        end

        # #391 / DT-7: Publish precheck for managed furniture identity.
        def handle_validate_managed_furniture_identity(dialog)
          result = if duplicate_resolver
                     duplicate_resolver.validate_model(active_model)
                   else
                     { 'valid' => true, 'code' => 'valid' }
                   end
          execute_bridge(dialog, 'onValidateFurnitureIdentityResult', result)
        rescue StandardError => e
          @logger.error('validate_managed_furniture_identity_failed', error: e)
          execute_bridge(dialog, 'onValidateFurnitureIdentityResult',
                         { 'valid' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #391 / DT-7: Rescan and resolve all duplicate identities in the model.
        def handle_rescan_duplicates(dialog)
          result = if duplicate_resolver
                     duplicate_resolver.rescan_and_resolve(active_model)
                   else
                     { 'ok' => false, 'code' => 'resolver_unavailable' }
                   end
          execute_bridge(dialog, 'onRescanDuplicatesResult', result)
          handle_get_project_furniture(dialog)
        rescue StandardError => e
          @logger.error('rescan_duplicates_failed', error: e)
          execute_bridge(dialog, 'onRescanDuplicatesResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #392 / DT-8: publish the connected design as an immutable revision
        # with model/manifest/preview artifacts. The dialog never builds
        # business payloads — the publisher owns the sequence, reuses the
        # #391 precheck, and reports honest progress steps.
        #
        # #731 PR2: `Publicar diseño` is now an ORCHESTRATION, not a gate
        # wall. One click runs: fresh HostReconciliation → safe convergence
        # of every pending_confirmation position (1 coalesced working copy
        # transaction) → design-wide batch validation over the canonical
        # publication scope → FRESH PublicationPreflightGate evaluation →
        # Publisher.publish (or exceptions-only rendering). The gate is
        # still enforced fail-closed Ruby-side immediately before the
        # publisher; the batch never mints readiness and the publisher
        # stays publication-only.
        def handle_publish_design_revision(dialog)
          unless @design_publisher
            execute_bridge(dialog, 'onPublishResult',
                           { 'ok' => false, 'code' => 'publisher_unavailable',
                             'reason' => 'la publicación de diseños no está disponible' })
            return
          end

          start_design_workflow(dialog, 'publish')
        rescue StandardError => e
          @logger.error('publish_design_revision_failed', error: e)
          execute_bridge(dialog, 'onPublishResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # #731 PR2 Entrega D: explicit design-wide validation. Runs the SAME
        # DesignPreflightBatch `Publicar diseño` runs — never a second
        # path — and reports the same exceptions-only projection without
        # publishing.
        def handle_validate_design_revision(dialog)
          start_design_workflow(dialog, 'validate')
        rescue StandardError => e
          @logger.error('validate_design_revision_failed', error: e)
          execute_bridge(dialog, 'onDesignValidationResult',
                         { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        def start_design_workflow(dialog, kind)
          if design_workflow_busy?
            execute_bridge(dialog, workflow_result_channel(kind),
                           { 'ok' => false, 'code' => 'action_in_progress',
                             'reason' => 'hay una validación o publicación del diseño en curso' })
            return
          end

          model = active_model
          binding = model && Connection::ModelBinding::Store.new(model).read
          unless model && binding
            finish_design_workflow(dialog, kind,
                                   { 'ok' => false, 'code' => 'unbound',
                                     'reason' => 'conectá este modelo a un proyecto y diseño primero' })
            return
          end

          @design_workflow = { 'kind' => kind, 'model' => model, 'binding' => binding }
          report_design_workflow_progress(dialog, kind, 0, 0, 'Preparando validación del diseño…')

          host = design_workflow_host_projection(model, binding)
          design_workflow_converge_pending(dialog, kind, model, binding, host)
          host = design_workflow_host_projection(model, binding)

          blockers = design_workflow_host_blockers(host)
          if blockers.any?
            # Hard host blockers (duplicate_local, missing_local,
            # incompatible, terminal_or_orphan, unavailable projection…)
            # have NO safe automatic repair: stop before the batch and show
            # the exceptions.
            finish_design_workflow_exceptions(dialog, kind, host, blockers)
            return
          end

          # Wire the completion guard BEFORE start: a synchronous scheduler
          # (tests, non-UI hosts) runs the whole batch inside #start.
          @design_workflow['batch_generation'] = design_preflight_batch.next_generation
          outcome = design_preflight_batch.start
          finish_design_workflow(dialog, kind, batch_start_failure(outcome)) unless outcome['started'] == true
        rescue StandardError => e
          @logger.error('design_workflow_start_failed', error: e, kind: kind)
          finish_design_workflow(dialog, kind, { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        # Batch progress → per-channel feedback. Superseded generations and
        # runs whose workflow already finished are discarded.
        def handle_design_validation_progress(payload)
          workflow = @design_workflow
          return unless workflow
          return unless payload['generation'] == workflow['batch_generation']

          dialog = @dialog
          return unless dialog&.visible?

          report_design_workflow_progress(dialog, workflow['kind'],
                                          payload['done'].to_i, payload['total'].to_i, nil)
        end

        # Batch completion → FRESH gate evaluation (never the batch's own
        # tally) → publish or exceptions. A mutation that landed during the
        # batch flips tracker entries to stale, so the gate re-reads the
        # honest state here and blocks the publish.
        def handle_design_validation_complete(result)
          workflow = @design_workflow
          return unless workflow
          return unless result['generation'] == workflow['batch_generation']

          dialog = @dialog
          return unless dialog

          unless design_workflow_context_current?(workflow)
            finish_design_workflow(dialog, workflow['kind'],
                                   { 'ok' => false, 'code' => 'context_changed',
                                     'reason' => 'el modelo activo o su enlace cambió durante la validación' })
            return
          end

          push_preflight_state(dialog)

          if result['code'] != Host::DesignPreflightBatch::COMPLETED
            finish_design_workflow(dialog, workflow['kind'],
                                   { 'ok' => false, 'code' => result['code'],
                                     'reason' => 'la validación del diseño no completó' })
            return
          end

          host = design_workflow_host_projection(workflow['model'], workflow['binding'])
          if workflow['kind'] == 'validate'
            finish_design_validation_only(dialog, host)
          else
            finish_publish_after_validation(dialog, host)
          end
        rescue StandardError => e
          @logger.error('design_validation_complete_failed', error: e)
          finish_design_workflow(@dialog, 'publish', { 'ok' => false, 'code' => 'error', 'reason' => e.message })
        end

        private

        # `Validar diseño` outcome: the same exceptions-only projection,
        # without any publish attempt.
        def finish_design_validation_only(dialog, host)
          finish_design_workflow(dialog, 'validate',
                                 { 'ok' => true, 'code' => Host::DesignPreflightBatch::COMPLETED,
                                   'validation' => publication_validation_projection(nil, host, []) })
        end

        # Publish half of the completion: mutation-free check, FRESH gate,
        # then the untouched publisher sequence.
        def finish_publish_after_validation(dialog, host)
          if mutation_coordinator.respond_to?(:busy?) && mutation_coordinator.busy?
            finish_design_workflow(dialog, 'publish',
                                   { 'ok' => false, 'code' => 'action_in_progress',
                                     'reason' => mutation_in_progress_reason })
            return
          end

          gate = publication_gate_projection
          if gate.nil? || gate['allowed'] != true
            failure = { 'ok' => false, 'code' => 'preflight_incomplete',
                        'reason' => publish_gate_reason(gate) }
            finish_design_workflow_exceptions(dialog, 'publish', host, [], extra: failure)
            return
          end

          on_progress = ->(step) { execute_bridge(dialog, 'onPublishProgress', { 'step' => step }) }
          publish_result = @design_publisher.publish(on_progress: on_progress)
          notify_commercial_projection_synchronization(:full) if publish_result['ok']
          execute_bridge(dialog, 'onPublishResult', publish_result)
          # The binding base label and capabilities follow the new revision.
          handle_get_model_binding(dialog) if publish_result['ok']
          @design_workflow = nil
        end

        def design_workflow_busy?
          !@design_workflow.nil?
        end

        def mutation_in_progress_reason
          'hay otra modificación del modelo en curso; reintentá la publicación'
        end

        def workflow_result_channel(kind)
          kind == 'validate' ? 'onDesignValidationResult' : 'onPublishResult'
        end

        def finish_design_workflow(dialog, kind, result)
          @design_workflow = nil
          execute_bridge(dialog, workflow_result_channel(kind), result)
        end

        # Exceptions-only ending (#731 product rule): the designer sees the
        # summary counts and ONLY the furniture that requires attention —
        # never a list of per-unit successes.
        def finish_design_workflow_exceptions(dialog, kind, host, blockers, extra: {})
          validation = publication_validation_projection(nil, host, blockers)
          if kind == 'validate'
            finish_design_workflow(dialog, kind,
                                   { 'ok' => true, 'code' => 'exceptions',
                                     'validation' => validation })
          else
            failure = extra.any? ? extra : { 'ok' => false, 'code' => 'preflight_incomplete' }
            failure['reason'] ||= publish_gate_reason(publication_gate_projection)
            finish_design_workflow(dialog, kind,
                                   failure.merge('validation' => validation))
          end
        end

        def design_workflow_host_projection(model, binding)
          return nil unless @host_reconciliation

          method = @host_reconciliation.method(:projection)
          accepts_context = method.parameters.any? { |kind, _name| %i[key keyreq keyrest].include?(kind) }
          accepts_context ? method.call(model: model, binding: binding) : method.call
        rescue StandardError => e
          @logger.error('design_workflow_host_projection_failed', error: e)
          nil
        end

        # Safe automatic convergence: only pending_confirmation units of a
        # CONNECTED projection, converging in one coalesced working copy
        # transaction. Every other state is left untouched for the honest
        # blocker classification that follows.
        def design_workflow_converge_pending(dialog, kind, model, binding, host)
          return false unless host.is_a?(Hash) && host['state'] == 'connected'
          return false unless @position_sync_coordinator.respond_to?(:converge_pending)

          pending = host['items'].to_a
                                 .select { |item| item['reconciliationState'] == 'pending_confirmation' }
                                 .filter_map { |item| item['id'] }
          return false if pending.empty?

          report_design_workflow_progress(dialog, kind, 0, 0, 'Sincronizando posiciones pendientes…')
          result = @position_sync_coordinator.converge_pending(model, binding, pending)
          result['ok'] == true
        rescue StandardError => e
          @logger.error('design_workflow_converge_failed', error: e)
          false
        end

        # Hard blockers have no safe automatic repair: every blocking
        # reconciliation item of a connected projection, or the projection's
        # own unavailable state.
        def design_workflow_host_blockers(host)
          if host.is_a?(Hash) && host['state'] == 'connected'
            host['items'].to_a.select { |item| item['blocking'] }.map do |item|
              { 'furnitureInstanceId' => item['id'], 'displayName' => item['displayName'],
                'state' => item['reconciliationState'], 'reason' => item['reason'] }
            end
          else
            [{ 'state' => host.is_a?(Hash) ? host['state'] : 'unknown',
               'reason' => host.is_a?(Hash) ? host['reason'] : 'no se pudo reconciliar el modelo con el diseño' }]
          end
        end

        def design_workflow_context_current?(workflow)
          return false unless active_model.equal?(workflow['model'])

          current = Connection::ModelBinding::Store.new(workflow['model']).read
          current && current.to_h == workflow['binding'].to_h
        end

        def report_design_workflow_progress(dialog, kind, done, total, detail)
          text = detail || "Validando diseño… #{done} de #{total}"
          if kind == 'validate'
            execute_bridge(dialog, 'onDesignValidationProgress',
                           { 'done' => done, 'total' => total, 'detail' => text })
          else
            execute_bridge(dialog, 'onPublishProgress',
                           { 'step' => 'validating', 'detail' => text })
          end
        end

        def batch_start_failure(outcome)
          scope_reason = 'no se pudo confirmar el alcance de publicación del diseño'
          reasons = {
            'busy' => ['action_in_progress', 'hay una validación del diseño en curso'],
            Host::DesignPreflightBatch::UNBOUND => ['unbound', 'conectá este modelo a un proyecto y diseño primero'],
            Host::DesignPreflightBatch::SCOPE_UNAVAILABLE => ['preflight_incomplete', scope_reason]
          }
          code, reason = reasons.fetch(outcome['code'], ['error', 'no se pudo iniciar la validación del diseño'])
          { 'ok' => false, 'code' => code, 'reason' => reason }
        end

        # #731 exceptions-only projection. Counts come from the gate/scope
        # denominator; cards exist ONLY for furniture requiring attention
        # (blocked/stale/unverified/unavailable or hard reconciliation
        # states). displayNames come from the HostReconciliation authority;
        # issue detail from the stored authoritative review — never from
        # names or geometry.
        def publication_validation_projection(gate, host, extra_blockers)
          scope_items = publication_workflow_scope_items
          gate ||= publication_gate_projection
          host_items = host.is_a?(Hash) && host['state'] == 'connected' ? host['items'].to_a : []
          by_id = host_items.to_h { |item| [item['id'], item] }

          # Hard host blockers first: their reconciliation state and reason
          # are more specific than a generic unverified scope entry.
          seen = {}
          exceptions = host_blocker_exceptions(host_items, seen)
          exceptions.concat(scope_state_exceptions(scope_items, by_id, seen))
          exceptions.concat(new_extra_blockers(extra_blockers, seen))

          total = gate && gate['total'] ? gate['total'] : scope_items.length
          ready = gate && gate['verified'] ? gate['verified'] : 0
          { 'total' => total, 'ready' => ready, 'attention' => exceptions.length,
            'exceptions' => exceptions }
        end

        def host_blocker_exceptions(host_items, seen)
          host_items.filter_map do |item|
            next unless item['blocking']
            next if seen[item['id']]

            seen[item['id']] = true
            validation_exception_payload(item['id'], item['reconciliationState'],
                                         item, item['reason'])
          end
        end

        def scope_state_exceptions(scope_items, by_id, seen)
          scope_items.filter_map do |item|
            id = item['furnitureInstanceId']
            next if seen[id]

            state = scope_state_for(id)
            next if %w[ready warning].include?(state)

            seen[id] = true
            validation_exception_payload(id, state, by_id[id])
          end
        end

        def new_extra_blockers(extra_blockers, seen)
          extra_blockers.filter_map do |blocker|
            id = blocker['furnitureInstanceId']
            next if id && seen[id]

            seen[id] = true
            blocker.merge('review' => nil).compact
          end
        end

        def scope_state_for(furniture_instance_id)
          return Host::PublicationPreflightGate::UNVERIFIED unless @publication_gate

          @publication_gate.state_for_furniture(furniture_instance_id)
        end

        def validation_exception_payload(furniture_instance_id, state, host_item, reason = nil)
          review = nil
          if furniture_instance_id
            review = preflight_review_session.payload_for('furnitureInstanceId' => furniture_instance_id)
          end
          {
            'furnitureInstanceId' => furniture_instance_id,
            'displayName' => host_item && host_item['displayName'],
            'state' => state,
            'reason' => reason || (host_item && host_item['reason']) || (review && review['reason']),
            'review' => review
          }.compact
        end

        def publication_workflow_scope_items
          return [] unless @publication_scope_provider

          @publication_scope_provider.call || []
        rescue StandardError => e
          @logger.error('publication_workflow_scope_failed', error: e)
          []
        end

        # Lazy shared batch: the SAME scope provider, session, tracker and
        # event-loop deferral the unit review and publisher flows use.
        def design_preflight_batch
          @design_preflight_batch ||= Host::DesignPreflightBatch.new(
            scope_provider: -> { @publication_scope_provider&.call },
            preflight_session: preflight_review_session,
            model_provider: method(:active_model),
            binding_provider: ->(model) { Connection::ModelBinding::Store.new(model).read },
            scheduler: ->(&block) { host_event_loop_defer(&block) },
            on_progress: method(:handle_design_validation_progress),
            on_complete: method(:handle_design_validation_complete),
            logger: @logger
          )
        end

        def host_event_loop_defer(&block)
          if defined?(::UI) && ::UI.respond_to?(:start_timer)
            ::UI.start_timer(0, false, &block)
          else
            block.call
          end
        end

        # Honest Spanish reason for a blocked publication gate, in the same
        # priority the dialog renders (blocked > stale > unavailable >
        # unverified).
        def publish_gate_reason(gate)
          scope_unknown = 'no se pudo confirmar el alcance de publicación del diseño'
          return scope_unknown if gate.nil? || !gate['scopeAvailable']

          unless gate['hostAvailable'] && gate['hostClean']
            count = gate['hostAttention'].to_i
            return "hay #{count} muebles que requieren reconciliación con este archivo SketchUp" if count.positive?

            return 'no se pudo confirmar que este archivo SketchUp coincida con el diseño'
          end
          return 'hay muebles con problemas de fabricación' if gate['blocked'].to_i.positive?
          return 'la revisión de fabricación quedó desactualizada' if gate['stale'].to_i.positive?
          if gate['unavailable'].to_i.positive?
            return 'no se pudo confirmar el estado de fabricación de todos los muebles'
          end

          "faltan verificar #{gate['pending']} de #{gate['total']} muebles del diseño"
        end

        def project_furniture_placer
          @project_furniture_placer
        end

        def duplicate_resolver
          @duplicate_resolver
        end
      end

      # #498 / SU-HOST-1 shared host mutation bridge: every managed
      # authoring mutation from the dialog — the legacy update_furniture
      # command and the new versioned authoring_mutation channel — runs
      # through ONE Host::AuthoringMutationCoordinator. This bridge only
      # adapts dialog payloads into MutationCommand seams; correlation,
      # late-response rejection, one-operation atomicity, rollback, selection
      # restore and degraded semantics live in the coordinator so #466–#471
      # plug in without cloning any of it.
      # rubocop:disable-next Metrics/ModuleLength
      module HostMutationBridge
        def handle_authoring_mutation(dialog, payload_json)
          envelope = Host::CommandContract.parse_command!(payload_json)
          case envelope['mutation']
          when 'update_furniture'
            payload = envelope['payload'].merge(
              'instanceId' => envelope['semanticTarget']['furnitureInstanceRef'] ||
                              envelope['payload']['instanceId']
            )
            execute_coordinated_update(dialog, payload, semantic_target: envelope['semanticTarget'],
                                                        command_message_id: envelope['messageId'])
          when 'update_hardware_placement'
            execute_coordinated_hardware_update(dialog, envelope['payload'],
                                                semantic_target: envelope['semanticTarget'],
                                                command_message_id: envelope['messageId'])
          when 'substitute_hardware'
            execute_coordinated_hardware_substitution(dialog, envelope['payload'],
                                                      semantic_target: envelope['semanticTarget'],
                                                      command_message_id: envelope['messageId'])
          when *ComponentAuthoringBridge::COMPONENT_MUTATIONS
            execute_coordinated_component_mutation(dialog, envelope['payload'],
                                                   semantic_target: envelope['semanticTarget'],
                                                   command_message_id: envelope['messageId'],
                                                   mutation: envelope['mutation'])
          end
        rescue Host::CommandContract::ContractError => e
          @logger.error('authoring_mutation_contract_rejected', error: e)
          outcome = Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                              reason: e.message).with_mutation_name('authoring_mutation')
          push_mutation_outcome(dialog, outcome, in_reply_to: nil)
        end

        def execute_coordinated_update(dialog, payload, semantic_target: nil, command_message_id: nil)
          command = build_update_command(payload, semantic_target)
          overlay_mutation_started(command&.semantic_target || semantic_target)
          outcome = if command
                      mutation_coordinator.execute(command, command_message_id: command_message_id)
                    else
                      invalid_update_outcome(payload, semantic_target)
                    end
          legacy = legacy_update_payload(outcome)
          execute_bridge(dialog, 'onUpdateResult', legacy)
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          log_operation_result('furniture_updated', payload['definitionId'] || payload[:definitionId], legacy)
          outcome
        rescue StandardError => e
          @logger.error('furniture_update_failed', error: e)
          failure = { 'success' => false, 'error' => e.message }
          execute_bridge(dialog, 'onUpdateResult', failure)
          outcome = Host::MutationOutcome.new(outcome: 'aborted', category: 'host_apply_failure',
                                              reason: e.message,
                                              semantic_target: semantic_target || {})
                                         .with_mutation_name('update_furniture')
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        end

        def execute_coordinated_hardware_update(dialog, payload, semantic_target: nil, command_message_id: nil)
          command = build_hardware_update_command(payload, semantic_target)
          overlay_mutation_started(command&.semantic_target || semantic_target)
          outcome = if command
                      mutation_coordinator.execute(command, command_message_id: command_message_id)
                    else
                      invalid_hardware_update_outcome(payload, semantic_target)
                    end
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        rescue StandardError => e
          @logger.error('hardware_update_failed', error: e)
          outcome = Host::MutationOutcome.new(outcome: 'aborted', category: 'host_apply_failure',
                                              reason: e.message,
                                              semantic_target: semantic_target || {})
                                         .with_mutation_name('update_hardware_placement')
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        end

        def execute_coordinated_hardware_substitution(dialog, payload, semantic_target: nil, command_message_id: nil)
          command = build_hardware_substitution_command(payload, semantic_target)
          overlay_mutation_started(command&.semantic_target || semantic_target)
          outcome = if command
                      mutation_coordinator.execute(command, command_message_id: command_message_id)
                    else
                      invalid_hardware_substitution_outcome(payload, semantic_target)
                    end
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        rescue StandardError => e
          @logger.error('hardware_substitution_failed', error: e)
          outcome = Host::MutationOutcome.new(outcome: 'aborted', category: 'host_apply_failure',
                                              reason: e.message,
                                              semantic_target: semantic_target || {})
                                         .with_mutation_name('substitute_hardware')
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        end

        private

        # Command adapter for the furniture update flow. The full #477
        # authoring snapshot capture arrives with #467/#468; today the
        # authoritative resolve rides the server layout channel (nil layout
        # under offline catalogs stays an explicit generic preview).
        # rubocop:disable-next Metrics/AbcSize
        def build_update_command(payload, semantic_target)
          definition_id = payload['definitionId'] || payload[:definitionId]
          definition = @catalog_provider.find_definition(definition_id)
          return nil if definition.nil?

          target = update_semantic_target(payload, semantic_target)
          entity = if target['furnitureInstanceId'] || target['furnitureInstanceRef']
                     find_target_furniture_entity(target['furnitureInstanceRef'])
                   else
                     find_target_furniture_entity(nil)
                   end
          # Selection-first flows still capture an explicit semantic target:
          # the captured entity's own identity, never `selection.first` as
          # lasting truth.
          if entity && target['furnitureInstanceRef'].nil?
            identity = @metadata_store_factory.call(active_model).read(entity)&.dig('identity')
            target['furnitureInstanceRef'] = identity && identity['instanceRef']
          end
          return nil if entity.nil? || active_model.nil? ||
                        Host::CommandContract.semantic_target_key(target).empty?

          params = payload['parameters'] || payload[:parameters] || {}
          choices = merged_material_choices(entity, payload)
          Host::MutationCommand.new(
            name: 'update_furniture',
            operation_name: "Editar Mueble #{definition['name']}",
            semantic_target: target,
            build_furniture_request: nil,
            resolve: ->(ctx) { resolve_update_result(definition, params, choices, ctx) },
            context_valid: -> { update_context_valid?(entity, target) },
            apply: lambda { |result, host_context|
              apply_update_result(host_context, entity, definition, params, choices, result)
            }
          )
        end

        def update_semantic_target(payload, semantic_target)
          base = semantic_target || {}
          ref = base['furnitureInstanceRef'] || payload['instanceId'] || payload[:instanceId]
          target = base.dup
          target['furnitureInstanceRef'] = ref.to_s if ref && !base.key?('furnitureInstanceRef')
          target.reject { |_key, value| value.to_s.strip.empty? }
        end

        def resolve_update_result(definition, params, choices, request_context)
          layout = resolve_layout_for(definition, params, choices)
          Host::LayoutResolveResult.new(
            layout: layout,
            message_id: request_context[:message_id],
            idempotency_key: request_context[:idempotency_key],
            resolve_kind: layout ? 'native_layout' : 'generic_preview'
          )
        end

        def apply_update_result(_host_context, entity, definition, params, choices, result)
          model = entity.respond_to?(:model) && entity.model ? entity.model : active_model
          relationships = result.normalized_snapshot.is_a?(Hash) ? result.normalized_snapshot['relationships'] : nil
          # The server-normalized echo is the authoritative parameter intent
          # (defaults filled, quantity bindings consistent, #467): persisting
          # it keeps the next full-snapshot echo self-consistent.
          normalized_params = if result.normalized_snapshot.is_a?(Hash) &&
                                 result.normalized_snapshot['parameters'].is_a?(Hash)
                                result.normalized_snapshot['parameters']
                              else
                                params
                              end
          outcome = furniture_builder_for(model).update_furniture(
            model, entity, definition, normalized_params,
            resolved_layout: result.layout, material_choices: choices,
            transaction: false, relationships: relationships
          )
          return outcome if outcome['success'] == true

          error = outcome['error'].to_s
          if [Model::FurnitureBuilder::LEGACY_REPRESENTATION_ERROR,
              Model::FurnitureBuilder::MATERIAL_RESOLUTION_REQUIRED_ERROR].include?(error)
            raise Host::MutationCommand::ApplyRefused, error
          end

          raise Host::MutationCommand::ApplyFailed, error
        end

        # Wrong-selection guard: the response may only apply while the exact
        # captured furniture still carries the same semantic identity.
        def update_context_valid?(entity, target)
          return false unless entity&.valid?

          metadata = @metadata_store_factory.call(active_model).read(entity)
          identity = metadata && metadata['identity']
          expected = if target['furnitureInstanceId']
                       identity && identity['furnitureInstanceId']
                     else
                       identity && identity['instanceRef']
                     end
          expected == (target['furnitureInstanceId'] || target['furnitureInstanceRef'])
        rescue JSON::ParserError, Metadata::InvalidMetadataError
          false
        end

        def invalid_update_outcome(payload, semantic_target)
          definition_id = payload['definitionId'] || payload[:definitionId]
          reason = if @catalog_provider.find_definition(definition_id).nil?
                     'Definición no encontrada'
                   else
                     'Instancia no encontrada en el modelo'
                   end
          Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                    reason: reason, semantic_target: semantic_target || {})
                               .with_mutation_name('update_furniture')
        end

        def invalid_hardware_update_outcome(_payload, semantic_target)
          Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                    reason: 'Colocación de herraje o mueble no encontrado',
                                    semantic_target: semantic_target || {})
                               .with_mutation_name('update_hardware_placement')
        end

        def invalid_hardware_substitution_outcome(_payload, semantic_target)
          Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                    reason: 'Colocación de herraje o mueble no encontrado',
                                    semantic_target: semantic_target || {})
                               .with_mutation_name('substitute_hardware')
        end

        # rubocop:disable Metrics/AbcSize
        def build_hardware_update_command(payload, semantic_target)
          target = update_semantic_target(payload, semantic_target)
          hw_placement_id = target['hardwarePlacementId']
          return nil if hw_placement_id.to_s.strip.empty?

          entity = find_target_furniture_entity(target['furnitureInstanceRef'] || target['furnitureInstanceId'])
          return nil if entity.nil? || active_model.nil?

          store = @metadata_store_factory.call(active_model)
          furniture_meta = store.read(entity)
          definition_id = payload['definitionId'] ||
                          furniture_meta&.dig('intent', 'furnitureDefinitionId') ||
                          furniture_meta&.dig('identity', 'furnitureDefinitionId') ||
                          furniture_meta&.dig('definition', 'furniture_definition_id')
          definition = @catalog_provider.find_definition(definition_id)
          return nil if definition.nil?

          params = furniture_meta&.dig('intent', 'parameters') || {}
          choices = merged_material_choices(entity, furniture_meta)
          new_offset = payload['offsetMm']

          Host::MutationCommand.new(
            name: 'update_hardware_placement',
            operation_name: "Editar Colocación de Herraje #{hw_placement_id}",
            semantic_target: target,
            build_furniture_request: nil,
            resolve: lambda { |ctx|
              resolve_hardware_mutation(entity, definition, params, choices, target,
                                        ctx: ctx, new_offset: new_offset)
            },
            context_valid: -> { update_context_valid?(entity, target) },
            apply: lambda { |result, host_context|
              apply_update_result(host_context, entity, definition, params, choices, result)
            }
          )
        end

        def build_hardware_substitution_command(payload, semantic_target)
          target = update_semantic_target(payload, semantic_target)
          hw_placement_id = target['hardwarePlacementId']
          return nil if hw_placement_id.to_s.strip.empty?

          entity = find_target_furniture_entity(target['furnitureInstanceRef'] || target['furnitureInstanceId'])
          return nil if entity.nil? || active_model.nil?

          store = @metadata_store_factory.call(active_model)
          furniture_meta = store.read(entity)
          definition_id = payload['definitionId'] ||
                          furniture_meta&.dig('intent', 'furnitureDefinitionId') ||
                          furniture_meta&.dig('identity', 'furnitureDefinitionId') ||
                          furniture_meta&.dig('definition', 'furniture_definition_id')
          definition = @catalog_provider.find_definition(definition_id)
          return nil if definition.nil?

          params = furniture_meta&.dig('intent', 'parameters') || {}
          choices = merged_material_choices(entity, furniture_meta)
          target_hw_id = payload['targetHardwareDefinitionId'] || payload['hardwareDefinitionId']

          Host::MutationCommand.new(
            name: 'substitute_hardware',
            operation_name: "Sustituir Herraje #{hw_placement_id}",
            semantic_target: target,
            build_furniture_request: nil,
            resolve: lambda { |ctx|
              resolve_hardware_mutation(entity, definition, params, choices, target,
                                        ctx: ctx, target_hardware_id: target_hw_id)
            },
            context_valid: -> { update_context_valid?(entity, target) },
            apply: lambda { |result, host_context|
              apply_update_result(host_context, entity, definition, params, choices, result)
            }
          )
        end
        # rubocop:enable Metrics/AbcSize

        def guard_against_derived_hardware_edit!(entity, target)
          store = @metadata_store_factory.call(active_model)
          child = Host::SelectionRestore.new(metadata_store_factory: @metadata_store_factory,
                                             model_provider: -> { active_model }).send(:locate_child, entity, target)
          hw_meta = child ? store.read(child) : nil
          hw_intent = hw_meta&.dig('intent') || {}
          hw_kind = hw_intent['placementKind'] || target['placementKind']

          return unless hw_kind == 'derived'

          issue = Library::AuthoringResolveIssue.new(
            'code' => 'HARDWARE_DERIVED_EDIT',
            'message' => 'Los herrajes derivados se calculan por regla de ingeniería y no admiten edición manual',
            'severity' => 'error'
          )
          raise Library::AuthoringResolveError.new(issue.message, issues: [issue])
        end

        def layout_components(layout)
          layout.boards.map do |b|
            {
              'componentInstanceId' => b.component_instance_id,
              'componentDefinitionId' => b.component_definition_id,
              'role' => b.role
            }
          end
        end

        def current_catalog_revision
          if @catalog_provider.respond_to?(:catalog_revision) && @catalog_provider.catalog_revision
            @catalog_provider.catalog_revision
          else
            'workshop-current'
          end
        end

        def persisted_furniture_relationships(entity)
          store = @metadata_store_factory.call(active_model)
          furniture_meta = store.read(entity)
          furniture_meta.is_a?(Hash) ? furniture_meta['relationships'] : nil
        end

        def build_hardware_mutation_request(definition, params, choices, base_layout,
                                            hardware_placements, relationships, components: nil)
          req = {
            'furnitureDefinitionId' => definition['furniture_definition_id'] || definition['id'],
            'catalogRevision' => current_catalog_revision,
            'parameters' => params || {},
            'materialChoices' => choices || {},
            'components' => components || layout_components(base_layout),
            'hardwarePlacements' => hardware_placements
          }
          req['relationships'] = relationships if relationships.is_a?(Array) && !relationships.empty?
          req
        end

        def resolve_hardware_mutation(entity, definition, params, choices, target,
                                      ctx:, new_offset: nil, target_hardware_id: nil)
          guard_against_derived_hardware_edit!(entity, target)

          base_layout = resolve_layout_for(definition, params, choices)
          raise Library::AuthoringResolveError, 'No se pudo resolver el layout del mueble' if base_layout.nil?

          relationships = persisted_furniture_relationships(entity)
          hardware_placements = build_hardware_authoring_intents(
            base_layout, target['hardwarePlacementId'], new_offset, target_hardware_id
          )
          furniture_req = build_hardware_mutation_request(
            definition, params, choices, base_layout, hardware_placements, relationships
          )

          req_payload = Library::AuthoringResolveRequest.build_request(
            message_id: ctx[:message_id] || "msg-#{SecureRandom.hex(4)}",
            idempotency_key: ctx[:idempotency_key] || "idemp-#{SecureRandom.hex(4)}",
            furniture: furniture_req
          )

          result = @catalog_provider.resolve_authoring(req_payload) if @catalog_provider.respond_to?(:resolve_authoring)
          if result.nil?
            raise Library::AuthoringResolveError, 'No se pudo resolver la autoría en el servidor autoritativo'
          end

          result
        end

        def next_hardware_offset(placement, new_offset)
          return placement.offset_mm || [0.0, 0.0] if new_offset.nil?
          return [new_offset[0].to_f, (new_offset[1] || new_offset[0]).to_f] if new_offset.is_a?(Array)

          base_x = placement.offset_mm ? placement.offset_mm[0].to_f : 0.0
          [base_x, new_offset.to_f]
        end

        def build_hardware_authoring_intents(base_layout, target_placement_id, new_offset, target_hardware_id)
          base_layout.hardware.filter_map do |hp|
            is_target = hp.placement_id == target_placement_id
            next if hp.placement_kind == 'derived' && !is_target

            next_hw_id = is_target && target_hardware_id ? target_hardware_id : hp.hardware_id
            offset = is_target ? next_hardware_offset(hp, new_offset) : (hp.offset_mm || [0.0, 0.0])
            {
              'hardwarePlacementId' => hp.placement_id,
              'placementKind' => hp.placement_kind || 'manual',
              'catalogHardwareId' => next_hw_id,
              'hostComponentInstanceId' => hp.host_component_instance_id,
              'anchorFace' => hp.anchor_face || 'front',
              'offsetMm' => offset
            }
          end
        end

        # Legacy onUpdateResult shape so the existing inspector UX keeps
        # working; the versioned truth rides onMutationState.
        def legacy_update_payload(outcome)
          result = outcome.result if outcome.committed?
          return result if result.is_a?(Hash) && result['success'] == true

          payload = { 'success' => false, 'error' => outcome.reason || 'No se pudo actualizar el mueble' }
          issues = outcome.issues.to_a.map do |issue|
            { 'code' => issue.code, 'message' => issue.message,
              'severity' => issue.respond_to?(:severity) ? issue.severity : nil,
              'path' => issue.respond_to?(:path) ? issue.path : nil }.compact
          end
          payload['issues'] = issues unless issues.empty?
          payload
        end

        def push_mutation_outcome(dialog, outcome, in_reply_to:)
          mark_commercial_projection_local_work if outcome.committed?
          execute_bridge(dialog, 'onMutationState', outcome.to_envelope(in_reply_to: in_reply_to))
          if outcome.committed? && mutation_coordinator.preflight_tracker
            # #466: the post-mutation invalidation push carries entries AND
            # the review of the owning furniture, so the review panel shows
            # the honest stale state instead of the pre-mutation verdict.
            scope = Host::CommandContract.furniture_scope(outcome.semantic_target)
            review = preflight_review_session.reviews[
              Host::CommandContract.semantic_target_key(scope)
            ]
            execute_bridge(dialog, 'onPreflightState',
                           Host::CommandContract.preflight_state_envelope(
                             mutation_coordinator.preflight_tracker.payload,
                             review: review && preflight_review_session.payload_for(scope),
                             publication_gate: publication_gate_projection
                           ))
          end
          # #470: a manufacturing-affecting mutation refreshes the overlay
          # from the NEW accepted fingerprint or leaves it honestly stale.
          overlay_mutation_outcome(outcome)
          push_manufacturing_state(dialog) if @manufacturing_overlay&.mode_on?
          refresh_project_furniture if outcome.committed? && @project_furniture_placer
        end

        # Honest dialog-level degraded state derived from catalog/session
        # provenance (#498 minimum; #474 owns the full offline product).
        def push_degraded_state(dialog)
          return unless @catalog_provider.respond_to?(:last_source)

          state = Host::DegradedState.for_catalog_source(@catalog_provider.last_source)
          execute_bridge(dialog, 'onDegradedState', Host::CommandContract.degraded_state_envelope(state))
        rescue StandardError => e
          @logger.error('dialog_degraded_state_failed', error: e)
        end
      end

      # Insert/update callback handlers, extracted to keep DialogController
      # within its class-length budget. Both resolve the furniture's real
      # composition server-side before touching the model.
      module FurnitureBridge
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
          execute_coordinated_update(dialog, payload, command_message_id: payload['messageId'])
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
        def handle_host_model_event(event, model)
          return unless model.equal?(active_model)

          rebind_model(model) if event == :model_changed && @dialog&.visible?
          push_host_save_awareness(@dialog) if @dialog&.visible?
          refresh_binding_status if event == :saved && @dialog&.visible?
          refresh_project_furniture if event == :saved
        rescue StandardError => e
          @logger.error('host_model_event_failed', error: e)
        end

        def push_host_save_awareness(dialog)
          return unless @save_awareness && dialog&.visible?

          execute_bridge(dialog, 'onHostSaveAwareness', @save_awareness.projection(active_model))
        end

        def handle_selection_change(context)
          return unless @dialog&.visible?

          payload = context.respond_to?(:to_payload) ? context.to_payload : context
          execute_bridge(@dialog, 'onSelectionChange', payload)
          # #470: a live inspection overlay follows the selection — a part
          # change re-scopes it, an unmanaged selection clears it honestly.
          rescope_overlay_from_selection(payload)
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
          attach_model_observers(@observed_model)
          attach_app_observer
        end

        def detach_selection_observer
          detach_model_observers(@observed_model)
          @observed_model = nil
          detach_app_observer
        end

        def rebind_model(new_model)
          return if @observed_model.equal?(new_model)

          detach_model_observers(@observed_model)
          @observed_model = new_model
          attach_model_observers(@observed_model)
          @builder_model = nil
          check_current_selection(@dialog) if @dialog&.visible?
          refresh_binding_status
          # The Project Furniture panel follows the binding of whichever
          # model is active (#389): switching documents refreshes its rows.
          refresh_project_furniture
          offer_migration_if_legacy(new_model)
          @duplicate_resolver&.rescan_and_resolve(new_model)
        end

        def attach_model_observers(target_model)
          return unless target_model

          target_model.selection&.add_observer(@selection_observer)
          target_model.entities&.add_observer(@entities_observer) if @entities_observer
          @position_sync_coordinator&.rebind(target_model)
        end

        def detach_model_observers(target_model)
          return unless target_model

          target_model.selection&.remove_observer(@selection_observer)
          target_model.entities&.remove_observer(@entities_observer) if @entities_observer
          @position_sync_coordinator&.detach
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

      # Read-only manufacturing inspection bridge (#470 / SU-VIS-1): the
      # `Ver fabricación` mode. Commands arrive through the versioned
      # inspection channel (CommandContract manufacturing_command) and state
      # leaves through manufacturing_state envelopes. The overlay itself is
      # view state only — no operation, no entity, no metadata write — and
      # its only machining truth is the accepted authoring resolve.
      # rubocop:disable-next Metrics/ModuleLength
      module ManufacturingInspectionBridge
        # Lazy, injectable overlay manager: built on first inspection use so
        # sessions that never inspect pay nothing.
        def manufacturing_overlay
          @manufacturing_overlay ||= Overlay::Manager.new(
            resolver: Overlay::InspectionResolver.new(
              catalog_provider: @catalog_provider,
              metadata_store_factory: @metadata_store_factory,
              logger: @logger
            ),
            locator: Overlay::EntityLocator.new(
              metadata_store_factory: @metadata_store_factory,
              model_provider: method(:active_model)
            ),
            model_provider: method(:active_model),
            preflight_tracker: mutation_coordinator.preflight_tracker,
            logger: @logger,
            on_state_change: ->(_payload) { push_manufacturing_state(@dialog) if @dialog&.visible? },
            on_viewport_selection: ->(entity) { handle_viewport_selection(entity) }
          )
        end

        def handle_manufacturing_inspection(dialog, payload_json)
          envelope = Host::CommandContract.parse_manufacturing_command!(payload_json)
          case envelope['command']
          when 'set_mode'
            apply_inspection_mode(envelope)
          when 'select_feature'
            manufacturing_overlay.select_feature(envelope['payload']['visualId'].to_s)
          when 'set_filter'
            manufacturing_overlay.set_filter(envelope['payload']['filter'].to_s)
          when 'refresh'
            manufacturing_overlay.refresh
          when 'navigate_to_source'
            navigate_inspection_source(envelope)
          end
          push_manufacturing_state(dialog)
        rescue Host::CommandContract::ContractError => e
          @logger.error('manufacturing_inspection_contract_rejected', error: e)
          push_manufacturing_state(dialog)
        rescue StandardError => e
          @logger.error('manufacturing_inspection_failed', error: e)
          push_manufacturing_state(dialog)
        end

        def push_manufacturing_state(dialog)
          overlay = @manufacturing_overlay
          return unless overlay && dialog&.visible?

          execute_bridge(dialog, 'onManufacturingState',
                         Host::CommandContract.manufacturing_state_envelope(
                           message_id: Host::CommandContract.next_outcome_message_id,
                           state: overlay.to_payload
                         ))
        rescue StandardError => e
          @logger.error('manufacturing_state_push_failed', error: e)
        end

        private

        def apply_inspection_mode(envelope)
          if envelope['payload']['mode'] == 'on'
            manufacturing_overlay.enable(envelope['semanticTarget'])
          else
            manufacturing_overlay.disable
          end
        end

        def navigate_inspection_source(envelope)
          overlay = manufacturing_overlay
          snapshot = overlay.snapshot
          feature = snapshot&.feature_by_visual_id(envelope['payload']['visualId'].to_s)
          return if feature.nil?

          navigation = Overlay::ProvenanceNavigation.new(
            locator: Overlay::EntityLocator.new(
              metadata_store_factory: @metadata_store_factory,
              model_provider: method(:active_model)
            ),
            model_provider: method(:active_model)
          ).navigate_to_source(feature, snapshot)
          @logger&.info('manufacturing_provenance_navigation',
                        source_kind: feature.source_kind, located: !navigation.nil?)
          navigation
        end

        # Viewport pick fell through to a model entity: resolve its semantic
        # context and run the normal selection flow (dialog update + overlay
        # re-scope) — identical to clicking it in the model.
        def handle_viewport_selection(entity)
          model = active_model
          return unless model

          context = @selection_observer.resolve(entity, selection: model.selection)
          handle_selection_change(context)
        end

        # Selection changed: re-scope the active overlay to the managed
        # part/furniture context, or clear it honestly for unmanaged
        # selections (#470 §44/#45).
        def rescope_overlay_from_selection(payload)
          overlay = @manufacturing_overlay
          return unless overlay&.mode_on?

          overlay.rescope(scope_of_selection(payload))
        end

        def scope_of_selection(payload)
          return {} unless payload.is_a?(Hash)

          scope = {}
          scope['furnitureInstanceId'] = payload['furnitureInstanceId'] if payload['furnitureInstanceId']
          scope['furnitureInstanceRef'] = payload['furnitureInstanceRef'] if payload['furnitureInstanceRef']
          scope['componentInstanceId'] = payload['componentInstanceId'] if payload['componentInstanceId']
          scope
        end

        def overlay_mutation_started(semantic_target)
          overlay = @manufacturing_overlay
          return unless overlay&.mode_on?

          overlay.mutation_started(semantic_target || {})
        end

        def overlay_mutation_outcome(outcome)
          overlay = @manufacturing_overlay
          return unless overlay&.mode_on?

          overlay.handle_mutation_outcome(outcome)
        end
      end

      # #466 / SU-UX-1 authoritative preflight review bridge: `Verificar
      # fabricación` runs the SAME #477 authoring resolve as the mutation and
      # inspection flows (never a local validation), projects the resolve's
      # preflight subset into a review (grouped issues, Spanish remediation)
      # and navigates each issue to its exact managed context in the
      # viewport. Commands arrive through the versioned preflight_command
      # channel; state leaves through preflight_state envelopes (entries +
      # review). Read-only: no coordinator, no SketchUp operation, no
      # metadata write. Orchestration lives in Host::PreflightReviewSession.
      module PreflightReviewBridge
        def handle_preflight_review(dialog, payload_json)
          envelope = Host::CommandContract.parse_preflight_command!(payload_json)
          case envelope['command']
          when 'run'
            preflight_review_session.run(review_scope(envelope), message_id: envelope['messageId'])
          when 'navigate_issue'
            preflight_review_session.navigate(review_scope(envelope),
                                              issue_id: envelope['payload']['issueId'],
                                              target: envelope['payload']['target'])
          end
          push_preflight_state(dialog, review_scope(envelope))
        rescue Host::CommandContract::ContractError => e
          @logger.error('preflight_review_contract_rejected', error: e)
          push_preflight_state(dialog)
        rescue StandardError => e
          @logger.error('preflight_review_failed', error: e)
          push_preflight_state(dialog)
        end

        # Pushes tracker entries plus the review of the scope (or the most
        # recent one) with its honest effective status, and the design-wide
        # publication gate projection (#466) composed Ruby-side — JS never
        # rebuilds the #392 publication scope.
        def push_preflight_state(dialog, scope_or_key = nil)
          return unless dialog&.visible?

          session = preflight_review_session
          payload = scope_or_key && session.payload_for(scope_or_key)
          payload ||= session.reviews.values.last&.then do |review|
            session.payload_for(review.target_key)
          end
          execute_bridge(dialog, 'onPreflightState',
                         Host::CommandContract.preflight_state_envelope(
                           mutation_coordinator.preflight_tracker.payload,
                           review: payload,
                           publication_gate: publication_gate_projection
                         ))
        rescue StandardError => e
          @logger.error('preflight_state_push_failed', error: e)
        end

        private

        # Design-wide publish gate projection (#466). nil when no gate is
        # wired or its evaluation fails — the dialog then stays fail-closed.
        def publication_gate_projection
          return nil unless @publication_gate

          @publication_gate.projection
        rescue StandardError => e
          @logger.error('publication_gate_projection_failed', error: e)
          nil
        end

        # Lazy shared session: same resolver/locator seams as #470, one
        # tracker, one review store per dialog controller.
        def preflight_review_session
          @preflight_review_session ||= Host::PreflightReviewSession.new(
            tracker: mutation_coordinator.preflight_tracker,
            resolver: Overlay::InspectionResolver.new(
              catalog_provider: @catalog_provider,
              metadata_store_factory: @metadata_store_factory,
              logger: @logger
            ),
            locator: Overlay::EntityLocator.new(
              metadata_store_factory: @metadata_store_factory,
              model_provider: method(:active_model)
            ),
            model_provider: method(:active_model),
            logger: @logger
          ).tap do |session|
            if @position_sync_coordinator.respond_to?(:preflight_session=)
              @position_sync_coordinator.preflight_session = session
            end
          end
        end

        def review_scope(envelope)
          Host::CommandContract.furniture_scope(envelope['semanticTarget'])
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

      # HardwareMountBridge coordinates the MountFramePreparerController from DialogController.
      module HardwareMountBridge
        def handle_prepare_hardware_mount(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          asset_id = payload['assetId'] || payload['hardwareAssetId']
          unless asset_id
            @logger.warn('prepare_hardware_mount_missing_asset_id')
            return
          end

          source_rev_id = payload['sourceRevisionId'] || payload['revisionId']
          expected_spacing = payload['expectedHoleSpacingMm'] || payload['holeSpacingMm']
          nominal_dims = payload['nominalDimensions']

          mount_frame_preparer_controller.start_preparation(
            asset_id: asset_id,
            source_revision_id: source_rev_id,
            expected_hole_spacing_mm: expected_spacing&.to_f,
            nominal_dimensions: nominal_dims,
            on_saved: lambda do |new_rev|
              @logger.info('hardware_mount_prepared_success', asset_id: asset_id, revision: new_rev['revision_number'])
              execute_bridge(dialog, 'onHardwareMountPrepared', new_rev)
            end
          )
        rescue StandardError => e
          @logger.error('prepare_hardware_mount_failed', error: e)
        end

        def mount_frame_preparer_controller
          @mount_frame_preparer_controller ||= begin
            transport = @session.respond_to?(:transport) ? @session.transport : nil
            downloader = Assets::HardwareAssetDownloader.new(
              transport: transport,
              auth_provider: @session,
              logger: @logger
            )
            validator = Assets::HardwareAssetValidator.new(logger: @logger)
            MountFramePreparerController.new(
              downloader: downloader,
              validator: validator,
              transport: transport,
              auth_provider: @session,
              logger: @logger
            )
          end
        end
      end

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
          dialog.add_action_callback('select_furniture') { |_c, p| handle_select_furniture(p) }
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
        end

        # #467/#498 authoring channels: the versioned mutation bridge plus
        # the constrained viewport gesture activation.
        def register_authoring_callbacks(dialog)
          dialog.add_action_callback('authoring_mutation') { |_c, p| handle_authoring_mutation(dialog, p) }
          dialog.add_action_callback('component_viewport_move') { |_c, p| handle_component_viewport_move(dialog, p) }
        end

        def handle_dialog_ready(dialog)
          update_status(dialog)
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
          payload = if raw_payload.is_a?(String) && !raw_payload.strip.empty?
                      JSON.parse(raw_payload)
                    else
                      raw_payload || {}
                    end
          instance_id = payload['instanceId'] || payload[:instanceId]

          deleted = false
          target = find_target_furniture_entity(instance_id)
          if target && active_model
            store = @metadata_store_factory.call(active_model)
            meta = store.read(target)
            if meta && meta['identity']
              active_model.start_operation('Eliminar Mueble', true)
              active_model.active_entities.erase_entities([target])
              active_model.commit_operation
              deleted = true
              @logger.info('furniture_deleted', instance_id: instance_id || meta.dig('identity', 'instanceRef'))
            else
              @logger.warn('furniture_delete_rejected_no_metadata', target_class: target.class.name)
            end
          else
            @logger.warn('furniture_delete_target_not_found', instance_id: instance_id)
          end

          execute_bridge(dialog, 'onSelectionChange', nil)
          refresh_after_local_delete(dialog) if deleted
        rescue StandardError => e
          @logger.error('furniture_delete_failed', error: e)
          execute_bridge(dialog, 'onSelectionChange', nil)
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
