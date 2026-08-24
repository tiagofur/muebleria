# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module UserInterface
      class DialogController
        def initialize(logger:, status_provider:)
          @logger = logger
          @status_provider = status_provider
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
            dialog_title: 'Granete for SketchUp',
            preferences_key: 'com.granete.sketchup_extension.dialog',
            scrollable: true,
            resizable: true,
            width: 460,
            height: 560,
            min_width: 360,
            min_height: 440,
            style: ::UI::HtmlDialog::STYLE_DIALOG
          )
          dialog.set_file(resource_path)
          bind_callbacks(dialog)
          dialog.set_on_closed { @dialog = nil if @dialog.equal?(dialog) }
          dialog
        end

        def bind_callbacks(dialog)
          dialog.add_action_callback('dialog_ready') do |_context|
            update_status(dialog)
            @logger.info('dialog_ready')
          end
          dialog.add_action_callback('close_dialog') { |_context| dialog.close }
        end

        def update_status(dialog)
          status = @status_provider.call
          script = "window.GraneteDialog.setStatus(#{JSON.generate(status)})"
          dialog.execute_script(script)
        rescue StandardError => e
          @logger.error('dialog_status_failed', error: e)
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
