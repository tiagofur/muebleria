# frozen_string_literal: true

# Auth/enroll del panel: login por código, poll de vinculación, logout. Se incluye en DialogController.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
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
    end
  end
end
