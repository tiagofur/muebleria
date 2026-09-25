# frozen_string_literal: true

# Migración de representaciones legacy a nativas.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module MigrationBridge
        # Menu entry (Granete → Migrar modelos anteriores): always opens the
        # review so the user sees the current classification — even a clean
        # "0 detectados" is honest feedback, not an error.
        def handle_migration_review
          model = active_model
          return unless model

          scan = scan_legacy_model(model)
          show_migration_review(model, scan)
        end

        private

        # Non-blocking offer on model open/activate (#416): the dialog only
        # appears when the scan actually finds legacy furniture. After a
        # successful migration no Groups remain, so save/reopen stays quiet
        # without extra model-level state.
        def offer_migration_if_legacy(model)
          return unless model.respond_to?(:entities)

          scan = scan_legacy_model(model)
          return unless scan.any_legacy?
          return if migration_review_controller.open?

          show_migration_review(model, scan)
        rescue StandardError => e
          @logger.error('migration_offer_failed', error: e)
        end

        def show_migration_review(model, scan)
          migration_review_controller.show_review(
            scan_result: scan,
            on_migrate: -> { run_legacy_migration(model) }
          )
        end

        def migration_review_controller
          @migration_review_controller ||= MigrationReviewController.new(logger: @logger)
        end

        def scan_legacy_model(model)
          Migration::Scanner.new(metadata_store: @metadata_store_factory.call(model)).scan(model)
        end

        # Fresh scan inside the callback: the review snapshot shown to the
        # user may be outdated by the time they press the button.
        def run_legacy_migration(model)
          scan = scan_legacy_model(model)
          Migration::Migrator.new(
            metadata_store: @metadata_store_factory.call(model),
            furniture_builder: furniture_builder_for(model),
            catalog_provider: @catalog_provider
          ).migrate(model, scan)
        end
      end

      # HardwareMountBridge coordinates the MountFramePreparerController from DialogController.
    end
  end
end
