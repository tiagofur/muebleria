# frozen_string_literal: true

# Mutación de autoría versionada (#498): execute_bridge validado al HtmlDialog.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module HostMutationBridge # rubocop:disable Metrics/ModuleLength
        def handle_authoring_mutation(dialog, payload_json)
          envelope = Host::CommandContract.parse_command!(payload_json)
          case envelope['mutation']
          when 'update_furniture'
            payload = envelope['payload'].merge(
              'instanceId' => envelope['semanticTarget']['furnitureInstanceRef'] ||
                              envelope['payload']['instanceId']
            )
            execute_coordinated_update(dialog, payload, semantic_target: envelope['semanticTarget'],
                                                        command_message_id: envelope['messageId'])
          when 'update_hardware_placement'
            execute_coordinated_hardware_update(dialog, envelope['payload'],
                                                semantic_target: envelope['semanticTarget'],
                                                command_message_id: envelope['messageId'])
          when 'substitute_hardware'
            execute_coordinated_hardware_substitution(dialog, envelope['payload'],
                                                      semantic_target: envelope['semanticTarget'],
                                                      command_message_id: envelope['messageId'])
          when *ComponentAuthoringBridge::COMPONENT_MUTATIONS
            execute_coordinated_component_mutation(dialog, envelope['payload'],
                                                   semantic_target: envelope['semanticTarget'],
                                                   command_message_id: envelope['messageId'],
                                                   mutation: envelope['mutation'])
          end
        rescue Host::CommandContract::ContractError => e
          @logger.error('authoring_mutation_contract_rejected', error: e)
          outcome = Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                              reason: e.message).with_mutation_name('authoring_mutation')
          push_mutation_outcome(dialog, outcome, in_reply_to: nil)
        end

        def execute_coordinated_update(dialog, payload, semantic_target: nil, command_message_id: nil)
          command = build_update_command(payload, semantic_target)
          overlay_mutation_started(command&.semantic_target || semantic_target)
          outcome = if command
                      mutation_coordinator.execute(command, command_message_id: command_message_id)
                    else
                      invalid_update_outcome(payload, semantic_target)
                    end
          legacy = legacy_update_payload(outcome)
          execute_bridge(dialog, 'onUpdateResult', legacy)
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          log_operation_result('furniture_updated', payload['definitionId'] || payload[:definitionId], legacy)
          outcome
        rescue StandardError => e
          @logger.error('furniture_update_failed', error: e)
          failure = { 'success' => false, 'error' => e.message }
          execute_bridge(dialog, 'onUpdateResult', failure)
          outcome = Host::MutationOutcome.new(outcome: 'aborted', category: 'host_apply_failure',
                                              reason: e.message,
                                              semantic_target: semantic_target || {})
                                         .with_mutation_name('update_furniture')
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        end

        def execute_coordinated_hardware_update(dialog, payload, semantic_target: nil, command_message_id: nil)
          command = build_hardware_update_command(payload, semantic_target)
          overlay_mutation_started(command&.semantic_target || semantic_target)
          outcome = if command
                      mutation_coordinator.execute(command, command_message_id: command_message_id)
                    else
                      invalid_hardware_update_outcome(payload, semantic_target)
                    end
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        rescue StandardError => e
          @logger.error('hardware_update_failed', error: e)
          outcome = Host::MutationOutcome.new(outcome: 'aborted', category: 'host_apply_failure',
                                              reason: e.message,
                                              semantic_target: semantic_target || {})
                                         .with_mutation_name('update_hardware_placement')
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        end

        def execute_coordinated_hardware_substitution(dialog, payload, semantic_target: nil, command_message_id: nil)
          command = build_hardware_substitution_command(payload, semantic_target)
          overlay_mutation_started(command&.semantic_target || semantic_target)
          outcome = if command
                      mutation_coordinator.execute(command, command_message_id: command_message_id)
                    else
                      invalid_hardware_substitution_outcome(payload, semantic_target)
                    end
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        rescue StandardError => e
          @logger.error('hardware_substitution_failed', error: e)
          outcome = Host::MutationOutcome.new(outcome: 'aborted', category: 'host_apply_failure',
                                              reason: e.message,
                                              semantic_target: semantic_target || {})
                                         .with_mutation_name('substitute_hardware')
          push_mutation_outcome(dialog, outcome, in_reply_to: command_message_id)
          outcome
        end

        private

        # Command adapter for the furniture update flow. The full #477
        # authoring snapshot capture arrives with #467/#468; today the
        # authoritative resolve rides the server layout channel (nil layout
        # under offline catalogs stays an explicit generic preview).
        # rubocop:disable-next Metrics/AbcSize
        def build_update_command(payload, semantic_target)
          definition_id = payload['definitionId'] || payload[:definitionId]
          definition = @catalog_provider.find_definition(definition_id)
          return nil if definition.nil?

          target = update_semantic_target(payload, semantic_target)
          entity = if target['furnitureInstanceId'] || target['furnitureInstanceRef']
                     find_target_furniture_entity(target['furnitureInstanceRef'])
                   else
                     find_target_furniture_entity(nil)
                   end
          # Selection-first flows still capture an explicit semantic target:
          # the captured entity's own identity, never `selection.first` as
          # lasting truth.
          if entity && target['furnitureInstanceRef'].nil?
            identity = @metadata_store_factory.call(active_model).read(entity)&.dig('identity')
            target['furnitureInstanceRef'] = identity && identity['instanceRef']
          end
          return nil if entity.nil? || active_model.nil? ||
                        Host::CommandContract.semantic_target_key(target).empty?

          params = payload['parameters'] || payload[:parameters] || {}
          choices = merged_material_choices(entity, payload)
          Host::MutationCommand.new(
            name: 'update_furniture',
            operation_name: "Editar Mueble #{definition['name']}",
            semantic_target: target,
            build_furniture_request: nil,
            resolve: ->(ctx) { resolve_update_result(definition, params, choices, ctx) },
            context_valid: -> { update_context_valid?(entity, target) },
            apply: lambda { |result, host_context|
              apply_update_result(host_context, entity, definition, params, choices, result)
            }
          )
        end

        def update_semantic_target(payload, semantic_target)
          base = semantic_target || {}
          ref = base['furnitureInstanceRef'] || payload['instanceId'] || payload[:instanceId]
          target = base.dup
          target['furnitureInstanceRef'] = ref.to_s if ref && !base.key?('furnitureInstanceRef')
          target.reject { |_key, value| value.to_s.strip.empty? }
        end

        def resolve_update_result(definition, params, choices, request_context)
          layout = resolve_layout_for(definition, params, choices)
          Host::LayoutResolveResult.new(
            layout: layout,
            message_id: request_context[:message_id],
            idempotency_key: request_context[:idempotency_key],
            resolve_kind: layout ? 'native_layout' : 'generic_preview'
          )
        end

        def apply_update_result(_host_context, entity, definition, params, choices, result)
          model = entity.respond_to?(:model) && entity.model ? entity.model : active_model
          relationships = result.normalized_snapshot.is_a?(Hash) ? result.normalized_snapshot['relationships'] : nil
          # The server-normalized echo is the authoritative parameter intent
          # (defaults filled, quantity bindings consistent, #467): persisting
          # it keeps the next full-snapshot echo self-consistent.
          normalized_params = if result.normalized_snapshot.is_a?(Hash) &&
                                 result.normalized_snapshot['parameters'].is_a?(Hash)
                                result.normalized_snapshot['parameters']
                              else
                                params
                              end
          outcome = furniture_builder_for(model).update_furniture(
            model, entity, definition, normalized_params,
            resolved_layout: result.layout, material_choices: choices,
            transaction: false, relationships: relationships
          )
          return outcome if outcome['success'] == true

          error = outcome['error'].to_s
          if [Model::FurnitureBuilder::LEGACY_REPRESENTATION_ERROR,
              Model::FurnitureBuilder::MATERIAL_RESOLUTION_REQUIRED_ERROR].include?(error)
            raise Host::MutationCommand::ApplyRefused, error
          end

          raise Host::MutationCommand::ApplyFailed, error
        end

        # Wrong-selection guard: the response may only apply while the exact
        # captured furniture still carries the same semantic identity.
        def update_context_valid?(entity, target)
          return false unless entity&.valid?

          metadata = @metadata_store_factory.call(active_model).read(entity)
          identity = metadata && metadata['identity']
          expected = if target['furnitureInstanceId']
                       identity && identity['furnitureInstanceId']
                     else
                       identity && identity['instanceRef']
                     end
          expected == (target['furnitureInstanceId'] || target['furnitureInstanceRef'])
        rescue JSON::ParserError, Metadata::InvalidMetadataError
          false
        end

        def invalid_update_outcome(payload, semantic_target)
          definition_id = payload['definitionId'] || payload[:definitionId]
          reason = if @catalog_provider.find_definition(definition_id).nil?
                     'Definición no encontrada'
                   else
                     'Instancia no encontrada en el modelo'
                   end
          Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                    reason: reason, semantic_target: semantic_target || {})
                               .with_mutation_name('update_furniture')
        end

        def invalid_hardware_update_outcome(_payload, semantic_target)
          Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                    reason: 'Colocación de herraje o mueble no encontrado',
                                    semantic_target: semantic_target || {})
                               .with_mutation_name('update_hardware_placement')
        end

        def invalid_hardware_substitution_outcome(_payload, semantic_target)
          Host::MutationOutcome.new(outcome: 'rejected', category: 'invalid_authoring_input',
                                    reason: 'Colocación de herraje o mueble no encontrado',
                                    semantic_target: semantic_target || {})
                               .with_mutation_name('substitute_hardware')
        end

        # rubocop:disable Metrics/AbcSize
        def build_hardware_update_command(payload, semantic_target)
          target = update_semantic_target(payload, semantic_target)
          hw_placement_id = target['hardwarePlacementId']
          return nil if hw_placement_id.to_s.strip.empty?

          entity = find_target_furniture_entity(target['furnitureInstanceRef'] || target['furnitureInstanceId'])
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
          new_offset = payload['offsetMm']

          Host::MutationCommand.new(
            name: 'update_hardware_placement',
            operation_name: "Editar Colocación de Herraje #{hw_placement_id}",
            semantic_target: target,
            build_furniture_request: nil,
            resolve: lambda { |ctx|
              resolve_hardware_mutation(entity, definition, params, choices, target,
                                        ctx: ctx, new_offset: new_offset)
            },
            context_valid: -> { update_context_valid?(entity, target) },
            apply: lambda { |result, host_context|
              apply_update_result(host_context, entity, definition, params, choices, result)
            }
          )
        end

        def build_hardware_substitution_command(payload, semantic_target)
          target = update_semantic_target(payload, semantic_target)
          hw_placement_id = target['hardwarePlacementId']
          return nil if hw_placement_id.to_s.strip.empty?

          entity = find_target_furniture_entity(target['furnitureInstanceRef'] || target['furnitureInstanceId'])
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
          target_hw_id = payload['targetHardwareDefinitionId'] || payload['hardwareDefinitionId']

          Host::MutationCommand.new(
            name: 'substitute_hardware',
            operation_name: "Sustituir Herraje #{hw_placement_id}",
            semantic_target: target,
            build_furniture_request: nil,
            resolve: lambda { |ctx|
              resolve_hardware_mutation(entity, definition, params, choices, target,
                                        ctx: ctx, target_hardware_id: target_hw_id)
            },
            context_valid: -> { update_context_valid?(entity, target) },
            apply: lambda { |result, host_context|
              apply_update_result(host_context, entity, definition, params, choices, result)
            }
          )
        end
        # rubocop:enable Metrics/AbcSize

        def guard_against_derived_hardware_edit!(entity, target)
          store = @metadata_store_factory.call(active_model)
          child = Host::SelectionRestore.new(metadata_store_factory: @metadata_store_factory,
                                             model_provider: -> { active_model }).send(:locate_child, entity, target)
          hw_meta = child ? store.read(child) : nil
          hw_intent = hw_meta&.dig('intent') || {}
          hw_kind = hw_intent['placementKind'] || target['placementKind']

          return unless hw_kind == 'derived'

          issue = Library::AuthoringResolveIssue.new(
            'code' => 'HARDWARE_DERIVED_EDIT',
            'message' => 'Los herrajes derivados se calculan por regla de ingeniería y no admiten edición manual',
            'severity' => 'error'
          )
          raise Library::AuthoringResolveError.new(issue.message, issues: [issue])
        end

        def layout_components(layout)
          layout.boards.map do |b|
            {
              'componentInstanceId' => b.component_instance_id,
              'componentDefinitionId' => b.component_definition_id,
              'role' => b.role
            }
          end
        end

        def current_catalog_revision
          if @catalog_provider.respond_to?(:catalog_revision) && @catalog_provider.catalog_revision
            @catalog_provider.catalog_revision
          else
            'workshop-current'
          end
        end

        def persisted_furniture_relationships(entity)
          store = @metadata_store_factory.call(active_model)
          furniture_meta = store.read(entity)
          furniture_meta.is_a?(Hash) ? furniture_meta['relationships'] : nil
        end

        def build_hardware_mutation_request(definition, params, choices, base_layout,
                                            hardware_placements, relationships, components: nil)
          req = {
            'furnitureDefinitionId' => definition['furniture_definition_id'] || definition['id'],
            'catalogRevision' => current_catalog_revision,
            'parameters' => params || {},
            'materialChoices' => choices || {},
            'components' => components || layout_components(base_layout),
            'hardwarePlacements' => hardware_placements
          }
          req['relationships'] = relationships if relationships.is_a?(Array) && !relationships.empty?
          req
        end

        def resolve_hardware_mutation(entity, definition, params, choices, target,
                                      ctx:, new_offset: nil, target_hardware_id: nil)
          guard_against_derived_hardware_edit!(entity, target)

          base_layout = resolve_layout_for(definition, params, choices)
          raise Library::AuthoringResolveError, 'No se pudo resolver el layout del mueble' if base_layout.nil?

          relationships = persisted_furniture_relationships(entity)
          hardware_placements = build_hardware_authoring_intents(
            base_layout, target['hardwarePlacementId'], new_offset, target_hardware_id
          )
          furniture_req = build_hardware_mutation_request(
            definition, params, choices, base_layout, hardware_placements, relationships
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

        def next_hardware_offset(placement, new_offset)
          return placement.offset_mm || [0.0, 0.0] if new_offset.nil?
          return [new_offset[0].to_f, (new_offset[1] || new_offset[0]).to_f] if new_offset.is_a?(Array)

          base_x = placement.offset_mm ? placement.offset_mm[0].to_f : 0.0
          [base_x, new_offset.to_f]
        end

        def build_hardware_authoring_intents(base_layout, target_placement_id, new_offset, target_hardware_id)
          base_layout.hardware.filter_map do |hp|
            is_target = hp.placement_id == target_placement_id
            next if hp.placement_kind == 'derived' && !is_target

            next_hw_id = is_target && target_hardware_id ? target_hardware_id : hp.hardware_id
            offset = is_target ? next_hardware_offset(hp, new_offset) : (hp.offset_mm || [0.0, 0.0])
            {
              'hardwarePlacementId' => hp.placement_id,
              'placementKind' => hp.placement_kind || 'manual',
              'catalogHardwareId' => next_hw_id,
              'hostComponentInstanceId' => hp.host_component_instance_id,
              'anchorFace' => hp.anchor_face || 'front',
              'offsetMm' => offset
            }
          end
        end

        # Legacy onUpdateResult shape so the existing inspector UX keeps
        # working; the versioned truth rides onMutationState.
        def legacy_update_payload(outcome)
          result = outcome.result if outcome.committed?
          return result if result.is_a?(Hash) && result['success'] == true

          payload = { 'success' => false, 'error' => outcome.reason || 'No se pudo actualizar el mueble' }
          issues = outcome.issues.to_a.map do |issue|
            { 'code' => issue.code, 'message' => issue.message,
              'severity' => issue.respond_to?(:severity) ? issue.severity : nil,
              'path' => issue.respond_to?(:path) ? issue.path : nil }.compact
          end
          payload['issues'] = issues unless issues.empty?
          payload
        end

        def push_mutation_outcome(dialog, outcome, in_reply_to:)
          mark_commercial_projection_local_work if outcome.committed?
          execute_bridge(dialog, 'onMutationState', outcome.to_envelope(in_reply_to: in_reply_to))
          if outcome.committed? && mutation_coordinator.preflight_tracker
            # #466: the post-mutation invalidation push carries entries AND
            # the review of the owning furniture, so the review panel shows
            # the honest stale state instead of the pre-mutation verdict.
            scope = Host::CommandContract.furniture_scope(outcome.semantic_target)
            review = preflight_review_session.reviews[
              Host::CommandContract.semantic_target_key(scope)
            ]
            execute_bridge(dialog, 'onPreflightState',
                           Host::CommandContract.preflight_state_envelope(
                             mutation_coordinator.preflight_tracker.payload,
                             review: review && preflight_review_session.payload_for(scope),
                             publication_gate: publication_gate_projection
                           ))
          end
          # #470: a manufacturing-affecting mutation refreshes the overlay
          # from the NEW accepted fingerprint or leaves it honestly stale.
          overlay_mutation_outcome(outcome)
          push_manufacturing_state(dialog) if @manufacturing_overlay&.mode_on?
          refresh_project_furniture if outcome.committed? && @project_furniture_placer
        end

        # Honest dialog-level degraded state derived from catalog/session
        # provenance (#498 minimum; #474 owns the full offline product).
        def push_degraded_state(dialog)
          return unless @catalog_provider.respond_to?(:last_source)

          state = Host::DegradedState.for_catalog_source(@catalog_provider.last_source)
          execute_bridge(dialog, 'onDegradedState', Host::CommandContract.degraded_state_envelope(state))
        rescue StandardError => e
          @logger.error('dialog_degraded_state_failed', error: e)
        end
      end

      # Insert/update callback handlers, extracted to keep DialogController
      # within its class-length budget. Both resolve the furniture's real
      # composition server-side before touching the model.
    end
  end
end
