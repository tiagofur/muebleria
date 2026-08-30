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
                    :manufacturing_fingerprint, :catalog_revision, :correlation,
                    :normalized_snapshot

        def initialize(status:, issues:, layout: nil, machining: {},
                       correlation: {}, normalized_snapshot: nil, catalog_revision: nil)
          @status = status
          @issues = issues
          @layout = layout
          @operations = machining.fetch(:operations, [])
          @derived_hardware_placements = machining.fetch(:derived_hardware_placements, [])
          @manufacturing_fingerprint = machining[:manufacturing_fingerprint]
          @catalog_revision = catalog_revision
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

        def operations(raw)
          raise AuthoringResolveContract::ContractError, 'Operaciones de machining inválidas' unless raw.is_a?(Array)

          parsed = raw.map { |operation| operation(operation) }
          AuthoringResolveContract.ensure_unique!(parsed.map(&:operation_id), 'operationId de machining')
          parsed
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
        PROVENANCE_KEYS = %w[relationshipId jointPlacementId hardwarePlacementId catalogRuleId sourceKind].freeze

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

          # Exclusivity: a provenance carries exactly its variant's keys — a
          # relationship provenance with a hardwarePlacementId (or vice versa)
          # is ambiguous and fails closed (#346 §6).
          allowed = case source_kind
                    when 'relationship' then %w[sourceKind relationshipId catalogRuleId]
                    when 'manualHardwarePlacement' then %w[sourceKind hardwarePlacementId]
                    else %w[sourceKind relationshipId jointPlacementId catalogRuleId]
                    end
          unless (raw.keys - allowed).empty? && (raw.keys - PROVENANCE_KEYS).empty?
            raise AuthoringResolveContract::ContractError,
                  "Provenance ambigua en #{context}: #{(raw.keys - allowed).inspect}"
          end

          raw
        end

        def holes(raw, context)
          raise AuthoringResolveContract::ContractError, "Hoyos inválidos en #{context}" unless raw.is_a?(Array)

          raw.map do |hole|
            unless hole.is_a?(Hash) && hole.keys.sort == HOLE_KEYS.sort &&
                   hole['face'].is_a?(String) && HOLE_FACES.include?(hole['face']) &&
                   hole['type'].is_a?(String) && !hole['type'].empty? &&
                   %w[xMm yMm].all? { |key| finite_number?(hole[key]) && hole[key] >= 0 } &&
                   %w[diameterMm depthMm].all? { |key| finite_number?(hole[key]) && hole[key].positive? }
              raise AuthoringResolveContract::ContractError, "Hoyo con campos inválidos en #{context}"
            end

            hole
          end
        end

        def derived_placements(raw)
          raise AuthoringResolveContract::ContractError, 'Placements derivados inválidos' unless raw.is_a?(Array)

          parsed = raw.map do |placement|
            unless placement.is_a?(Hash) && placement['derivedHardwarePlacementId'].is_a?(String) &&
                   !placement['derivedHardwarePlacementId'].empty? &&
                   placement['hostComponentInstanceId'].is_a?(String) &&
                   !placement['hostComponentInstanceId'].empty?
              raise AuthoringResolveContract::ContractError, 'Placement derivado inválido'
            end

            provenance(placement['provenance'], placement['derivedHardwarePlacementId'])

            placement
          end
          AuthoringResolveContract.ensure_unique!(
            parsed.map { |placement| placement['derivedHardwarePlacementId'] },
            'derivedHardwarePlacementId'
          )
          parsed
        end

        def finite_number?(value)
          value.is_a?(Numeric) && value.to_f.finite?
        end
      end

      # Structured issue parsing against the closed stable code set — the
      # same set packages/domain and the Go gateway enforce (one contract).
      module AuthoringIssueParsing
        ISSUE_CODES = %w[
          SCHEMA_ID_MISMATCH
          SCHEMA_VERSION_UNSUPPORTED
          REQUEST_INVALID
          PAYLOAD_TOO_LARGE
          QUERY_PARAMETERS_UNSUPPORTED
          METHOD_NOT_ALLOWED
          AUTHENTICATION_REQUIRED
          ACCESS_FORBIDDEN
          CONTENT_TYPE_UNSUPPORTED
          CATALOG_REFERENCE_MISSING
          CATALOG_REVISION_STALE
          CATALOG_DEFINITION_INACTIVE
          PARAMETER_INVALID
          MATERIAL_CHOICE_INVALID
          RESOLVE_GEOMETRY_INVALID
          OCCURRENCE_UNKNOWN_TEMPLATE
          OCCURRENCE_DUPLICATE_ID
          OCCURRENCE_COUNT_UNSUPPORTED
          SNAPSHOT_INCOMPLETE
          TRANSFORM_INVALID
          RELATIONSHIP_INVALID
          RELATIONSHIP_ORPHANED
          JOINERY_SYSTEM_UNSUPPORTED
          HARDWARE_HOST_INVALID
          HARDWARE_REFERENCE_INVALID
          HARDWARE_PLACEMENT_INVALID
          DRILLING_CONFLICT
        ].freeze
        ISSUE_SEVERITIES = %w[error warning info].freeze

        module_function

        def issues(raw)
          raise AuthoringResolveContract::ContractError, 'Issues de resolve inválidos' unless raw.is_a?(Array)

          raw.map do |issue|
            unless issue.is_a?(Hash) && issue['code'].is_a?(String) && ISSUE_CODES.include?(issue['code'])
              raise AuthoringResolveContract::ContractError, 'Issue de resolve sin código estable conocido'
            end
            unless ISSUE_SEVERITIES.include?(issue['severity']) &&
                   issue['message'].is_a?(String) && !issue['message'].empty?
              raise AuthoringResolveContract::ContractError, "Issue #{issue['code']} con severidad desconocida"
            end

            AuthoringResolveIssue.new(issue)
          end
        end
      end

      module AuthoringSnapshotValues
        module_function

        def valid_identity?(hash, *keys)
          return false unless hash.is_a?(Hash) && !drifted_v1_fields?(hash)

          keys.all? { |key| non_empty_string?(hash[key]) } ||
            raise(AuthoringResolveContract::ContractError,
                  "Campos fuera del contrato v1 en #{hash['hardwarePlacementId'] || hash['componentInstanceId']}")
        end

        def valid_anchor?(anchor, component_ids)
          anchor.is_a?(Hash) && anchor.keys.sort == AuthoringSnapshotParsing::ANCHOR_KEYS.sort &&
            non_empty_string?(anchor['componentInstanceId']) && non_empty_string?(anchor['role']) &&
            component_ids.include?(anchor['componentInstanceId'])
        end

        def validate_scalar_map(raw, context)
          return if valid_scalar_map?(raw)

          raise AuthoringResolveContract::ContractError, "#{context} del snapshot normalizado inválidos"
        end

        def valid_scalar_map?(raw)
          raw.is_a?(Hash) && raw.all? { |key, value| non_empty_string?(key) && scalar_value?(value) }
        end

        def validate_material_choices(raw)
          return if raw.is_a?(Hash) && raw.all? { |key, value| non_empty_string?(key) && non_empty_string?(value) }

          raise AuthoringResolveContract::ContractError, 'materialChoices del snapshot normalizado inválidos'
        end

        def valid_offsets?(offsets)
          offsets.is_a?(Array) && offsets.length == 2 && offsets.all? { |value| finite_number?(value) }
        end

        def finite_number?(value)
          value.is_a?(Numeric) && value.to_f.finite?
        end

        def non_empty_string?(value)
          value.is_a?(String) && !value.empty?
        end

        def scalar_value?(value)
          value.is_a?(String) || value == true || value == false || finite_number?(value)
        end

        def drifted_v1_fields?(placement)
          placement.key?('rotationDeg') || placement.key?('handedness')
        end

        def validate_relationship(relationship, component_ids)
          valid = relationship.is_a?(Hash) &&
                  relationship.keys.all? { |key| AuthoringSnapshotParsing::RELATIONSHIP_KEYS.include?(key) } &&
                  non_empty_string?(relationship['relationshipId']) && non_empty_string?(relationship['kind']) &&
                  valid_anchor?(relationship['source'], component_ids) && valid_targets?(relationship, component_ids)
          valid &&= !relationship.key?('joinerySystemId') || non_empty_string?(relationship['joinerySystemId'])
          valid &&= !relationship.key?('parameters') || valid_scalar_map?(relationship['parameters'])
          raise AuthoringResolveContract::ContractError, 'Relationship del snapshot normalizado inválida' unless valid

          targets = relationship['targets'].map { |target| [target['componentInstanceId'], target['role']] }
          AuthoringResolveContract.ensure_unique!(targets, "target de #{relationship['relationshipId']}")
        end

        def valid_targets?(relationship, component_ids)
          relationship['targets'].is_a?(Array) && !relationship['targets'].empty? &&
            relationship['targets'].all? { |anchor| valid_anchor?(anchor, component_ids) }
        end
      end

      # Deep validation of the normalized authoring snapshot — the ONLY echo
      # the next request may use. Every echoed occurrence/placement is
      # validated so a corrupt echo can never seed the next authoring
      # request; resolved layout/machining may never re-enter it as
      # authoring truth.
      module AuthoringSnapshotParsing
        ANCHOR_FACES = %w[front back left right top bottom].freeze
        COMPONENT_KEYS = %w[componentInstanceId componentDefinitionId catalogComponentId role transform].freeze
        PLACEMENT_KEYS = %w[hardwarePlacementId catalogHardwareId hostComponentInstanceId anchorFace offsetMm].freeze
        RELATIONSHIP_KEYS = %w[relationshipId kind source targets joinerySystemId parameters].freeze
        ANCHOR_KEYS = %w[componentInstanceId role].freeze

        module_function

        def parse(raw)
          raise AuthoringResolveContract::ContractError, 'Snapshot normalizado inválido' unless raw.is_a?(Hash)

          %w[parameters materialChoices components relationships hardwarePlacements].each do |key|
            raise AuthoringResolveContract::ContractError, "Snapshot normalizado sin #{key}" unless raw.key?(key)
          end
          AuthoringSnapshotValues.validate_scalar_map(raw['parameters'], 'parameters')
          AuthoringSnapshotValues.validate_material_choices(raw['materialChoices'])
          component_ids = validate_components(raw['components'])
          validate_relationships(raw['relationships'], component_ids)
          validate_placements(raw['hardwarePlacements'], component_ids)
          raw
        end

        def validate_components(components)
          unless components.is_a?(Array) && !components.empty?
            raise AuthoringResolveContract::ContractError, 'Snapshot normalizado sin ocurrencias'
          end

          components.each do |component|
            unless AuthoringSnapshotValues.valid_identity?(component, 'componentInstanceId', 'componentDefinitionId')
              raise AuthoringResolveContract::ContractError, 'Ocurrencia del snapshot normalizado sin identidad estable'
            end
            unless component.keys.all? { |key| COMPONENT_KEYS.include?(key) } &&
                   %w[catalogComponentId role].all? { |key| AuthoringSnapshotValues.non_empty_string?(component[key]) }
              raise AuthoringResolveContract::ContractError, 'Ocurrencia del snapshot normalizado inválida'
            end

            transform = component['transform']
            next unless transform

            validate_transform(transform, component['componentInstanceId'])
          end
          ids = components.map { |component| component['componentInstanceId'] }
          AuthoringResolveContract.ensure_unique!(ids, 'componentInstanceId')
          ids
        end

        def validate_transform(transform, context)
          return if transform.is_a?(Hash) && transform.keys.sort == %w[frame translationMm].sort &&
                    transform['frame'] == 'assembly' && transform['translationMm'].is_a?(Array) &&
                    transform['translationMm'].length == 3 &&
                    transform['translationMm'].all? { |value| AuthoringSnapshotValues.finite_number?(value) }

          raise AuthoringResolveContract::ContractError, "Transform inválida en #{context}"
        end

        def validate_placements(placements, component_ids)
          unless placements.is_a?(Array)
            raise AuthoringResolveContract::ContractError,
                  'Placements del snapshot normalizado inválidos'
          end

          placements.each do |placement|
            validate_placement(placement, component_ids)
          end
          AuthoringResolveContract.ensure_unique!(
            placements.map { |placement| placement['hardwarePlacementId'] }, 'hardwarePlacementId'
          )
        end

        def validate_placement(placement, component_ids)
          unless AuthoringSnapshotValues.valid_identity?(placement, 'hardwarePlacementId', 'catalogHardwareId',
                                                         'hostComponentInstanceId')
            raise AuthoringResolveContract::ContractError, 'Placement del snapshot normalizado sin identidad estable'
          end

          id = placement['hardwarePlacementId']
          unless placement.keys.sort == PLACEMENT_KEYS.sort &&
                 component_ids.include?(placement['hostComponentInstanceId'])
            raise AuthoringResolveContract::ContractError, "Placement #{id} con host o campos inválidos"
          end
          unless ANCHOR_FACES.include?(placement['anchorFace'])
            raise AuthoringResolveContract::ContractError, "Placement #{id} con anchorFace desconocida"
          end
          return if AuthoringSnapshotValues.valid_offsets?(placement['offsetMm'])

          raise AuthoringResolveContract::ContractError, "Placement #{id} con offsetMm inválido"
        end

        def validate_relationships(relationships, component_ids)
          unless relationships.is_a?(Array)
            raise AuthoringResolveContract::ContractError, 'Relationships del snapshot normalizado inválidas'
          end

          relationships.each do |relationship|
            AuthoringSnapshotValues.validate_relationship(relationship, component_ids)
          end
          AuthoringResolveContract.ensure_unique!(
            relationships.map { |relationship| relationship['relationshipId'] }, 'relationshipId'
          )
        end
      end

      module AuthoringResolvedCoherence
        module_function

        def validate!(snapshot, layout, operations, derived_placements)
          snapshot_components = snapshot['components'].to_h do |component|
            [component['componentInstanceId'], component]
          end
          layout_components = validate_components(snapshot_components, layout)
          manual_ids = validate_manual_placements(snapshot, layout)
          validate_hosts!(snapshot_components.keys, layout, operations, derived_placements)
          validate_provenance!(snapshot, manual_ids, operations, derived_placements)
          layout_components
        end

        def validate_components(snapshot_components, layout)
          AuthoringResolveContract.ensure_unique!(layout.boards.map(&:component_instance_id),
                                                  'componentInstanceId del layout')
          layout_components = layout.boards.to_h { |board| [board.component_instance_id, board] }
          unless snapshot_components.keys.sort == layout_components.keys.sort
            raise AuthoringResolveContract::ContractError, 'IDs del layout no coinciden con el snapshot normalizado'
          end

          snapshot_components.each do |id, component|
            board = layout_components.fetch(id)
            if board.component_definition_id == component['componentDefinitionId'] && board.role == component['role']
              next
            end

            raise AuthoringResolveContract::ContractError, "Identidad del layout incoherente para #{id}"
          end
          layout_components
        end

        def validate_manual_placements(snapshot, layout)
          AuthoringResolveContract.ensure_unique!(layout.hardware.map(&:placement_id), 'placementId del layout')
          manual_snapshot = snapshot['hardwarePlacements'].to_h do |placement|
            [placement['hardwarePlacementId'], placement]
          end
          manual_layout = layout.hardware.select { |placement| placement.placement_kind == 'manual' }
                                .to_h { |placement| [placement.placement_id, placement] }
          unless manual_snapshot.keys.sort == manual_layout.keys.sort
            raise AuthoringResolveContract::ContractError,
                  'Placements manuales del layout no coinciden con el snapshot normalizado'
          end
          manual_snapshot.each do |id, placement|
            resolved = manual_layout.fetch(id)
            next if resolved.hardware_id == placement['catalogHardwareId'] &&
                    resolved.host_component_instance_id == placement['hostComponentInstanceId']

            raise AuthoringResolveContract::ContractError, "Placement manual del layout incoherente para #{id}"
          end
          manual_snapshot.keys
        end

        def validate_hosts!(known_ids, layout, operations, derived_placements)
          hosts = layout.hardware.map(&:host_component_instance_id) + operations.map(&:host_component_instance_id) +
                  derived_placements.map { |placement| placement['hostComponentInstanceId'] }
          return if hosts.compact.all? { |host| known_ids.include?(host) }

          raise AuthoringResolveContract::ContractError,
                'Resultado resuelto referencia un host fuera del snapshot normalizado'
        end

        def validate_provenance!(snapshot, manual_ids, operations, derived_placements)
          relationship_ids = snapshot['relationships'].map { |relationship| relationship['relationshipId'] }
          sources = operations.map(&:provenance) + derived_placements.map { |placement| placement['provenance'] }
          valid = sources.all? do |source|
            case source['sourceKind']
            when 'relationship' then relationship_ids.include?(source['relationshipId'])
            when 'manualHardwarePlacement' then manual_ids.include?(source['hardwarePlacementId'])
            else false
            end
          end
          return if valid

          raise AuthoringResolveContract::ContractError,
                'Provenance resuelta no corresponde al snapshot normalizado'
        end
      end

      module AuthoringResolveCorrelation
        KEYS = %w[responseMessageId inReplyToMessageId idempotencyKey].freeze

        module_function

        def parse(body, expected_request:, issues:)
          values = KEYS.to_h { |key| [key, body[key]] }
          non_empty = values.values.count { |value| value.is_a?(String) && !value.empty? }
          return uncorrelated_rejection(body, issues) if non_empty.zero?

          unless non_empty == KEYS.length
            raise AuthoringResolveContract::ContractError,
                  'Correlación incompleta: la respuesta no se procesa sin ella'
          end
          unless values['responseMessageId'] == "resolve-#{values['inReplyToMessageId']}"
            raise AuthoringResolveContract::ContractError, 'responseMessageId no corresponde al request respondido'
          end
          unless expected_request.is_a?(Hash) &&
                 values['inReplyToMessageId'] == expected_request['messageId'] &&
                 values['idempotencyKey'] == expected_request['idempotencyKey']
            raise AuthoringResolveContract::ContractError,
                  'Correlación de respuesta no coincide con el request enviado'
          end
          values
        end

        def uncorrelated_rejection(body, issues)
          return {} if body['status'] == 'rejected' && issues.map(&:code).include?('QUERY_PARAMETERS_UNSUPPORTED')

          raise AuthoringResolveContract::ContractError,
                'Correlación ausente fuera del rechazo de query parameters'
        end
      end

      # Versioned rich authoring resolve contract (#477): parses the
      # granete.sketchup-authoring-resolve.v1 response envelope fail-closed.
      # Unknown schema/contract, ambiguous provenance or a missing layout on
      # an accepted resolve raise ContractError before any host mutation.
      module AuthoringResolveContract
        SUPPORTED_SCHEMA_ID = 'granete.sketchup-authoring-resolve.v1'
        SUPPORTED_SCHEMA_NAME = 'granete.sketchup-authoring-resolve'
        SUPPORTED_SCHEMA_VERSION = '1.0'
        SUPPORTED_RESOLVE_CONTRACT = 'granete.sketchup-authoring-resolve.v1'
        class ContractError < AuthoringResolveError; end

        module_function

        # Parses and validates a resolve response envelope. Raises
        # ContractError (an AuthoringResolveError) on any violation; a
        # rejected envelope parses into a result with issues so callers can
        # branch on codes.
        def parse!(body, expected_request: nil)
          raise ContractError, 'Respuesta de resolve de autoría inválida' unless body.is_a?(Hash)

          schema_id = body['schemaId']
          unless schema_id == SUPPORTED_SCHEMA_ID &&
                 body['schemaName'] == SUPPORTED_SCHEMA_NAME &&
                 body['schemaVersion'] == SUPPORTED_SCHEMA_VERSION
            raise ContractError,
                  "Schema de resolve no soportado: #{schema_id.inspect}/" \
                  "#{body['schemaName'].inspect}/#{body['schemaVersion'].inspect} " \
                  "(esta extensión entiende #{SUPPORTED_SCHEMA_ID} " \
                  "#{SUPPORTED_SCHEMA_NAME} #{SUPPORTED_SCHEMA_VERSION}). " \
                  'Actualizá la extensión; el resolve no se interpreta desde una versión desconocida.'
          end
          resolve_contract = body['resolveContract']
          unless resolve_contract == SUPPORTED_RESOLVE_CONTRACT
            raise ContractError,
                  "Contrato de resolve no soportado: #{resolve_contract.inspect} " \
                  "(esta extensión entiende #{SUPPORTED_RESOLVE_CONTRACT})"
          end

          issues = AuthoringIssueParsing.issues(body['issues'])
          case body['status']
          when 'rejected'
            rejected_result(body, issues, expected_request)
          when 'accepted'
            accepted_result(body, issues, expected_request)
          else
            raise ContractError, "Estado de resolve desconocido: #{body['status'].inspect}"
          end
        end

        FINGERPRINT_PATTERN = /\Asha256-[0-9a-f]{64}\z/

        def fingerprint(raw)
          unless raw.is_a?(String) &&
                 FINGERPRINT_PATTERN.match?(raw)
            raise AuthoringResolveContract::ContractError,
                  'Fingerprint de manufacturing inválido'
          end

          raw
        end

        def rejected_result(body, issues, expected_request)
          raise ContractError, 'Resolve rechazado sin issues estructurados' if issues.empty?
          raise ContractError, 'Resolve rechazado no puede incluir resultado parcial' if body.key?('resolved')

          AuthoringResolveResult.new(status: 'rejected', issues: issues,
                                     correlation: AuthoringResolveCorrelation.parse(
                                       body, expected_request: expected_request, issues: issues
                                     ))
        end

        def accepted_result(body, issues, expected_request)
          resolved = body['resolved']
          unless resolved.is_a?(Hash) && resolved['layout'].is_a?(Hash)
            raise ContractError, 'Resolve aceptado sin layout resuelto'
          end

          machining = resolved['machining']
          raise ContractError, 'Resolve aceptado sin sección de machining' unless machining.is_a?(Hash)

          revision = body['catalogRevision']
          unless revision.is_a?(String) && !revision.empty?
            raise ContractError, 'Resolve aceptado sin revisión de catálogo pineada'
          end

          snapshot = AuthoringSnapshotParsing.parse(body['normalizedSnapshot'])
          preflight(resolved['preflight'])
          layout = LayoutContract.parse!(resolved['layout'])
          operations = AuthoringResolveWireParsing.operations(machining['operations'])
          derived_placements = AuthoringResolveWireParsing.derived_placements(
            machining['derivedHardwarePlacements']
          )
          AuthoringResolvedCoherence.validate!(snapshot, layout, operations, derived_placements)

          AuthoringResolveResult.new(
            status: 'accepted',
            issues: issues,
            layout: layout,
            machining: {
              operations: operations,
              derived_hardware_placements: derived_placements,
              manufacturing_fingerprint: fingerprint(machining['manufacturingFingerprint'])
            },
            catalog_revision: revision,
            correlation: AuthoringResolveCorrelation.parse(
              body, expected_request: expected_request, issues: issues
            ),
            normalized_snapshot: snapshot
          )
        end

        def preflight(raw)
          unless raw.is_a?(Hash) && raw['scope'] == 'authoring-resolve-subset' &&
                 %w[clear blocked].include?(raw['status']) &&
                 raw['preflightContract'] == 'granete.manufacturing-preflight.v1'
            raise ContractError, 'Preflight de resolve ausente o no soportado'
          end

          AuthoringIssueParsing.issues(raw['issues'])
        end

        def ensure_unique!(values, context)
          return if values.length == values.uniq.length

          raise ContractError, "IDs duplicados en #{context}"
        end
      end

      # Request envelope builder: authoring intent (occurrences/
      # relationships/hardware placements) rides the body — the transport
      # never accepts query parameters for it.
      module AuthoringResolveRequest
        module_function

        # Builds the deterministic request envelope. Authoring intent
        # (occurrences/relationships/hardware placements) rides the body;
        # the transport never accepts query parameters for it.
        def build_request(message_id:, idempotency_key:, furniture:, source: {})
          {
            'schemaId' => AuthoringResolveContract::SUPPORTED_SCHEMA_ID,
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
      end

      # Transport mapping for the resolve endpoint: HTTP status → parsed
      # result or structured error. Kept next to the contract so providers
      # stay thin and never interpret response bodies themselves.
      module AuthoringResolveTransport
        module_function

        def interpret(response, expected_request: nil, logger: nil)
          case response['status']
          when 200
            AuthoringResolveContract.parse!(response['body'], expected_request: expected_request)
          when 400, 404, 413, 422
            result = AuthoringResolveContract.parse!(response['body'], expected_request: expected_request)
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
