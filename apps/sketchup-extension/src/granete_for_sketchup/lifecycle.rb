# frozen_string_literal: true

module Granete
  module SketchUpExtension
    class Lifecycle
      def initialize(open_dialog:, close_dialog:, logger:, migrate_models: nil)
        @open_dialog = open_dialog
        @close_dialog = close_dialog
        # #416: optional entry point for the legacy-model migration review.
        @migrate_models = migrate_models
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
        register_migration_menu
        register_toolbar
        @menu_registered = true
      end

      # Legacy Group → native migration review (#416). The entry is always
      # present; the review itself reports whatever the scan finds.
      def register_migration_menu
        return unless @migrate_models

        ::UI.menu('Extensions').add_item('Migrar modelos anteriores…') { @migrate_models.call }
      end

      # A toolbar button keeps the panel one click away: the Extensions menu
      # auto-nests items under a Granete submenu in SketchUp 2026, which users
      # routinely miss.
      def register_toolbar
        command = ::UI::Command.new('Abrir Granete') { @open_dialog.call }
        command.tooltip = 'Granete: biblioteca de muebles del taller'
        command.status_bar_text = 'Abre la biblioteca de muebles del taller'
        directory = __dir__.dup
        directory.force_encoding('UTF-8')
        icons = File.expand_path('resources/icons', directory)
        command.small_icon = File.join(icons, 'granete_16.png')
        command.large_icon = File.join(icons, 'granete_24.png')
        toolbar = ::UI::Toolbar.new('Granete')
        toolbar.add_item(command)
        toolbar.restore
      end
    end

    # SketchUp does not stop already-loaded Ruby when an item is unchecked in
    # the Extension Manager. AppObserver#onUnloadExtension is the host
    # notification surface for user deactivation, so session cleanup hangs off
    # it instead of pretending uncheck is an unload. The host API declares
    # AppObserver as a class: observers subclass it, including it raises
    # TypeError at load time.
    class AppLifecycleObserver < ::Sketchup::AppObserver
      attr_reader :extension_name, :extension_id

      def initialize(extension_name:, extension_id:, on_unload:)
        super()
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
