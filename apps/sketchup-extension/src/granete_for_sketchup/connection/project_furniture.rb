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

        # HTTP client for the #389 / #390 surface: project furniture list,
        # design-first identity creation (POST /furniture-instances with
        # server-authoritative origin='design' and Idempotency-Key) and the
        # design working copy (GET + merge-PUT). Typed errors only.
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

          # #390 / DT-6: Allocates an authoritative project-owned FurnitureInstance
          # identity on the backend before SketchUp places the physical component.
          # The backend assigns server-authoritative origin='design' and returns 201.
          # IdempotencyKey is sent to guarantee retry safety.
          def create_furniture_instance(project_id, definition_id: nil, idempotency_key: nil)
            payload = {}
            payload['furniture_definition_id'] = definition_id if definition_id && !definition_id.to_s.strip.empty?
            headers = {}
            headers['Idempotency-Key'] = idempotency_key if idempotency_key && !idempotency_key.to_s.strip.empty?
            body = request(:post, "/projects/#{project_id}/furniture-instances", payload, extra_headers: headers)
            Contract.parse_instance!(body)
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

          def request(method, path, body = nil, extra_headers: nil)
            raise Error.new(:unauthenticated, 'sin sesión iniciada') unless @auth_provider.configured?

            payload = { 'method' => method.to_s.upcase, 'path' => path, 'headers' => {} }
            payload['body'] = body if body
            auth = @auth_provider.authorization_header
            payload['headers']['Authorization'] = auth if auth
            payload['headers'].merge!(extra_headers) if extra_headers

            response = @transport.request(payload)
            status = response['status'].to_i
            case status
            when 200, 201 then response['body']
            when 400 then raise Error.new(:bad_request, error_message(response), status: status)
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

          def error_message(response)
            response.dig('body', 'error', 'message') || response.dig('body', 'message') || 'solicitud inválida'
          end
        end

        # Reusable placement revalidation and lifecycle guards (#389 §15).
        module PlacementGuards
          module_function

          def placement_context(binding_store, model_binding_service)
            binding = binding_store.read
            unless binding
              return { 'ok' => false, 'code' => 'unbound',
                       'reason' => 'conectá este modelo a un proyecto y diseño primero' }
            end

            validate_binding_current(binding, model_binding_service) || { 'ok' => true, 'binding' => binding }
          end

          def validate_binding_current(binding, model_binding_service)
            validation = model_binding_service.validate(project_id: binding.project_id,
                                                        design_id: binding.design_id,
                                                        base_revision_id: binding.base_revision_id)
            state = ModelBinding::State.derive(stored: binding, validation: validation)
            return nil if state == 'connected'

            remediation = state == 'stale_base' ? 'actualizá la base de trabajo en la pestaña Estado' : nil
            { 'ok' => false, 'code' => state,
              'reason' => remediation || 'el enlace del modelo no permite editar este diseño' }
          rescue ModelBinding::Service::Error => e
            { 'ok' => false, 'code' => ModelBinding::State.derive(stored: binding, error: e), 'reason' => e.message }
          end

          def validate_instance_active(service, binding, furniture_instance_id)
            instance = service.list_project_furniture(binding.project_id).find { |c| c.id == furniture_instance_id }
            unless instance
              return { 'ok' => false, 'code' => 'not_found',
                       'reason' => 'el mueble no pertenece al proyecto conectado' }
            end
            if instance.lifecycle_status != 'active'
              return { 'ok' => false, 'code' => 'terminal',
                       'reason' => 'el mueble fue eliminado del proyecto' }
            end

            { 'ok' => true, 'unit' => instance }
          end

          def resolve_unit(service, binding, furniture_instance_id, located)
            guard = validate_instance_active(service, binding, furniture_instance_id)
            return guard unless guard['ok']
            if located['duplicates'] > 1
              return { 'ok' => false, 'code' => 'duplicate_detected', 'reason' => DUPLICATE_MESSAGE }
            end

            if located['entity']
              working = service.get_working_copy(binding.design_id)
              confirmed = working.items.any? { |item| item.furniture_instance_id == furniture_instance_id }
              return { 'ok' => true,
                       'code' => confirmed ? 'already_placed' : 'pending_confirmation',
                       'instanceId' => furniture_instance_id }
            end

            { 'ok' => true, 'unit' => guard['unit'] }
          end

          def confirm_entity_guard(located, intent)
            if located['duplicates'] > 1
              return { 'ok' => false, 'code' => 'duplicate_detected', 'reason' => DUPLICATE_MESSAGE }
            end
            unless located['entity']
              return { 'ok' => false, 'code' => 'not_placed',
                       'reason' => 'el mueble no está en el modelo; colocálo primero' }
            end
            unless intent
              return { 'ok' => false, 'code' => 'intent_mismatch',
                       'reason' => 'la identidad del mueble no coincide; colocálo de nuevo' }
            end

            { 'ok' => true }
          end
        end

        # Helpers for design-first backend instance creation (#390 DT-6).
        module PlacementCreation
          module_function

          def prepare_unit(catalog_provider, definition_id, parameters, material_choices)
            definition = catalog_provider.find_definition(definition_id)
            unless definition
              return { 'ok' => false, 'code' => 'definition_unavailable',
                       'reason' => 'el catálogo del taller no incluye la definición de este mueble' }
            end

            params = WorkingCopyMerger.catalog_parameters(definition, parameters)
            layout = WorkingCopyMerger.resolve_layout(catalog_provider, definition, params, material_choices)
            { 'ok' => true, 'definition' => definition, 'params' => params, 'layout' => layout }
          end

          def fallback_idempotency_key(key)
            stripped = key.to_s.strip
            return stripped unless stripped.empty?

            "idem-#{(Time.now.to_f * 1000).to_i}-#{rand(0xffff).to_s(16)}#{rand(0xffff).to_s(16)}"
          end
        end

        # Retains pending catalog authoring intent across local insertion failures
        # so recovery placement reuses the selected parameters/material choices (#390).
        class IntentStore
          def initialize
            @intents = {}
          end

          def store(instance_id, parameters:, material_choices:)
            return unless instance_id

            @intents[instance_id.to_s] = {
              'parameters' => parameters || {},
              'material_choices' => material_choices || {}
            }
          end

          def fetch(instance_id)
            @intents[instance_id.to_s]
          end

          def clear(instance_id)
            @intents.delete(instance_id.to_s)
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
          attr_reader :intent_store

          def initialize(model_provider:, binding_store_factory:, model_binding_service:,
                         service:, metadata_store_factory:, catalog_provider:,
                         furniture_builder_factory:, intent_store: IntentStore.new, logger: SafeLogger.new)
            @model_provider = model_provider
            @binding_store_factory = binding_store_factory
            @model_binding_service = model_binding_service
            @service = service
            @metadata_store_factory = metadata_store_factory
            @catalog_provider = catalog_provider
            @furniture_builder_factory = furniture_builder_factory
            @intent_store = intent_store
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

          # #390 / DT-6: Design-first creation and placement from catalog.
          # Flow:
          #   1. context guard: model active, binding connected & current.
          #   2. definition guard: definition found in catalog.
          #   3. normalize parameters & resolve layout server-side.
          #   4. create authoritative identity on backend FIRST:
          #      POST /projects/{projectId}/furniture-instances with Idempotency-Key
          #      server mints FurnitureInstance.id with origin='design'.
          #   5. insert into SketchUp top-level root stamped with THAT SAME id.
          #   6. returns pending_position with instanceId.
          # If backend fails: no local root is inserted (fails loud).
          # If local placement fails: backend identity remains in project (pending),
          #   never rolled back/deleted destructively from backend.
          def create_and_place(definition_id:, parameters: {}, material_choices: {}, idempotency_key: nil)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            context = placement_context(model)
            return context unless context['ok']

            prep = PlacementCreation.prepare_unit(@catalog_provider, definition_id, parameters, material_choices)
            return prep unless prep['ok']

            execute_created_placement(model, context['binding'], prep, idempotency_key, material_choices)
          rescue Service::Error => e
            failure(:service_error, e.message)
          rescue PlacementResolutionError => e
            failure(:resolution_failed, e.message)
          rescue Contract::ContractError => e
            failure(:bad_contract, e.message)
          rescue StandardError => e
            @logger.error('project_furniture_create_and_place_failed', error: e)
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
            entity = located['entity']
            intent = entity ? placement_intent(entity, furniture_instance_id) : nil
            guard = PlacementGuards.confirm_entity_guard(located, intent)
            return guard unless guard['ok']

            active_guard = validate_instance_active(context['binding'], furniture_instance_id)
            unless active_guard['ok']
              builder = @furniture_builder_factory.call(model)
              rollback_local(model, builder, entity, furniture_instance_id)
              return active_guard
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
            metadata_store = model ? @metadata_store_factory.call(model) : nil
            PanelState.build_panel_payload(
              model: model,
              binding_store: @binding_store_factory.call,
              service: @service,
              catalog_provider: @catalog_provider,
              metadata_store: metadata_store,
              logger: @logger
            )
          end

          private

          def execute_created_placement(model, binding, prep, idempotency_key, material_choices)
            key = PlacementCreation.fallback_idempotency_key(idempotency_key)
            created = @service.create_furniture_instance(
              binding.project_id,
              definition_id: prep['definition']['furniture_definition_id'],
              idempotency_key: key
            )
            @intent_store.store(created.id, parameters: prep['params'], material_choices: material_choices)

            located = locate_unit(model, created.id)
            return { 'ok' => true, 'code' => 'pending_position', 'instanceId' => created.id } if located['entity']

            inserted = insert_physical_unit(model, binding, created, prep['definition'],
                                            prep['params'], material_choices, prep['layout'])
            unless inserted['ok']
              msg = "el mueble se creó en el proyecto (#{created.id}) pero falló su inserción local: " \
                    "#{inserted['reason']}"
              return { 'ok' => false, 'code' => 'created_pending', 'instanceId' => created.id, 'reason' => msg }
            end

            inserted
          end

          # Phase 1 — binding + authoritative revalidation. Fails loud
          # (unbound / drifted-base / archived / auth) BEFORE anything is
          # placed or synced (#389 §15).
          def placement_context(_model)
            PlacementGuards.placement_context(@binding_store_factory.call, @model_binding_service)
          end

          def validate_instance_active(binding, furniture_instance_id)
            PlacementGuards.validate_instance_active(@service, binding, furniture_instance_id)
          end

          # Phase 2 — resolve the exact unit from the AUTHORITATIVE project
          # list plus the local duplicate/already-placed guards. A foreign
          # project/org unit is simply absent from the list (#389 proofs E/F).
          # A local root that is NOT yet in the working copy is a placement
          # awaiting position confirmation — resume it instead of duplicating.
          def resolve_unit(binding, furniture_instance_id)
            model = @model_provider.call
            located = locate_unit(model, furniture_instance_id)
            PlacementGuards.resolve_unit(@service, binding, furniture_instance_id, located)
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

            pending = @intent_store.fetch(instance.id)
            params = pending ? pending['parameters'] : WorkingCopyMerger.placement_parameters(instance, definition)
            choices = pending ? pending['material_choices'] : {}
            layout = WorkingCopyMerger.resolve_layout(@catalog_provider, definition, params, choices)
            insert_physical_unit(model, binding, instance, definition, params, choices, layout)
          end

          def insert_physical_unit(model, binding, instance, definition, parameters, choices, layout)
            result = @furniture_builder_factory.call(model).place_existing_furniture(
              model, furniture_instance_id: instance.id, definition: definition,
                     parameters: parameters, resolved_layout: layout, material_choices: choices,
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
            locator = ManagedFurniture.persistent_locator(entity)
            merged = WorkingCopyMerger.merge(working, furniture_instance_id, entity,
                                             intent: intent, locator: locator)
            @service.update_working_copy(binding.design_id, items: merged,
                                                            base_revision_id: binding.base_revision_id)
            @intent_store.clear(furniture_instance_id)
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
