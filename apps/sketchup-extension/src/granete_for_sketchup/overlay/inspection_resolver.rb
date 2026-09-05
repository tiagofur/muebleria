# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # Read-only authoritative source for the inspection overlay (#470).
      # Submits the SAME #477 authoring resolve the mutation flow submits —
      # current definition, pinned catalog revision, persisted parameters/
      # material choices, occurrence identities and the manual hardware
      # placement set — WITHOUT applying any edit. Inspection adds no intent:
      # it observes the resolve the backend would produce for the furniture
      # as it stands.
      #
      # This is NOT a mutation: no coordinator, no SketchUp operation, no
      # metadata write. Correlation comes from #498 MessageIdentity so a
      # late/superseded answer can be discarded by the manager.
      class InspectionResolver
        def initialize(catalog_provider:, metadata_store_factory:, logger: nil)
          @catalog_provider = catalog_provider
          @metadata_store_factory = metadata_store_factory
          @logger = logger
        end

        # Returns { result:, message_id: } for an ACCEPTED resolve; raises
        # Library::AuthoringResolveError (or LayoutResolutionError) on
        # rejection/unavailability so the caller maps it to UNAVAILABLE.
        def resolve(furniture_entity:, model:)
          metadata = read_metadata(furniture_entity, model)
          definition = @catalog_provider.find_definition(definition_id_of(metadata))
          if definition.nil?
            raise Library::AuthoringResolveError,
                  'La definición del catálogo ya no está disponible para inspeccionar fabricación'
          end

          params = metadata&.dig('intent', 'parameters') || {}
          choices = metadata&.dig('intent', 'materialChoices') || {}
          relationships = metadata.is_a?(Hash) ? metadata['relationships'] : nil

          base_layout = resolve_layout_for(definition, params, choices)
          if base_layout.nil?
            raise Library::AuthoringResolveError,
                  'No hay resolve de composición disponible para este mueble; ' \
                  'la fabricación no puede inspeccionarse'
          end

          identity = Host::MessageIdentity.allocate
          request = Library::AuthoringResolveRequest.build_request(
            message_id: identity[:message_id],
            idempotency_key: identity[:idempotency_key],
            furniture: furniture_request(definition, params, choices, base_layout, relationships)
          )

          result = @catalog_provider.resolve_authoring(request)
          if result.nil?
            raise Library::AuthoringResolveError,
                  'La inspección de fabricación requiere el resolve autoritativo ' \
                  'del servidor; el catálogo local no la provee'
          end
          unless result.respond_to?(:accepted?) && result.accepted?
            raise Library::AuthoringResolveError,
                  'El servidor autoritativo no aceptó el resolve de inspección'
          end

          { result: result, message_id: identity[:message_id] }
        end

        private

        # Mirrors the mutation request shape (#468): occurrence identities +
        # the manual hardware placement set echoed from the resolved layout;
        # derived placements are re-derived server-side and never sent.
        def furniture_request(definition, params, choices, base_layout, relationships = nil)
          req = {
            'furnitureDefinitionId' => definition['furniture_definition_id'] || definition['id'],
            'catalogRevision' => catalog_revision,
            'parameters' => params,
            'materialChoices' => choices,
            'components' => base_layout.boards.map do |board|
              {
                'componentInstanceId' => board.component_instance_id,
                'componentDefinitionId' => board.component_definition_id,
                'role' => board.role
              }
            end,
            'hardwarePlacements' => base_layout.hardware.map do |placement|
              next nil if placement.placement_kind == 'derived'

              {
                'hardwarePlacementId' => placement.placement_id,
                'placementKind' => placement.placement_kind || 'manual',
                'catalogHardwareId' => placement.hardware_id,
                'hostComponentInstanceId' => placement.host_component_instance_id,
                'anchorFace' => placement.anchor_face || 'front',
                'offsetMm' => placement.offset_mm || [0.0, 0.0]
              }
            end.compact
          }
          req['relationships'] = relationships if relationships.is_a?(Array) && !relationships.empty?
          req
        end

        def catalog_revision
          if @catalog_provider.respond_to?(:catalog_revision) && @catalog_provider.catalog_revision
            @catalog_provider.catalog_revision
          else
            'workshop-current'
          end
        end

        def definition_id_of(metadata)
          metadata&.dig('intent', 'furnitureDefinitionId') ||
            metadata&.dig('identity', 'furnitureDefinitionId') ||
            metadata&.dig('definition', 'furniture_definition_id')
        end

        def resolve_layout_for(definition, params, choices)
          return nil unless @catalog_provider.respond_to?(:resolved_native_layout)

          @catalog_provider.resolved_native_layout(
            definition['furniture_definition_id'], params, choices
          )
        end

        def read_metadata(entity, model)
          @metadata_store_factory.call(model).read(entity)
        end
      end
    end
  end
end
