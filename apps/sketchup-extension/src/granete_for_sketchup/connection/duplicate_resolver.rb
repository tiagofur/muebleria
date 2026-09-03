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
      class DuplicateResolver # rubocop:disable Metrics/ClassLength
        UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

        attr_reader :service, :logger

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

        # Resolves an observed entity addition when Move+Copy or Copy/Paste occurs.
        # The added entity is known to be the copy; the existing entity with the
        # same furnitureInstanceId is the original.
        def resolve_observed_addition(model, copy_entity)
          return if @suppressed || @resolving
          return unless copy_entity && model

          store = metadata_store(model)
          copy_metadata = safe_read_metadata(store, copy_entity)
          return unless copy_metadata.is_a?(Hash) && copy_metadata['identity'].is_a?(Hash)

          source_instance_id = copy_metadata['identity']['furnitureInstanceId']
          return unless source_instance_id.is_a?(String) && source_instance_id.match?(UUID_PATTERN)

          # Find other entities in model.entities with the same ID
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          matches = model.entities.select do |e|
            next false if e == copy_entity

            m = safe_read_metadata(store, e)
            m.is_a?(Hash) && m.dig('identity', 'furnitureInstanceId') == source_instance_id
          end

          return if matches.empty? # Not a duplicate

          original_entity = matches.first
          context = binding_context
          unless context['ok']
            mark_unresolved(copy_entity, source_instance_id, context['reason'])
            return context
          end

          resolve_copy(model, context['binding'], original_entity, copy_entity, source_instance_id)
        end

        # Resolves all duplicates currently in the model (e.g. at model open or on manual rescan).
        def rescan_and_resolve(model)
          return { 'ok' => false, 'code' => 'no_model', 'reason' => 'no hay un modelo activo' } unless model

          context = binding_context
          unless context['ok']
            duplicates = scan_duplicates(model)
            duplicates.each do |source_id, entities|
              entities.each { |e| mark_unresolved(e, source_id, context['reason']) }
            end
            return context
          end

          duplicates = scan_duplicates(model)
          unresolved_entities = find_unresolved_entities(model)

          if duplicates.empty? && unresolved_entities.empty?
            return { 'ok' => true, 'code' => 'no_duplicates', 'resolved' => 0 }
          end

          working_copy = fetch_working_copy(context['binding'].design_id)
          resolved_count = 0

          duplicates.each do |source_id, entities|
            original, copies = determine_original_and_copies(source_id, entities, working_copy)
            if original.nil?
              # Ambiguous: cannot safely determine which entity was the original
              copies.each do |e|
                mark_unresolved(e, source_id, 'ambigüedad: no se pudo determinar cuál es el mueble original')
              end
              next
            end

            copies.each do |copy|
              result = resolve_copy(model, context['binding'], original, copy, source_id, working_copy: working_copy)
              resolved_count += 1 if result['ok']
            end
          end

          { 'ok' => true, 'code' => 'duplicates_resolved', 'resolved' => resolved_count }
        end

        # Precheck validation service (#391 / DT-7 §21-22):
        # Checks whether the model's managed furniture identities are valid for productive publish.
        # Fails if:
        #   - Duplicate business IDs exist.
        #   - Unresolved copied identities exist.
        #   - Invalid or fake/random UUIDs exist.
        #   - Foreign project identities exist (when bound).
        def validate_model(model, binding: nil) # rubocop:disable Metrics/MethodLength
          return { 'valid' => false, 'code' => 'no_model', 'reason' => 'no hay un modelo activo' } unless model

          current_binding = binding || @binding_store_factory.call&.read
          duplicates = scan_duplicates(model)
          if duplicates.any?
            ids = duplicates.keys.join(', ')
            return {
              'valid' => false,
              'code' => 'duplicate_business_identity',
              'reason' => "existen copias con la misma identidad física en el modelo (#{ids}); " \
                          'resolvé los duplicados antes de continuar',
              'duplicates' => duplicates.transform_values(&:length)
            }
          end

          unresolved = find_unresolved_entities(model)
          if unresolved.any?
            return {
              'valid' => false,
              'code' => 'unresolved_duplicate_identity',
              'reason' => 'hay un mueble copiado cuya identidad todavía no pudo sincronizarse; ' \
                          'conectate al taller para resolverlo'
            }
          end

          invalid = find_invalid_identity_entities(model)
          if invalid.any?
            return {
              'valid' => false,
              'code' => 'invalid_furniture_identity',
              'reason' => 'el modelo contiene muebles con identidades no válidas o inventadas localmente'
            }
          end

          if current_binding
            foreign = find_foreign_project_entities(model, current_binding.project_id)
            if foreign.any?
              return {
                'valid' => false,
                'code' => 'foreign_project_identity',
                'reason' => 'el modelo contiene muebles con identidades de otro proyecto distinto al conectado'
              }
            end
          end

          { 'valid' => true, 'code' => 'valid' }
        end

        private

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
            idempotency_key = "dup:#{binding.project_id}:#{binding.design_id}:#{source_instance_id}:#{pid}"

            created = nil
            begin
              created = @service.duplicate_furniture_instance(
                binding.project_id,
                source_instance_id,
                idempotency_key: idempotency_key
              )
            rescue StandardError => e
              @logger.error('duplicate_resolver_backend_failed', error: e, source_id: source_instance_id)
              mark_unresolved(copy, source_instance_id, "fallo del servidor: #{e.message}")
              return { 'ok' => false, 'code' => 'backend_error', 'reason' => e.message }
            end

            # Rewrite metadata on copy only
            rewrite_copy_metadata(model, copy, created.id, source_instance_id, binding)

            # Update working copy to include original + copy
            sync_working_copy(binding, created.id, copy, working_copy: working_copy)

            @logger.info('duplicate_resolved',
                         original_id: source_instance_id,
                         new_id: created.id,
                         persistent_id: pid)

            { 'ok' => true, 'originalId' => source_instance_id, 'copyId' => created.id, 'entity' => copy }
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

        def sync_working_copy(binding, new_id, copy_entity, working_copy: nil)
          wc = working_copy || fetch_working_copy(binding.design_id)
          return unless wc

          store = metadata_store(copy_entity.model)
          metadata = safe_read_metadata(store, copy_entity) || {}
          intent = metadata['intent'].is_a?(Hash) ? metadata['intent'] : {}
          locator = ProjectFurniture::ManagedFurniture.persistent_locator(copy_entity)

          transform = if copy_entity.respond_to?(:transformation) && copy_entity.transformation
                        ProjectFurniture::TransformContract.from_host(copy_entity.transformation)
                      else
                        { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] }
                      end

          new_item = ProjectFurniture::Contract::WorkingItem.new(
            furniture_instance_id: new_id,
            parameters: intent['parameters'] || {},
            material_choices: intent['materialChoices'] || {},
            transform: transform,
            technical_client_locator: locator
          )

          # Merge: retain other items, add/replace this new unit
          merged = wc.items.reject { |item| item.furniture_instance_id == new_id }
          merged << new_item

          @service.update_working_copy(
            binding.design_id,
            items: merged,
            base_revision_id: binding.base_revision_id
          )
        rescue StandardError => e
          @logger.error('duplicate_resolver_sync_working_copy_failed', error: e, new_id: new_id)
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
