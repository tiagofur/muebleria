# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module UserInterface
      # MigrationReviewController manages the dedicated HtmlDialog that turns
      # the #416 legacy-entity scan into a product workflow: the user sees
      # counts and per-item state BEFORE any conversion, decides whether to
      # migrate the compatible batch, and receives an honest per-item report
      # afterwards (a batch with leftovers is never presented as total
      # success).
      class MigrationReviewController
        attr_reader :dialog

        def initialize(logger: nil, resource_path: nil)
          @logger = logger
          @resource_path = resource_path || default_resource_path
          @dialog = nil
          @on_migrate = nil
          @scan_payload = nil
        end

        # scan_result: Migration::ScanResult. on_migrate: proc returning the
        # Migrator report hash (the controller only renders it — it never
        # touches the model itself).
        def show_review(scan_result:, on_migrate: nil)
          @scan_payload = build_payload(scan_result)
          @on_migrate = on_migrate

          if @dialog&.visible?
            @dialog.bring_to_front
            send_scan(@dialog)
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
          File.expand_path('../resources/migration_review.html', directory)
        end

        def build_dialog
          dialog = ::UI::HtmlDialog.new(
            dialog_title: 'Migrar modelos anteriores — Granete',
            preferences_key: 'com.granete.sketchup_extension.migration_review',
            scrollable: true,
            resizable: true,
            width: 640,
            height: 520,
            min_width: 480,
            min_height: 380,
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
          dialog.add_action_callback('migration_ready') { handle_ready(dialog) }
          dialog.add_action_callback('migrate_compatible') { |_c, _p| handle_migrate }
          dialog.add_action_callback('close_migration') { close }
        end

        def handle_ready(dialog)
          send_scan(dialog)
          @logger&.info('migration_review_ready')
        end

        def send_scan(dialog)
          return unless @scan_payload

          execute_bridge(dialog, 'initMigrationReview', @scan_payload)
        end

        def handle_migrate
          report = @on_migrate&.call
          return unless report.is_a?(Hash)

          execute_bridge(@dialog, 'migrationResult', report)
          @logger&.info('migration_batch_finished',
                        migrated: report['migratedCount'], remaining: report['remainingLegacyCount'])
        rescue StandardError => e
          @logger&.error('migration_review_action_failed', error: e)
        end

        def build_payload(scan_result)
          counts = scan_result.counts
          {
            'counts' => counts,
            'ready' => items_payload(scan_result.ready, 'ready'),
            'requiresReview' => items_payload(scan_result.requires_review, 'requires_review'),
            'unsupported' => items_payload(scan_result.unsupported, 'unsupported')
          }
        end

        def items_payload(entities, state)
          entities.map do |item|
            {
              'name' => item.entity.respond_to?(:name) ? item.entity.name : nil,
              'instanceRef' => item.instance_ref,
              'definitionId' => item.furniture_definition_id,
              'state' => state,
              'reason' => item.reason,
              'detail' => item.metadata&.dig('error')
            }
          end
        end

        def execute_bridge(dialog, function_name, payload)
          json = JSON.generate(payload)
          dialog.execute_script("window.#{function_name} && window.#{function_name}(#{json});")
        rescue StandardError => e
          @logger&.error('migration_review_bridge_error', function: function_name, error: e)
        end
      end
    end
  end
end
