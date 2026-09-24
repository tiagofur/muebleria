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
        # #469 increment 4: roots WITHOUT server identity (local catalog
        # inserts) are indexed under :local_by_ref by their local
        # instanceRef — never promoted to furnitureInstanceId — so semantic
        # snapping can target placed local furniture too.
        module ManagedFurniture
          module_function

          # Reads every top-level entity exactly once and groups roots by the
          # server-owned furnitureInstanceId (plus the local instanceRef
          # stream). The returned index also keeps incompatible managed
          # roots explicit so host reconciliation can fail closed instead of
          # silently treating corrupt metadata as absence.
          def index(model, metadata_store)
            result = { by_id: Hash.new { |hash, key| hash[key] = [] },
                       local_by_ref: Hash.new { |hash, key| hash[key] = [] }, invalid: [] }
            return result unless model.respond_to?(:entities)

            # rubocop:disable-next SketchupSuggestions/ModelEntities
            model.entities.each do |entity|
              metadata = metadata_store.read(entity)
              next unless metadata.is_a?(Hash)

              identity = metadata['identity']
              furniture_id = identity.is_a?(Hash) ? identity['furnitureInstanceId'] : nil
              if !furniture_id.is_a?(String) || furniture_id.strip.empty?
                index_local_root(result, entity, metadata, identity)
                next
              end

              result[:by_id][furniture_id] << { entity: entity, metadata: metadata }
            rescue JSON::ParserError, Metadata::InvalidMetadataError
              result[:invalid] << { entity: entity, reason: 'unreadable_metadata' }
            end
            result
          end

          # A managed furnitureInstance root with NO server identity stays
          # in :invalid for the server lanes exactly as before (a bound
          # model's reconciliation/design-sync must keep failing closed on
          # local furniture — never silently ignore it) AND enters
          # :local_by_ref under its local instanceRef so semantic snapping
          # (#469) can target placed local furniture. The instanceRef is
          # the compat locator, never a promoted business identity.
          def index_local_root(result, entity, metadata, identity)
            return unless metadata['kind'] == 'furnitureInstance'

            local_ref = identity.is_a?(Hash) ? identity['instanceRef'] : nil
            if local_ref.is_a?(String) && !local_ref.strip.empty?
              result[:local_by_ref][local_ref] << { entity: entity, metadata: metadata }
            end
            result[:invalid] << { entity: entity, reason: 'missing_furniture_instance_id' }
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
