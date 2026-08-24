# frozen_string_literal: true

module Granete
  module SketchUpExtension
    class Application
      attr_reader :auth_provider, :transport

      def initialize(
        transport: Transport::NullAdapter.new,
        auth_provider: Auth::NullProvider.new,
        logger: SafeLogger.new
      )
        @transport = transport
        @auth_provider = auth_provider
        @logger = logger
        @dialog = UserInterface::DialogController.new(
          logger: logger,
          status_provider: method(:connection_status)
        )
        @lifecycle = Lifecycle.new(
          open_dialog: method(:open_dialog),
          close_dialog: method(:close_dialog),
          logger: logger
        )
      end

      def start
        @lifecycle.start
        self
      end

      def shutdown
        @lifecycle.shutdown
      end

      def started?
        @lifecycle.started?
      end

      def open_dialog
        @dialog.show
      end

      def close_dialog
        @dialog.close
      end

      def metadata_store(model)
        Metadata::Store.new(model)
      end

      private

      def connection_status
        if transport.configured? && auth_provider.configured?
          {
            'state' => 'configured',
            'heading' => 'Conexión configurada',
            'message' => 'La conexión está configurada. Granete conserva la validación industrial.'
          }
        else
          {
            'state' => 'disabled',
            'heading' => 'Conexión no configurada',
            'message' => 'La conexión está desactivada. Configurá acceso y transporte ' \
                         'antes de enviar información.'
          }
        end
      end
    end
  end
end
