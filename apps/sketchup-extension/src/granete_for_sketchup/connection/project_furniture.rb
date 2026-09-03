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
      #     survive, and a backend failure rolls back the local insertion —
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

        # Orchestrates Place EXISTING FurnitureInstance (#389 §8/§14/§18):
        #
        #   binding → revalidate (#388) → server instance list → local
        #   duplicate guard → server-authoritative resolve → one undoable
        #   native placement stamped with furnitureInstanceId → merge-PUT the
        #   working copy → on backend failure, roll the local insertion back
        #   and fail loud.
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

          def place(furniture_instance_id)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            context = placement_context(model)
            return context unless context['ok']

            unit = resolve_unit(context['binding'], furniture_instance_id)
            # Failures AND already_placed (focus existing) short-circuit here.
            return unit unless unit['unit']

            place_and_sync(model, context['binding'], unit['unit'])
          rescue Service::Error => e
            failure(:service_error, e.message)
          rescue PlacementResolutionError => e
            failure(:resolution_failed, e.message)
          rescue Contract::ContractError => e
            failure(:bad_contract, e.message)
          rescue StandardError => e
            warn e.backtrace.first(6).join("\n") if ENV['PF_DEBUG']
            @logger.error('project_furniture_place_failed', error: e)
            failure(:place_failed, e.message)
          end

          # Phase 1 — model + binding + authoritative revalidation. Fails
          # loud (unbound / drifted-base / archived / auth) BEFORE anything
          # is placed (#389 §15).
          def placement_context(_model)
            binding = @binding_store_factory.call.read
            return failure(:unbound, 'conectá este modelo a un proyecto y diseño primero') unless binding

            guard = validate_binding_current(binding)
            return guard if guard

            { 'ok' => true, 'binding' => binding }
          end

          # Phase 2 — resolve the exact unit from the AUTHORITATIVE project
          # list plus the local duplicate/already-placed guards. A foreign
          # project/org unit is simply absent from the list (#389 proofs E/F).
          def resolve_unit(binding, furniture_instance_id)
            instances = @service.list_project_furniture(binding.project_id)
            instance = instances.find { |candidate| candidate.id == furniture_instance_id }
            return failure(:not_found, 'el mueble no pertenece al proyecto conectado') unless instance
            return failure(:terminal, 'el mueble fue eliminado del proyecto') if instance.lifecycle_status != 'active'

            metadata_store = @metadata_store_factory.call(@model_provider.call)
            located = ManagedFurniture.locate(@model_provider.call, metadata_store, furniture_instance_id)
            if located['duplicates'] > 1
              # Two roots sharing one business ID is an invalid steady state
              # (#391): never a third placement, never a new identity.
              return failure(:duplicate_detected, DUPLICATE_MESSAGE)
            end
            if located['entity']
              return { 'ok' => true, 'code' => 'already_placed',
                       'instanceId' => furniture_instance_id }
            end

            { 'ok' => true, 'unit' => instance }
          end

          # Phase 3 — server-authoritative resolve, one undoable native
          # placement, then merge-PUT the working copy; a backend failure
          # rolls the local insertion back and fails loud (#389 §18).
          def place_and_sync(model, binding, instance)
            definition = @catalog_provider.find_definition(instance.furniture_definition_id)
            unless definition
              return failure(:definition_unavailable,
                             'el catálogo del taller no incluye la definición de este mueble')
            end

            parameters = placement_parameters(instance, definition)
            layout = resolve_layout(definition, parameters)

            builder = @furniture_builder_factory.call(model)
            result = builder.place_existing_furniture(
              model, furniture_instance_id: instance.id, definition: definition,
                     parameters: parameters, resolved_layout: layout,
                     project_id: binding.project_id, design_id: binding.design_id
            )
            return failure(:placement_failed, result['error']) unless result['success']

            sync_result = sync_working_copy(model, builder, binding, instance, definition,
                                            parameters, result)
            return sync_result unless sync_result['ok']

            @logger.info('project_furniture_placed',
                         furniture_instance_id: instance.id,
                         project_id: binding.project_id, design_id: binding.design_id,
                         components: result['component_count'])
            { 'ok' => true, 'code' => 'placed', 'instanceId' => instance.id,
              'components' => result['component_count'] }
          end

          # GET → merge by furnitureInstanceId → PUT complete state; other
          # working items survive untouched (#389 §14).
          def sync_working_copy(model, builder, binding, instance, definition, parameters, result)
            working = @service.get_working_copy(binding.design_id)
            merged = merge_working_items(working, instance, definition, parameters,
                                         TransformContract.from_host(result['entity'].transformation),
                                         result['entity'])
            begin
              @service.update_working_copy(binding.design_id, items: merged,
                                                              base_revision_id: binding.base_revision_id)
            rescue Service::Error => e
              rollback_local(model, builder, result['entity'], instance.id)
              @logger.error('project_furniture_sync_failed', error: e, furniture_instance_id: instance.id)
              return failure(:sync_failed,
                             "el diseño no se pudo actualizar (#{e.message}); se revirtió la colocación local")
            end
            { 'ok' => true }
          end

          # Panel payload for the dialog: binding-aware rows with
          # pending/placed derived from the working copy.
          def panel
            model = @model_provider.call
            return { 'state' => 'no_model' } unless model

            binding = @binding_store_factory.call.read
            return { 'state' => 'unbound' } unless binding

            instances = @service.list_project_furniture(binding.project_id)
            working = @service.get_working_copy(binding.design_id)
            state = PanelState.build(instances, working, definition_names: definition_names)
            { 'state' => 'connected', 'items' => state['items'],
              'pending' => state['pending'], 'placed' => state['placed'] }
          rescue Service::Error => e
            { 'state' => panel_error_state(e), 'reason' => e.message }
          rescue Contract::ContractError => e
            { 'state' => 'bad_contract', 'reason' => e.message }
          rescue StandardError => e
            @logger.error('project_furniture_panel_failed', error: e)
            { 'state' => 'error', 'reason' => e.message }
          end

          private

          # Fail-loud base guard (#389 §15): placement never proceeds on a
          # drifted-base/archived/foreign binding even if the list endpoints would
          # still answer. Uses the #388 state machine verbatim.
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

          def placement_parameters(instance, definition)
            parameters = {}
            (definition['parameters'] || []).each do |parameter|
              parameters[parameter['name']] = parameter['defaultValue'] if parameter.key?('defaultValue')
            end
            dims = instance.display_dimensions
            if dims
              parameters['widthMm'] = dims[0] if dims[0]
              parameters['heightMm'] = dims[1] if dims[1]
              parameters['depthMm'] = dims[2] if dims[2]
            end
            parameters
          end

          # Resolution is server-authoritative (#389 §9): a server that
          # rejects the composition fails the placement loudly — the unit is
          # NOT placeable against a locally guessed geometry. nil (a local
          # development catalog that cannot resolve layouts) keeps the
          # builder's documented generic authoring renderer.
          def resolve_layout(definition, parameters)
            return nil unless @catalog_provider.respond_to?(:resolved_native_layout)

            @catalog_provider.resolved_native_layout(definition['furniture_definition_id'], parameters, {})
          rescue Library::LayoutResolutionError => e
            raise PlacementResolutionError,
                  "Granete no pudo resolver la composición de este mueble (#{e.message})"
          end

          # Merge rule (#389 §14): PUT carries the COMPLETE desired state —
          # every existing working item survives untouched; an item for this
          # unit is added (or refreshed with the placement transform when a
          # row already existed). Parameters/materials of existing items are
          # server state and are never overwritten by a local render.
          def merge_working_items(working, instance, definition, parameters, transform, entity)
            items = working.items.reject { |item| item.furniture_instance_id == instance.id }
            items << Contract::WorkingItem.new(
              furniture_instance_id: instance.id,
              furniture_definition_id: instance.furniture_definition_id,
              definition_version: definition['definition_version'],
              parameters: parameters, material_choices: {},
              transform: transform, technical_client_locator: persistent_locator(entity)
            )
            items
          end

          def persistent_locator(entity)
            value = entity.respond_to?(:persistent_id) ? entity.persistent_id : nil
            return nil unless value

            { 'kind' => 'sketchup_persistent_id', 'value' => value.to_s }
          end

          def rollback_local(model, builder, entity, furniture_instance_id)
            rolled = builder.rollback_placement(model, entity)
            return if rolled

            @logger.error('project_furniture_rollback_failed', furniture_instance_id: furniture_instance_id)
          end

          def definition_names
            names = {}
            if @catalog_provider.respond_to?(:all_definitions)
              (@catalog_provider.all_definitions || []).each do |definition|
                names[definition['furniture_definition_id']] = definition['name']
              end
            end
            names
          end

          def panel_error_state(error)
            case error.kind
            when :unauthenticated then 'unauthenticated'
            when :unauthorized then 'unauthorized'
            when :unreachable then 'unreachable'
            else 'error'
            end
          end

          def failure(code, reason)
            { 'ok' => false, 'code' => code.to_s, 'reason' => reason }
          end
        end
      end
    end
  end
end
