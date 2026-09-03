# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Connection
      # #391 / DT-7 — Duplicate / Copy-Paste FurnitureInstance Identity in SketchUp
      # (digital-thread §§14, 25.4, 26, 28, 30–31).
      #
      # Invariants:
      #   * One physical unit = one FurnitureInstance.id.
      #   * A copy operation (Move+Copy, Copy/Paste) creates a second top-level root
      #     sharing the source's metadata. The original keeps its server-authoritative
      #     ID. The copy receives a NEW server-authoritative ID allocated by the
      #     backend (origin='duplicate', originFurnitureInstanceId=source.id) via
      #     POST /api/projects/{projectId}/furniture-instances/{instanceId}:duplicate.
      #   * Server authority: SketchUp NEVER generates business identities locally.
      #   * Idempotency: Duplicate commands send a deterministic Idempotency-Key
      #     tied to the bound project/design, source FI, and copied technical locator
      #     (persistent_id) so repeated callbacks or retries never mint extra FIs.
      #   * Metadata rewrite: ONLY the copied entity's identity is updated;
      #     parameters, materials, definitions, transform and geometry are preserved.
      #   * Deterministic original resolution: Identified by matching against known
      #     working-copy locators, observer event context, or persistent locators.
      #     Ambiguous duplicates are marked unresolved and block publish.
      #   * Reentrancy guard: Observer callbacks are suppressed during internal
      #     metadata rewrites to prevent cascading loops.
      #   * Offline resilience: If backend is unavailable, copies are tagged as
      #     unresolved, preserving user work without masquerading as valid.
      #   * WorkingCopy sync resilience: If duplicate ID allocation succeeds but
      #     working-copy sync fails, the entity enters an explicit 'working_copy_unsynced'
      #     state. The allocated ID is retained (never recycled/re-requested), and retry
      #     directly re-syncs the working copy without minting additional identities.
      #   * Authoritative precheck: publish precheck verifies all managed IDs against
      #     active instances in the backend project, blocking unknown/locally-invented UUIDs.
      class DuplicateResolver # rubocop:disable Metrics/ClassLength
        UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

        attr_reader :service, :logger

        def self.validate_model(model, service: nil, binding: nil, metadata_store_factory: nil)
          new(
            model_provider: -> { model },
            binding_store_factory: -> { ModelBinding::Store.new(model) },
            model_binding_service: nil,
            service: service,
            metadata_store_factory: metadata_store_factory || ->(m) { Metadata::Store.new(m) },
            logger: SafeLogger.new
          ).validate_model(model, binding: binding, service: service)
        end

        def initialize(model_provider:, binding_store_factory:, model_binding_service:,
                       service:, metadata_store_factory:, logger: SafeLogger.new)
          @model_provider = model_provider
          @binding_store_factory = binding_store_factory
          @model_binding_service = model_binding_service
          @service = service
          @metadata_store_factory = metadata_store_factory
          @logger = logger
          @resolving = false
          @suppressed = false
        end

        def suppressed?
          @suppressed
        end

        def suppress
          old = @suppressed
          @suppressed = true
          yield
        ensure
          @suppressed = old
        end

        # Scans model top-level entities and groups them by furnitureInstanceId.
        # Returns a Hash: { instance_id => [entity, entity, ...] } only for
        # instance IDs that appear MORE than once.
        def scan_duplicates(model)
          return {} unless model.respond_to?(:entities)

          store = metadata_store(model)
          instances_map = {}
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities.each do |entity|
            metadata = safe_read_metadata(store, entity)
            next unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

            fid = metadata['identity']['furnitureInstanceId']
            next unless fid.is_a?(String) && !fid.strip.empty?

            (instances_map[fid] ||= []) << entity
          end

          instances_map.select { |_id, entities| entities.length > 1 }
        end

        # Scans for entities that carry an explicit unresolved duplicate marker.
        def find_unresolved_entities(model)
          return [] unless model.respond_to?(:entities)

          store = metadata_store(model)
          unresolved = []
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities.each do |entity|
            metadata = safe_read_metadata(store, entity)
            next unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

            unresolved << entity if metadata['identity']['duplicateStatus'] == 'unresolved'
          end
          unresolved
        end

        # Scans for entities that have an allocated duplicate ID but failed working copy sync.
        def find_unsynced_entities(model)
          return [] unless model.respond_to?(:entities)

          store = metadata_store(model)
          unsynced = []
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities.each do |entity|
            metadata = safe_read_metadata(store, entity)
            next unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

            unsynced << entity if metadata['identity']['duplicateStatus'] == 'working_copy_unsynced'
          end
          unsynced
        end

        # Scans for entities carrying invalid UUIDs as furnitureInstanceId.
        def find_invalid_identity_entities(model)
          return [] unless model.respond_to?(:entities)

          store = metadata_store(model)
          invalid = []
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities.each do |entity|
            metadata = safe_read_metadata(store, entity)
            next unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

            fid = metadata['identity']['furnitureInstanceId']
            next if fid.nil?

            invalid << entity unless fid.is_a?(String) && fid.match?(UUID_PATTERN)
          end
          invalid
        end

        # Scans for all unique managed furnitureInstanceIds present in top-level entities.
        def find_all_managed_ids(model)
          return [] unless model.respond_to?(:entities)

          store = metadata_store(model)
          ids = []
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities.each do |entity|
            metadata = safe_read_metadata(store, entity)
            next unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

            fid = metadata['identity']['furnitureInstanceId']
            ids << fid if fid.is_a?(String) && fid.match?(UUID_PATTERN)
          end
          ids.uniq
        end

        # Resolves an observed entity addition when Move+Copy or Copy/Paste occurs.
        def resolve_observed_addition(model, copy_entity)
          return if @suppressed || @resolving
          return unless copy_entity && model

          copy_identity = read_entity_identity(model, copy_entity)
          return unless copy_identity

          if copy_identity['duplicateStatus'] == 'working_copy_unsynced'
            return handle_observed_unsynced(model, copy_entity)
          end

          source_id = copy_identity['furnitureInstanceId']
          return unless source_id.is_a?(String) && source_id.match?(UUID_PATTERN)

          original = find_duplicate_original(model, copy_entity, source_id)
          return unless original

          handle_observed_duplicate(model, copy_entity, original, source_id)
        end

        # Resolves all duplicates currently in the model (e.g. at model open or on manual rescan).
        def rescan_and_resolve(model)
          return { 'ok' => false, 'code' => 'no_model', 'reason' => 'no hay un modelo activo' } unless model

          context = binding_context
          unless context['ok']
            mark_all_duplicates_unresolved(model, context['reason'])
            return context
          end

          duplicates = scan_duplicates(model)
          unresolved = find_unresolved_entities(model)
          unsynced = find_unsynced_entities(model)

          if duplicates.empty? && unresolved.empty? && unsynced.empty?
            return { 'ok' => true, 'code' => 'no_duplicates', 'resolved' => 0 }
          end

          working_copy = fetch_working_copy(context['binding'].design_id)
          count = retry_all_unsynced(model, context['binding'], unsynced, working_copy)
          count += resolve_all_duplicates(model, context['binding'], duplicates, working_copy)

          { 'ok' => true, 'code' => 'duplicates_resolved', 'resolved' => count }
        end

        # Precheck validation service (#391 / DT-7 §§21-22):
        # Checks whether the model's managed furniture identities are valid for productive publish.
        def validate_model(model, binding: nil, service: nil)
          return { 'valid' => false, 'code' => 'no_model', 'reason' => 'no hay un modelo activo' } unless model

          current_binding = binding || resolve_binding(model)
          svc = service || @service

          validate_duplicates(model) ||
            validate_unresolved_and_unsynced(model) ||
            validate_identities_format(model) ||
            validate_foreign_project(model, current_binding) ||
            validate_backend_authority(model, current_binding, svc) ||
            { 'valid' => true, 'code' => 'valid' }
        end

        private

        def read_entity_identity(model, entity)
          store = metadata_store(model)
          metadata = safe_read_metadata(store, entity)
          return nil unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

          metadata['identity']
        end

        def find_duplicate_original(model, copy_entity, source_id)
          store = metadata_store(model)
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities.find do |e|
            next false if e == copy_entity

            m = safe_read_metadata(store, e)
            m.is_a?(Hash) && m.dig('identity', 'furnitureInstanceId') == source_id
          end
        end

        def handle_observed_unsynced(model, copy_entity)
          context = binding_context
          return context unless context['ok']

          retry_unsynced_copy(model, context['binding'], copy_entity)
        end

        def handle_observed_duplicate(model, copy_entity, original, source_id)
          context = binding_context
          unless context['ok']
            mark_unresolved(copy_entity, source_id, context['reason'])
            return context
          end

          resolve_copy(model, context['binding'], original, copy_entity, source_id)
        end

        def mark_all_duplicates_unresolved(model, reason)
          scan_duplicates(model).each do |source_id, entities|
            entities.each { |e| mark_unresolved(e, source_id, reason) }
          end
        end

        def retry_all_unsynced(model, binding, unsynced, working_copy)
          count = 0
          unsynced.each do |copy|
            result = retry_unsynced_copy(model, binding, copy, working_copy: working_copy)
            count += 1 if result['ok']
          end
          count
        end

        def resolve_all_duplicates(model, binding, duplicates, working_copy)
          count = 0
          duplicates.each do |source_id, entities|
            original, copies = determine_original_and_copies(source_id, entities, working_copy)
            if original.nil?
              msg = 'ambigüedad: no se pudo determinar cuál es el mueble original'
              copies.each { |e| mark_unresolved(e, source_id, msg) }
              next
            end

            copies.each do |copy|
              result = resolve_copy(model, binding, original, copy, source_id, working_copy: working_copy)
              count += 1 if result['ok']
            end
          end
          count
        end

        def validate_duplicates(model)
          duplicates = scan_duplicates(model)
          return nil if duplicates.empty?

          ids = duplicates.keys.join(', ')
          {
            'valid' => false,
            'code' => 'duplicate_furniture_identity',
            'reason' => "existen copias con la misma identidad física en el modelo (#{ids}); " \
                        'resolvé los duplicados antes de continuar',
            'duplicates' => duplicates.transform_values(&:length)
          }
        end

        def validate_unresolved_and_unsynced(model)
          unresolved = find_unresolved_entities(model)
          if unresolved.any?
            return {
              'valid' => false,
              'code' => 'unresolved_duplicate_identity',
              'reason' => 'hay un mueble copiado cuya identidad todavía no pudo sincronizarse; ' \
                          'conectate al taller para resolverlo'
            }
          end

          unsynced = find_unsynced_entities(model)
          if unsynced.any?
            return {
              'valid' => false,
              'code' => 'working_copy_unsynced',
              'reason' => 'hay un mueble copiado cuya posición en el diseño todavía no pudo ' \
                          'sincronizarse con el taller'
            }
          end

          nil
        end

        def validate_identities_format(model)
          invalid = find_invalid_identity_entities(model)
          return nil if invalid.empty?

          {
            'valid' => false,
            'code' => 'invalid_furniture_identity',
            'reason' => 'el modelo contiene muebles con identidades no válidas o inventadas localmente'
          }
        end

        def validate_foreign_project(model, current_binding)
          return nil unless current_binding

          foreign = find_foreign_project_entities(model, current_binding.project_id)
          return nil if foreign.empty?

          {
            'valid' => false,
            'code' => 'foreign_project_identity',
            'reason' => 'el modelo contiene muebles con identidades de otro proyecto distinto al conectado'
          }
        end

        def validate_backend_authority(model, current_binding, service)
          return nil unless current_binding

          managed_ids = find_all_managed_ids(model)
          return nil if managed_ids.empty?

          unless service.respond_to?(:list_project_furniture)
            return {
              'valid' => false,
              'code' => 'backend_verification_failed',
              'reason' => 'servicio no disponible para verificar autoridad de muebles en el servidor'
            }
          end

          begin
            instances = service.list_project_furniture(current_binding.project_id)
            active_ids = instances.select { |i| i.lifecycle_status == 'active' }.to_set(&:id)
            unknown_ids = managed_ids.reject { |id| active_ids.include?(id) }

            if unknown_ids.any?
              return {
                'valid' => false,
                'code' => 'unknown_furniture_identity',
                'reason' => 'el modelo contiene muebles cuya identidad no existe en el servidor: ' \
                            "#{unknown_ids.join(', ')}",
                'unknown_ids' => unknown_ids
              }
            end
          rescue StandardError => e
            @logger&.error('validate_model_authoritative_check_failed', error: e)
            return {
              'valid' => false,
              'code' => 'backend_verification_failed',
              'reason' => "no se pudo verificar la identidad autoritativa con el servidor: #{e.message}"
            }
          end

          nil
        end

        def resolve_binding(model)
          binding = @binding_store_factory.call&.read if @binding_store_factory
          binding ||= ModelBinding::Store.new(model).read if model.respond_to?(:get_attribute)
          binding
        end

        def find_foreign_project_entities(model, expected_project_id)
          store = metadata_store(model)
          foreign = []
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities.each do |entity|
            metadata = safe_read_metadata(store, entity)
            next unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

            project_id = metadata['identity']['projectId']
            foreign << entity if project_id && project_id != expected_project_id
          end
          foreign
        end

        def binding_context
          ProjectFurniture::PlacementGuards.placement_context(
            @binding_store_factory.call,
            @model_binding_service
          )
        end

        def fetch_working_copy(design_id)
          @service.get_working_copy(design_id)
        rescue StandardError => e
          @logger.error('duplicate_resolver_fetch_working_copy_failed', error: e)
          nil
        end

        # Determines which entity in the group is the original based on authoritative technical evidence:
        # 1. Matching the working-copy item's technicalClientLocator (persistent_id).
        # 2. If exactly one entity matches, that entity is original; the others are copies.
        # 3. If neither or multiple match, returns [nil, entities] (ambiguous).
        def determine_original_and_copies(source_id, entities, working_copy)
          return [nil, entities] unless working_copy&.items

          item = working_copy.items.find { |i| i.furniture_instance_id == source_id }
          return [nil, entities] unless item&.technical_client_locator

          target_pid = item.technical_client_locator['value'].to_s
          return [nil, entities] if target_pid.empty?

          original = entities.find { |e| e.respond_to?(:persistent_id) && e.persistent_id.to_s == target_pid }
          return [nil, entities] unless original

          copies = entities.reject { |e| e == original }
          [original, copies]
        end

        def resolve_copy(model, binding, _original, copy, source_instance_id, working_copy: nil)
          with_reentrancy_guard do
            pid = copy.respond_to?(:persistent_id) ? copy.persistent_id.to_s : 'unknown'
            created = request_duplicate_instance(binding, source_instance_id, pid)
            unless created
              mark_unresolved(copy, source_instance_id, 'fallo del servidor al duplicar')
              return { 'ok' => false, 'code' => 'backend_error' }
            end

            rewrite_copy_metadata(model, copy, created.id, source_instance_id, binding)
            sync_result = execute_copy_sync(binding, created.id, copy, source_instance_id, working_copy)
            return sync_result unless sync_result['ok']

            @logger.info('duplicate_resolved', original_id: source_instance_id, new_id: created.id, persistent_id: pid)
            { 'ok' => true, 'originalId' => source_instance_id, 'copyId' => created.id, 'entity' => copy }
          end
        end

        def request_duplicate_instance(binding, source_instance_id, pid)
          key = "dup:#{binding.project_id}:#{binding.design_id}:#{source_instance_id}:#{pid}"
          @service.duplicate_furniture_instance(binding.project_id, source_instance_id, idempotency_key: key)
        rescue StandardError => e
          @logger.error('duplicate_resolver_backend_failed', error: e, source_id: source_instance_id)
          nil
        end

        def execute_copy_sync(binding, new_id, copy, source_instance_id, working_copy)
          sync_working_copy(binding, new_id, copy, source_instance_id: source_instance_id, working_copy: working_copy)
          { 'ok' => true }
        rescue StandardError => e
          @logger.error('duplicate_resolver_sync_working_copy_failed', error: e, new_id: new_id)
          mark_unsynced(copy, new_id, source_instance_id, "fallo al sincronizar working copy: #{e.message}")
          {
            'ok' => false,
            'code' => 'working_copy_unsynced',
            'copyId' => new_id,
            'reason' => e.message,
            'entity' => copy
          }
        end

        def retry_unsynced_copy(model, binding, copy, working_copy: nil)
          with_reentrancy_guard do
            store = metadata_store(model)
            metadata = safe_read_metadata(store, copy) || {}
            assigned_id = metadata.dig('identity', 'furnitureInstanceId')
            source_id = metadata.dig('identity', 'originFurnitureInstanceId')
            return { 'ok' => false, 'code' => 'missing_identity' } unless assigned_id

            begin
              sync_working_copy(binding, assigned_id, copy, source_instance_id: source_id, working_copy: working_copy)
              metadata['identity'].delete('duplicateStatus')
              store.write(copy, metadata)
              @logger.info('unsynced_duplicate_resolved', copy_id: assigned_id, source_id: source_id)
              { 'ok' => true, 'code' => 'resolved', 'copyId' => assigned_id }
            rescue StandardError => e
              @logger.error('retry_unsynced_copy_failed', error: e, copy_id: assigned_id)
              { 'ok' => false, 'code' => 'working_copy_unsynced', 'reason' => e.message }
            end
          end
        end

        def rewrite_copy_metadata(model, copy, new_id, source_id, binding)
          store = metadata_store(model)
          metadata = safe_read_metadata(store, copy) || {}
          metadata['identity'] ||= {}
          metadata['identity']['furnitureInstanceId'] = new_id
          metadata['identity']['instanceRef'] = new_id
          metadata['identity']['origin'] = 'duplicate'
          metadata['identity']['originFurnitureInstanceId'] = source_id
          metadata['identity']['projectId'] = binding.project_id
          metadata['identity']['designId'] = binding.design_id
          metadata['identity'].delete('duplicateStatus')
          metadata['identity'].delete('duplicateSourceInstanceId')

          # Update display name if entity carries old ID in name
          copy.name = copy.name.sub(source_id, new_id) if copy.respond_to?(:name) && copy.name&.include?(source_id)

          store.write(copy, metadata)
        end

        def sync_working_copy(binding, new_id, copy_entity, source_instance_id: nil, working_copy: nil)
          wc = working_copy || fetch_working_copy(binding.design_id)
          raise 'no se pudo obtener working copy' unless wc

          source_item = source_instance_id ? wc.items.find { |i| i.furniture_instance_id == source_instance_id } : nil
          new_item = build_working_copy_item(copy_entity, new_id, source_item)

          merged = wc.items.reject { |item| item.furniture_instance_id == new_id }
          merged << new_item

          @service.update_working_copy(binding.design_id, items: merged, base_revision_id: binding.base_revision_id)
        end

        def build_working_copy_item(copy_entity, new_id, source_item)
          store = metadata_store(copy_entity.model)
          metadata = safe_read_metadata(store, copy_entity) || {}
          intent = metadata['intent'].is_a?(Hash) ? metadata['intent'] : {}

          params = if source_item&.parameters
                     source_item.parameters.dup
                   else
                     intent['parameters'] || {}
                   end

          materials = if source_item&.material_choices
                        source_item.material_choices.dup
                      else
                        intent['materialChoices'] || {}
                      end

          ProjectFurniture::Contract::WorkingItem.new(
            furniture_instance_id: new_id,
            furniture_definition_id: resolve_definition_id(source_item, metadata),
            definition_version: source_item&.definition_version || metadata.dig('intent', 'definitionVersion'),
            room_id: source_item&.room_id || metadata.dig('intent', 'roomId'),
            parameters: params,
            material_choices: materials,
            transform: extract_transform(copy_entity),
            technical_client_locator: ProjectFurniture::ManagedFurniture.persistent_locator(copy_entity)
          )
        end

        def resolve_definition_id(source_item, metadata)
          source_item&.furniture_definition_id ||
            metadata.dig('identity', 'furnitureDefinitionId') ||
            metadata.dig('intent', 'furnitureDefinitionId')
        end

        def extract_transform(copy_entity)
          if copy_entity.respond_to?(:transformation) && copy_entity.transformation
            ProjectFurniture::TransformContract.from_host(copy_entity.transformation)
          else
            { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] }
          end
        end

        def mark_unresolved(entity, source_id, reason)
          store = metadata_store(entity.model)
          metadata = safe_read_metadata(store, entity) || {}
          metadata['identity'] ||= {}
          metadata['identity']['duplicateStatus'] = 'unresolved'
          metadata['identity']['duplicateSourceInstanceId'] = source_id
          store.write(entity, metadata)
          @logger.warn('duplicate_marked_unresolved', source_id: source_id, reason: reason)
        rescue StandardError => e
          @logger.error('duplicate_resolver_mark_unresolved_failed', error: e)
        end

        def mark_unsynced(entity, new_id, source_id, reason)
          store = metadata_store(entity.model)
          metadata = safe_read_metadata(store, entity) || {}
          metadata['identity'] ||= {}
          metadata['identity']['furnitureInstanceId'] = new_id
          metadata['identity']['instanceRef'] = new_id
          metadata['identity']['origin'] = 'duplicate'
          metadata['identity']['originFurnitureInstanceId'] = source_id
          metadata['identity']['duplicateStatus'] = 'working_copy_unsynced'
          store.write(entity, metadata)
          @logger.warn('duplicate_marked_unsynced',
                       copy_id: new_id,
                       source_id: source_id,
                       reason: reason)
        rescue StandardError => e
          @logger.error('duplicate_resolver_mark_unsynced_failed', error: e)
        end

        def with_reentrancy_guard
          return if @resolving

          @resolving = true
          yield
        ensure
          @resolving = false
        end

        def metadata_store(model)
          @metadata_store_factory.call(model)
        end

        def safe_read_metadata(store, entity)
          return nil unless entity && store

          store.read(entity)
        rescue JSON::ParserError, Metadata::InvalidMetadataError
          nil
        end
      end
    end
  end
end
