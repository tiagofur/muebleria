# frozen_string_literal: true

require 'digest'
require 'fileutils'
require 'json'

module Granete
  module SketchUpExtension
    module Connection
      # #392 / DT-8 — Publish immutable DesignRevision with manifest + 3D
      # artifacts (digital-thread §§17-18, 21, 26, 28, 30-31).
      #
      # Authority rules enforced here:
      #   * the DesignWorkingCopy is the ONLY publication source: SketchUp
      #     syncs it, the backend snapshots it — the manifest never carries
      #     an arbitrary revision item list past the server;
      #   * the manifest contains EXCLUSIVELY Granete-managed
      #     FurnitureInstances; unmanaged walls/plants/decoration never
      #     enter the productive semantic surface;
      #   * identity precheck is #391's validate_managed_furniture_identity —
      #     reused, never reimplemented;
      #   * artifacts are exported host-safe (save_copy/write_image to a
      #     temp dir): the user's working document path is never touched;
      #   * SHA-256 is computed locally AND verified against the server's
      #     hash before finalize;
      #   * baseRevisionId advances only after an authoritative success.
      module DesignPublish
        MANIFEST_SCHEMA_VERSION = 1
        ARTIFACT_KINDS = %w[model manifest preview].freeze
        PROGRESS_STEPS = %w[validating exporting uploading publishing].freeze
        PREVIEW_WIDTH = 1280
        PREVIEW_HEIGHT = 720

        UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/
        SHA256_PATTERN = /\Asha256-[0-9a-f]{64}\z/

        def self.uuid?(value)
          value.is_a?(String) && value.match?(UUID_PATTERN)
        end

        def self.with_temp_dir(prefix = 'granete-publish')
          base = ENV['TMPDIR'] || ENV['TEMP'] || '/tmp'
          dir = File.join(base, "#{prefix}-#{Time.now.to_i}-#{rand(1_000_000)}")
          FileUtils.mkdir_p(dir)
          yield dir
        ensure
          FileUtils.rm_rf(dir) if dir && File.directory?(dir)
        end

        # Fail-closed parsers for the backend responses (mirrors of the
        # generated Go DTOs). Unknown shapes raise; nothing is guessed.
        module Contract
          SESSION_STATUSES = %w[prepared finalized abandoned].freeze

          PrepareSession = Struct.new(:id, :design_id, :status, :base_revision_id, :expires_at,
                                      :required_artifacts, keyword_init: true)
          UploadedArtifact = Struct.new(:kind, :sha256, :size_bytes, :content_type, keyword_init: true)
          PublishedRevision = Struct.new(:id, :design_id, :revision_number, :parent_revision_id,
                                         :artifacts, keyword_init: true)
          ArtifactSummary = Struct.new(:kind, :sha256, :size_bytes, :content_type, keyword_init: true)

          def self.parse_session!(body)
            raise ArgumentError, 'publish session payload must be present' if body.nil?

            payload = body.is_a?(Hash) ? body : JSON.parse(body)
            require_keys!(payload, 'id', 'design_id', 'status', 'expires_at', 'required_artifacts')
            raise ArgumentError, 'session id must be a uuid' unless DesignPublish.uuid?(payload['id'])
            raise ArgumentError, 'session design_id must be a uuid' unless DesignPublish.uuid?(payload['design_id'])
            unless SESSION_STATUSES.include?(payload['status'])
              raise ArgumentError, "unknown publish session status: #{payload['status'].inspect}"
            end
            unless payload['required_artifacts'].is_a?(Array) &&
                   (payload['required_artifacts'] - DesignPublish::ARTIFACT_KINDS).empty?
              raise ArgumentError, 'session required_artifacts inválidos'
            end

            base = payload['base_revision_id']
            base = nil if base.to_s.strip.empty?
            raise ArgumentError, 'session base_revision_id inválido' unless base.nil? || DesignPublish.uuid?(base)

            PrepareSession.new(
              id: payload['id'], design_id: payload['design_id'], status: payload['status'],
              base_revision_id: base, expires_at: payload['expires_at'],
              required_artifacts: payload['required_artifacts']
            )
          end

          def self.parse_artifact!(body)
            payload = body.is_a?(Hash) ? body : JSON.parse(body)
            require_keys!(payload, 'kind', 'sha256', 'size_bytes', 'content_type')
            unless DesignPublish::ARTIFACT_KINDS.include?(payload['kind'])
              raise ArgumentError, "unknown artifact kind: #{payload['kind'].inspect}"
            end
            unless payload['sha256'].to_s.match?(DesignPublish::SHA256_PATTERN)
              raise ArgumentError, 'artifact sha256 inválido'
            end
            unless payload['size_bytes'].is_a?(Integer) && payload['size_bytes'].positive?
              raise ArgumentError, 'artifact size_bytes inválido'
            end
            unless payload['content_type'].is_a?(String) && !payload['content_type'].strip.empty?
              raise ArgumentError, 'artifact content_type inválido'
            end

            UploadedArtifact.new(
              kind: payload['kind'], sha256: payload['sha256'],
              size_bytes: payload['size_bytes'], content_type: payload['content_type']
            )
          end

          def self.parse_revision!(body)
            payload = body.is_a?(Hash) ? body : JSON.parse(body)
            require_keys!(payload, 'id', 'design_id', 'revision_number', 'source_type', 'status')
            raise ArgumentError, 'revision id must be a uuid' unless DesignPublish.uuid?(payload['id'])
            raise ArgumentError, 'revision design_id must be a uuid' unless DesignPublish.uuid?(payload['design_id'])
            unless payload['revision_number'].is_a?(Integer) && payload['revision_number'].positive?
              raise ArgumentError, 'revision_number inválido'
            end
            raise ArgumentError, 'publish must produce a published revision' unless payload['status'] == 'published'

            parent = payload['parent_revision_id']
            parent = nil if parent.to_s.strip.empty?

            artifacts = payload['artifacts'].is_a?(Array) ? payload['artifacts'] : []
            PublishedRevision.new(
              id: payload['id'], design_id: payload['design_id'],
              revision_number: payload['revision_number'], parent_revision_id: parent,
              artifacts: artifacts.map { |a| parse_artifact!(a) }
            )
          end

          def self.require_keys!(payload, *keys)
            keys.each do |key|
              raise ArgumentError, "missing publish payload key: #{key}" unless payload.key?(key)
            end
          end
        end

        # HTTP client for the staged publish surface. Typed errors only.
        class Service
          class Error < StandardError
            attr_reader :kind, :status

            def initialize(kind, message = nil, status: nil)
              @kind = kind
              @status = status
              super(message || kind.to_s)
            end
          end

          def initialize(transport:, auth_provider:, logger: SafeLogger.new)
            @transport = transport
            @auth_provider = auth_provider
            @logger = logger
          end

          # Validates the manifest against the authoritative working copy and
          # pins the base revision. Retry-safe via a deterministic
          # Idempotency-Key minted by the caller.
          def prepare_publish(design_id, manifest:, idempotency_key:)
            body = request(:post, "/designs/#{design_id}/publish:prepare",
                           { 'manifest' => manifest }, extra_headers: { 'Idempotency-Key' => idempotency_key })
            Contract.parse_session!(body)
          end

          # Streams one artifact file as multipart form-data. The server
          # computes the authoritative SHA-256.
          def upload_artifact(design_id, session_id, kind, file_path:, content_type:)
            raise Error.new(:bad_request, 'kind de artefacto inválido') unless ARTIFACT_KINDS.include?(kind.to_s)

            payload = { 'path' => "/designs/#{design_id}/publish/#{session_id}/artifacts/#{kind}" }
            response = perform_upload(payload, file_path, content_type)
            status = response['status'].to_i
            case status
            when 200, 201 then Contract.parse_artifact!(response['body'])
            when 400 then raise Error.new(:bad_request, error_message(response), status: status)
            when 401 then raise Error.new(:unauthenticated, 'sesión expirada o inválida', status: status)
            when 403 then raise Error.new(:unauthorized, 'no tenés permiso para publicar diseños', status: status)
            when 404 then raise Error.new(:not_found, 'diseño o sesión de publicación inexistente', status: status)
            when 409 then raise Error.new(:conflict, conflict_message(response), status: status)
            when 413 then raise Error.new(:too_large, 'el artefacto es demasiado grande', status: status)
            else raise Error.new(:bad_response, "respuesta inesperada del servidor (#{status})", status: status)
            end
          end

          # Finalizes the staged publication; retry with the same
          # Idempotency-Key replays the SAME revision.
          def finalize_publish(design_id, session_id:, idempotency_key:)
            body = request(:post, "/designs/#{design_id}/publish/#{session_id}:finalize",
                           nil, extra_headers: { 'Idempotency-Key' => idempotency_key })
            Contract.parse_revision!(body)
          end

          private

          def perform_upload(payload, file_path, content_type)
            raise Error.new(:unauthenticated, 'sin sesión iniciada') unless @auth_provider.configured?

            auth = @auth_provider.authorization_header
            @transport.upload(payload, file_path: file_path, content_type: content_type,
                                        authorization_header: auth)
          rescue ::Granete::SketchUpExtension::Transport::RequestError => e
            @logger.error('design_publish_upload_failed', error: e)
            raise Error.new(:unreachable, 'no se pudo contactar al servidor')
          end

          def request(method, path, body = nil, extra_headers: nil)
            raise Error.new(:unauthenticated, 'sin sesión iniciada') unless @auth_provider.configured?

            payload = { 'method' => method.to_s.upcase, 'path' => path, 'headers' => {} }
            payload['body'] = body if body
            auth = @auth_provider.authorization_header
            payload['headers']['Authorization'] = auth if auth
            payload['headers'].merge!(extra_headers) if extra_headers

            response = @transport.request(payload)
            status = response['status'].to_i
            case status
            when 200, 201 then response['body']
            when 400 then raise Error.new(:bad_request, error_message(response), status: status)
            when 401 then raise Error.new(:unauthenticated, 'sesión expirada o inválida', status: status)
            when 403 then raise Error.new(:unauthorized, 'no tenés permiso para publicar diseños', status: status)
            when 404 then raise Error.new(:not_found, 'diseño o sesión de publicación inexistente', status: status)
            when 409 then raise Error.new(:conflict, conflict_message(response), status: status)
            else raise Error.new(:bad_response, "respuesta inesperada del servidor (#{status})", status: status)
            end
          rescue ::Granete::SketchUpExtension::Transport::RequestError => e
            @logger.error('design_publish_request_failed', error: e)
            raise Error.new(:unreachable, 'no se pudo contactar al servidor')
          end

          def conflict_message(response)
            response.dig('body', 'error', 'message') || 'el diseño cambió en el servidor'
          end

          def error_message(response)
            response.dig('body', 'error', 'message') || response.dig('body', 'message') || 'solicitud inválida'
          end
        end

        # Builds the managed-only semantic manifest v1 from the model:
        # EXCLUSIVELY Granete-managed component instances with a valid
        # backend furnitureInstanceId. Walls, plants, decorations and any
        # other unmanaged geometry never appear (DT-8 negative proof B).
        module ManifestBuilder
          module_function

          def build(model, binding, metadata_store, sketchup_version:, plugin_version:)
            items = []
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            model.entities.each do |entity|
              metadata = read_metadata(metadata_store, entity)
              next unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

              instance_id = metadata['identity']['furnitureInstanceId']
              next unless instance_id.is_a?(String) && instance_id.match?(DesignPublish::UUID_PATTERN)

              project_id = metadata['identity']['projectId']
              next if project_id && project_id != binding.project_id

              items << {
                'furnitureInstanceId' => instance_id,
                'technicalClientLocator' => ProjectFurniture::ManagedFurniture.persistent_locator(entity)
              }
            end

            {
              'schemaVersion' => MANIFEST_SCHEMA_VERSION,
              'projectId' => binding.project_id,
              'designId' => binding.design_id,
              'baseRevisionId' => binding.base_revision_id,
              'source' => {
                'client' => 'sketchup',
                'sketchupVersion' => sketchup_version.to_s,
                'pluginVersion' => plugin_version.to_s
              },
              'items' => items
            }
          end

          def read_metadata(store, entity)
            store.read(entity)
          rescue JSON::ParserError, Metadata::InvalidMetadataError
            nil
          end

          # Deterministic fingerprint of the manifest content for the
          # prepare Idempotency-Key.
          def fingerprint(manifest)
            Digest::SHA256.hexdigest(JSON.generate(manifest))[0, 32]
          end
        end

        # Host-safe artifact export (#392 §§8-10): a temp publish directory
        # receives save_copy of the current model state and a PNG preview of
        # the current view. The user's working document path is never
        # changed; the directory is always cleaned up by the caller.
        module ArtifactExporter
          module_function

          def export(model, manifest, dir)
            skp_path = File.join(dir, 'model.skp')
            manifest_path = File.join(dir, 'manifest.json')
            preview_path = File.join(dir, 'preview.png')

            raise 'el host no pudo guardar la copia del modelo' unless model.save_copy(skp_path)
            raise 'la copia del modelo está vacía' unless File.size?(skp_path)

            model.write_image(preview_path, DesignPublish::PREVIEW_WIDTH, DesignPublish::PREVIEW_HEIGHT, true)
            raise 'la preview exportada está vacía' unless File.size?(preview_path)

            File.binwrite(manifest_path, JSON.pretty_generate(manifest))
            {
              'model' => { 'path' => skp_path, 'content_type' => 'application/octet-stream' },
              'manifest' => { 'path' => manifest_path, 'content_type' => 'application/json' },
              'preview' => { 'path' => preview_path, 'content_type' => 'image/png' }
            }
          end

          def local_sha256(path)
            digest = Digest::SHA256.file(path)
            "sha256-#{digest.hexdigest}"
          end
        end

        # Orchestrates the publish sequence. Progress is reported through
        # on_progress(step) so the dialog can surface honest intermediate
        # states; every failure returns a typed payload and NEVER advances
        # the binding base.
        class Publisher
          def initialize(model_provider:, binding_store_factory:, duplicate_resolver:,
                         service:, working_copy_service:, base_advancer:,
                         metadata_store_factory:, logger: SafeLogger.new)
            @model_provider = model_provider
            @binding_store_factory = binding_store_factory
            @duplicate_resolver = duplicate_resolver
            @service = service
            @working_copy_service = working_copy_service
            @base_advancer = base_advancer
            @metadata_store_factory = metadata_store_factory
            @logger = logger
          end

          attr_reader :service

          def publish(on_progress: nil)
            model = @model_provider.call
            return failure('no_model', 'no hay un modelo activo') unless model

            binding = @binding_store_factory.call.read
            return failure('unbound', 'conectá este modelo a un proyecto y diseño primero') unless binding

            report(on_progress, 'validating')
            precheck = @duplicate_resolver.validate_model(model, binding: binding)
            unless precheck['valid']
              return failure(precheck['code'] || 'precheck_failed',
                             precheck['reason'] || 'la identidad de los muebles no es válida para publicar')
            end

            report(on_progress, 'syncing')
            manifest = ManifestBuilder.build(model, binding, @metadata_store_factory.call(model),
                                             sketchup_version: host_sketchup_version,
                                             plugin_version: Granete::SketchUpExtension::EXTENSION_VERSION)
            sync_working_copy(binding, model, manifest)

            report(on_progress, 'exporting')
            DesignPublish.with_temp_dir('granete-publish') do |dir|
              artifacts = ArtifactExporter.export(model, manifest, dir)

              report(on_progress, 'uploading')
              session = @service.prepare_publish(
                binding.design_id,
                manifest: manifest,
                idempotency_key: prepare_key(binding, manifest)
              )
              upload_and_verify(binding, session, artifacts)

              report(on_progress, 'publishing')
              revision = @service.finalize_publish(
                binding.design_id,
                session_id: session.id,
                idempotency_key: "pubfin:#{session.id}"
              )

              advance = advance_binding_base(revision)
              return advance unless advance['ok']

              @logger.info('design_published',
                           design_id: binding.design_id, revision_id: revision.id,
                           revision_number: revision.revision_number,
                           artifacts: revision.artifacts.map(&:kind))
              {
                'ok' => true,
                'revisionId' => revision.id,
                'revisionNumber' => revision.revision_number,
                'baseRevisionId' => revision.id,
                'artifacts' => revision.artifacts.map { |a| { 'kind' => a.kind, 'sha256' => a.sha256 } },
                'status' => advance['status']
              }
            end
          rescue Service::Error => e
            failure(error_code(e.kind), e.message)
          rescue StandardError => e
            @logger.error('design_publish_failed', error: e)
            failure('publish_failed', e.message)
          end

          private

          def report(on_progress, step)
            on_progress&.call(step)
          end

          # Final sync of the working copy before publishing: the working
          # copy is the sole publication source, so every managed entity's
          # CURRENT transform/locator must be merged into it (existing
          # authoritative fields survive verbatim — #389 merge rule).
          def sync_working_copy(binding, model, manifest)
            working = @working_copy_service.get_working_copy(binding.design_id)
            metadata_store = @metadata_store_factory.call(model)
            items = working.items
            manifest['items'].each do |manifest_item|
              entity = ProjectFurniture::ManagedFurniture.locate(
                model, metadata_store, manifest_item['furnitureInstanceId']
              )['entity']
              next unless entity

              items = ProjectFurniture::WorkingCopyMerger.merge(
                working, manifest_item['furnitureInstanceId'], entity,
                locator: manifest_item['technicalClientLocator']
              )
              working = ProjectFurniture::Contract::WorkingCopy.new(
                design_id: working.design_id, project_id: working.project_id,
                base_revision_id: working.base_revision_id, items: items
              )
            end
            @working_copy_service.update_working_copy(
              binding.design_id, items: items, base_revision_id: binding.base_revision_id,
              source_type: 'sketchup'
            )
          end

          def upload_and_verify(binding, session, artifacts)
            ARTIFACT_KINDS.each do |kind|
              artifact = artifacts.fetch(kind)
              uploaded = @service.upload_artifact(
                binding.design_id, session.id, kind,
                file_path: artifact['path'], content_type: artifact['content_type']
              )
              local = ArtifactExporter.local_sha256(artifact['path'])
              next if uploaded.sha256 == local

              raise Service::Error.new(:hash_mismatch,
                                       "el hash del artefacto #{kind} no coincide con el archivo exportado")
            end
          end

          # The binding base advances ONLY from the server-authoritative
          # answer after a successful publish (adopt re-validates; it never
          # trusts a client-side guess).
          def advance_binding_base(revision)
            result = @base_advancer.call
            unless result['ok']
              return failure('base_advance_failed',
                             'la revisión se publicó pero el modelo no pudo actualizar su base; ' \
                             'usá Actualizar base de trabajo en la pestaña Estado')
            end

            status = result['status'] || {}
            authoritative = status['authoritativeBaseRevisionId']
            return { 'ok' => true, 'status' => status } if authoritative == revision.id

            failure('base_advance_failed',
                    'la base autoritativa del servidor no coincide con la revisión publicada')
          end

          def prepare_key(binding, manifest)
            base = binding.base_revision_id || 'r0'
            "pub:#{binding.design_id}:#{base}:#{ManifestBuilder.fingerprint(manifest)}"
          end

          def host_sketchup_version
            Sketchup.respond_to?(:version) ? Sketchup.version : 'unknown'
          end

          def error_code(kind)
            {
              conflict: 'stale_base', not_found: 'not_found', unauthenticated: 'unauthenticated',
              unauthorized: 'unauthorized', unreachable: 'unreachable',
              too_large: 'artifact_too_large', hash_mismatch: 'hash_mismatch'
            }.fetch(kind, 'publish_failed')
          end

          def failure(code, reason)
            { 'ok' => false, 'code' => code, 'reason' => reason }
          end
        end
      end
    end
  end
end
