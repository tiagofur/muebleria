# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Runtime
      module_function

      def start(application: nil)
        @application ||= application || Application.new
        @application.start
        register_host_observer
        @application
      end

      def shutdown
        unregister_host_observer
        @application&.shutdown
      end

      def application
        @application
      end

      def host_observer
        @host_observer
      end

      # Test seam only; the host owns the real lifecycle.
      def reset!
        unregister_host_observer
        @application = nil
      end

      def register_host_observer
        return @host_observer if @host_observer
        return nil unless ::Sketchup.respond_to?(:add_observer)

        @host_observer = AppLifecycleObserver.new(
          extension_name: EXTENSION_NAME,
          extension_id: EXTENSION_ID,
          on_unload: method(:shutdown)
        )
        ::Sketchup.add_observer(@host_observer)
        @host_observer
      end

      def unregister_host_observer
        return unless @host_observer

        ::Sketchup.remove_observer(@host_observer) if ::Sketchup.respond_to?(:remove_observer)
        @host_observer = nil
      end
    end
  end
end
