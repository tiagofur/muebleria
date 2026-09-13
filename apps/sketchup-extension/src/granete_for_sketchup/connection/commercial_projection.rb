# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Connection
      module CommercialProjection
        UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/
        SHA256_PATTERN = /\Asha256-[0-9a-f]{64}\z/

        module Contract
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

            require_keys!(value, %w[schema status projectId designId])
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
            raise ArgumentError, 'versión de diseño inválida' if value['workingVersion'].to_s.empty?
            unless value['workingFingerprint'].to_s.match?(SHA256_PATTERN)
              raise ArgumentError, 'huella de diseño inválida'
            end

            validate_optional_fingerprints!(value)
            unless value['pricingAuthority'] == 'calc-project-breakdown'
              raise ArgumentError, 'autoridad de precios incompatible'
            end
            raise ArgumentError, 'fecha de cálculo inválida' if value['calculatedAt'].to_s.empty?
            raise ArgumentError, 'moneda inválida' if value['currency'].to_s.empty?
            return if value['itemCount'].is_a?(Integer) && value['itemCount'] >= 0

            raise ArgumentError, 'cantidad de muebles inválida'
          end

          def validate_optional_fingerprints!(value)
            %w[catalogFingerprint projectionFingerprint].each do |key|
              fingerprint = value[key]
              next if fingerprint.nil? || fingerprint.to_s.match?(SHA256_PATTERN)

              raise ArgumentError, "#{key} inválida"
            end
          end

          def validate_payload!(value)
            require_keys!(value, %w[amounts costsWithheld saleAmountsWithheld reference acceptedReference
                                    latestPublishedReference comparison issues])
            %w[costsWithheld saleAmountsWithheld].each do |key|
              raise ArgumentError, "#{key} inválido" unless [true, false].include?(value[key])
            end
            raise ArgumentError, 'incidencias inválidas' unless value['issues'].is_a?(Array)

            validate_amounts!(value['amounts']) if value['amounts']
            %w[reference acceptedReference latestPublishedReference].each do |key|
              validate_reference!(value[key]) if value[key]
            end
            validate_comparison!(value['comparison']) if value['comparison']
          end

          def validate_amounts!(amounts)
            raise ArgumentError, 'montos comerciales inválidos' unless amounts.is_a?(Hash)

            %w[materialsCost edgeTotal hardwareTotal directCost laborModular laborFixedCost marginFactor
               saleTotal].each do |key|
              raise ArgumentError, "#{key} ausente" unless amounts.key?(key)

              amount = amounts[key]
              next if amount.nil? || (amount.is_a?(Numeric) && amount.finite?)

              raise ArgumentError, "#{key} inválido"
            end
          end

          def validate_reference!(reference)
            raise ArgumentError, 'referencia comercial inválida' unless reference.is_a?(Hash)
            unless reference['quoteRevisionId'].to_s.match?(UUID_PATTERN) &&
                   reference['revisionNumber'].is_a?(Integer) && reference['revisionNumber'].positive? &&
                   %w[draft published accepted superseded].include?(reference['status']) &&
                   (reference['currency'].nil? || !reference['currency'].to_s.empty?)
              raise ArgumentError, 'referencia comercial inválida'
            end

            validate_finite_or_nil!(reference['saleTotal'], 'total de referencia inválido')
          end

          def validate_comparison!(comparison)
            raise ArgumentError, 'comparación comercial inválida' unless comparison.is_a?(Hash)

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
