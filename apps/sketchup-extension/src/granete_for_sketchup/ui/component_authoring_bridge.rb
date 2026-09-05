# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module UserInterface
      # #467 / SU-AUTH-1: direct internal-component authoring. Move/add/
      # duplicate/remove of a movable internal occurrence is expressed as
      # component authoring intent on the #477 resolve contract and runs
      # through the ONE #498 Host::AuthoringMutationCoordinator — this bridge
      # only adapts dialog payloads into MutationCommand seams.
      #
      # Authority boundary (final #467 correction):
      #   - the client proposes occurrence identity (canonical #477: the
      #     occurrence set carries client-authored componentInstanceIds and
      #     the server validates collisions and echoes the ACCEPTED set);
      #   - the client NEVER constructs relationship topology — it echoes the
      #     last accepted relationship set verbatim on move/add/duplicate and
      #     OMITS it on remove; Granete materializes/cleans relationships,
      #     their identities and every manufacturing consequence;
      #   - movability comes exclusively from the engine-published
      #     authoringCapability {movable, axis}; the viewport gesture authors
      #     along that published axis;
      #   - position RANGE validity is server authority: the plugin validates
      #     only transport shape (three finite millimetres).
      # rubocop:disable Metrics/ModuleLength
      module ComponentAuthoringBridge
        COMPONENT_MUTATIONS = %w[move_component add_component duplicate_component
                                 remove_component].freeze
        COUNT_CHANGING_MUTATIONS = %w[add_component duplicate_component remove_component].freeze

        def execute_coordinated_component_mutation(dialog, payload, semantic_target: nil,
                                                   command_message_id: nil,
                                                   mutation: 'move_component')
          command = build_component_mutation_command(payload, semantic_target, mutation)
          overlay_mutation_started(command&.semantic_target || semantic_target)
          outcome = if command
                      mutation_coordinator.execute(command, command_message_id: command_message_id)
                    else
                      invalid_component_mutation_outcome(payload, semantic_target, mutation)
                    end
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        rescue StandardError => e
          @logger.error('component_mutation_failed', error: e)
          outcome = Host::MutationOutcome.new(outcome: 'aborted', category: 'host_apply_failure',
                                              reason: e.message,
                                              semantic_target: semantic_target || {})
                                         .with_mutation_name(mutation)
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        end

        # Constrained viewport gesture (#467 interaction contract §7): a drag
        # along the ENGINE-PUBLISHED authoring axis previews the target pose
        # as pure viewport pixels and commits the SAME semantic move intent on
        # click. The tool never mutates entities/metadata — the coordinator's
        # atomic rebuild is the only productive change.
        def handle_component_viewport_move(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          target = Host::CommandContract.parse_semantic_target(payload['semanticTarget'] || payload)

          furniture = find_target_furniture_entity(target['furnitureInstanceRef'] ||
                                                   target['furnitureInstanceId'])
          child = locate_component_occurrence(furniture, target['componentInstanceId'])
          axis = component_authoring_axis(child)
          base_translation = component_base_translation(child)
          if furniture.nil? || child.nil? || axis.nil? || base_translation.nil?
            outcome = Host::MutationOutcome.new(
              outcome: 'rejected', category: 'invalid_authoring_input',
              reason: 'No se pudo localizar un componente interno movible para mover en el ' \
                      'viewport; verificá la selección y volvé a intentarlo',
              semantic_target: target
            ).with_mutation_name('move_component')
            push_mutation_outcome(dialog, outcome, in_reply_to: nil)
            return
          end

          tool = Tools::InternalComponentMoveTool.new(
            furniture: furniture, child: child, base_translation_mm: base_translation,
            authoring_axis: axis, logger: @logger
          ) do |translation_mm|
            execute_coordinated_component_mutation(
              dialog, { 'translationMm' => translation_mm },
              semantic_target: target, mutation: 'move_component'
            )
          end
          active_model.select_tool(tool) if active_model.respond_to?(:select_tool)
        rescue Host::CommandContract::ContractError, JSON::ParserError => e
          @logger.error('component_viewport_move_rejected', error: e)
        end

        private

        # rubocop:disable-next Metrics/AbcSize
        def build_component_mutation_command(payload, semantic_target, mutation_name)
          target = update_semantic_target(payload, semantic_target)
          comp_id = target['componentInstanceId']
          return nil if comp_id.to_s.strip.empty?

          entity = find_target_furniture_entity(target['furnitureInstanceRef'] ||
                                                target['furnitureInstanceId'])
          return nil if entity.nil? || active_model.nil?

          store = @metadata_store_factory.call(active_model)
          furniture_meta = store.read(entity)
          definition_id = payload['definitionId'] ||
                          furniture_meta&.dig('intent', 'furnitureDefinitionId') ||
                          furniture_meta&.dig('identity', 'furnitureDefinitionId') ||
                          furniture_meta&.dig('definition', 'furniture_definition_id')
          definition = @catalog_provider.find_definition(definition_id)
          return nil if definition.nil?

          params = furniture_meta&.dig('intent', 'parameters') || {}
          choices = merged_material_choices(entity, furniture_meta)
          # Client-proposed occurrence identity is canonical #477 contract
          # shape (the server validates collisions and echoes the ACCEPTED
          # id); everything else — relationships, machining — is server
          # authority. The base occurrence set travels in a box so the
          # post-rebuild selection can find the ACCEPTED new occurrence even
          # when the server settles a different identity.
          new_component_id = "ci-#{SecureRandom.hex(8)}"
          base_ids = {}

          Host::MutationCommand.new(
            name: mutation_name,
            operation_name: component_operation_name(mutation_name, comp_id),
            semantic_target: target,
            build_furniture_request: nil,
            resolve: lambda { |ctx|
              resolve_component_mutation(entity, definition, params, choices, target,
                                         ctx: ctx, mutation: mutation_name, payload: payload,
                                         new_component_id: new_component_id, base_ids: base_ids)
            },
            context_valid: -> { update_context_valid?(entity, target) },
            apply: lambda { |result, host_context|
              apply_update_result(host_context, entity, definition, params, choices, result)
            },
            restore_selection: lambda { |result|
              restore_component_selection(result, target, mutation_name, base_ids,
                                          draft_id: new_component_id,
                                          requested: payload['translationMm'])
            }
          )
        end

        def resolve_component_mutation(entity, definition, params, choices, target,
                                       ctx:, mutation:, payload:, new_component_id:,
                                       base_ids:)
          base_layout = resolve_layout_for(definition, params, choices)
          raise Library::AuthoringResolveError, 'No se pudo resolver el layout del mueble' if base_layout.nil?

          base_ids[:ids] = base_layout.boards.map(&:component_instance_id)
          board = base_layout.boards.find do |b|
            b.component_instance_id == target['componentInstanceId']
          end
          guard_against_non_authorable_component!(board, target['componentInstanceId'])
          base_ids[:target_def] = board.component_definition_id

          components = component_occurrence_intents(base_layout, board, mutation, payload,
                                                    new_component_id)
          synced_params = component_quantity_parameters(definition, params, board, components,
                                                        mutation)
          # Relationship topology is Granete's: EVERY mutation echoes the
          # last ACCEPTED set verbatim — including removals, whose stale
          # anchors the server prunes authoritatively. Ruby never filters
          # relationships and never decides dependencies.
          relationships = persisted_furniture_relationships(entity)
          hardware_placements = build_hardware_authoring_intents(base_layout, nil, nil, nil)
          furniture_req = build_hardware_mutation_request(
            definition, synced_params, choices, base_layout, hardware_placements, relationships,
            components: components
          )

          req_payload = Library::AuthoringResolveRequest.build_request(
            message_id: ctx[:message_id] || "msg-#{SecureRandom.hex(4)}",
            idempotency_key: ctx[:idempotency_key] || "idemp-#{SecureRandom.hex(4)}",
            furniture: furniture_req
          )

          result = @catalog_provider.resolve_authoring(req_payload) if @catalog_provider.respond_to?(:resolve_authoring)
          if result.nil?
            raise Library::AuthoringResolveError, 'No se pudo resolver la autoría en el servidor autoritativo'
          end

          result
        end

        # Fail-closed authoring boundary: only occurrences carrying the
        # engine-published authoring capability ({movable, axis}) accept
        # direct authoring. Structural/agregado templates and legacy layouts
        # publish none — Granete's resolve is the authority behind this
        # affordance, never a plugin formula.
        def guard_against_non_authorable_component!(board, target_id)
          if board.nil?
            raise non_authorable_issue(
              'OCCURRENCE_UNKNOWN_TEMPLATE',
              "La ocurrencia #{target_id} no forma parte de la composición actual del mueble",
              'Reinsertá el mueble o volvé a seleccionar el componente antes de editar.'
            )
          end
          return if board.movable_internal?

          raise non_authorable_issue(
            'OCCURRENCE_COUNT_UNSUPPORTED',
            "El componente #{target_id} no publica capacidad de autoría directa",
            'Granete define qué internos son movibles; las piezas estructurales mantienen la ' \
            'posición definida por la definición.'
          )
        end

        def non_authorable_issue(code, message, remediation)
          issue = Library::AuthoringResolveIssue.new(
            'code' => code, 'message' => message,
            'severity' => 'error', 'remediation' => remediation
          )
          Library::AuthoringResolveError.new(message, issues: [issue])
        end

        # Occurrence snapshot echo with the semantic edit applied: every
        # occurrence keeps its CURRENT authoritative assembly translation so
        # a previously moved occurrence never resets to the default pose, a
        # move overrides the target's transform with the requested position,
        # add/duplicate append the proposed occurrence and remove drops the
        # target. The server plans the result and owns every consequence.
        def component_occurrence_intents(base_layout, board, mutation, payload, new_component_id)
          intents = base_layout.boards.map do |b|
            intent = {
              'componentInstanceId' => b.component_instance_id,
              'componentDefinitionId' => b.component_definition_id
            }
            if b.component_instance_id == board.component_instance_id &&
               mutation == 'move_component'
              intent['transform'] = requested_transform(payload)
            elsif b.translation
              # #414: the authoritative POSE is localTransform.translationMm
              # (board.translation); the AABB is preview convenience and is
              # never echoed as authoring truth.
              intent['transform'] = { 'frame' => 'assembly', 'translationMm' => b.translation.map(&:to_f) }
            end
            intent
          end

          case mutation
          when 'remove_component'
            intents.reject { |intent| intent['componentInstanceId'] == board.component_instance_id }
          when 'add_component', 'duplicate_component'
            intents + [{
              'componentInstanceId' => new_component_id,
              'componentDefinitionId' => board.component_definition_id,
              'transform' => requested_transform(payload)
            }]
          else
            intents
          end
        end

        # Transport shape only: three finite numeric millimetres. Whether the
        # requested POSITION is allowed (envelope, clearances, interference,
        # relationship limits) is Granete's decision — the resolve rejects
        # with TRANSFORM_INVALID and the allowed range.
        def requested_transform(payload)
          raw = payload['translationMm']
          unless raw.is_a?(Array) && raw.length == 3 &&
                 raw.all? { |value| value.is_a?(Numeric) && value.to_f.finite? }
            raise non_authorable_issue(
              'TRANSFORM_INVALID',
              'La posición debe ser tres valores numéricos en mm (X, Y, Z)',
              'Ingresá la posición del componente en milímetros.'
            )
          end

          { 'frame' => 'assembly', 'translationMm' => raw.map(&:to_f) }
        end

        # Keeps the occurrence snapshot consistent with every evaluated
        # componentQuantity binding (the server cross-validates both sides
        # with PARAMETER_BINDING_CONFLICT): count-changing mutations sync the
        # bound parameter value to the new occurrence count.
        def component_quantity_parameters(definition, params, board, components, mutation)
          return params unless COUNT_CHANGING_MUTATIONS.include?(mutation)

          bound = quantity_bound_parameters(definition, board)
          return params if bound.empty?

          count = components.count do |intent|
            intent['componentDefinitionId'] == board.component_definition_id
          end
          merged = (params || {}).dup
          bound.each { |param| merged[param['name']] = count }
          merged
        end

        def quantity_bound_parameters(definition, board)
          return [] unless definition.is_a?(Hash)

          (definition['parameters'] || []).select do |param|
            binding = param.is_a?(Hash) ? param['binding'] : nil
            next false unless binding.is_a?(Hash) && binding['kind'] == 'componentQuantity'

            bound_component?(binding['componentId'], board)
          end
        end

        # A quantity binding references the catalog component; a resolved
        # board carries that reference as catalogComponentId and/or as the
        # #346 authoring definition ID (`mod-<catalogComponentId>`, the
        # engine's deterministic template derivation). Either match is
        # contract data — never a name guess.
        def bound_component?(component_id, board)
          return false unless component_id

          component_id == board.catalog_component_id ||
            "mod-#{component_id}" == board.component_definition_id
        end

        def component_operation_name(mutation, comp_id)
          case mutation
          when 'move_component' then "Mover Componente Interno #{comp_id}"
          when 'add_component' then 'Agregar Componente Interno'
          when 'duplicate_component' then "Duplicar Componente Interno #{comp_id}"
          else "Quitar Componente Interno #{comp_id}"
          end
        end

        def invalid_component_mutation_outcome(_payload, semantic_target, mutation)
          Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                    reason: 'Componente interno o mueble no encontrado',
                                    semantic_target: semantic_target || {})
                               .with_mutation_name(mutation)
        end

        # Post-rebuild selection by ACCEPTED identity (#467 final
        # correction). The accepted new occurrence is resolved from the
        # AUTHORITATIVE echo, in descending contract certainty:
        #   1. the echoed draft id (canonical design A: the server validates
        #      and echoes the client-proposed occurrence identity);
        #   2. the accepted occurrence of the same definition at the REQUESTED
        #      transform (the settled identity when the echo re-identifies);
        #   3. the single id the echo added on top of the base set.
        # Never the local draft as truth, never names/persistent_id. Remove
        # falls back to the owning furniture.
        def restore_component_selection(result, target, mutation_name, base_ids, draft_id:, requested:)
          wanted = target['componentInstanceId']
          if %w[add_component duplicate_component].include?(mutation_name)
            components = snapshot_components(result)
            draft = components.find do |component|
              component['componentInstanceId'] == draft_id
            end
            if draft
              wanted = draft_id
            else
              at_requested_position = components.select do |component|
                component['componentDefinitionId'] == base_ids[:target_def] &&
                  translation_matches?(component['transform'], requested)
              end
              added = components.map { |component| component['componentInstanceId'] }
                                .reject { |id| base_ids[:ids].to_a.include?(id) }
              wanted = if at_requested_position.length == 1
                         at_requested_position.first['componentInstanceId']
                       elsif added.length == 1
                         added.first
                       else
                         wanted
                       end
            end
          end

          restorer.restore(target.merge('componentInstanceId' => wanted))
        end

        def translation_matches?(transform, requested)
          return false unless transform.is_a?(Hash) && requested.is_a?(Array)

          translation = transform['translationMm']
          translation.is_a?(Array) && translation.length == 3 &&
            requested.length == 3 &&
            translation.each_with_index.all? { |value, index| (value - requested[index].to_f).abs < 0.01 }
        end

        def snapshot_components(result)
          snapshot = result.respond_to?(:normalized_snapshot) ? result.normalized_snapshot : nil
          snapshot.is_a?(Hash) && snapshot['components'].is_a?(Array) ? snapshot['components'] : []
        end

        def restorer
          @restorer ||= Host::SelectionRestore.new(
            metadata_store_factory: @metadata_store_factory,
            model_provider: -> { active_model },
            logger: @logger
          )
        end

        def locate_component_occurrence(furniture, component_id)
          return nil if furniture.nil? || component_id.to_s.strip.empty?

          restorer.send(:locate_child, furniture, 'componentInstanceId' => component_id)
        end

        # Seed pose for the viewport gesture: the assembly translation stored
        # at the last rebuild. Display/preview seed only — the authoritative
        # resolve re-reads the fresh layout.
        def component_base_translation(child)
          return nil unless child

          metadata = @metadata_store_factory.call(active_model).read(child)
          translation = metadata&.dig('intent', 'assemblyTranslationMm')
          translation.is_a?(Array) && translation.length == 3 ? translation.map(&:to_f) : nil
        end

        # The gesture authors along the axis the ENGINE published with the
        # capability — never a client-side axis decision.
        def component_authoring_axis(child)
          return nil unless child

          metadata = @metadata_store_factory.call(active_model).read(child)
          capability = metadata&.dig('intent', 'authoringCapability')
          if capability.is_a?(Hash) && capability['movable'] == true &&
             Library::AUTHORING_AXES.include?(capability['axis'])
            capability['axis']
          end
        end
      end
    end
  end
end
# rubocop:enable Metrics/ModuleLength
