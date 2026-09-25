# frozen_string_literal: true

# Preparación de montaje de herrajes (#468).
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module HardwareMountBridge
        def handle_prepare_hardware_mount(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          asset_id = payload['assetId'] || payload['hardwareAssetId']
          unless asset_id
            @logger.warn('prepare_hardware_mount_missing_asset_id')
            return
          end

          source_rev_id = payload['sourceRevisionId'] || payload['revisionId']
          expected_spacing = payload['expectedHoleSpacingMm'] || payload['holeSpacingMm']
          nominal_dims = payload['nominalDimensions']

          mount_frame_preparer_controller.start_preparation(
            asset_id: asset_id,
            source_revision_id: source_rev_id,
            expected_hole_spacing_mm: expected_spacing&.to_f,
            nominal_dimensions: nominal_dims,
            on_saved: lambda do |new_rev|
              @logger.info('hardware_mount_prepared_success', asset_id: asset_id, revision: new_rev['revision_number'])
              execute_bridge(dialog, 'onHardwareMountPrepared', new_rev)
            end
          )
        rescue StandardError => e
          @logger.error('prepare_hardware_mount_failed', error: e)
        end

        def mount_frame_preparer_controller
          @mount_frame_preparer_controller ||= begin
            transport = @session.respond_to?(:transport) ? @session.transport : nil
            downloader = Assets::HardwareAssetDownloader.new(
              transport: transport,
              auth_provider: @session,
              logger: @logger
            )
            validator = Assets::HardwareAssetValidator.new(logger: @logger)
            MountFramePreparerController.new(
              downloader: downloader,
              validator: validator,
              transport: transport,
              auth_provider: @session,
              logger: @logger
            )
          end
        end
      end
    end
  end
end
