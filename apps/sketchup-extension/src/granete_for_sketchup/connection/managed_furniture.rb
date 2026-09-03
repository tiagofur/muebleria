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

          # Returns { 'entity' => entity|nil, 'duplicates' => count } for the
          # given furnitureInstanceId across the model's top-level entities.
          def locate(model, metadata_store, furniture_instance_id)
            return { 'entity' => nil, 'duplicates' => 0 } unless model.respond_to?(:entities)
            return { 'entity' => nil, 'duplicates' => 0 } unless furniture_instance_id.is_a?(String)

            matches = []
            # Top-level furniture lives in the model root: model.entities is
            # the correct read here, not the open editing context.
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            model.entities.each do |entity|
              metadata = read_metadata(metadata_store, entity)
              next unless metadata.is_a?(Hash) && metadata['identity'].is_a?(Hash)

              matches << entity if metadata['identity']['furnitureInstanceId'] == furniture_instance_id
            end
            { 'entity' => matches.first, 'duplicates' => matches.length }
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
