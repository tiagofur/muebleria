# frozen_string_literal: true

module Granete
  module SketchUpExtension
    class Application
      attr_reader :auth_provider, :transport, :session

      def initialize(
        transport: nil,
        auth_provider: nil,
        logger: SafeLogger.new,
        session_provider: nil,
        catalog_provider: nil
      )
        @logger = logger
        @session = session_provider || Auth::SessionProvider.new(logger: logger)
        @transport = transport || @session.transport
        @auth_provider = auth_provider || @session
        @dialog = UserInterface::DialogController.new(
          logger: logger,
          status_provider: method(:connection_status),
          metadata_store_factory: method(:metadata_store),
          catalog_provider: catalog_provider || Library::RemoteCatalogProvider.new(
            transport: @transport,
            auth_provider: @auth_provider,
            fallback_provider: Library::StaticCatalogProvider.new,
            logger: logger
          ),
          session: @session
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
        session_status = @session.respond_to?(:status) ? @session.status : nil
        if session_status && session_status['state'] == 'logged_in'
          license = session_status['license'] || {}
          {
            'state' => 'logged_in',
            'heading' => 'Sesión iniciada',
            'message' => "Biblioteca del taller conectada (#{license['plan'] || 'sin plan'}).",
            'server_url' => session_status['server_url'],
            'user' => session_status['user'],
            'license' => license
          }
        elsif transport.configured? && auth_provider.configured?
          {
            'state' => 'configured',
            'heading' => 'Conexión configurada',
            'message' => 'La conexión está configurada. Granete conserva la validación industrial.'
          }
        else
          {
            'state' => 'disabled',
            'heading' => 'Sin sesión iniciada',
            'message' => 'Iniciá sesión con tu cuenta del taller más abajo en esta ' \
                         'pestaña para cargar su biblioteca de muebles. Sin sesión, ' \
                         'la extensión funciona con el catálogo local de respaldo.'
          }
        end
      end
    end
  end
end
