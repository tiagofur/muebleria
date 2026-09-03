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
        catalog_provider: nil,
        model_binding_connector: nil,
        project_furniture_placer: nil,
        duplicate_resolver: nil,
        entities_observer: nil
      )
        @logger = logger
        @session = session_provider || Auth::DeviceProvider.new(logger: logger)
        @transport = transport || @session.transport
        @auth_provider = auth_provider || @session
        @model_binding_connector = model_binding_connector || Connection::ModelBinding::Connector.new(
          store_factory: -> { Connection::ModelBinding::Store.new(active_model) },
          service: Connection::ModelBinding::Service.new(
            transport: @transport,
            auth_provider: @auth_provider,
            logger: logger
          ),
          logger: logger
        )
        resolved_catalog_provider = catalog_provider || Library::RemoteCatalogProvider.new(
          transport: @transport,
          auth_provider: @auth_provider,
          fallback_provider: Library::StaticCatalogProvider.new,
          logger: logger
        )
        @project_furniture_placer = project_furniture_placer || build_project_furniture_placer(
          resolved_catalog_provider
        )
        @duplicate_resolver = duplicate_resolver || Connection::DuplicateResolver.new(
          model_provider: method(:active_model),
          binding_store_factory: -> { Connection::ModelBinding::Store.new(active_model) },
          model_binding_service: @model_binding_connector.service,
          service: @project_furniture_placer.service,
          metadata_store_factory: method(:metadata_store),
          logger: @logger
        )
        @entities_observer = entities_observer || Observers::EntitiesObserver.new(
          duplicate_resolver: @duplicate_resolver,
          model_provider: method(:active_model)
        )
        @dialog = UserInterface::DialogController.new(
          logger: logger,
          status_provider: method(:connection_status),
          metadata_store_factory: method(:metadata_store),
          catalog_provider: resolved_catalog_provider,
          session: @session,
          model_binding_connector: @model_binding_connector,
          project_furniture_placer: @project_furniture_placer,
          duplicate_resolver: @duplicate_resolver,
          entities_observer: @entities_observer
        )
        @lifecycle = Lifecycle.new(
          open_dialog: method(:open_dialog),
          close_dialog: method(:close_dialog),
          migrate_models: method(:open_migration_review),
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

      # #416: menu entry for the legacy-model migration review.
      def open_migration_review
        @dialog.handle_migration_review
      end

      def close_dialog
        @dialog.close
      end

      def metadata_store(model)
        Metadata::Store.new(model)
      end

      # The model binding always resolves against whichever document is
      # active at call time, so switching models switches binding context.
      attr_reader :model_binding_connector, :duplicate_resolver, :entities_observer

      private

      # #389 / DT-5: Place existing project units. The placer reuses the
      # binding connector's service for base revalidation and the same
      # builder/metadata/catalog authorities as insertion — no parallel
      # resolution path.
      def build_project_furniture_placer(catalog_provider)
        texture_cache = Assets::TextureCache.new(transport: @transport, auth_provider: @auth_provider)
        Connection::ProjectFurniture::Placer.new(
          model_provider: method(:active_model),
          binding_store_factory: -> { Connection::ModelBinding::Store.new(active_model) },
          model_binding_service: @model_binding_connector.service,
          service: Connection::ProjectFurniture::Service.new(
            transport: @transport,
            auth_provider: @auth_provider,
            logger: @logger
          ),
          metadata_store_factory: method(:metadata_store),
          catalog_provider: catalog_provider,
          furniture_builder_factory: lambda { |model|
            Model::FurnitureBuilder.new(
              metadata_store: metadata_store(model),
              asset_loader: Assets::AssetLoader.new,
              texture_cache: texture_cache
            )
          },
          logger: @logger
        )
      end

      def active_model
        Sketchup.active_model if defined?(Sketchup) && Sketchup.respond_to?(:active_model)
      end

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
