# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module UserInterface
      # OptionSelectorController manages the dedicated, floating HtmlDialog
      # for browsing and selecting workshop material finishes with Miller columns.
      class OptionSelectorController
        attr_reader :dialog

        def initialize(logger: nil, resource_path: nil)
          @logger = logger
          @resource_path = resource_path || default_resource_path
          @dialog = nil
          @current_payload = nil
          @on_apply = nil
        end

        def show_selector(role:, role_name:, current_material_id:, allowed_materials:, categories:, media: nil,
                          media_refresher: nil, on_apply: nil)
          @current_payload = {
            'role' => role,
            'roleName' => role_name || role,
            'currentMaterialId' => current_material_id,
            'allowedMaterials' => allowed_materials || [],
            'categories' => categories || [],
            'media' => media
          }
          @on_apply = on_apply
          # #460 SEC-3: re-mints an expired media grant on demand. The webview
          # never holds the session credential — only short-lived signed URLs.
          @media_refresher = media_refresher

          if @dialog&.visible?
            @dialog.bring_to_front
            send_initial_payload(@dialog)
            return @dialog
          end

          @dialog = build_dialog
          @dialog.show
          @dialog.bring_to_front
          @dialog
        end

        def close
          @dialog&.close
          @dialog = nil
        end

        def open?
          @dialog&.visible? || false
        end

        private

        def default_resource_path
          directory = __dir__.dup
          directory.force_encoding('UTF-8')
          File.expand_path('../resources/material_selector.html', directory)
        end

        def build_dialog
          dialog = ::UI::HtmlDialog.new(
            dialog_title: 'Catálogo de Acabados — Granete',
            preferences_key: 'com.granete.sketchup_extension.material_selector',
            scrollable: false,
            resizable: true,
            width: 960,
            height: 620,
            min_width: 760,
            min_height: 500,
            style: ::UI::HtmlDialog::STYLE_DIALOG
          )
          dialog.set_file(@resource_path)
          bind_callbacks(dialog)
          dialog.set_on_closed do
            @dialog = nil
          end
          dialog
        end

        def bind_callbacks(dialog)
          dialog.add_action_callback('selector_ready') { handle_ready(dialog) }
          dialog.add_action_callback('apply_selection') { |_c, p| handle_apply(p) }
          dialog.add_action_callback('close_selector') { close }
          dialog.add_action_callback('refresh_media_url') { |_c, p| handle_refresh_media_url(dialog, p) }
        end

        def handle_refresh_media_url(dialog, filename)
          refresh = @media_refresher ? @media_refresher.call(filename.to_s) : nil
          return if refresh.nil?

          execute_bridge(dialog, 'updateMediaUrl', refresh)
        rescue StandardError => e
          @logger&.error('option_selector_media_refresh_failed', error: e)
        end

        def handle_ready(dialog)
          send_initial_payload(dialog)
          @logger&.info('option_selector_ready')
        end

        def send_initial_payload(dialog)
          return unless @current_payload

          execute_bridge(dialog, 'initOptionSelector', @current_payload)
        end

        def handle_apply(payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          role = payload['role'] || payload[:role]
          material_id = payload['materialId'] || payload[:materialId] || payload['material_id'] || payload[:material_id]
          scope = payload['scope'] || payload[:scope] || 'furniture'
          context = payload['context'] || payload[:context]

          if @on_apply
            if @on_apply.arity == 3
              @on_apply.call(role, material_id, scope)
            else
              @on_apply.call(role, material_id, scope, context)
            end
          end
          close
        rescue StandardError => e
          @logger&.error('option_selector_apply_failed', error: e)
        end

        def execute_bridge(dialog, function_name, payload)
          json = JSON.generate(payload)
          dialog.execute_script("window.#{function_name} && window.#{function_name}(#{json});")
        rescue StandardError => e
          @logger&.error('option_selector_bridge_error', function: function_name, error: e)
        end
      end
    end
  end
end
