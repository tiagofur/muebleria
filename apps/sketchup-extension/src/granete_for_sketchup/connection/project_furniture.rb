# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Connection
      # #389 / DT-5 — Project Furniture inside Granete for SketchUp
      # (digital-thread §13, ADR-0003). Authority rules enforced here:
      #   * the panel's project comes ONLY from the #388 ModelBinding —
      #     never from a parallel manual selection;
      #   * FurnitureInstance.id is the business identity: Place EXISTING
      #     stamps it verbatim and never creates another identity;
      #   * pending/placed is DERIVED per furnitureInstanceId from the
      #     current DesignWorkingCopy — no global placed flag exists;
      #   * resolution stays server-authoritative (display summary + layout);
      #   * the working copy update is a merge (GET → merge by
      #     furnitureInstanceId → PUT complete state) so other working items
      #     survive; the sync happens only with the user's FINAL chosen
      #     transform, and a backend failure rolls the local insertion back —
      #     no partial success is ever reported.
      module ProjectFurniture
        UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/
        LIFECYCLE_STATUSES = %w[active removed cancelled].freeze
        ORIGINS = %w[quote design manual import duplicate].freeze

        # Server-rejected composition for a project unit (#389 §9): aborts
        # instead of placing against a local geometry guess.
        class PlacementResolutionError < StandardError; end

        # Two roots sharing one furnitureInstanceId (#391 preview): placing
        # is blocked, never resolved by minting a third identity.
        DUPLICATE_MESSAGE =
          'existen dos copias del mismo mueble en el modelo; ' \
          'resolvé los duplicados antes de continuar'

        def self.uuid?(value)
          value.is_a?(String) && value.match?(UUID_PATTERN)
        end

        # HTTP client for the #389 surface: project furniture list (with the
        # server-computed display summary) and the design working copy
        # (GET + merge-PUT). Typed errors only — never message parsing.
        class Service
          class Error < StandardError
            attr_reader :kind, :status

            def initialize(kind, message = nil, status: nil)
              @kind = kind
              @status = status
              super(message || kind.to_s)
            end
          end

          def initialize(transport:, auth_provider:, logger: SafeLogger.new)
            @transport = transport
            @auth_provider = auth_provider
            @logger = logger
          end

          def list_project_furniture(project_id)
            body = request(:get, "/projects/#{project_id}/furniture-instances")
            Contract.parse_instances!(body)
          end

          def get_working_copy(design_id)
            body = request(:get, "/designs/#{design_id}/working-copy")
            Contract::WorkingCopyContract.parse_working_copy!(body)
          end

          # Sends the COMPLETE desired working state (replace semantics of
          # PUT); the caller is responsible for merging, never for silent
          # overwrite of items it did not place.
          def update_working_copy(design_id, items:, base_revision_id: nil, source_type: nil)
            payload = { 'items' => items.map(&:to_contract_h) }
            payload['base_revision_id'] = base_revision_id if base_revision_id
            payload['source_type'] = source_type if source_type
            body = request(:put, "/designs/#{design_id}/working-copy", payload)
            Contract::WorkingCopyContract.parse_working_copy!(body)
          end

          private

          def request(method, path, body = nil)
            raise Error.new(:unauthenticated, 'sin sesión iniciada') unless @auth_provider.configured?

            payload = { 'method' => method.to_s.upcase, 'path' => path, 'headers' => {} }
            payload['body'] = body if body
            auth = @auth_provider.authorization_header
            payload['headers']['Authorization'] = auth if auth

            response = @transport.request(payload)
            status = response['status'].to_i
            case status
            when 200 then response['body']
            when 401 then raise Error.new(:unauthenticated, 'sesión expirada o inválida', status: status)
            when 403 then raise Error.new(:unauthorized, 'no tenés permiso para este proyecto o diseño', status: status)
            when 404 then raise Error.new(:not_found, 'proyecto, diseño o mueble inexistente', status: status)
            when 409 then raise Error.new(:conflict, conflict_message(response), status: status)
            else raise Error.new(:bad_response, "respuesta inesperada del servidor (#{status})", status: status)
            end
          rescue ::Granete::SketchUpExtension::Transport::RequestError => e
            @logger.error('project_furniture_request_failed', error: e)
            raise Error.new(:unreachable, 'no se pudo contactar al servidor')
          end

          def conflict_message(response)
            response.dig('body', 'error', 'message') || 'el diseño cambió en el servidor'
          end
        end

        # Orchestrates Place EXISTING FurnitureInstance (#389 §8/§14/§18) in
        # two user-visible steps so the working copy only ever receives the
        # FINAL chosen transform:
        #
        #   place    → validate binding → resolve unit server-side → one
        #              undoable TOP-LEVEL native placement stamped with the
        #              backend furnitureInstanceId → user positions it
        #              (Move tool) → honest `pending_position` (no success)
        #   confirm  → read the root's CURRENT host transform → canonical
        #              Transform3D → merge-PUT the working copy → success
        #   cancel   → revert the not-yet-confirmed local insertion
        #
        # A backend PUT failure at confirm rolls the local placement back and
        # fails loud; drifted_base/archived/auth states fail BEFORE anything is
        # placed or synced.
        class Placer
          def initialize(model_provider:, binding_store_factory:, model_binding_service:,
                         service:, metadata_store_factory:, catalog_provider:,
                         furniture_builder_factory:, logger: SafeLogger.new)
            @model_provider = model_provider
            @binding_store_factory = binding_store_factory
            @model_binding_service = model_binding_service
            @service = service
            @metadata_store_factory = metadata_store_factory
            @catalog_provider = catalog_provider
            @furniture_builder_factory = furniture_builder_factory
            @logger = logger
          end

          # Step 1 — authoritative context + unit scope + insertion. Does NOT
          # touch the working copy: the unit lands at the origin and is handed
          # to the Move tool; confirm_placement completes the sync with the
          # final transform. `pending_position` is an honest intermediate —
          # never success.
          def place(furniture_instance_id)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            context = placement_context(model)
            return context unless context['ok']

            unit = resolve_unit(context['binding'], furniture_instance_id)
            # Failures, already_placed (focus) and pending_confirmation
            # (resume the confirm step) short-circuit here.
            return unit unless unit['unit']

            insert_furniture_unit(model, context['binding'], unit['unit'])
          rescue Service::Error => e
            failure(:service_error, e.message)
          rescue PlacementResolutionError => e
            failure(:resolution_failed, e.message)
          rescue Contract::ContractError => e
            failure(:bad_contract, e.message)
          rescue StandardError => e
            @logger.error('project_furniture_place_failed', error: e)
            failure(:place_failed, e.message)
          end

          # Step 2 — completes a pending placement with the position and
          # orientation the user FINALIZED in the host. Reads the root's
          # current transformation, converts it to the canonical Transform3D
          # and merge-PUTs the working copy: existing authoritative authoring
          # state is preserved, only transform and the technical locator are
          # placement-owned. A backend PUT failure rolls the local placement
          # back and fails loud — no false success (#389 §18).
          def confirm_placement(furniture_instance_id)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            context = placement_context(model)
            return context unless context['ok']

            located = locate_unit(model, furniture_instance_id)
            return failure(:duplicate_detected, DUPLICATE_MESSAGE) if located['duplicates'] > 1
            return failure(:not_placed, 'el mueble no está en el modelo; colocálo primero') unless located['entity']

            entity = located['entity']
            intent = placement_intent(entity, furniture_instance_id)
            return failure(:intent_mismatch, 'la identidad del mueble no coincide; colocálo de nuevo') unless intent

            guard = validate_instance_active(context['binding'], furniture_instance_id)
            unless guard['ok']
              builder = @furniture_builder_factory.call(model)
              rollback_local(model, builder, entity, furniture_instance_id)
              return guard
            end

            sync_placement(model, context['binding'], furniture_instance_id, entity)
          rescue Service::Error => e
            failure(:service_error, e.message)
          rescue Contract::ContractError => e
            failure(:bad_contract, e.message)
          rescue StandardError => e
            @logger.error('project_furniture_confirm_failed', error: e)
            failure(:confirm_failed, e.message)
          end

          # Explicit cancel: reverts the not-yet-confirmed local insertion
          # (erase + scoped purge) without ever touching the working copy.
          # No successful state, no false success.
          def cancel_placement(furniture_instance_id)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            located = locate_unit(model, furniture_instance_id)
            return failure(:duplicate_detected, DUPLICATE_MESSAGE) if located['duplicates'] > 1

            if located['entity']
              builder = @furniture_builder_factory.call(model)
              rolled = builder.rollback_placement(model, located['entity'])
              return failure(:cancel_failed, 'no se pudo revertir la colocación local') unless rolled

              @logger.info('project_furniture_placement_cancelled', furniture_instance_id: furniture_instance_id)
            end
            { 'ok' => true, 'code' => 'cancelled', 'instanceId' => furniture_instance_id }
          rescue StandardError => e
            @logger.error('project_furniture_cancel_failed', error: e)
            failure(:cancel_failed, e.message)
          end

          # Panel payload for the dialog: binding-aware rows with
          # pending/placed derived from the working copy. A pending unit with
          # a local root is awaiting position confirmation — surfaced
          # explicitly, never as success.
          def panel
            model = @model_provider.call
            return { 'state' => 'no_model' } unless model

            binding = @binding_store_factory.call.read
            return { 'state' => 'unbound' } unless binding

            instances = @service.list_project_furniture(binding.project_id)
            working = @service.get_working_copy(binding.design_id)
            state = PanelState.build(instances, working,
                                     definition_names: PanelState.definition_names(@catalog_provider))
            PanelState.mark_pending_confirmation(state['items']) do |id|
              locate_unit(model, id)
            end
            { 'state' => 'connected', 'items' => state['items'],
              'pending' => state['pending'], 'placed' => state['placed'] }
          rescue Service::Error => e
            { 'state' => PanelState.error_state(e), 'reason' => e.message }
          rescue Contract::ContractError => e
            { 'state' => 'bad_contract', 'reason' => e.message }
          rescue StandardError => e
            @logger.error('project_furniture_panel_failed', error: e)
            { 'state' => 'error', 'reason' => e.message }
          end

          private

          # Phase 1 — binding + authoritative revalidation. Fails loud
          # (unbound / drifted-base / archived / auth) BEFORE anything is
          # placed or synced (#389 §15).
          def placement_context(_model)
            binding = @binding_store_factory.call.read
            return failure(:unbound, 'conectá este modelo a un proyecto y diseño primero') unless binding

            validate_binding_current(binding) || { 'ok' => true, 'binding' => binding }
          end

          # Fail-loud base guard (#389 §15): placement never proceeds on a
          # drifted-base/archived/foreign binding even if the list endpoints
          # would still answer. Uses the #388 state machine verbatim.
          def validate_binding_current(binding)
            validation = @model_binding_service.validate(project_id: binding.project_id,
                                                         design_id: binding.design_id,
                                                         base_revision_id: binding.base_revision_id)
            state = ModelBinding::State.derive(stored: binding, validation: validation)
            return nil if state == 'connected'

            remediation = state == 'stale_base' ? 'actualizá la base de trabajo en la pestaña Estado' : nil
            failure(state, remediation || 'el enlace del modelo no permite editar este diseño')
          rescue ModelBinding::Service::Error => e
            failure(ModelBinding::State.derive(stored: binding, error: e), e.message)
          end

          def validate_instance_active(binding, furniture_instance_id)
            instance = @service.list_project_furniture(binding.project_id).find { |c| c.id == furniture_instance_id }
            return failure(:not_found, 'el mueble no pertenece al proyecto conectado') unless instance
            return failure(:terminal, 'el mueble fue eliminado del proyecto') if instance.lifecycle_status != 'active'

            { 'ok' => true, 'unit' => instance }
          end

          # Phase 2 — resolve the exact unit from the AUTHORITATIVE project
          # list plus the local duplicate/already-placed guards. A foreign
          # project/org unit is simply absent from the list (#389 proofs E/F).
          # A local root that is NOT yet in the working copy is a placement
          # awaiting position confirmation — resume it instead of duplicating.
          def resolve_unit(binding, furniture_instance_id)
            guard = validate_instance_active(binding, furniture_instance_id)
            return guard unless guard['ok']

            model = @model_provider.call
            located = locate_unit(model, furniture_instance_id)
            return failure(:duplicate_detected, DUPLICATE_MESSAGE) if located['duplicates'] > 1

            if located['entity']
              working = @service.get_working_copy(binding.design_id)
              confirmed = working.items.any? { |item| item.furniture_instance_id == furniture_instance_id }
              return { 'ok' => true,
                       'code' => confirmed ? 'already_placed' : 'pending_confirmation',
                       'instanceId' => furniture_instance_id }
            end

            { 'ok' => true, 'unit' => guard['unit'] }
          end

          # Phase 3 — server-authoritative resolve + one undoable TOP-LEVEL
          # native placement. No working-copy write: the user still has to
          # finalize the position (Move tool) and confirm.
          def insert_furniture_unit(model, binding, instance)
            definition = @catalog_provider.find_definition(instance.furniture_definition_id)
            unless definition
              return failure(:definition_unavailable,
                             'el catálogo del taller no incluye la definición de este mueble')
            end

            parameters = WorkingCopyMerger.placement_parameters(instance, definition)
            layout = WorkingCopyMerger.resolve_layout(@catalog_provider, definition, parameters)

            result = @furniture_builder_factory.call(model).place_existing_furniture(
              model, furniture_instance_id: instance.id, definition: definition,
                     parameters: parameters, resolved_layout: layout,
                     project_id: binding.project_id, design_id: binding.design_id
            )
            return failure(:placement_failed, result['error']) unless result['success']

            @logger.info('project_furniture_inserted',
                         furniture_instance_id: instance.id, components: result['component_count'])
            { 'ok' => true, 'code' => 'pending_position', 'instanceId' => instance.id,
              'components' => result['component_count'] }
          end

          # Phase 4 — sync with the FINAL transform: GET → merge by
          # furnitureInstanceId → PUT complete state (#389 §14). Existing
          # items keep every field SketchUp does not own; a PUT failure rolls
          # the local placement back (#389 §18).
          def sync_placement(model, binding, furniture_instance_id, entity)
            working = @service.get_working_copy(binding.design_id)
            intent = placement_intent(entity, furniture_instance_id) || {}
            locator = persistent_locator(entity)
            merged = WorkingCopyMerger.merge(working, furniture_instance_id, entity,
                                             intent: intent, locator: locator)
            @service.update_working_copy(binding.design_id, items: merged,
                                                            base_revision_id: binding.base_revision_id)
            @logger.info('project_furniture_placed',
                         furniture_instance_id: furniture_instance_id,
                         project_id: binding.project_id, design_id: binding.design_id)
            { 'ok' => true, 'code' => 'placed', 'instanceId' => furniture_instance_id }
          rescue Service::Error => e
            builder = @furniture_builder_factory.call(model)
            rollback_local(model, builder, entity, furniture_instance_id)
            @logger.error('project_furniture_sync_failed', error: e,
                                                           furniture_instance_id: furniture_instance_id)
            failure(:sync_failed,
                    "el diseño no se pudo actualizar (#{e.message}); se revirtió la colocación local")
          end

          # Reads the placed entity's semantic metadata and verifies the
          # business identity matches the unit being confirmed — a corrupt or
          # mismatched root must never be synced. Returns nil on mismatch.
          def placement_intent(entity, furniture_instance_id)
            metadata = @metadata_store_factory.call(@model_provider.call).read(entity)
            identity = metadata.is_a?(Hash) ? metadata['identity'] : nil
            if identity&.dig('furnitureInstanceId') != furniture_instance_id
              @logger.error('project_furniture_intent_mismatch',
                            furniture_instance_id: furniture_instance_id,
                            stored: identity&.dig('furnitureInstanceId'))
              return nil
            end

            metadata['intent'].is_a?(Hash) ? metadata['intent'] : {}
          end

          def locate_unit(model, furniture_instance_id)
            ManagedFurniture.locate(model, @metadata_store_factory.call(model), furniture_instance_id)
          end

          def persistent_locator(entity)
            return nil unless entity.respond_to?(:persistent_id) && entity.persistent_id

            { 'kind' => 'sketchup_persistent_id', 'value' => entity.persistent_id.to_s }
          end

          def rollback_local(model, builder, entity, furniture_instance_id)
            return if builder.rollback_placement(model, entity)

            @logger.error('project_furniture_rollback_failed', furniture_instance_id: furniture_instance_id)
          end

          def failure(code, reason)
            { 'ok' => false, 'code' => code.to_s, 'reason' => reason }
          end
        end
      end
    end
  end
end
