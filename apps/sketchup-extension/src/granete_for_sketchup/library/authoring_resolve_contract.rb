# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Library
      # Structured transport failure of the authoring resolve (#477). Carries
      # the stable issue codes (and the HTTP status) so UI/host code branches
      # on `issues.map(&:code)` — never on localized message substrings.
      class AuthoringResolveError < LayoutResolutionError
        attr_reader :issues, :status

        def initialize(message, status: nil, issues: [])
          super(message)
          @status = status
          @issues = issues
        end
      end

      # One structured ContractIssue of the resolve envelope.
      class AuthoringResolveIssue
        attr_reader :code, :severity, :message, :entity_id, :path, :remediation

        def initialize(raw)
          @code = raw['code'].to_s
          @severity = raw['severity'].to_s
          @message = raw['message'].to_s
          @entity_id = raw['entityId']
          @path = raw['path']
          @remediation = raw['remediation']
        end
      end

      # One derived machining operation with provenance (#356 wire shape).
      # provenance keeps exactly one source variant — the parser fails closed
      # on ambiguous/empty provenance instead of guessing.
      class AuthoringMachiningOperation
        attr_reader :operation_id, :host_component_instance_id, :provenance, :holes

        def initialize(operation_id:, host_component_instance_id:, provenance:, holes:)
          @operation_id = operation_id
          @host_component_instance_id = host_component_instance_id
          @provenance = provenance
          @holes = holes
        end

        def relationship_id
          provenance['relationshipId']
        end

        def hardware_placement_id
          provenance['hardwarePlacementId']
        end
      end

      # The parsed authoring resolve result. Ruby is a CONSUMER: identity,
      # geometry, machining and fingerprints are Granete-resolved truth; this
      # object never recomputes them and the normalized snapshot is the only
      # input the next authoring request may echo.
      class AuthoringResolveResult
        attr_reader :status, :issues, :layout, :operations, :derived_hardware_placements,
                    :bom_fingerprint, :correlation, :normalized_snapshot

        def initialize(status:, issues:, layout: nil, machining: {},
                       correlation: {}, normalized_snapshot: nil)
          @status = status
          @issues = issues
          @layout = layout
          @operations = machining.fetch(:operations, [])
          @derived_hardware_placements = machining.fetch(:derived_hardware_placements, [])
          @bom_fingerprint = machining[:bom_fingerprint]
          @correlation = correlation
          @normalized_snapshot = normalized_snapshot
        end

        def accepted?
          status == 'accepted'
        end

        def response_message_id
          correlation['responseMessageId']
        end

        def in_reply_to_message_id
          correlation['inReplyToMessageId']
        end

        def idempotency_key
          correlation['idempotencyKey']
        end
      end

      # Wire-level validation of the machining/snapshot sections.
      # Fail-closed on shape violations: ambiguous provenance, unknown hole
      # faces or a broken fingerprint never parse into a usable result.
      module AuthoringResolveWireParsing
        PROVENANCE_SOURCE_KINDS = %w[relationship manualHardwarePlacement].freeze
        HOLE_FACES = %w[front back left right top bottom].freeze
        HOLE_KEYS = %w[face xMm yMm diameterMm depthMm type].freeze

        module_function

        def issues(raw)
          return [] if raw.nil?

          raise AuthoringResolveContract::ContractError, 'Issues de resolve inválidos' unless raw.is_a?(Array)

          raw.map do |issue|
            unless issue.is_a?(Hash) && issue['code'].is_a?(String) && !issue['code'].empty?
              raise AuthoringResolveContract::ContractError, 'Issue de resolve sin código estable'
            end

            AuthoringResolveIssue.new(issue)
          end
        end

        def operations(raw)
          return [] if raw.nil?
          raise AuthoringResolveContract::ContractError, 'Operaciones de machining inválidas' unless raw.is_a?(Array)

          raw.map { |operation| operation(operation) }
        end

        def operation(raw)
          raise AuthoringResolveContract::ContractError, 'Operación de machining inválida' unless raw.is_a?(Hash)

          operation_id = raw['operationId']
          host = raw['hostComponentInstanceId']
          unless operation_id.is_a?(String) && !operation_id.empty? &&
                 host.is_a?(String) && !host.empty?
            raise AuthoringResolveContract::ContractError, 'Operación de machining sin identidad estable'
          end

          AuthoringMachiningOperation.new(
            operation_id: operation_id,
            host_component_instance_id: host,
            provenance: provenance(raw['provenance'], operation_id),
            holes: holes(raw['holes'], operation_id)
          )
        end

        # Exactly one provenance variant: empty or ambiguous combinations are
        # contract violations (#346 §6), never a guess.
        def provenance(raw, context)
          raise AuthoringResolveContract::ContractError, "Provenance inválida en #{context}" unless raw.is_a?(Hash)

          source_kind = raw['sourceKind']
          unless PROVENANCE_SOURCE_KINDS.include?(source_kind)
            raise AuthoringResolveContract::ContractError,
                  "Provenance con sourceKind desconocido en #{context}: #{source_kind.inspect}"
          end

          case source_kind
          when 'relationship'
            unless raw['relationshipId'].is_a?(String) && !raw['relationshipId'].empty?
              raise AuthoringResolveContract::ContractError,
                    "Provenance de relationship sin relationshipId en #{context}"
            end
          when 'manualHardwarePlacement'
            unless raw['hardwarePlacementId'].is_a?(String) && !raw['hardwarePlacementId'].empty?
              raise AuthoringResolveContract::ContractError, "Provenance manual sin hardwarePlacementId en #{context}"
            end
          end
          raw
        end

        def holes(raw, context)
          return [] if raw.nil?
          raise AuthoringResolveContract::ContractError, "Hoyos inválidos en #{context}" unless raw.is_a?(Array)

          raw.map do |hole|
            unless hole.is_a?(Hash) && hole['face'].is_a?(String) && HOLE_FACES.include?(hole['face']) &&
                   HOLE_KEYS.all? { |key| hole[key].is_a?(String) || hole[key].is_a?(Numeric) }
              raise AuthoringResolveContract::ContractError, "Hoyo con campos inválidos en #{context}"
            end

            hole
          end
        end

        def derived_placements(raw)
          return [] if raw.nil?
          raise AuthoringResolveContract::ContractError, 'Placements derivados inválidos' unless raw.is_a?(Array)

          raw.map do |placement|
            unless placement.is_a?(Hash) && placement['derivedHardwarePlacementId'].is_a?(String) &&
                   placement['hostComponentInstanceId'].is_a?(String)
              raise AuthoringResolveContract::ContractError, 'Placement derivado inválido'
            end

            placement
          end
        end

        def fingerprint(raw)
          unless raw.is_a?(String) && raw.start_with?('fnv1a-')
            raise AuthoringResolveContract::ContractError, 'Fingerprint de manufacturing inválido'
          end

          raw
        end

        def correlation_of(body)
          {
            'responseMessageId' => body['responseMessageId'],
            'inReplyToMessageId' => body['inReplyToMessageId'],
            'idempotencyKey' => body['idempotencyKey']
          }
        end

        # The normalized snapshot is the ONLY echo the next request may use;
        # resolved layout/machining may never re-enter it as authoring truth.
        def normalized_snapshot(raw)
          return nil unless raw.is_a?(Hash)

          %w[parameters materialChoices components relationships hardwarePlacements].each do |key|
            raise AuthoringResolveContract::ContractError, "Snapshot normalizado sin #{key}" unless raw.key?(key)
          end
          raw
        end
      end

      # Versioned rich authoring resolve contract (#477): parses the
      # granete.sketchup-authoring-resolve.v1 response envelope fail-closed.
      # Unknown schema/contract, ambiguous provenance or a missing layout on
      # an accepted resolve raise ContractError before any host mutation.
      module AuthoringResolveContract
        SUPPORTED_SCHEMA_ID = 'granete.sketchup-authoring-resolve.v1'
        SUPPORTED_RESOLVE_CONTRACT = 'granete.sketchup-authoring-resolve.v1'

        class ContractError < AuthoringResolveError; end

        module_function

        # Parses and validates a resolve response envelope. Raises
        # ContractError (an AuthoringResolveError) on any violation; a
        # rejected envelope parses into a result with issues so callers can
        # branch on codes.
        def parse!(body)
          raise ContractError, 'Respuesta de resolve de autoría inválida' unless body.is_a?(Hash)

          schema_id = body['schemaId']
          unless schema_id == SUPPORTED_SCHEMA_ID
            raise ContractError,
                  "Schema de resolve no soportado: #{schema_id.inspect} " \
                  "(esta extensión entiende #{SUPPORTED_SCHEMA_ID}). " \
                  'Actualizá la extensión; el resolve no se interpreta desde una versión desconocida.'
          end
          resolve_contract = body['resolveContract']
          unless resolve_contract == SUPPORTED_RESOLVE_CONTRACT
            raise ContractError,
                  "Contrato de resolve no soportado: #{resolve_contract.inspect} " \
                  "(esta extensión entiende #{SUPPORTED_RESOLVE_CONTRACT})"
          end

          issues = AuthoringResolveWireParsing.issues(body['issues'])
          case body['status']
          when 'rejected'
            rejected_result(body, issues)
          when 'accepted'
            accepted_result(body, issues)
          else
            raise ContractError, "Estado de resolve desconocido: #{body['status'].inspect}"
          end
        end

        # Builds the deterministic request envelope. Authoring intent
        # (occurrences/relationships/hardware placements) rides the body;
        # the transport never accepts query parameters for it.
        def build_request(message_id:, idempotency_key:, furniture:, source: {})
          {
            'schemaId' => SUPPORTED_SCHEMA_ID,
            'schemaName' => 'granete.sketchup-authoring-resolve',
            'schemaVersion' => '1.0',
            'messageId' => message_id,
            'idempotencyKey' => idempotency_key,
            'sentAt' => Time.now.utc.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'source' => {
              'client' => 'granete-for-sketchup',
              'clientVersion' => source.fetch(:client_version,
                                              Granete::SketchUpExtension::EXTENSION_VERSION),
              'host' => 'sketchup',
              'hostVersion' => source.fetch(:host_version, 'unknown')
            },
            'units' => { 'length' => 'mm', 'angle' => 'deg', 'precisionMm' => 0.01 },
            'coordinateSystem' => {
              'handedness' => 'right', 'upAxis' => 'z',
              'projectFrameId' => source.fetch(:project_frame_id, 'granete-project')
            },
            'furniture' => furniture
          }
        end

        def rejected_result(body, issues)
          raise ContractError, 'Resolve rechazado sin issues estructurados' if issues.empty?

          AuthoringResolveResult.new(status: 'rejected', issues: issues,
                                     correlation: AuthoringResolveWireParsing.correlation_of(body))
        end

        def accepted_result(body, issues)
          resolved = body['resolved']
          unless resolved.is_a?(Hash) && resolved['layout'].is_a?(Hash)
            raise ContractError, 'Resolve aceptado sin layout resuelto'
          end

          machining = resolved['machining']
          raise ContractError, 'Resolve aceptado sin sección de machining' unless machining.is_a?(Hash)

          AuthoringResolveResult.new(
            status: 'accepted',
            issues: issues,
            layout: LayoutContract.parse!(resolved['layout']),
            machining: {
              operations: AuthoringResolveWireParsing.operations(machining['operations']),
              derived_hardware_placements:
                AuthoringResolveWireParsing.derived_placements(machining['derivedHardwarePlacements']),
              bom_fingerprint: AuthoringResolveWireParsing.fingerprint(machining['bomFingerprint'])
            },
            correlation: AuthoringResolveWireParsing.correlation_of(body),
            normalized_snapshot:
              AuthoringResolveWireParsing.normalized_snapshot(body['normalizedSnapshot'])
          )
        end
      end

      # Transport mapping for the resolve endpoint: HTTP status → parsed
      # result or structured error. Kept next to the contract so providers
      # stay thin and never interpret response bodies themselves.
      module AuthoringResolveTransport
        module_function

        def interpret(response, logger: nil)
          case response['status']
          when 200
            AuthoringResolveContract.parse!(response['body'])
          when 400, 404, 413, 422
            result = AuthoringResolveContract.parse!(response['body'])
            first = result.issues.first
            raise AuthoringResolveError.new(
              "La autoría fue rechazada (#{first&.code}): #{first&.message}",
              status: response['status'], issues: result.issues
            )
          when 401
            logger&.info('authoring_resolve_session_invalid')
            raise AuthoringResolveError.new('Sesión inválida o expirada', status: 401)
          when 403
            logger&.info('authoring_resolve_license_blocked')
            raise AuthoringResolveError.new('Licencia requerida para resolver autoría', status: 403)
          else
            logger&.info('authoring_resolve_remote_unavailable', status: response['status'])
            raise AuthoringResolveError.new(
              "Error del servidor al resolver autoría (HTTP #{response['status']})",
              status: response['status']
            )
          end
        end
      end
    end
  end
end
