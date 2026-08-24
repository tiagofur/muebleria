# frozen_string_literal: true

module Granete
  module SketchUpExtension
    class Lifecycle
      def initialize(open_dialog:, close_dialog:, logger:)
        @open_dialog = open_dialog
        @close_dialog = close_dialog
        @logger = logger
        @menu_registered = false
        @started = false
      end

      def start
        register_menu unless @menu_registered
        return self if @started

        @started = true
        @logger.info('extension_started')
        self
      end

      def shutdown
        return self unless @started

        @close_dialog.call
        @started = false
        @logger.info('extension_stopped')
        self
      end

      def started?
        @started
      end

      private

      def register_menu
        ::UI.menu('Extensions').add_item('Abrir Granete') { @open_dialog.call }
        @menu_registered = true
      end
    end

    # SketchUp does not stop already-loaded Ruby when an item is unchecked in
    # the Extension Manager. AppObserver#onUnloadExtension is the host
    # notification surface for user deactivation, so session cleanup hangs off
    # it instead of pretending uncheck is an unload.
    class AppLifecycleObserver
      include ::Sketchup::AppObserver

      attr_reader :extension_name, :extension_id

      def initialize(extension_name:, extension_id:, on_unload:)
        @extension_name = extension_name
        @extension_id = extension_id
        @on_unload = on_unload
      end

      def onUnloadExtension(extension_id)
        identifier = extension_id.to_s
        return unless [@extension_name, @extension_id].include?(identifier)

        @on_unload.call
      end
    end
  end
end
