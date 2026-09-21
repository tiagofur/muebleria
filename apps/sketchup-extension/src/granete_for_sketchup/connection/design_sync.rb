# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      # #810 — the single explicit "Sincronizar diseño" operation plus the
      # conflict-safe write shared by EVERY working-copy writer.
      #
      # The extension never performs a blind full PUT from reconstructed
      # local state: the desired working copy is built from the SERVER
      # working copy plus the local dirty intent, preserving unmodified
      # fields verbatim. Dirty intent is derived per furnitureInstanceId:
      #   * add    — local managed top-level root, working item absent;
      #   * update — entity carries the persisted authoring-dirty flag (a
      #              local parameter/material edit awaiting confirmed sync)
      #              or its transform differs from the working item;
      #   * remove — working item with no local root: a conscious
      #              Design-intent delete. The Project FurnitureInstance is
      #              NEVER touched: the panel re-derives the unit as pending
      #              and re-placing reuses the same identity (#810 Caso 1).
      #
      # Every write goes through the canonical frontier
      # (expected_working_version, validated server-side under the write
      # lock) and success is reported only after the authoritative accepted
      # state matches the intent. A lost response retried later converges
      # when the server state already equals the intention; real divergence
      # surfaces as conflict without ever overwriting the newer state.
      module DesignSync
        # Numeric-tolerant semantic equivalence between the working items the
        # server holds and the items the extension intends.
        module ItemsEquivalence
          module_function

          def equivalent_items?(server_items, intended_items)
            server_by_id = server_items.to_h { |item| [item.furniture_instance_id, item] }
            intended_by_id = intended_items.to_h { |item| [item.furniture_instance_id, item] }
            return false unless server_by_id.keys.sort == intended_by_id.keys.sort

            intended_by_id.all? do |id, intended|
              equivalent_item?(server_by_id[id], intended)
            end
          end

          def equivalent_item?(server_item, intended_item)
            return false unless server_item.is_a?(ProjectFurniture::Contract::WorkingItem) &&
                                intended_item.is_a?(ProjectFurniture::Contract::WorkingItem)

            values_equal?(server_item.parameters, intended_item.parameters) &&
              values_equal?(server_item.material_choices, intended_item.material_choices) &&
              server_item.furniture_definition_id == intended_item.furniture_definition_id &&
              ProjectFurniture::Contract.authoritative_definition_version(server_item.definition_version) ==
                ProjectFurniture::Contract.authoritative_definition_version(intended_item.definition_version) &&
              server_item.room_id == intended_item.room_id &&
              transform_equivalent?(server_item.transform, intended_item.transform) &&
              locator_equal?(server_item.technical_client_locator, intended_item.technical_client_locator)
          end

          def transform_equivalent?(server_transform, intended_transform)
            return true if server_transform.nil? && intended_transform.nil?
            return false unless server_transform && intended_transform

            ProjectFurniture::TransformContract.equivalent?(server_transform, intended_transform)
          end

          def locator_equal?(server_locator, intended_locator)
            return true if server_locator.nil? && intended_locator.nil?
            return false unless server_locator.is_a?(Hash) && intended_locator.is_a?(Hash)

            server_locator['kind'].to_s == intended_locator['kind'].to_s &&
              server_locator['value'].to_s == intended_locator['value'].to_s
          end

          # JSON numbers cross the wire as Integer or Float depending on the
          # producer; 600 and 600.0 are the same authored value.
          def values_equal?(server_value, intended_value)
            normalized(server_value) == normalized(intended_value)
          end

          def normalized(value)
            case value
            when Hash then value.keys.sort.to_h { |key| [key, normalized(value[key])] }
            when Array then value.map { |item| normalized(item) }
            when Numeric then value.to_f
            else value
            end
          end
        end

        # The canonical conflict-safe working-copy write (#810 frontier),
        # shared by placer, position sync, publish pre-sync, duplicate
        # resolution and the explicit Synchronize Design operation. Sends
        # the workingVersion token held by the caller's `working` read; on a
        # typed VERSION_CONFLICT re-reads the authoritative state: a retry
        # whose intention already landed (lost response) converges; real
        # divergence re-raises the conflict — the newer server state is
        # never overwritten.
        module SafeWrite
          module_function

          def version_conflict?(error)
            error.is_a?(ProjectFurniture::Service::Error) &&
              error.api_code == 'VERSION_CONFLICT'
          end

          def write(service:, working:, items:, base_revision_id:, source_type: 'sketchup')
            wc = service.update_working_copy(
              working.design_id, items: items, base_revision_id: base_revision_id,
                                 source_type: source_type, expected_working_version: working.updated_at
            )
            { 'working' => wc, 'code' => 'written' }
          rescue ProjectFurniture::Service::Error => e
            raise unless version_conflict?(e)

            current = service.get_working_copy(working.design_id)
            unless ItemsEquivalence.equivalent_items?(current.items, items)
              raise ProjectFurniture::Service::Error.new(
                :conflict,
                'el diseño cambió en el servidor; sincronizá de nuevo para ver el estado actual',
                status: e.status, api_code: e.api_code
              )
            end

            { 'working' => current, 'code' => 'converged' }
          end
        end

        # Builds the desired working-copy state (server WC + dirty local
        # intent) and the exact change set. Pure: no service calls, no host
        # mutation.
        module IntentBuilder
          module_function

          def build(working:, local:)
            items = working.items.dup
            added = []
            updated = []

            local[:by_id].each do |id, entries|
              next if entries.length > 1 # duplicates are surfaced by the caller

              outcome = merge_local_entry(items, id, entries.first)
              items = outcome[:items]
              added << id if outcome[:change] == :added
              updated << id if outcome[:change] == :updated
            end

            removed = remove_missing_locals(items, working, local)
            { items: items, added: added, updated: updated, removed: removed }
          end

          # One local root against the server state: an add when the working
          # copy lacks the id, an update when the merged item really differs
          # (authoring-dirty fields or transform/locator), verbatim
          # preservation otherwise.
          def merge_local_entry(items, id, entry)
            entity = entry[:entity]
            metadata = entry[:metadata].is_a?(Hash) ? entry[:metadata] : {}
            return { items: items, change: nil } unless entity.respond_to?(:transformation)

            intent = metadata['intent'].is_a?(Hash) ? metadata['intent'] : {}
            locator = ProjectFurniture::ManagedFurniture.persistent_locator(entity)

            existing = items.find { |item| item.furniture_instance_id == id }
            if existing.nil?
              item = ProjectFurniture::WorkingCopyMerger.new_working_item(id, entity, intent, locator)
              return { items: items + [item], change: :added }
            end

            merged = ProjectFurniture::WorkingCopyMerger.merge(
              wrap(items), id, entity, intent: intent, locator: locator,
                                       authoring_dirty: metadata['authoringDirty'] == true
            )
            merged_item = merged.find { |item| item.furniture_instance_id == id }
            return { items: items, change: nil } if ItemsEquivalence.equivalent_item?(existing, merged_item)

            { items: merged, change: :updated }
          end

          # Working items with no local root are the conscious remove intent
          # (#810 Caso 1): the Design drops them; the Project keeps the
          # FurnitureInstance and the panel re-derives the unit as pending.
          def remove_missing_locals(items, working, local)
            removed = []
            local_ids = local[:by_id].keys
            working.items.each do |item|
              id = item.furniture_instance_id
              next if local_ids.include?(id)

              items.reject! { |candidate| candidate.furniture_instance_id == id }
              removed << id
            end
            removed
          end

          def wrap(items)
            ProjectFurniture::Contract::WorkingCopy.new(
              design_id: nil, project_id: nil, base_revision_id: nil,
              updated_at: nil, items: items
            )
          end
        end

        # The user-facing operation: one explicit, conscious sync of the
        # connected design. Success is only reported after the authoritative
        # accepted state matches the intent (readback verification).
        class Synchronizer
          def initialize(model_provider:, binding_store_factory:, model_binding_service:,
                         service:, metadata_store_factory:, logger: SafeLogger.new)
            @model_provider = model_provider
            @binding_store_factory = binding_store_factory
            @model_binding_service = model_binding_service
            @service = service
            @metadata_store_factory = metadata_store_factory
            @logger = logger
          end

          attr_reader :service

          def synchronize_design
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            context = ProjectFurniture::PlacementGuards.placement_context(
              binding_store(model), @model_binding_service
            )
            return context unless context['ok']

            sync_connected_design(model, context['binding'])
          rescue ProjectFurniture::Service::Error => e
            code = SafeWrite.version_conflict?(e) ? 'conflict' : e.kind.to_s
            @logger.error('design_sync_failed', error: e)
            failure(code, e.message)
          rescue ProjectFurniture::Contract::ContractError => e
            @logger.error('design_sync_contract_failed', error: e)
            failure(:bad_contract, e.message)
          rescue StandardError => e
            @logger.error('design_sync_unexpected_failed', error: e)
            failure(:sync_failed, e.message)
          end

          private

          def sync_connected_design(model, binding)
            working, local = read_authorities(model, binding)
            duplicate_ids = local[:by_id].select { |_id, entries| entries.length > 1 }.keys
            if duplicate_ids.any?
              return failure(:duplicate_detected, ProjectFurniture::DUPLICATE_MESSAGE,
                             'duplicates' => duplicate_ids)
            end

            intent = IntentBuilder.build(working: working, local: local)
            changes = { 'added' => intent[:added], 'updated' => intent[:updated],
                        'removed' => intent[:removed] }
            return synchronized_result(binding, changes, working.updated_at, false) if changes.values.all?(&:empty?)

            outcome = SafeWrite.write(service: @service, working: working,
                                      items: intent[:items], base_revision_id: binding.base_revision_id)
            authoritative = outcome['working']

            mismatch = verify_readback(authoritative, intent, binding)
            return mismatch if mismatch

            clear_authoring_dirty(model, intent[:updated] + intent[:added])
            @logger.info('design_sync_synchronized',
                         design_id: binding.design_id,
                         added: intent[:added], updated: intent[:updated], removed: intent[:removed])
            synchronized_result(binding, changes, authoritative.updated_at,
                                outcome['code'] == 'converged')
          end

          def read_authorities(model, binding)
            working = @service.get_working_copy(binding.design_id)
            local = ProjectFurniture::ManagedFurniture.index(
              model, @metadata_store_factory.call(model)
            )
            [working, local]
          end

          def synchronized_result(binding, changes, working_version, converged)
            result = { 'ok' => true, 'code' => 'synchronized', 'changes' => changes,
                       'designId' => binding.design_id, 'workingVersion' => working_version }
            result['converged'] = true if converged
            result
          end

          # Readback verification: the state the server ACCEPTED must match
          # the intention sent — added/updated items present and semantically
          # equal, removed ids absent, and the working copy still bound to
          # the exact model binding. The accepted state is the PUT response
          # itself (committed and re-read server-side); a converged retry is
          # verified against the authoritative re-read that proved the
          # convergence.
          def verify_readback(authoritative, intent, binding)
            intended_by_id = intent[:items].to_h { |item| [item.furniture_instance_id, item] }
            (intent[:added] + intent[:updated]).each do |id|
              accepted = authoritative.items.find { |item| item.furniture_instance_id == id }
              unless accepted && ItemsEquivalence.equivalent_item?(accepted, intended_by_id[id])
                return failure(:readback_mismatch,
                               'el estado aceptado por el servidor difiere de la intención enviada')
              end
            end
            intent[:removed].each do |id|
              if authoritative.items.any? { |item| item.furniture_instance_id == id }
                return failure(:readback_mismatch,
                               "el servidor conserva un mueble que se quitó del diseño (#{id})")
              end
            end
            unless authoritative.project_id == binding.project_id &&
                   authoritative.base_revision_id == binding.base_revision_id
              return failure(:base_revision_mismatch,
                             'el Working Copy devuelto no corresponde a la revisión base del modelo')
            end

            nil
          end

          # Clears the persisted authoring-dirty flag of every item whose
          # confirmed sync just landed; the flag is the ONLY marker that a
          # local edit still owes the working copy its fields (#810 rule C).
          def clear_authoring_dirty(model, ids)
            return if ids.empty?

            store = @metadata_store_factory.call(model)
            ids.each do |id|
              entries = ProjectFurniture::ManagedFurniture.locate(model, store, id)
              entity = entries && entries['entity']
              next unless entity

              metadata = store.read(entity)
              next unless metadata.is_a?(Hash) && metadata['authoringDirty']

              metadata.delete('authoringDirty')
              store.write(entity, metadata)
            end
          end

          def binding_store(model)
            factory = @binding_store_factory
            factory.arity.zero? ? factory.call : factory.call(model)
          end

          def failure(code, reason, extra = {})
            { 'ok' => false, 'code' => code.to_s, 'reason' => reason }.merge(extra)
          end
        end
      end
    end
  end
end
