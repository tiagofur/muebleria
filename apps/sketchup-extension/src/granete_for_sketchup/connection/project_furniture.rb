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
      #   * placement state is DERIVED per furnitureInstanceId from active
      #     project membership, exact DesignWorkingCopy intent and one
      #     top-level host inventory — no global placed flag exists;
      #   * board choices seed from the frozen quoted finish overlaid by
      #     the authored working item's explicit roles — a placement never
      #     silently drops the acabado the customer chose (#620, #821 R1);
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
            attr_reader :kind, :status, :api_code

            def initialize(kind, message = nil, status: nil, api_code: nil)
              @kind = kind
              @status = status
              @api_code = api_code
              super(message || kind.to_s)
            end
          end

          def initialize(transport:, auth_provider:, logger: SafeLogger.new)
            @transport = transport
            @auth_provider = auth_provider
            @logger = logger
          end

          # #469 non-secret authenticated-context fingerprint with EXPLICIT
          # semantics. The bearer is deliberately NOT compared: providers
          # mint short-lived tokens and a technical refresh of the SAME
          # context must not abort a placement. Identity comes from the
          # provider's session_context_id (stable across token refresh,
          # changed by logout/re-enrollment/context switch, nil when the
          # context is unknown or unreadable — nil NEVER equals nil: the
          # callers treat an unknown context as fail-closed).
          def context_fingerprint
            context_id = @auth_provider.respond_to?(:session_context_id) ? @auth_provider.session_context_id : nil
            return nil unless context_id.is_a?(String) && !context_id.empty?

            base_url = @transport.respond_to?(:base_url) ? @transport.base_url : nil
            [base_url, context_id]
          rescue StandardError
            nil
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

          # #391 / DT-7: Duplicates an existing project-owned FurnitureInstance
          # on the backend. The backend assigns server-authoritative origin='duplicate'
          # and origin_furniture_instance_id referencing the source instance, returning 201.
          # IdempotencyKey is sent to guarantee retry safety.
          def duplicate_furniture_instance(project_id, instance_id, idempotency_key: nil)
            headers = {}
            headers['Idempotency-Key'] = idempotency_key if idempotency_key && !idempotency_key.to_s.strip.empty?
            body = request(:post, "/projects/#{project_id}/furniture-instances/#{instance_id}:duplicate", {},
                           extra_headers: headers)
            Contract.parse_instance!(body)
          end

          # #1177: the terminal lifecycle command — POST
          # /furniture-instances/{id}:remove marks the unit lifecycle_status
          # 'removed' (durable history, never a hard delete). Optimistic
          # concurrency via the strong version ETag: If-Match must be
          # `"v<version>"` exactly as the server formats it; a stale version
          # surfaces as the typed 409 VERSION_CONFLICT.
          def remove_furniture_instance(instance_id, expected_version:)
            unless expected_version.is_a?(Integer) && expected_version >= 1
              raise ArgumentError, 'expected_version es obligatorio (token If-Match)'
            end

            body = request(:post, "/furniture-instances/#{instance_id}:remove", {},
                           extra_headers: { 'If-Match' => "\"v#{expected_version}\"" })
            Contract.parse_instance!(body)
          end

          # #784 R3: the server-side inheritance projection (badge authority).
          def get_design_inheritance(design_id)
            body = request(:get, "/designs/#{design_id}/working-copy/material-provenance")
            DesignInheritanceContract.parse!(body)
          end

          # #784 R4: resolves definition-aware effective materials and inheritance modes
          # against the Design's authoring defaults.
          def get_effective_materials(design_id, definition_id, material_choices: {})
            payload = {
              'furnitureDefinitionId' => definition_id,
              'materialChoices' => material_choices || {}
            }
            body = request(:post, "/designs/#{design_id}/effective-materials", payload)
            EffectiveMaterialsContract.parse!(body)
          end

          def get_working_copy(design_id)
            body = request(:get, "/designs/#{design_id}/working-copy")
            Contract::WorkingCopyContract.parse_working_copy!(body)
          end

          # Sends the COMPLETE desired working state (replace semantics of
          # PUT); the caller is responsible for merging, never for silent
          # overwrite of items it did not place. expected_working_version is
          # the canonical #810 workingVersion token — the verbatim updated_at
          # of the caller's last authoritative read — validated server-side
          # under the write lock (409 VERSION_CONFLICT on mismatch).
          def update_working_copy(design_id, items:, expected_working_version:, authoring_defaults: nil,
                                  base_revision_id: nil, source_type: nil)
            unless expected_working_version.is_a?(String) && !expected_working_version.strip.empty?
              raise ArgumentError, 'expected_working_version es obligatorio (token workingVersion #810)'
            end

            payload = { 'items' => items.map(&:to_contract_h),
                        'expected_working_version' => expected_working_version }
            # #784 R2: the durable Design authoring defaults ride the same
            # #810 frontier. Omitted (nil) keeps the stored defaults
            # (legacy nil-keeps); a provided block replaces them wholesale.
            payload['authoring_defaults'] = authoring_defaults if authoring_defaults
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
            return response['body'] if [200, 201].include?(status)

            raise typed_error(status, response)
          rescue ::Granete::SketchUpExtension::Transport::RequestError => e
            @logger.error('project_furniture_request_failed', error: e)
            raise Error.new(:unreachable, 'no se pudo contactar al servidor')
          end

          def typed_error(status, response)
            error_body = response['body']
            api_code = error_body.is_a?(Hash) ? error_body['code'] : nil
            case status
            when 400 then raise Error.new(:bad_request, error_message(response), status: status, api_code: api_code)
            when 401 then raise Error.new(:unauthenticated, 'sesión expirada o inválida', status: status,
                                                                                          api_code: api_code)
            when 403 then raise Error.new(:unauthorized, 'no tenés permiso para este proyecto o diseño',
                                          status: status, api_code: api_code)
            when 404 then raise Error.new(:not_found, 'proyecto, diseño o mueble inexistente', status: status,
                                                                                               api_code: api_code)
            when 409 then raise Error.new(:conflict, conflict_message(response), status: status, api_code: api_code)
            when 428 then raise Error.new(:precondition_required, error_message(response), status: status,
                                                                                           api_code: api_code)
            else raise Error.new(:bad_response, "respuesta inesperada del servidor (#{status})", status: status,
                                                                                                 api_code: api_code)
            end
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

            remediation = state == 'stale_base' ? 'actualizá la base de trabajo en la tarjeta Modelo / Diseño' : nil
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

          # Authoritative inputs for placing an existing unit (#389 §8 +
          # #620). Returns [parameters, choices, lineage modes] — the modes
          # always ride the SAME source that won the choices, so a re-placed
          # unit keeps its #784 lineage. A pending create-and-place intent is
          # resumed verbatim; with a live working item, parameters seed from
          # the quoted display and the item overlays the frozen choices; #977:
          # when the item is gone (delete → sync → re-place), the instance's
          # authoring snapshot replaces it — the unit re-enters with its
          # authored finishes, lineage and dimensions, never as defaults.
          def placement_inputs(service, intent_store, binding, instance, definition)
            pending = intent_store.fetch(instance.id)
            if pending
              return [pending['parameters'],
                      compose_effective_choices(instance, pending['material_choices']),
                      pending['materialChoiceModes']]
            end

            working = service.get_working_copy(binding.design_id)
            item = working.items.find { |candidate| candidate.furniture_instance_id == instance.id }
            if item
              return [WorkingCopyMerger.placement_parameters(instance, definition),
                      compose_effective_choices(instance, item.material_choices),
                      item.material_choice_modes]
            end

            [WorkingCopyMerger.recovery_placement_parameters(instance, definition),
             compose_effective_choices(instance, instance.authoring_material_choices),
             instance.authoring_material_choice_modes]
          end

          # base = frozen display choices; overlay = explicit authored/intent
          # choices. The overlay wins only for the keys it contains.
          def compose_effective_choices(instance, overlay)
            base = instance.display_material_choices || {}
            return base.dup unless overlay.is_a?(Hash) && !overlay.empty?

            base.merge(overlay)
          end

          # #469 gesture-context fingerprint: a deterministic digest of the
          # authoritative composition the preview was generated from —
          # definition identity, resolved dimensions AND the per-board
          # geometry (size + local translation), so a board that changes
          # width or placement under UNCHANGED ids is still detected when
          # dimensionsMm is absent. The commit compares against it: a
          # DIFFERENT composition means the accepted transform refers to a
          # stale preview and must not be placed — the user regenerates the
          # preview instead.
          def layout_signature(layout)
            return nil unless layout.is_a?(::Granete::SketchUpExtension::Library::NativeLayout)

            boards = layout.boards.map do |board|
              "#{board.component_instance_id}:#{board.geometry_fingerprint}"
            end.sort
            [
              layout.furniture_definition_id,
              layout.dimensions_mm ? layout.dimensions_mm.join('x') : 'no-dims',
              boards.join(';'),
              layout.hardware.map(&:placement_id).sort.join(',')
            ].join('|')
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

          def store(instance_id, parameters:, material_choices:, material_choice_modes: nil)
            return unless instance_id

            entry = {
              'parameters' => parameters || {},
              'material_choices' => material_choices || {}
            }
            # Canonical intent key (camelCase) matches MetadataWriter intent
            # and the working-copy merger; no duplicated snake_case spelling.
            if material_choice_modes.is_a?(Hash) && !material_choice_modes.empty?
              entry['materialChoiceModes'] = material_choice_modes
            end
            @intents[instance_id.to_s] = entry
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
        class Placer # rubocop:disable Metrics/ClassLength
          attr_reader :intent_store, :service, :host_reconciliation

          # rubocop:disable-next Metrics/ParameterLists
          def initialize(model_provider:, binding_store_factory:, model_binding_service:,
                         service:, metadata_store_factory:, catalog_provider:,
                         furniture_builder_factory:, intent_store: IntentStore.new,
                         host_reconciliation: nil, restorer: nil, logger: SafeLogger.new)
            @model_provider = model_provider
            @binding_store_factory = binding_store_factory
            @model_binding_service = model_binding_service
            @service = service
            @metadata_store_factory = metadata_store_factory
            @catalog_provider = catalog_provider
            @furniture_builder_factory = furniture_builder_factory
            @intent_store = intent_store
            @logger = logger
            @host_reconciliation = host_reconciliation || HostReconciliation.new(
              model_provider: model_provider, binding_store_factory: binding_store_factory,
              service: service, metadata_store_factory: metadata_store_factory, logger: logger
            )
            @restorer = restorer || Restorer.new(
              model_provider: model_provider, binding_store_factory: binding_store_factory,
              model_binding_service: model_binding_service, service: service,
              metadata_store_factory: metadata_store_factory, catalog_provider: catalog_provider,
              furniture_builder_factory: furniture_builder_factory,
              host_reconciliation: @host_reconciliation, logger: logger
            )
          end

          # Step 1 — authoritative context + unit scope + insertion. Does NOT
          # touch the working copy: the unit lands at the origin and is handed
          # to the Move tool; confirm_placement completes the sync with the
          # final transform. `pending_position` is an honest intermediate —
          # never success.
          #
          # #469: with a `transformation` (the accepted preview gesture) the
          # canonical insertion lands the unit directly at the user's final
          # position and the Move handoff is skipped — same command, same
          # identity, one undo operation. expected_layout_signature pins the
          # composition the gesture previewed: a different one fails closed
          # (composition_changed) BEFORE any insertion — the preview must be
          # regenerated, never silently placed.
          def place(furniture_instance_id, transformation: nil, expected_layout_signature: nil)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            context = placement_context(model)
            return context unless context['ok']

            reconciliation = @host_reconciliation.projection
            unless reconciliation['state'] == 'connected'
              return failure(:host_reconciliation_required,
                             reconciliation['reason'] || 'el estado local del diseño no se pudo reconciliar')
            end
            admission, manual_missing = placement_admission(reconciliation, furniture_instance_id, transformation)
            return admission unless admission == true

            unit = resolve_unit(context['binding'], furniture_instance_id)
            # Failures, already_placed (focus) and pending_confirmation
            # (resume the confirm step) short-circuit here.
            return unit unless unit['unit']

            insert_furniture_unit(model, context['binding'], unit['unit'],
                                  transformation: transformation,
                                  expected_layout_signature: expected_layout_signature,
                                  missing_manual: manual_missing)
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

          # #469 — preview preparation for the shared placement tool: runs
          # the SAME guards and server-side resolution as #place (binding,
          # reconciliation, unit scope, definition, layout) but mutates
          # nothing and allocates nothing. The transient tool consumes the
          # returned layout/label for its preview; identity and productive
          # state are untouched until the commit click revalidates through
          # #place itself.
          # #870 — a missing_local unit previews through the SAME entry
          # point with its WorkingCopy-authoritative inputs (the exact
          # source its commit re-reads), so the gesture signature covers
          # the authorized composition, not the quoted display.
          def prepare_placement_preview(furniture_instance_id)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            context = placement_context(model)
            return context unless context['ok']

            reconciliation = @host_reconciliation.projection
            unless reconciliation['state'] == 'connected'
              return failure(:host_reconciliation_required,
                             reconciliation['reason'] || 'el estado local del diseño no se pudo reconciliar')
            end
            missing_manual = missing_local_row?(reconciliation, furniture_instance_id)

            unit = resolve_unit(context['binding'], furniture_instance_id)
            return unit unless unit['unit']

            resolved = preview_inputs(context, unit['unit'], missing_manual)
            return resolved unless resolved.is_a?(Array)

            definition, params, choices, = resolved
            layout = WorkingCopyMerger.resolve_layout(@catalog_provider, definition, params, choices)
            { 'ok' => true, 'code' => 'preview_ready', 'instanceId' => unit['unit'].id,
              'definition' => definition, 'parameters' => params,
              'material_choices' => choices, 'layout' => layout,
              'layout_signature' => PlacementGuards.layout_signature(layout) }
          rescue Service::Error => e
            failure(:service_error, e.message)
          rescue PlacementResolutionError => e
            failure(:resolution_failed, e.message)
          rescue Contract::ContractError => e
            failure(:bad_contract, e.message)
          rescue StandardError => e
            @logger.error('project_furniture_preview_prepare_failed', error: e)
            failure(:preview_failed, e.message)
          end

          # #784 R4: server-authoritative effective materials for a bound
          # insertion. Unbound models (or an already-explicit modes statement
          # from the R3b inspector apply) keep the caller-provided choices.
          EffectivePlacementMaterials = Struct.new(:choices, :modes, keyword_init: true)

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
          #
          # #469: with a `transformation` (the accepted preview gesture) the
          # identity is still minted ONLY here — at the explicit commit — and
          # the insertion lands at the user's final position with no Move
          # handoff. Browsing/previewing the catalog never allocates identity.
          def create_and_place(definition_id:, parameters: {}, material_choices: {}, idempotency_key: nil,
                               transformation: nil, expected_layout_signature: nil,
                               material_choice_modes: nil, material_overrides: nil)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            # Local fast failure (same code the catalog resolve uses) so an
            # empty definition never pays the effective-materials roundtrip.
            if definition_id.to_s.strip.empty?
              return failure(:definition_unavailable,
                             'la definición del mueble es requerida')
            end

            context = placement_context(model)
            return context unless context['ok']

            effective = compose_effective_materials(context['binding'], definition_id,
                                                    material_choices,
                                                    overrides: material_overrides,
                                                    modes: material_choice_modes)

            prep = PlacementCreation.prepare_unit(@catalog_provider, definition_id, parameters, effective.choices)
            return prep unless prep['ok']

            signature_mismatch = composition_mismatch(expected_layout_signature, prep['layout'])
            return signature_mismatch if signature_mismatch

            execute_created_placement(model, context['binding'], prep, idempotency_key,
                                      effective.choices, material_choice_modes: effective.modes,
                                                         transformation: transformation)
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

          # #469 — catalog preview preparation: the connected Library entry
          # point resolves definition + authoritative layout WITHOUT minting
          # any backend identity (no POST /furniture-instances) — the
          # FurnitureInstance is created canonically (#390) only inside the
          # commit gesture.
          def prepare_catalog_preview(definition_id:, parameters: {}, material_choices: {}, material_overrides: nil)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            # Local fast failure before the effective-materials roundtrip.
            if definition_id.to_s.strip.empty?
              return failure(:definition_unavailable,
                             'la definición del mueble es requerida')
            end

            context = placement_context(model)
            return context unless context['ok']

            effective = compose_effective_materials(context['binding'], definition_id,
                                                    material_choices, overrides: material_overrides)

            prep = PlacementCreation.prepare_unit(@catalog_provider, definition_id, parameters, effective.choices)
            return prep unless prep['ok']

            { 'ok' => true, 'code' => 'preview_ready',
              'definition' => prep['definition'], 'parameters' => prep['params'],
              'material_choices' => effective.choices, 'layout' => prep['layout'],
              'layout_signature' => PlacementGuards.layout_signature(prep['layout']) }
          rescue Service::Error => e
            failure(:service_error, e.message)
          rescue PlacementResolutionError => e
            failure(:resolution_failed, e.message)
          rescue Contract::ContractError => e
            failure(:bad_contract, e.message)
          rescue StandardError => e
            @logger.error('project_furniture_catalog_preview_failed', error: e)
            failure(:preview_failed, e.message)
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

          # Panel payload for the dialog: binding-aware rows derived from the
          # shared Project + WorkingCopy + top-level host reconciliation.
          def panel
            PanelState.build_panel_payload(
              reconciliation: @host_reconciliation,
              catalog_provider: @catalog_provider
            )
          end

          def restore(furniture_instance_id)
            @restorer.restore(furniture_instance_id)
          end

          # #1177 — the explicit terminal output the panel lacked: QUITAR del
          # proyecto. Order is server → design → host:
          #   1. POST :remove with If-Match against the FRESH authority read
          #      (a stale panel row version must never fail the remove; a real
          #      concurrent transition surfaces as the typed conflict);
          #   2. the design working copy drops the unit's item through the
          #     canonical #810 SafeWrite frontier (a leftover item would keep
          #     a zombie "Identidad no vigente" row alive until a manual sync);
          #   3. the local entity is erased in one undoable operation.
          # The identity survives server-side as auditable 'removed' history
          # (never a hard delete) and disappears from the panel, the project
          # and future materializations. Partial outcomes are honest flags —
          # never false success: designPending asks for one explicit
          # "Sincronizar diseño"; localPending asks for a manual cleanup.
          def remove(furniture_instance_id)
            model = @model_provider.call
            return failure(:no_model, 'no hay un modelo activo') unless model

            context = placement_context(model)
            return context unless context['ok']

            binding = context['binding']

            instance = @service.list_project_furniture(binding.project_id)
                               .find { |candidate| candidate.id == furniture_instance_id }
            return failure(:not_found, 'el mueble no pertenece al proyecto conectado') unless instance
            if instance.lifecycle_status != 'active'
              return failure(:terminal, 'el mueble ya fue eliminado del proyecto')
            end

            @service.remove_furniture_instance(furniture_instance_id, expected_version: instance.version)
            @intent_store.clear(furniture_instance_id)
            @logger.info('project_furniture_removed', furniture_instance_id: furniture_instance_id,
                                                      project_id: binding.project_id)

            result = { 'ok' => true, 'code' => 'removed', 'instanceId' => furniture_instance_id,
                       'designPending' => drop_working_copy_item(binding, furniture_instance_id) }
            result.merge(erase_local_unit(model, furniture_instance_id))
          rescue Service::Error => e
            if e.status == 409
              failure(:conflict, 'el mueble cambió en el servidor; panel actualizado, intentá de nuevo')
            else
              failure(:service_error, e.message)
            end
          rescue Contract::ContractError => e
            failure(:bad_contract, e.message)
          rescue StandardError => e
            @logger.error('project_furniture_remove_failed', error: e)
            failure(:remove_failed, e.message)
          end

          private

          # #784 R4: resolves definition-aware effective materials against
          # the Design working copy when the model is bound and no explicit
          # modes statement exists (the R3b inspector apply carries its
          # server-derived statement verbatim). Server authority only — the
          # client never composes compatibility or lineage itself.
          def compose_effective_materials(binding, definition_id, material_choices, overrides: nil, modes: nil)
            return EffectivePlacementMaterials.new(choices: material_choices, modes: modes) unless binding && modes.nil?

            resolved = @service.get_effective_materials(
              binding.design_id, definition_id,
              material_choices: overrides.nil? ? material_choices : overrides
            )
            EffectivePlacementMaterials.new(choices: resolved.material_choices,
                                            modes: resolved.material_choice_modes)
          end

          def execute_created_placement(model, binding, prep, idempotency_key, material_choices,
                                        material_choice_modes: nil, transformation: nil)
            key = PlacementCreation.fallback_idempotency_key(idempotency_key)
            created = @service.create_furniture_instance(
              binding.project_id,
              definition_id: prep['definition']['furniture_definition_id'],
              idempotency_key: key
            )
            @intent_store.store(created.id, parameters: prep['params'], material_choices: material_choices,
                                            material_choice_modes: material_choice_modes)

            located = locate_unit(model, created.id)
            return { 'ok' => true, 'code' => 'pending_position', 'instanceId' => created.id } if located['entity']

            inserted = insert_physical_unit(model, binding, created, prep['definition'],
                                            prep['params'], material_choices, prep['layout'],
                                            material_choice_modes: material_choice_modes,
                                            transformation: transformation,
                                            prepare: transformation.nil?)
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
          def placement_context(model)
            PlacementGuards.placement_context(binding_store(model), @model_binding_service)
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
          # finalize the position (Move tool) and confirm. With a preview
          # `transformation` the position is already final: the canonical
          # insertion receives it verbatim and skips the Move handoff.
          def insert_furniture_unit(model, binding, instance, transformation: nil,
                                    expected_layout_signature: nil, missing_manual: false)
            definition = @catalog_provider.find_definition(instance.furniture_definition_id)
            unless definition
              return failure(:definition_unavailable,
                             'el catálogo del taller no incluye la definición de este mueble')
            end

            # #870: a manually placed missing unit keeps its AUTHORIZED
            # composition — the same source its preview resolved, so the
            # pinned layout signature still matches. #977: the same
            # resolution carries the lineage modes (live item on the
            # recovery lane, authoring snapshot on the delete→re-place
            # lane) so the re-placed unit re-enters with its #784 lineage.
            inputs = resolve_placement_inputs(binding, instance, definition, missing_manual)
            return inputs unless inputs.is_a?(Array)

            params, choices, modes = inputs
            layout = WorkingCopyMerger.resolve_layout(@catalog_provider, definition, params, choices)
            signature_mismatch = composition_mismatch(expected_layout_signature, layout)
            return signature_mismatch if signature_mismatch

            insert_physical_unit(model, binding, instance, definition, params, choices, layout,
                                 material_choice_modes: modes,
                                 transformation: transformation, prepare: transformation.nil?,
                                 preserve_parameters: missing_manual)
          end

          # A pinned composition that no longer matches the freshly resolved
          # layout fails closed BEFORE any insertion (#469 gesture context).
          def composition_mismatch(expected_layout_signature, layout)
            return nil unless expected_layout_signature
            return nil if expected_layout_signature == PlacementGuards.layout_signature(layout)

            failure(:composition_changed,
                    'la composición del mueble cambió desde la vista previa; ' \
                    'cancelá con Esc y generá la vista previa de nuevo')
          end

          # rubocop:disable-next Metrics/ParameterLists
          def insert_physical_unit(model, binding, instance, definition, parameters, choices, layout,
                                   material_choice_modes: nil,
                                   transformation: nil, prepare: true, preserve_parameters: false)
            result = @furniture_builder_factory.call(model).place_existing_furniture(
              model, furniture_instance_id: instance.id, definition: definition,
                     parameters: parameters, resolved_layout: layout, material_choices: choices,
                     material_choice_modes: material_choice_modes,
                     project_id: binding.project_id, design_id: binding.design_id,
                     transformation: transformation, prepare: prepare,
                     preserve_parameters: preserve_parameters
            )
            return failure(:placement_failed, result['error']) unless result['success']

            @logger.info('project_furniture_inserted',
                         furniture_instance_id: instance.id, components: result['component_count'])
            { 'ok' => true, 'code' => 'pending_position', 'instanceId' => instance.id,
              'components' => result['component_count'] }
          end

          # Admission of an existing unit against the live reconciliation
          # (#870): unreconcilable rows fail closed, and a missing_local
          # unit re-enters placement ONLY through an explicit preview
          # gesture — the ordinary origin+Move path stays closed. Returns
          # [failure_answer, false] to block, or [true, manual_missing].
          def placement_admission(reconciliation, furniture_instance_id, transformation)
            row = reconciliation['items'].find { |item| item['id'] == furniture_instance_id }
            manual_missing = row && row['reconciliationState'] == 'missing_local' && transformation
            if row && %w[missing_local incompatible unknown].include?(row['reconciliationState']) && !manual_missing
              blocked = failure(:host_reconciliation_required,
                                row['reason'] || 'el estado local del mueble no se pudo reconciliar')
              return [blocked, false]
            end

            [true, !!manual_missing]
          end

          # True when the live reconciliation still classifies this unit as
          # missing_local — the #870 manual-recovery preview lane.
          def missing_local_row?(reconciliation, furniture_instance_id)
            row = reconciliation['items'].find { |item| item['id'] == furniture_instance_id }
            !!(row && row['reconciliationState'] == 'missing_local')
          end

          # Definition + composition inputs for the #469 preview: the
          # exact catalog definition plus the lane-appropriate inputs.
          # Returns a failure answer, or [definition, params, choices].
          def preview_inputs(context, instance, missing_manual)
            definition = @catalog_provider.find_definition(instance.furniture_definition_id)
            unless definition
              return failure(:definition_unavailable,
                             'el catálogo del taller no incluye la definición de este mueble')
            end

            inputs = resolve_placement_inputs(context['binding'], instance, definition, missing_manual)
            return inputs unless inputs.is_a?(Array)

            [definition, *inputs]
          end

          # The composition inputs a placement renders from. Ordinary lanes
          # seed from the quote display (#389/#620); a #870 missing unit's
          # manual recovery keeps its AUTHORIZED WorkingCopy item verbatim
          # (restore semantics — never re-seeded from the quoted display).
          # Returns [params, choices], or the correlated failure itself
          # when the backing item no longer exists. #977: returns a
          # [parameters, choices, modes] triple — the lineage modes ride the
          # same authoritative inputs (live item for the recovery lane,
          # authoring snapshot for the delete→re-place lane) so a re-placed
          # unit keeps its #784 lineage instead of re-entering as fresh
          # overrides.
          def resolve_placement_inputs(binding, instance, definition, missing_manual)
            unless missing_manual
              return PlacementGuards.placement_inputs(@service, @intent_store, binding, instance, definition)
            end

            recovered = missing_unit_inputs(binding, instance)
            return recovered unless recovered['ok']

            [recovered['parameters'], recovered['material_choices'], recovered['material_choice_modes']]
          end

          # #870 — manual recovery of a missing_local unit resolves its
          # composition from the AUTHORITATIVE WorkingCopy item: parameters
          # and material choices verbatim, exactly like the Restorer.
          # Preview preparation and the commit both go through here, so
          # the gesture signature covers the authorized composition.
          def missing_unit_inputs(binding, instance)
            working = @service.get_working_copy(binding.design_id)
            item = working.items.find { |candidate| candidate.furniture_instance_id == instance.id }
            unless item
              return { 'ok' => false, 'code' => 'working_copy_changed',
                       'reason' => 'el Working Copy ya no contiene exactamente este mueble' }
            end

            { 'ok' => true, 'parameters' => item.parameters || {},
              'material_choices' => item.material_choices || {},
              'material_choice_modes' => item.material_choice_modes }
          end

          # Phase 4 — sync with the FINAL transform: GET → merge by
          # furnitureInstanceId → PUT complete state (#389 §14, #810
          # frontier). Existing items keep every field SketchUp does not
          # own; a PUT failure rolls the local placement back (#389 §18).
          def sync_placement(model, binding, furniture_instance_id, entity)
            working = @service.get_working_copy(binding.design_id)
            intent = placement_intent(entity, furniture_instance_id) || {}
            locator = ManagedFurniture.persistent_locator(entity)
            merged = WorkingCopyMerger.merge(working, furniture_instance_id, entity,
                                             intent: intent, locator: locator,
                                             authoring_dirty: authoring_dirty?(entity, furniture_instance_id))
            @service.update_working_copy(binding.design_id, items: merged,
                                                            base_revision_id: binding.base_revision_id,
                                                            expected_working_version: working.updated_at)
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

          # #810 rule C: a locally edited entity carries the persisted
          # authoring-dirty flag until a confirmed sync clears it; the merge
          # then owns its parameters/material choices.
          def authoring_dirty?(entity, furniture_instance_id)
            metadata = @metadata_store_factory.call(@model_provider.call).read(entity)
            return false unless metadata.is_a?(Hash)

            identity = metadata['identity']
            return false unless identity&.dig('furnitureInstanceId') == furniture_instance_id

            metadata['authoringDirty'] == true
          end

          def locate_unit(model, furniture_instance_id)
            ManagedFurniture.locate(model, @metadata_store_factory.call(model), furniture_instance_id)
          end

          def rollback_local(model, builder, entity, furniture_instance_id)
            return if builder.rollback_placement(model, entity)

            @logger.error('project_furniture_rollback_failed', furniture_instance_id: furniture_instance_id)
          end

          # #1177 step 2: the removed unit's working-copy item leaves through
          # the shared conflict-safe frontier — other items travel verbatim,
          # the write is verified, and a lost response converges. Failure is
          # swallowed into the honest designPending flag (the unit IS already
          # removed from the project; the next "Sincronizar diseño" converges
          # the design) — it must never undo the server remove.
          def drop_working_copy_item(binding, furniture_instance_id)
            working = @service.get_working_copy(binding.design_id)
            return false if working.items.none? { |item| item.furniture_instance_id == furniture_instance_id }

            remaining = working.items.reject { |item| item.furniture_instance_id == furniture_instance_id }
            DesignSync::SafeWrite.write(service: @service, working: working, items: remaining,
                                        base_revision_id: binding.base_revision_id)
            false
          rescue Service::Error => e
            @logger.error('project_furniture_remove_design_pending', error: e,
                                                                     furniture_instance_id: furniture_instance_id)
            true
          end

          # #1177 step 3: erase the managed local root (same undoable
          # erase+purge a failed placement rollback uses). Honest flags:
          # localErased for the host mutation (save-pending), localPending
          # when geometry survives (duplicate roots or a failed erase).
          def erase_local_unit(model, furniture_instance_id)
            located = locate_unit(model, furniture_instance_id)
            return { 'localErased' => false, 'localPending' => false } unless located['entity']

            if located['duplicates'] > 1
              @logger.error('project_furniture_remove_duplicates', furniture_instance_id: furniture_instance_id)
              return { 'localErased' => false, 'localPending' => true,
                       'reason' => "#{DUPLICATE_MESSAGE}; la unidad ya fue quitada del proyecto" }
            end

            if @furniture_builder_factory.call(model).rollback_placement(model, located['entity'])
              { 'localErased' => true, 'localPending' => false }
            else
              @logger.error('project_furniture_remove_erase_failed', furniture_instance_id: furniture_instance_id)
              { 'localErased' => false, 'localPending' => true,
                'reason' => 'la unidad fue quitada del proyecto, pero no se pudo borrar la geometría local; ' \
                            'borrala manualmente del modelo' }
            end
          end

          def failure(code, reason)
            { 'ok' => false, 'code' => code.to_s, 'reason' => reason }
          end

          def binding_store(model)
            @binding_store_factory.arity.zero? ? @binding_store_factory.call : @binding_store_factory.call(model)
          end
        end
      end
    end
  end
end
