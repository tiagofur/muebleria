# frozen_string_literal: true

require 'digest'
require 'json'

module Granete
  module SketchUpExtension
    module Connection
      module ProjectBootstrap
        UUID_PATTERN = ModelBinding::UUID_PATTERN

        # Model-persisted technical retry receipt. It deliberately contains
        # no names, customer/project/design IDs, credentials or model data.
        class IntentStore
          SCHEMA_VERSION = 1

          def initialize(model, key)
            @model = model
            @key = key
          end

          def prepare!(request)
            digest = request_digest(request)
            current = read
            return current['idempotencyKey'] if current && current['requestDigest'] == digest

            payload = {
              'schemaVersion' => SCHEMA_VERSION,
              'intentId' => technical_identity,
              'idempotencyKey' => "sketchup-bootstrap-#{technical_identity}",
              'requestDigest' => digest
            }
            write!(payload)
            verified = read
            raise 'no se pudo verificar la intención de reintento en el modelo' unless verified == payload

            payload['idempotencyKey']
          end

          def pending_key(request)
            current = read
            return nil unless current && current['requestDigest'] == request_digest(request)

            current['idempotencyKey']
          end

          def clear!
            @model.set_attribute(ModelBinding::DICTIONARY, @key, '')
          end

          private

          def read
            raw = @model.get_attribute(ModelBinding::DICTIONARY, @key)
            return nil if raw.nil? || raw.to_s.empty?

            payload = JSON.parse(raw)
            return nil unless payload.is_a?(Hash) && payload['schemaVersion'] == SCHEMA_VERSION
            return nil unless payload.keys.sort == %w[idempotencyKey intentId requestDigest schemaVersion].sort

            payload
          rescue JSON::ParserError
            nil
          end

          def write!(payload)
            @model.set_attribute(ModelBinding::DICTIONARY, @key, JSON.generate(payload))
          end

          def technical_identity
            @sequence = (@sequence || 0) + 1
            stamp = (Time.now.to_f * 1_000_000).to_i.to_s(36)
            entropy = format('%012x', rand(0...(16**12)))
            "#{stamp}-#{Process.pid}-#{@sequence}-#{entropy}"
          end

          def request_digest(request) = Digest::SHA256.hexdigest(JSON.generate(request))
        end

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

          def customers
            response = request('GET', '/customers/summaries')
            body = response['body']
            unless body.is_a?(Array) && body.all? { |item| summary?(item) }
              raise Error.new(:incompatible, 'lista de clientes inválida')
            end

            body.map { |item| item.slice('id', 'name') }
          end

          def create(payload, idempotency_key)
            response = request('POST', '/projects:bootstrap-design', payload,
                               'Idempotency-Key' => idempotency_key)
            body = response['body']
            unless body.is_a?(Hash) && body.keys.sort == %w[binding customer] && summary?(body['customer'])
              raise Error.new(:incompatible, 'contexto creado inválido')
            end

            binding = ModelBinding::Contract.parse!(body['binding'])
            { 'customer' => body['customer'].slice('id', 'name'), 'binding' => binding }
          rescue ArgumentError => e
            raise Error.new(:incompatible, e.message)
          end

          private

          def summary?(value)
            value.is_a?(Hash) && value.keys.sort == %w[id name] &&
              value['id'].to_s.match?(UUID_PATTERN) && value['name'].is_a?(String)
          end

          def request(method, path, body = nil, extra_headers = {})
            raise Error.new(:unauthenticated, 'iniciá sesión para crear el proyecto') unless @auth_provider.configured?

            headers = extra_headers.dup
            auth = @auth_provider.authorization_header
            headers['Authorization'] = auth if auth
            payload = { 'method' => method, 'path' => path, 'headers' => headers }
            payload['body'] = body if body
            response = @transport.request(payload)
            status = response['status'].to_i
            return response if (method == 'GET' && status == 200) || (method == 'POST' && status == 201)

            kind, message = case status
                            when 401 then [:unauthenticated, 'la sesión venció; iniciá sesión de nuevo']
                            when 403 then [:unauthorized, 'no tenés permiso para crear este proyecto']
                            when 404 then [:not_found, 'el cliente seleccionado ya no está disponible']
                            when 409 then [:conflict, 'la intención no coincide con el reintento anterior']
                            else [:bad_response, "respuesta inesperada del servidor (#{status})"]
                            end
            raise Error.new(kind, message)
          rescue ::Granete::SketchUpExtension::Transport::RequestError => e
            @logger.error('project_bootstrap_request_failed', error: e)
            raise Error.new(:unreachable, 'no se pudo contactar al servidor')
          end
        end

        class Coordinator
          INTENT_KEY = 'granete.project-bootstrap-intent.v1'

          def initialize(model_provider:, service:, connector:, logger: SafeLogger.new)
            @model_provider = model_provider
            @service = service
            @connector = connector
            @logger = logger
          end

          def customers = @service.customers

          def create(payload) # rubocop:disable Metrics/AbcSize
            request = normalized_request(payload)
            model = @model_provider.call
            store = IntentStore.new(model, INTENT_KEY)
            pending_key = store.pending_key(request)
            if !pending_key && @connector.status['state'] != 'unbound'
              return failure('already_bound', 'este modelo ya está conectado')
            end

            key = pending_key || store.prepare!(request)
            created = @service.create(request, key)
            unless @model_provider.call.equal?(model)
              return failure('context_changed',
                             'el modelo activo cambió; volvé al modelo original y reintentá')
            end

            binding = created['binding']
            current = @connector.status
            if exact_status?(current, binding)
              store.clear!
              return { 'ok' => true, 'customer' => created['customer'], 'status' => current }
            end
            result = @connector.bind(project_id: binding.project['id'], design_id: binding.design['id'])
            return result unless result['ok']

            status = result['status']
            unless exact_status?(status, binding)
              return failure('bind_readback_failed', 'el proyecto se creó, pero no se verificó el enlace local')
            end

            store.clear!
            { 'ok' => true, 'customer' => created['customer'], 'status' => status }
          rescue Service::Error => e
            failure(e.kind.to_s, e.message)
          rescue StandardError => e
            @logger.error('project_bootstrap_failed', error: e)
            failure('error', e.message)
          end

          private

          def exact_status?(status, binding)
            status['state'] == 'connected' &&
              status.dig('binding', 'projectId') == binding.project['id'] &&
              status.dig('binding', 'designId') == binding.design['id']
          end

          def normalized_request(payload)
            project_name = payload['projectName'].to_s.strip
            design_name = payload['designName'].to_s.strip
            customer_mode = payload['customerMode'].to_s
            raise ArgumentError, 'indicá el proyecto y el diseño' if project_name.empty? || design_name.empty?

            request = { 'projectName' => project_name, 'designName' => design_name }
            if customer_mode == 'existing'
              customer_id = payload['customerId'].to_s
              raise ArgumentError, 'seleccioná un cliente' unless customer_id.match?(UUID_PATTERN)

              request['existingCustomerId'] = customer_id
            else
              name = payload['customerName'].to_s.strip
              raise ArgumentError, 'indicá el nombre del cliente' if name.empty?

              request['newCustomer'] = { 'name' => name }
            end
            request
          end

          def failure(code, reason) = { 'ok' => false, 'code' => code, 'reason' => reason }
        end
      end
    end
  end
end
