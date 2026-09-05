# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Host
      # Versioned Ruby↔JavaScript bridge contract of the shared host runtime
      # (#498 / integration excellence §6.2: "typed/validated messages at the
      # Ruby↔JavaScript boundary"). Every mutation-channel message carries
      # schema identity, correlation (messageId / inReplyTo) and an explicit
      # semantic target; unknown schema, unknown mutation or unknown fields
      # fail closed BEFORE any host state is touched. The legacy dialog
      # callbacks keep their reviewed shapes — this contract owns the new
      # mutation/preflight/degraded channel.
      module CommandContract # rubocop:disable Metrics/ModuleLength
        class ContractError < StandardError; end

        SCHEMA_ID = 'granete.sketchup-host-command.v1'
        MESSAGE_TYPES = %w[mutation_command mutation_state preflight_state degraded_state
                           manufacturing_command manufacturing_state preflight_command].freeze
        KNOWN_MUTATIONS = %w[update_furniture update_hardware_placement substitute_hardware].freeze
        # Read-only inspection channel (#470): commands never mutate the
        # model; they steer the overlay (mode/scope/filter/selection) or ask
        # for provenance navigation.
        KNOWN_INSPECTIONS = %w[set_mode select_feature set_filter navigate_to_source refresh].freeze
        # Read-only preflight review channel (#466): `run` re-runs the
        # AUTHORITATIVE resolve (never a local validation) and `navigate_issue`
        # selects/frames the exact managed context of an issue in the
        # viewport. No command here mutates the model.
        KNOWN_PREFLIGHT_COMMANDS = %w[run navigate_issue].freeze

        SEMANTIC_TARGET_KEYS = %w[furnitureInstanceId furnitureInstanceRef componentInstanceId
                                  hardwarePlacementId].freeze
        # A child/hardware occurrence is only addressable together with its
        # owning furniture identity (authoring contract §3): sharing a
        # componentDefinitionId must never collapse two occurrences.
        CHILD_TARGET_KEYS = %w[componentInstanceId hardwarePlacementId].freeze
        FURNITURE_TARGET_KEYS = %w[furnitureInstanceId furnitureInstanceRef].freeze

        OUTCOME_MESSAGE_PREFIX = 'mut-out'
        MAX_ID_LENGTH = 128

        module_function

        # Parses and validates a JS→Ruby mutation command envelope.
        # Raises ContractError on any violation; never touches the model.
        def parse_command!(raw)
          envelope = parse_json(raw)
          assert_schema(envelope)
          assert_type(envelope, 'mutation_command')

          message_id = bounded_string(envelope['messageId'], 'messageId')
          mutation = envelope['mutation'].to_s
          unless KNOWN_MUTATIONS.include?(mutation)
            raise ContractError, "Mutación desconocida en el contrato del host: #{mutation.inspect}"
          end

          target = parse_semantic_target(envelope['semanticTarget'])
          payload = envelope['payload']
          raise ContractError, 'payload debe ser un objeto' unless payload.is_a?(Hash)

          {
            'messageId' => message_id,
            'mutation' => mutation,
            'semanticTarget' => target,
            'payload' => payload
          }
        end

        # Closed-shape semantic target: only Granete identity namespaces, at
        # least one non-empty value, and child targets anchored to their
        # owning furniture. Nothing here derives identity from names/GUIDs.
        def parse_semantic_target(raw)
          raise ContractError, 'semanticTarget debe ser un objeto' unless raw.is_a?(Hash)

          unknown = raw.keys - SEMANTIC_TARGET_KEYS
          raise ContractError, "semanticTarget con campos desconocidos: #{unknown.join(', ')}" unless unknown.empty?

          target = {}
          SEMANTIC_TARGET_KEYS.each do |key|
            value = raw[key]
            target[key] = value if value.is_a?(String) && !value.strip.empty?
          end
          raise ContractError, 'semanticTarget sin identidad semántica' if target.empty?

          if target.keys.intersect?(CHILD_TARGET_KEYS) &&
             !target.keys.intersect?(%w[furnitureInstanceId furnitureInstanceRef])
            raise ContractError,
                  'un objetivo componentInstanceId/hardwarePlacementId requiere el mueble dueño'
          end

          target
        end

        # Stable key of a semantic target (double-submit guard + preflight
        # invalidation scope). Sorted so key order never matters.
        def semantic_target_key(target)
          SEMANTIC_TARGET_KEYS.filter_map { |key| "#{key}=#{target[key]}" if target[key] }.sort.join('|')
        end

        # Furniture-scoped slice of a target: the review/preflight identity of
        # the OWNING furniture, dropping child occurrence keys.
        def furniture_scope(target)
          target.to_h.slice(*FURNITURE_TARGET_KEYS)
        end

        # Canonical target key plus the furniture-scoped alias when the target
        # addresses a child occurrence: invalidations stay reachable from
        # every lookup key the overlays (#470) and the review (#466) use.
        def target_keys_for(target)
          keys = [semantic_target_key(target)]
          scoped = furniture_scope(target)
          keys << semantic_target_key(scoped) unless scoped.empty?
          keys.uniq
        end

        # Ruby→JS mutation outcome envelope. `outcome.result` is the legacy
        # result hash (kept for the existing UI); behavior-relevant truth is
        # outcome/category/issues/resolveKind/degraded.
        # rubocop:disable-next Metrics/ParameterLists
        def mutation_state_envelope(message_id:, in_reply_to:, mutation:, outcome:, category: nil,
                                    reason: nil, issues: [], result: nil, resolve_kind: nil,
                                    degraded: nil, semantic_target: {})
          assert_outcome(outcome)
          assert_category(category)
          {
            'schemaId' => SCHEMA_ID,
            'type' => 'mutation_state',
            'messageId' => bounded_string(message_id, 'messageId'),
            'inReplyTo' => in_reply_to.nil? || in_reply_to.to_s.empty? ? nil : in_reply_to.to_s,
            'mutation' => mutation.to_s,
            'outcome' => outcome,
            'category' => category,
            'reason' => reason,
            'issues' => compact_issues(issues),
            'resolveKind' => resolve_kind,
            'degraded' => degraded,
            'semanticTarget' => semantic_target.is_a?(Hash) ? semantic_target : {}
          }.merge(result.nil? ? {} : { 'result' => result })
        end

        # Parses and validates a JS→Ruby read-only inspection command (#470).
        # Raises ContractError on any violation; never touches the model.
        def parse_manufacturing_command!(raw)
          envelope = parse_json(raw)
          assert_schema(envelope)
          assert_type(envelope, 'manufacturing_command')

          command = envelope['command'].to_s
          unless KNOWN_INSPECTIONS.include?(command)
            raise ContractError, "Comando de inspección desconocido: #{command.inspect}"
          end

          target = envelope['semanticTarget']
          payload = envelope['payload']
          raise ContractError, 'payload debe ser un objeto' unless payload.is_a?(Hash)

          {
            'messageId' => bounded_string(envelope['messageId'], 'messageId'),
            'command' => command,
            'semanticTarget' => target.is_a?(Hash) ? parse_semantic_target(target) : {},
            'payload' => payload
          }
        end

        # Parses and validates a JS→Ruby read-only preflight review command
        # (#466). The review always targets the OWNING furniture. Raises
        # ContractError on any violation; never touches the model.
        def parse_preflight_command!(raw)
          envelope = parse_json(raw)
          assert_schema(envelope)
          assert_type(envelope, 'preflight_command')

          command = envelope['command'].to_s
          unless KNOWN_PREFLIGHT_COMMANDS.include?(command)
            raise ContractError, "Comando de revisión de preflight desconocido: #{command.inspect}"
          end

          target = parse_semantic_target(envelope['semanticTarget'])
          if furniture_scope(target).empty?
            raise ContractError, 'la revisión de preflight requiere identidad del mueble dueño'
          end

          payload = envelope['payload']
          raise ContractError, 'payload debe ser un objeto' unless payload.is_a?(Hash)
          if command == 'navigate_issue' &&
             !(payload['issueId'].is_a?(String) && !payload['issueId'].strip.empty?)
            raise ContractError, 'navigate_issue requiere issueId'
          end

          {
            'messageId' => bounded_string(envelope['messageId'], 'messageId'),
            'command' => command,
            'semanticTarget' => target,
            'payload' => payload
          }
        end

        # Ruby→JS inspection state envelope (#470): the overlay manager
        # payload (mode/status/scope/fingerprint/features) under the same
        # versioned schema as the mutation channel.
        def manufacturing_state_envelope(message_id:, state:)
          raise ContractError, 'state debe ser un objeto' unless state.is_a?(Hash)

          {
            'schemaId' => SCHEMA_ID,
            'type' => 'manufacturing_state',
            'messageId' => bounded_string(message_id, 'messageId'),
            'state' => state
          }
        end

        # Ruby→JS preflight state envelope (#498 invalidation entries;
        # #466 adds the optional review payload — grouped issues, Spanish
        # remediation and navigation context of the last authoritative
        # preflight for a furniture scope).
        def preflight_state_envelope(entries, review: nil)
          envelope = {
            'schemaId' => SCHEMA_ID,
            'type' => 'preflight_state',
            'messageId' => "#{OUTCOME_MESSAGE_PREFIX}-preflight-#{SecureRandom.hex(6)}",
            'entries' => entries
          }
          envelope['review'] = review if review.is_a?(Hash)
          envelope
        end

        def degraded_state_envelope(state, category: nil)
          unless DegradedState::STATES.include?(state)
            raise ContractError, "estado degradado desconocido: #{state.inspect}"
          end

          {
            'schemaId' => SCHEMA_ID,
            'type' => 'degraded_state',
            'messageId' => "#{OUTCOME_MESSAGE_PREFIX}-degraded-#{SecureRandom.hex(6)}",
            'state' => state,
            'category' => category
          }
        end

        def next_outcome_message_id
          "#{OUTCOME_MESSAGE_PREFIX}-#{SecureRandom.hex(8)}"
        end

        def assert_outcome(outcome)
          return if Granete::SketchUpExtension::Host::MutationOutcome::OUTCOMES.include?(outcome)

          raise ContractError, "outcome desconocido: #{outcome.inspect}"
        end

        def assert_category(category)
          return if category.nil? || ErrorTaxonomy::CATEGORIES.include?(category)

          raise ContractError, "categoría de error desconocida: #{category.inspect}"
        end

        def parse_json(raw)
          envelope = raw.is_a?(String) ? JSON.parse(raw) : raw
          raise ContractError, 'envelope debe ser un objeto' unless envelope.is_a?(Hash)

          envelope
        rescue JSON::ParserError
          raise ContractError, 'envelope no es JSON válido'
        end

        def assert_schema(envelope)
          return if envelope['schemaId'] == SCHEMA_ID

          raise ContractError,
                "Schema del host no soportado: #{envelope['schemaId'].inspect} " \
                "(esta extensión entiende #{SCHEMA_ID})"
        end

        def assert_type(envelope, expected)
          if envelope['type'] == expected ||
             (expected == 'mutation_command' && envelope['type'].nil? && envelope['mutation'])
            return
          end

          raise ContractError, "Tipo de mensaje inesperado: #{envelope['type'].inspect}"
        end

        def bounded_string(value, field)
          unless value.is_a?(String) && !value.strip.empty? && value.length <= MAX_ID_LENGTH
            raise ContractError, "#{field} debe ser un string no vacío"
          end

          value
        end

        def compact_issues(issues)
          issues.to_a.map do |issue|
            next { 'code' => issue.to_s } unless issue.respond_to?(:code)

            {
              'code' => issue.code,
              'message' => issue.message,
              'severity' => issue.respond_to?(:severity) ? issue.severity : nil
            }.compact
          end
        end
      end
    end
  end
end
