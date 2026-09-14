# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      module ProjectFurniture
        # Locates Granete-managed top-level furniture by SERVER identity.
        # identity.instanceRef aliases the furnitureInstanceId on #389-placed
        # entities, but the authority here is furnitureInstanceId — searching
        # by it also proves duplicate roots fail loud (#391 preview) instead
        # of silently counting two business units.
        module ManagedFurniture
          module_function

          # Reads every top-level entity exactly once and groups roots by the
          # server-owned furnitureInstanceId. The returned index also keeps
          # incompatible managed roots explicit so host reconciliation can
          # fail closed instead of silently treating corrupt metadata as
          # absence.
          def index(model, metadata_store)
            result = { by_id: Hash.new { |hash, key| hash[key] = [] }, invalid: [] }
            return result unless model.respond_to?(:entities)

            # rubocop:disable-next SketchupSuggestions/ModelEntities
            model.entities.each do |entity|
              metadata = metadata_store.read(entity)
              next unless metadata.is_a?(Hash)

              identity = metadata['identity']
              furniture_id = identity.is_a?(Hash) ? identity['furnitureInstanceId'] : nil
              if !furniture_id.is_a?(String) || furniture_id.strip.empty?
                if metadata['kind'] == 'furnitureInstance'
                  result[:invalid] << { entity: entity, reason: 'missing_furniture_instance_id' }
                end
                next
              end

              result[:by_id][furniture_id] << { entity: entity, metadata: metadata }
            rescue JSON::ParserError, Metadata::InvalidMetadataError
              result[:invalid] << { entity: entity, reason: 'unreadable_metadata' }
            end
            result
          end

          # Returns { 'entity' => entity|nil, 'duplicates' => count } for the
          # given furnitureInstanceId across the model's top-level entities.
          def locate(model, metadata_store, furniture_instance_id)
            return { 'entity' => nil, 'duplicates' => 0 } unless model.respond_to?(:entities)
            return { 'entity' => nil, 'duplicates' => 0 } unless furniture_instance_id.is_a?(String)

            matches = index(model, metadata_store)[:by_id][furniture_instance_id].map { |entry| entry[:entity] }
            { 'entity' => matches.first, 'duplicates' => matches.length }
          end

          def persistent_locator(entity)
            return nil unless entity.respond_to?(:persistent_id) && entity.persistent_id

            { 'kind' => 'sketchup_persistent_id', 'value' => entity.persistent_id.to_s }
          end

          # Corrupt/unreadable metadata on one entity must not abort the
          # scan: that entity simply does not carry the identity.
          def read_metadata(store, entity)
            store.read(entity)
          rescue JSON::ParserError, Metadata::InvalidMetadataError
            nil
          end
        end
      end
    end
  end
end
