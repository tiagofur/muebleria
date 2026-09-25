# frozen_string_literal: true

# Bootstrap de proyecto/diseño inicial (#398): form de alta + conexión.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
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
    end
  end
end
