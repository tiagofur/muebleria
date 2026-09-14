# frozen_string_literal: true

require 'digest'
require 'json'

module Granete
  module SketchUpExtension
    module Connection
      module ProjectFurniture
        # Side-effect-free projection of the three independent authorities for
        # one connected design: project membership, WorkingCopy intent and
        # physical presence in the active SketchUp model.
        class HostReconciliation # rubocop:disable Metrics/ClassLength
          CLEAN_STATES = %w[unplaced present_synced].freeze

          def initialize(model_provider:, binding_store_factory:, service:, metadata_store_factory:,
                         logger: SafeLogger.new)
            @model_provider = model_provider
            @binding_store_factory = binding_store_factory
            @service = service
            @metadata_store_factory = metadata_store_factory
            @logger = logger
          end

          def projection
            model = @model_provider.call
            return unavailable('no_model', 'no hay un modelo activo') unless model

            store = @binding_store_factory.call
            binding = store.read
            unless binding
              state = store.respond_to?(:last_error) && store.last_error ? 'unknown' : 'unbound'
              return unavailable(state, 'el modelo no tiene un enlace legible')
            end

            instances = @service.list_project_furniture(binding.project_id)
            working = @service.get_working_copy(binding.design_id)
            unless working.project_id == binding.project_id && working.design_id == binding.design_id &&
                   working.base_revision_id == binding.base_revision_id
              return unavailable('incompatible', 'el Working Copy no corresponde al enlace exacto del modelo', binding)
            end

            build(model, binding, instances, working)
          rescue Service::Error => e
            unavailable(error_state(e), e.message)
          rescue Contract::ContractError => e
            unavailable('unknown', e.message)
          rescue StandardError => e
            @logger.error('host_reconciliation_failed', error: e)
            unavailable('unknown', e.message)
          end

          def self.clean_for?(projection, binding)
            return false unless projection.is_a?(Hash) && projection['state'] == 'connected' &&
                                projection['clean'] == true && binding

            expected = binding.respond_to?(:to_h) ? binding.to_h : binding
            projection['projectId'] == expected['projectId'] &&
              projection['designId'] == expected['designId'] &&
              projection['baseRevisionId'] == expected['baseRevisionId'] &&
              projection['schemaVersion'] == expected['schemaVersion'] &&
              projection['snapshot'].is_a?(String)
          end

          private

          def build(model, binding, instances, working)
            local = ManagedFurniture.index(model, @metadata_store_factory.call(model))
            indexes = authority_indexes(instances, working, local)
            items = reconcile_items(indexes, local, binding)
            payload = connected_payload(binding, items)
            payload['snapshot'] = snapshot(binding, instances, working, local)
            payload
          end

          def authority_indexes(instances, working, local)
            {
              instances: instances.group_by(&:id),
              working: working.items.group_by(&:furniture_instance_id),
              local: local[:by_id]
            }
          end

          def reconcile_items(indexes, local, binding)
            items = reconciliation_ids(indexes).map do |id|
              classify(id, index_entries(indexes, :instances, id), index_entries(indexes, :working, id),
                       index_entries(indexes, :local, id), binding)
            end
            items.concat(local[:invalid].map { |entry| issue_row('unknown', entry[:reason]) })
          end

          def reconciliation_ids(indexes)
            indexes.values.flat_map(&:keys).uniq.sort.reject do |id|
              instances = index_entries(indexes, :instances, id)
              instances.any? && instances.none? { |instance| instance.lifecycle_status == 'active' } &&
                index_entries(indexes, :working, id).empty? && index_entries(indexes, :local, id).empty?
            end
          end

          def index_entries(indexes, authority, id)
            indexes[authority][id] || []
          end

          def connected_payload(binding, items)
            counts = items.map { |item| item['reconciliationState'] }.tally
            binding_payload(binding).merge(
              'state' => 'connected', 'items' => items,
              'clean' => items.all? { |item| CLEAN_STATES.include?(item['reconciliationState']) },
              'summary' => counts.merge('attention' => items.count { |item| item['blocking'] })
            )
          end

          def classify(id, instances, working_items, local_entries, binding)
            instance = instances.first
            state, reason = reconciliation_state(instances, working_items, local_entries, binding)
            {
              'id' => id,
              'definitionId' => instance&.furniture_definition_id,
              'origin' => instance&.origin,
              'lifecycleStatus' => instance&.lifecycle_status,
              'displayName' => instance&.display_name,
              'displayDimensions' => instance&.display_dimensions,
              'workingCopyPresence' => working_items.length == 1,
              'workingCopyMatchCount' => working_items.length,
              'localPresence' => local_entries.length == 1,
              'localMatchCount' => local_entries.length,
              'reconciliationState' => state,
              'blocking' => !CLEAN_STATES.include?(state),
              'reason' => reason
            }.compact
          end

          def reconciliation_state(instances, working_items, local_entries, binding)
            if instances.length > 1
              return ['incompatible', 'la identidad aparece más de una vez en la autoridad del proyecto']
            end
            return ['duplicate_local', 'hay más de una entidad raíz con la misma identidad'] if local_entries.length > 1

            instance = instances.first
            return ['terminal_or_orphan_local', 'la identidad no existe en el proyecto conectado'] unless instance

            invalid = invalid_authority_state(instance, working_items, local_entries, binding)
            return invalid if invalid

            if instance.lifecycle_status != 'active'
              return ['terminal_or_orphan_local', 'la instancia ya no está activa']
            end

            return ['unplaced', nil] if working_items.empty? && local_entries.empty?
            return ['pending_confirmation', nil] if working_items.empty?
            if local_entries.empty?
              return ['missing_local', 'Granete espera este mueble, pero falta en este archivo SketchUp']
            end

            ['present_synced', nil]
          end

          def invalid_authority_state(instance, working_items, local_entries, binding)
            if instance.project_id != binding.project_id
              return ['incompatible', 'la instancia pertenece a otro proyecto']
            end
            return ['incompatible', 'el Working Copy contiene la identidad más de una vez'] if working_items.length > 1
            if local_context_invalid?(local_entries, binding)
              return ['incompatible', 'la entidad local no corresponde al enlace exacto']
            end
            if local_definition_invalid?(local_entries, instance)
              return ['incompatible', 'la definición de la entidad local no coincide con la instancia']
            end
            if working_items.length == 1 && definition_conflict?(instance, working_items.first)
              return ['incompatible', 'la definición del Working Copy no coincide con la instancia']
            end

            nil
          end

          def local_context_invalid?(entries, binding)
            entries.any? do |entry|
              next true unless entry[:metadata]['kind'] == 'furnitureInstance'

              identity = entry[:metadata]['identity']
              identity['projectId'] != binding.project_id || identity['designId'] != binding.design_id
            end
          end

          def local_definition_invalid?(entries, instance)
            return false unless instance.furniture_definition_id

            entries.any? do |entry|
              entry[:metadata].dig('intent', 'furnitureDefinitionId') != instance.furniture_definition_id
            end
          end

          def definition_conflict?(instance, item)
            instance.furniture_definition_id && item.furniture_definition_id &&
              instance.furniture_definition_id != item.furniture_definition_id
          end

          def issue_row(state, reason)
            { 'reconciliationState' => state, 'blocking' => true, 'localMatchCount' => 1,
              'workingCopyMatchCount' => 0, 'reason' => reason }
          end

          def snapshot(binding, instances, working, local)
            local_identity = local[:by_id].sort.to_h do |id, entries|
              identities = entries.map do |entry|
                entry[:metadata]['identity'].slice('furnitureInstanceId', 'projectId', 'designId')
              end
              [id, identities]
            end
            content = {
              'binding' => binding.to_h,
              'instances' => instances.sort_by(&:id).map do |item|
                [item.id, item.project_id, item.furniture_definition_id, item.lifecycle_status]
              end,
              'workingItems' => working.items.sort_by(&:furniture_instance_id).map(&:to_contract_h),
              'localIdentity' => local_identity,
              'invalidLocal' => local[:invalid].map { |entry| entry[:reason] }.sort
            }
            "sha256-#{Digest::SHA256.hexdigest(JSON.generate(deep_sort(content)))}"
          end

          def deep_sort(value)
            case value
            when Hash then value.keys.sort.to_h { |key| [key, deep_sort(value[key])] }
            when Array then value.map { |item| deep_sort(item) }
            else value
            end
          end

          def binding_payload(binding)
            {
              'projectId' => binding.project_id, 'designId' => binding.design_id,
              'baseRevisionId' => binding.base_revision_id, 'schemaVersion' => binding.schema_version
            }
          end

          def unavailable(state, reason, binding = nil)
            payload = { 'state' => state, 'clean' => false, 'items' => [],
                        'summary' => { 'attention' => 1 }, 'reason' => reason }
            binding ? binding_payload(binding).merge(payload) : payload
          end

          def error_state(error)
            case error.kind
            when :unauthenticated then 'unauthenticated'
            when :unauthorized then 'unauthorized'
            when :unreachable then 'unreachable'
            else 'unknown'
            end
          end
        end
      end
    end
  end
end
