# frozen_string_literal: true

require 'json'
require 'time'

module Granete
  module SketchUpExtension
    module Connection
      module CommercialProjection
        UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/
        SHA256_PATTERN = /\Asha256-[0-9a-f]{64}\z/
        TOP_LEVEL_KEYS = %w[schema status projectId designId workingVersion workingFingerprint catalogFingerprint
                            projectionFingerprint pricingAuthority calculatedAt currency itemCount amounts costsWithheld
                            saleAmountsWithheld reference acceptedReference latestPublishedReference comparison
                            issues].freeze
        AMOUNT_KEYS = %w[materialsCost edgeTotal hardwareTotal directCost laborModular laborFixedCost marginFactor
                         saleTotal].freeze
        REFERENCE_KEYS = %w[quoteRevisionId revisionNumber status currency saleTotal].freeze
        COMPARISON_KEYS = %w[absoluteDelta percentageDelta].freeze

        # Design-scoped evidence that the local SketchUp model still contains
        # confirmed authoring work not represented by the server working copy.
        # It lives with the canonical model binding so it survives dialog and
        # model close/reopen. A partial working-copy PUT advances the evidence
        # generation but NEVER clears another furniture's pending local work.
        class LocalWorkState
          DICTIONARY = 'com.granete.project'
          KEY = 'granete.commercial-projection-local-work.v1'
          SCHEMA_VERSION = 1

          def initialize(model)
            @model = model
          end

          def snapshot(project_id:, design_id:)
            payload = read_payload
            return unconfirmed(project_id, design_id) unless payload

            entry = payload.fetch('contexts', {})[context_key(project_id, design_id)]
            return unconfirmed(project_id, design_id) if entry && !valid_entry?(entry)

            state(project_id, design_id, entry || { 'generation' => 0, 'localChangesPending' => false })
          end

          def mark_pending!(project_id:, design_id:)
            update(project_id, design_id, pending: true, scope: 'local')
          end

          def record_sync!(project_id:, design_id:, scope:)
            normalized = scope.to_s
            unless %w[partial full].include?(normalized)
              raise ArgumentError, 'commercial synchronization scope must be partial or full'
            end

            current = snapshot(project_id: project_id, design_id: design_id)
            pending = normalized == 'full' ? false : current['localChangesPending']
            update(project_id, design_id, pending: pending, scope: normalized)
          end

          private

          def update(project_id, design_id, pending:, scope:)
            payload = read_payload || empty_payload
            contexts = payload['contexts']
            key = context_key(project_id, design_id)
            previous = contexts[key]
            generation = (valid_entry?(previous) ? previous['generation'] : 0) + 1
            contexts[key] = { 'generation' => generation, 'localChangesPending' => pending }
            @model.set_attribute(DICTIONARY, KEY, JSON.generate(payload))
            state(project_id, design_id, contexts[key]).merge('scope' => scope)
          end

          def read_payload
            return nil unless @model.respond_to?(:get_attribute) && @model.respond_to?(:set_attribute)

            raw = @model.get_attribute(DICTIONARY, KEY)
            return empty_payload if raw.nil? || raw.to_s.empty?

            payload = JSON.parse(raw)
            return nil unless payload.is_a?(Hash) && payload['schemaVersion'] == SCHEMA_VERSION
            return nil unless payload['contexts'].is_a?(Hash)

            payload
          rescue JSON::ParserError
            nil
          end

          def empty_payload
            { 'schemaVersion' => SCHEMA_VERSION, 'contexts' => {} }
          end

          def context_key(project_id, design_id)
            "#{project_id}/#{design_id}"
          end

          def state(project_id, design_id, entry)
            {
              'projectId' => project_id,
              'designId' => design_id,
              'generation' => entry['generation'].to_i,
              'localChangesPending' => entry['localChangesPending'] == true
            }
          end

          def valid_entry?(entry)
            entry.is_a?(Hash) && entry['generation'].is_a?(Integer) && entry['generation'] >= 0 &&
              [true, false].include?(entry['localChangesPending'])
          end

          def unconfirmed(project_id, design_id)
            state(project_id, design_id, 'generation' => 0, 'localChangesPending' => true)
              .merge('scope' => 'unconfirmed')
          end
        end

        module Contract # rubocop:disable Metrics/ModuleLength
          module_function

          def parse!(body)
            value = body.is_a?(String) ? JSON.parse(body) : body
            validate_identity!(value)
            validate_metadata!(value)
            validate_payload!(value)
            value
          rescue JSON::ParserError
            raise ArgumentError, 'respuesta comercial no es JSON válido'
          end

          def validate_identity!(value)
            raise ArgumentError, 'respuesta comercial inválida' unless value.is_a?(Hash)

            require_exact_keys!(value, TOP_LEVEL_KEYS)
            unless value['schema'] == 'granete.commercial-projection.v1'
              raise ArgumentError, 'schema comercial incompatible'
            end
            raise ArgumentError, 'estado comercial inválido' unless %w[current incomplete].include?(value['status'])

            %w[projectId designId].each do |key|
              raise ArgumentError, "#{key} inválido" unless value[key].to_s.match?(UUID_PATTERN)
            end
          end

          def validate_metadata!(value)
            require_keys!(value, %w[workingVersion workingFingerprint catalogFingerprint projectionFingerprint
                                    pricingAuthority calculatedAt currency itemCount])
            unless value['workingVersion'].is_a?(String) && !value['workingVersion'].empty?
              raise ArgumentError, 'versión de diseño inválida'
            end
            unless value['workingFingerprint'].is_a?(String) && value['workingFingerprint'].match?(SHA256_PATTERN)
              raise ArgumentError, 'huella de diseño inválida'
            end

            validate_optional_fingerprints!(value)
            unless value['pricingAuthority'] == 'calc-project-breakdown'
              raise ArgumentError, 'autoridad de precios incompatible'
            end

            validate_calculated_at!(value['calculatedAt'])
            raise ArgumentError, 'moneda inválida' unless value['currency'].is_a?(String)
            return if value['itemCount'].is_a?(Integer) && value['itemCount'] >= 0

            raise ArgumentError, 'cantidad de muebles inválida'
          end

          def validate_optional_fingerprints!(value)
            %w[catalogFingerprint projectionFingerprint].each do |key|
              fingerprint = value[key]
              next if fingerprint.nil? || (fingerprint.is_a?(String) && fingerprint.match?(SHA256_PATTERN))

              raise ArgumentError, "#{key} inválida"
            end
          end

          def validate_payload!(value)
            require_keys!(value, %w[amounts costsWithheld saleAmountsWithheld reference acceptedReference
                                    latestPublishedReference comparison issues])
            %w[costsWithheld saleAmountsWithheld].each do |key|
              raise ArgumentError, "#{key} inválido" unless [true, false].include?(value[key])
            end
            unless value['issues'].is_a?(Array) && value['issues'].all?(String)
              raise ArgumentError, 'incidencias inválidas'
            end

            validate_amounts!(value['amounts']) if value['amounts']
            %w[reference acceptedReference latestPublishedReference].each do |key|
              validate_reference!(value[key]) if value[key]
            end
            validate_comparison!(value['comparison']) if value['comparison']
          end

          def validate_amounts!(amounts)
            raise ArgumentError, 'montos comerciales inválidos' unless amounts.is_a?(Hash)

            require_exact_keys!(amounts, AMOUNT_KEYS)
            AMOUNT_KEYS.each do |key|
              amount = amounts[key]
              next if amount.nil? || (amount.is_a?(Numeric) && amount.finite?)

              raise ArgumentError, "#{key} inválido"
            end
          end

          def validate_reference!(reference)
            raise ArgumentError, 'referencia comercial inválida' unless reference.is_a?(Hash)

            require_exact_keys!(reference, REFERENCE_KEYS)
            unless reference['quoteRevisionId'].to_s.match?(UUID_PATTERN) &&
                   reference['revisionNumber'].is_a?(Integer) && reference['revisionNumber'].positive? &&
                   %w[draft published accepted superseded].include?(reference['status']) &&
                   (reference['currency'].nil? || reference['currency'].is_a?(String))
              raise ArgumentError, 'referencia comercial inválida'
            end

            validate_finite_or_nil!(reference['saleTotal'], 'total de referencia inválido')
          end

          def validate_comparison!(comparison)
            raise ArgumentError, 'comparación comercial inválida' unless comparison.is_a?(Hash)

            require_exact_keys!(comparison, COMPARISON_KEYS)

            validate_finite_or_nil!(comparison['absoluteDelta'], 'delta absoluto inválido', nullable: false)
            validate_finite_or_nil!(comparison['percentageDelta'], 'delta porcentual inválido')
          end

          def validate_finite_or_nil!(value, message, nullable: true)
            return if nullable && value.nil?
            return if value.is_a?(Numeric) && value.finite?

            raise ArgumentError, message
          end

          def require_keys!(value, keys)
            missing = keys.reject { |key| value.key?(key) }
            raise ArgumentError, "campos comerciales ausentes: #{missing.join(', ')}" unless missing.empty?
          end

          def require_exact_keys!(value, keys)
            require_keys!(value, keys)
            unknown = value.keys - keys
            raise ArgumentError, "campos comerciales desconocidos: #{unknown.join(', ')}" unless unknown.empty?
          end

          def validate_calculated_at!(value)
            unless value.is_a?(String) &&
                   value.match?(/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\z/)
              raise ArgumentError, 'fecha de cálculo inválida'
            end

            Time.iso8601(value)
          rescue ArgumentError
            raise ArgumentError, 'fecha de cálculo inválida'
          end
        end

        class Service
          class Error < StandardError
            attr_reader :kind, :status

            def initialize(kind, message, status: nil)
              @kind = kind
              @status = status
              super(message)
            end
          end

          def initialize(transport:, auth_provider:, logger: SafeLogger.new)
            @transport = transport
            @auth_provider = auth_provider
            @logger = logger
          end

          def fetch(project_id, design_id)
            unless project_id.to_s.match?(UUID_PATTERN) && design_id.to_s.match?(UUID_PATTERN)
              raise Error.new(:invalid_context,
                              'el proyecto o diseño conectado es inválido')
            end
            unless @auth_provider.configured?
              raise Error.new(:unauthenticated,
                              'iniciá sesión para calcular el presupuesto')
            end

            headers = {}
            auth = @auth_provider.authorization_header
            headers['Authorization'] = auth if auth
            path = "/projects/#{project_id}/designs/#{design_id}/commercial-projection"
            response = @transport.request('method' => 'GET',
                                          'path' => path,
                                          'headers' => headers)
            status = response['status'].to_i
            if status == 200
              projection = Contract.parse!(response['body'])
              unless projection['projectId'] == project_id && projection['designId'] == design_id
                raise ArgumentError, 'la respuesta comercial no coincide con el diseño conectado'
              end

              return projection
            end

            kind, message = case status
                            when 401 then [:unauthenticated, 'la sesión venció; iniciá sesión de nuevo']
                            when 403 then [:unauthorized, 'no tenés permiso para ver este presupuesto']
                            when 404 then [:not_found, 'el proyecto o diseño conectado ya no está disponible']
                            else [:bad_response, "respuesta inesperada del servidor (#{status})"]
                            end
            raise Error.new(kind, message, status: status)
          rescue ::Granete::SketchUpExtension::Transport::RequestError => e
            @logger.error('commercial_projection_request_failed', error: e)
            raise Error.new(:unreachable, 'no se pudo contactar al servidor')
          rescue ArgumentError => e
            raise Error.new(:incompatible, e.message)
          end
        end
      end
    end
  end
end
