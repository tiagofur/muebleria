# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Assets
      # HardwareAssetValidator validates downloaded SKP hardware assets directly in the
      # SketchUp host and reports append-only validation evidence back to the Granete backend
      # (POST /api/hardware-assets/{assetId}/revisions/{revisionId}:validate).
      class HardwareAssetValidator
        VALIDATOR_TOOL = 'sketchup-validator-v1'

        def initialize(downloader:, transport: nil, auth_provider: nil, logger: nil)
          @downloader = downloader
          @transport = transport
          @auth_provider = auth_provider
          @logger = logger
        end

        def validate_revision(asset_id:, revision_id:, sha256:, expected_bytes: nil, org_id: nil, model: nil)
          skp_path = @downloader.download_asset(
            asset_id: asset_id, revision_id: revision_id,
            sha256: sha256, expected_bytes: expected_bytes, org_id: org_id
          )

          unless skp_path && File.file?(skp_path)
            return report_validation(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              result: 'failed',
              details: { 'diagnostic' => 'No se pudo descargar o verificar la integridad del archivo' }
            )
          end

          target_model = model || Sketchup.active_model
          validate_in_host(target_model, skp_path, asset_id, revision_id, sha256)
        rescue StandardError => e
          @logger&.error('hardware_asset_validation_error', error: e, asset_id: asset_id, revision_id: revision_id)
          report_validation(
            asset_id: asset_id, revision_id: revision_id, sha256: sha256,
            result: 'failed',
            details: { 'diagnostic' => "Error inesperado durante validación: #{e.message}" }
          )
        end

        private

        def validate_in_host(model, path, asset_id, revision_id, sha256)
          definition = load_definition(model, path)
          unless definition
            return report_validation(
              asset_id: asset_id, revision_id: revision_id, sha256: sha256,
              result: 'failed',
              details: { 'diagnostic' => 'SketchUp no pudo crear ComponentDefinition a partir del archivo' }
            )
          end

          details = inspect_definition(definition)
          result = evaluate_definition(details)
          remove_definition(model, definition)

          report_validation(
            asset_id: asset_id, revision_id: revision_id, sha256: sha256,
            result: result, details: details
          )
        end

        def load_definition(model, path)
          model.definitions.load(path)
        rescue StandardError => e
          @logger&.warn('hardware_asset_skp_load_failed', error: e, path: path)
          nil
        end

        def inspect_definition(definition)
          entities = definition.respond_to?(:entities) ? definition.entities : []
          faces = entities.respond_to?(:grep) && defined?(::Sketchup::Face) ? entities.grep(::Sketchup::Face).size : 0
          edges = entities.respond_to?(:grep) && defined?(::Sketchup::Edge) ? entities.grep(::Sketchup::Edge).size : 0
          instances = entities.respond_to?(:grep) ? entities.grep(::Sketchup::ComponentInstance).size : 0
          total = entities.respond_to?(:length) ? entities.length : 0

          bounds_info = extract_bounds(definition)
          host_version = defined?(::Sketchup) && ::Sketchup.respond_to?(:version) ? ::Sketchup.version : 'unknown'

          details = {
            'total_entities' => total,
            'faces_count' => faces,
            'edges_count' => edges,
            'instances_count' => instances,
            'bounds' => bounds_info,
            'host' => {
              'application' => 'SketchUp',
              'version' => host_version,
              'os' => detect_os
            },
            'validatorVersion' => validator_version
          }

          unless bounds_info['empty']
            details['measuredBoundsMm'] = {
              'widthMm' => bounds_info['width_mm'],
              'heightMm' => bounds_info['height_mm'],
              'depthMm' => bounds_info['depth_mm'],
              'diagonalMm' => bounds_info['diagonal_mm']
            }
          end

          details
        end

        def detect_os
          if defined?(::Sketchup) && ::Sketchup.respond_to?(:platform)
            case ::Sketchup.platform
            when :platform_osx then 'macOS'
            when :platform_win then 'Windows'
            else ::Sketchup.platform.to_s
            end
          elsif RUBY_PLATFORM =~ /darwin/i
            'macOS'
          elsif RUBY_PLATFORM =~ /mswin|mingw|cygwin/i
            'Windows'
          else
            RUBY_PLATFORM
          end
        end

        def validator_version
          if defined?(Granete::SketchUpExtension::EXTENSION_VERSION)
            Granete::SketchUpExtension::EXTENSION_VERSION
          else
            '0.1.0'
          end
        end

        def extract_bounds(definition)
          return {} unless definition.respond_to?(:bounds) && definition.bounds

          b = definition.bounds
          info = base_bounds_info(b)
          add_extents_info(info, b)
          info
        end

        def base_bounds_info(bounds)
          {
            'empty' => bounds.respond_to?(:empty?) ? bounds.empty? : false,
            'width_mm' => bounds.respond_to?(:width) ? (bounds.width.to_f * 25.4).round(2) : 0.0,
            'height_mm' => bounds.respond_to?(:height) ? (bounds.height.to_f * 25.4).round(2) : 0.0,
            'depth_mm' => bounds.respond_to?(:depth) ? (bounds.depth.to_f * 25.4).round(2) : 0.0,
            'diagonal_mm' => bounds.respond_to?(:diagonal) ? (bounds.diagonal.to_f * 25.4).round(2) : 0.0
          }
        end

        def add_extents_info(info, bounds)
          return unless bounds.respond_to?(:min) && bounds.min && bounds.respond_to?(:max) && bounds.max

          info['min_mm'] = [bounds.min.x.to_f * 25.4, bounds.min.y.to_f * 25.4, bounds.min.z.to_f * 25.4].map do |val|
            val.round(2)
          end
          info['max_mm'] = [bounds.max.x.to_f * 25.4, bounds.max.y.to_f * 25.4, bounds.max.z.to_f * 25.4].map do |val|
            val.round(2)
          end
        end

        def evaluate_definition(details)
          if details['total_entities'].to_i.zero? && details['faces_count'].to_i.zero? &&
             details['edges_count'].to_i.zero?
            details['diagnostic'] = 'El componente no contiene geometría ni entidades'
            'failed'
          elsif details['bounds']['empty'] || details['bounds']['diagonal_mm'].to_f <= 0.0
            details['diagnostic'] = 'El bounding box del componente está vacío o tiene dimensión cero'
            'failed'
          else
            details['diagnostic'] = 'Geometría 3D validada exitosamente en el host SketchUp'
            'passed'
          end
        end

        def remove_definition(model, definition)
          return unless model.respond_to?(:definitions) && model.definitions.respond_to?(:remove)

          model.definitions.remove(definition)
        rescue StandardError => e
          @logger&.warn('hardware_asset_cleanup_failed', error: e)
        end

        def report_validation(asset_id:, revision_id:, sha256:, result:, details:)
          hex = sha256.to_s.sub(/\Asha256-/, '')
          formatted_sha = "sha256-#{hex}"
          payload = {
            'tool' => VALIDATOR_TOOL,
            'sha256' => formatted_sha,
            'result' => result,
            'details' => details
          }

          api_response = send_report(asset_id, revision_id, payload)
          @logger&.info(
            'hardware_asset_validated',
            asset_id: asset_id, revision_id: revision_id,
            result: result, diagnostic: details['diagnostic']
          )

          {
            'status' => result,
            'tool' => VALIDATOR_TOOL,
            'sha256' => formatted_sha,
            'details' => details,
            'api_response' => api_response
          }
        end

        def send_report(asset_id, revision_id, payload)
          return nil unless @transport && @auth_provider

          path = "/hardware-assets/#{asset_id}/revisions/#{revision_id}:validate"
          @transport.request(
            { 'method' => 'POST', 'path' => path, 'body' => payload },
            authorization_header: @auth_provider.authorization_header
          )
        rescue StandardError => e
          @logger&.error('hardware_asset_validation_report_failed', error: e, asset_id: asset_id)
          nil
        end
      end
    end
  end
end
