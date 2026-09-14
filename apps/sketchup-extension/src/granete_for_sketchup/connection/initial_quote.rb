# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Connection
      module InitialQuote
        class Service
          class Error < StandardError
            attr_reader :kind

            def initialize(kind, message)
              @kind = kind
              super(message)
            end
          end

          def initialize(transport:, auth_provider:, logger: SafeLogger.new)
            @transport = transport
            @auth_provider = auth_provider
            @logger = logger
          end

          def create(project_id:, design_id:, working_version:, working_fingerprint:, idempotency_key:)
            unless @auth_provider.configured?
              raise Error.new(:unauthenticated, 'iniciá sesión para emitir la cotización')
            end

            headers = { 'Idempotency-Key' => idempotency_key }
            auth = @auth_provider.authorization_header
            headers['Authorization'] = auth if auth
            response = @transport.request(
              'method' => 'POST',
              'path' => "/projects/#{project_id}/designs/#{design_id}/quote-revisions",
              'headers' => headers,
              'body' => { 'workingVersion' => working_version, 'workingFingerprint' => working_fingerprint }
            )
            status = response['status'].to_i
            if status == 201
              return parse!(response['body'], project_id, design_id, working_version,
                            working_fingerprint)
            end

            kind, message = case status
                            when 401 then [:unauthenticated, 'la sesión venció; iniciá sesión de nuevo']
                            when 403 then [:unauthorized, 'no tenés permiso para emitir esta cotización']
                            when 404 then [:not_found, 'el proyecto o diseño ya no está disponible']
                            when 409
                              [:conflict, 'el presupuesto cambió o Q1 ya existe; actualizá antes de continuar']
                            else [:bad_response, "respuesta inesperada del servidor (#{status})"]
                            end
            raise Error.new(kind, message)
          rescue ::Granete::SketchUpExtension::Transport::RequestError => e
            @logger.error('initial_quote_request_failed', error: e)
            raise Error.new(:unreachable, 'no se pudo contactar al servidor')
          rescue ArgumentError => e
            raise Error.new(:incompatible, e.message)
          end

          private

          def parse!(body, project_id, design_id, working_version, working_fingerprint)
            source = body.is_a?(Hash) ? body.dig('commercialSnapshot', 'designSource') : nil
            unless body.is_a?(Hash) && ModelBinding.uuid?(body['id']) && body['projectId'] == project_id &&
                   body['revisionNumber'] == 1 && body['status'] == 'draft' && body['sourceType'] == 'manual' &&
                   source.is_a?(Hash) && source['designId'] == design_id &&
                   source['workingVersion'] == working_version &&
                   source['workingFingerprint'] == working_fingerprint
              raise ArgumentError, 'respuesta de cotización inicial inválida'
            end

            body
          end
        end

        class Coordinator
          INTENT_KEY = 'granete.initial-quote-intent.v1'

          def initialize(model_provider:, service:)
            @model_provider = model_provider
            @service = service
          end

          def create(project_id:, design_id:, working_version:, working_fingerprint:)
            intent = { 'projectId' => project_id, 'designId' => design_id,
                       'workingVersion' => working_version, 'workingFingerprint' => working_fingerprint }
            model = @model_provider.call
            store = ProjectBootstrap::IntentStore.new(model, INTENT_KEY)
            key = store.prepare!(intent)
            quote = @service.create(project_id: project_id, design_id: design_id,
                                    working_version: working_version,
                                    working_fingerprint: working_fingerprint,
                                    idempotency_key: key)
            unless @model_provider.call.equal?(model)
              raise Service::Error.new(:context_changed,
                                       'el modelo activo cambió; volvé al modelo original y reintentá')
            end

            store.clear!
            quote
          end
        end
      end
    end
  end
end
