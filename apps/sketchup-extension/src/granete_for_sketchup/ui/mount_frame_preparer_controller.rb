# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module UserInterface
      # MountFramePreparerController coordinates the visual authoring workflow
      # for hardware asset mounting frames in SketchUp:
      # 1. Downloads and validates SKP asset file in host.
      # 2. Instantiates an isolated preview instance in the active model.
      # 3. Activates MountFrameTool for 3D viewport picking.
      # 4. Presents an HtmlDialog displaying asset status, nominal vs measured
      #    dimensions, picking step guidance, and normal verification.
      # 5. Persists the derived immutable revision server-side via:
      #    POST /api/hardware-assets/{assetId}/revisions:derive
      # 6. Cleans up isolated preview definition and instances created by this
      #    session without touching any external or model geometry.
      #
      # rubocop:disable-next Metrics/ClassLength
      class MountFramePreparerController
        attr_reader :dialog, :session_id, :tool, :preview_group, :definition

        def initialize(downloader:, validator:, transport:, auth_provider:,
                       host_preview: nil, logger: nil, resource_path: nil)
          @downloader = downloader
          @validator = validator
          @transport = transport
          @auth_provider = auth_provider
          @host_preview = host_preview || MountFrameHostPreview.new(logger: logger)
          @logger = logger
          @resource_path = resource_path || default_resource_path

          @dialog = nil
          @session_id = nil
          @asset_id = nil
          @source_revision = nil
          @asset_data = nil
          @definition = nil
          @preview_group = nil
          @tool = nil
          @on_saved = nil
          @measured_bounds = nil
        end

        def open?
          @dialog&.visible? || false
        end

        def start_preparation(asset_id:, source_revision_id: nil, expected_hole_spacing_mm: nil,
                              nominal_dimensions: nil, anchor_mode: nil, on_saved: nil)
          close if open?

          @session_id = generate_uuid
          @asset_id = asset_id
          @on_saved = on_saved
          @expected_hole_spacing_mm = expected_hole_spacing_mm
          @nominal_dimensions = nominal_dimensions || {}
          @anchor_mode = anchor_mode

          return nil unless prepare_source_revision?(asset_id, source_revision_id)

          skp_path = download_source_asset
          return nil unless skp_path

          return nil unless setup_host_geometry?(skp_path)

          activate_authoring_tool
          open_dialog
        end

        def close
          cleanup_preview!
          if @tool && defined?(Sketchup) && Sketchup.active_model&.tools&.active_tool == @tool
            Sketchup.active_model.select_tool(nil)
          end
          @tool = nil
          @dialog&.close
          @dialog = nil
        end

        def cleanup_preview!
          model = defined?(::Sketchup) && ::Sketchup.respond_to?(:active_model) ? ::Sketchup.active_model : nil
          @host_preview.cleanup_preview(model, @preview_group, @definition, @session_id)
          @preview_group = nil
          @definition = nil
        end

        private

        def prepare_source_revision?(asset_id, source_revision_id)
          asset_res = fetch_asset(asset_id)
          unless asset_res
            show_error_dialog('Error de red', 'No se pudo obtener la información del recurso del servidor.')
            return false
          end

          @asset_data = asset_res
          revisions = @asset_data['revisions'] || []
          if revisions.empty?
            show_error_dialog('Recurso sin revisiones', 'El recurso no tiene ninguna revisión disponible.')
            return false
          end

          @source_revision = resolve_revision(revisions, source_revision_id)
          unless @source_revision
            show_error_dialog('Revisión no encontrada', 'No se encontró la revisión especificada.')
            return false
          end
          true
        end

        def resolve_revision(revisions, source_revision_id)
          if source_revision_id
            revisions.find { |r| r['id'] == source_revision_id }
          else
            revisions.max_by { |r| r['revision_number'] || r['revisionNumber'] || 1 }
          end
        end

        def download_source_asset
          rev_id = @source_revision['id']
          sha = @source_revision['sha256']
          bytes_count = @source_revision['size_bytes'] || @source_revision['sizeBytes']
          skp_path = @downloader.download_asset(
            asset_id: @asset_id,
            revision_id: rev_id,
            sha256: sha,
            expected_bytes: bytes_count
          )
          unless skp_path && File.file?(skp_path)
            show_error_dialog('Error de descarga', 'No se pudo descargar el archivo 3D del recurso.')
            return nil
          end
          skp_path
        end

        def setup_host_geometry?(skp_path)
          model = Sketchup.active_model
          unless model
            show_error_dialog('Sin modelo activo', 'Abrí un modelo en SketchUp para preparar el herraje.')
            return false
          end

          @definition = @host_preview.load_definition(model, skp_path, @session_id)
          unless @definition
            show_error_dialog('Error de importación', 'SketchUp no pudo abrir la geometría del archivo.')
            return false
          end

          @measured_bounds = @host_preview.extract_measured_bounds(@definition)
          @preview_group = @host_preview.create_preview_group(model, @definition, @session_id)
          true
        end

        def activate_authoring_tool
          model = Sketchup.active_model
          @tool = Tools::MountFrameTool.new(
            expected_hole_spacing_mm: @expected_hole_spacing_mm,
            anchor_mode: @anchor_mode,
            logger: @logger,
            on_change: method(:handle_tool_change)
          )
          model.select_tool(@tool)
        end

        def open_dialog
          @dialog = build_dialog
          @dialog.show
          @dialog.bring_to_front
          @dialog
        end

        def default_resource_path
          directory = __dir__.dup
          directory.force_encoding('UTF-8')
          File.expand_path('../resources/mount_frame_preparer.html', directory)
        end

        def build_dialog
          dialog = ::UI::HtmlDialog.new(
            dialog_title: 'Preparar Montaje 3D — Granete',
            preferences_key: 'com.granete.sketchup_extension.mount_frame_preparer',
            scrollable: false,
            resizable: true,
            width: 440,
            height: 680,
            min_width: 380,
            min_height: 520,
            style: ::UI::HtmlDialog::STYLE_DIALOG
          )
          dialog.set_file(@resource_path)
          bind_callbacks(dialog)
          dialog.set_on_closed do
            cleanup_preview!
            @dialog = nil
          end
          dialog
        end

        def bind_callbacks(dialog)
          dialog.add_action_callback('preparer_ready') { handle_ready(dialog) }
          dialog.add_action_callback('invert_normal') { @tool&.invert_normal! }
          dialog.add_action_callback('reset_selection') { @tool&.reset! }
          dialog.add_action_callback('save_preparation') { handle_save(dialog) }
          dialog.add_action_callback('cancel_preparation') { close }
        end

        def handle_ready(dialog)
          payload = initial_dialog_payload
          execute_bridge(dialog, 'initMountFramePreparer', payload)
        end

        def handle_tool_change(tool_state)
          return unless @dialog&.visible?

          payload = {
            'step' => tool_state[:step].to_s,
            'anchorMode' => tool_state[:anchor_mode]&.to_s,
            'pointA' => tool_state[:point_a_mm],
            'pointB' => tool_state[:point_b_mm],
            'measuredSpacingMm' => tool_state[:measured_spacing_mm],
            'normalInverted' => tool_state[:normal_inverted],
            'spacingComparison' => tool_state[:spacing_comparison],
            'readyToSave' => !tool_state[:mount_frame].nil?
          }
          execute_bridge(@dialog, 'updateToolState', payload)
        end

        def handle_save(dialog)
          unless @tool&.mount_frame
            execute_bridge(dialog, 'showSaveError', { 'error' => 'Falta definir los puntos A y B de montaje.' })
            return
          end

          execute_bridge(dialog, 'setSaving', { 'saving' => true })
          perform_server_derive(dialog)
        rescue StandardError => e
          @logger&.error('mount_frame_save_failed', error: e)
          execute_bridge(dialog, 'showSaveError', { 'error' => "Error al guardar: #{e.message}" })
          execute_bridge(dialog, 'setSaving', { 'saving' => false })
        end

        def perform_server_derive(dialog)
          req_payload = build_derive_request
          idempotency_key = "prep-derive-#{generate_uuid}"
          path = "/hardware-assets/#{@asset_id}/revisions:derive"

          resp = @transport.request(
            {
              'method' => 'POST',
              'path' => path,
              'body' => req_payload,
              'headers' => { 'Idempotency-Key' => idempotency_key }
            },
            authorization_header: @auth_provider.authorization_header
          )

          process_derive_response(dialog, resp)
        end

        def process_derive_response(dialog, resp)
          unless resp && (resp['id'] || resp['revision_number'])
            err_msg = resp&.dig('error', 'message') || 'Error al guardar la revisión derivada en el servidor.'
            execute_bridge(dialog, 'showSaveError', { 'error' => err_msg })
            execute_bridge(dialog, 'setSaving', { 'saving' => false })
            return
          end

          @on_saved&.call(resp)
          execute_bridge(dialog, 'onSaveSuccess', resp)
          close
        end

        def build_derive_request
          mf = @tool.mount_frame
          derived_norm = Assets::MountFrame.derive_normalization(mf)
          origin_obj = @source_revision['origin'] || {}
          source_units = origin_obj['source_units'] || origin_obj['sourceUnits'] || 'mm'
          up_axis = origin_obj['up_axis'] || origin_obj['upAxis'] || 'z'

          {
            'source_revision_id' => @source_revision['id'],
            'origin' => {
              'source_units' => source_units,
              'up_axis' => up_axis,
              'mount_frame' => { 'origin_mm' => mf.origin_mm, 'basis' => mf.basis.to_h },
              'asset_normalization' => {
                'translation_mm' => derived_norm.translation_mm,
                'basis' => derived_norm.basis.to_h
              }
            }
          }
        end

        def initial_dialog_payload
          rev_num = @source_revision['revision_number'] || @source_revision['revisionNumber'] || 1
          {
            'assetId' => @asset_id,
            'displayName' => @asset_data['display_name'] || @asset_data['displayName'] || 'Herraje',
            'sourceRevisionId' => @source_revision['id'],
            'revisionNumber' => rev_num,
            'sha256' => @source_revision['sha256'],
            'measuredBounds' => @measured_bounds,
            'expectedHoleSpacingMm' => @expected_hole_spacing_mm,
            'nominalDimensions' => @nominal_dimensions,
            'anchorMode' => @tool&.anchor_mode&.to_s,
            'step' => @tool&.step.to_s,
            'normalInverted' => @tool&.normal_inverted || false
          }
        end

        def fetch_asset(asset_id)
          return nil unless @transport && @auth_provider

          path = "/hardware-assets/#{asset_id}"
          @transport.request(
            { 'method' => 'GET', 'path' => path },
            authorization_header: @auth_provider.authorization_header
          )
        rescue StandardError => e
          @logger&.error('mount_frame_fetch_asset_failed', error: e, asset_id: asset_id)
          nil
        end

        def show_error_dialog(title, message)
          return unless defined?(::UI) && ::UI.respond_to?(:messagebox)

          ::UI.messagebox("#{title}: #{message}")
        end

        def execute_bridge(dialog, function_name, payload)
          json = JSON.generate(payload)
          dialog.execute_script("window.#{function_name} && window.#{function_name}(#{json});")
        rescue StandardError => e
          @logger&.error('mount_frame_bridge_error', function: function_name, error: e)
        end

        def generate_uuid
          format(
            '%<a08>08x-%<b04>04x-%<c04>04x-%<d04>04x-%<e12>012x',
            a08: rand(0xffffffff),
            b04: rand(0xffff),
            c04: rand(0xffff),
            d04: rand(0xffff),
            e12: rand(0xffffffffffff)
          )
        end
      end
    end
  end
end
