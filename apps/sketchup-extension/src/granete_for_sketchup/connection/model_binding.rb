# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Connection
      # #388 / DT-4 — bind one SketchUp model to one exact Granete
      # Project/Design working context (digital-thread §12).
      #
      # Authority rules this module enforces:
      #   * business identity (projectId/designId/baseRevisionId) comes ONLY
      #     from the backend validation response — never from the filename,
      #     path, model GUID, persistent_id or user input;
      #   * the binding dictionary `com.granete.project` is written ONLY after
      #     authoritative validation succeeds; a failed validation/rebind
      #     preserves the previous valid binding untouched;
      #   * rebind is explicit: switching to a different Project/Design
      #     requires a reviewed confirmation and keeps the old binding until
      #     the new one validates;
      #   * the local `instanceRef`/`project_ref` namespace stays a technical
      #     locator/compatibility alias — it is never promoted to server
      #     identity (convergence with `furnitureInstanceId` happens in #389).
      module ModelBinding
        DICTIONARY = 'com.granete.project'
        BINDING_KEY = 'granete.project-binding.v1'
        SCHEMA_VERSION = 1
        UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/

        # Canonical plugin states (digital-thread §12 + #388 acceptance):
        # every state is surfaced distinctly — none collapses into another.
        STATES = %w[unbound connected stale_base design_archived invalid
                    incompatible unauthenticated unauthorized unreachable].freeze

        # Immutable, validated binding value object.
        class Binding
          attr_reader :project_id, :design_id, :base_revision_id, :schema_version

          def initialize(project_id:, design_id:, base_revision_id:, schema_version: SCHEMA_VERSION)
            @project_id = project_id
            @design_id = design_id
            @base_revision_id = base_revision_id
            @schema_version = schema_version
          end

          def valid?
            ModelBinding.uuid?(@project_id) && ModelBinding.uuid?(@design_id) &&
              (@base_revision_id.nil? || ModelBinding.uuid?(@base_revision_id)) &&
              @schema_version.is_a?(Integer) && @schema_version >= 1
          end

          def same_target?(other)
            other.is_a?(Binding) && @project_id == other.project_id && @design_id == other.design_id
          end

          def to_h
            {
              'projectId' => @project_id,
              'designId' => @design_id,
              'baseRevisionId' => @base_revision_id,
              'schemaVersion' => @schema_version
            }
          end

          # Fail-closed parse of a stored/payload binding shape.
          def self.parse(payload)
            return nil unless payload.is_a?(Hash)

            base = payload['baseRevisionId']
            binding = new(
              project_id: payload['projectId'],
              design_id: payload['designId'],
              base_revision_id: base.to_s.strip.empty? ? nil : base,
              schema_version: payload['schemaVersion']
            )
            binding.valid? ? binding : nil
          end
        end

        def self.uuid?(value)
          value.is_a?(String) && value.match?(UUID_PATTERN)
        end

        # Model-level binding persistence (digital-thread §12). The stored
        # value is one versioned JSON envelope inside the Granete-owned
        # dictionary, so a binding write is atomic and survives save/reopen
        # with the file — it never depends on filename, path or model.guid.
        class Store
          attr_reader :last_error

          def initialize(model)
            @model = model
            @last_error = nil
          end

          # Returns the stored Binding, or nil when absent/corrupt. Corrupt
          # metadata is surfaced through last_error so callers can derive the
          # `invalid` state — it is never interpreted as a valid binding.
          def read
            @last_error = nil
            return nil unless @model.respond_to?(:get_attribute)

            raw = @model.get_attribute(ModelBinding::DICTIONARY, ModelBinding::BINDING_KEY)
            return nil if raw.nil? || raw.to_s.strip.empty?

            payload = JSON.parse(raw)
            binding = Binding.parse(payload)
            return binding if binding

            @last_error = :invalid_binding_metadata
            nil
          rescue JSON::ParserError
            @last_error = :invalid_binding_json
            nil
          end

          # Writes the binding as one standalone undoable model operation
          # (Metadata::Store rule: never nested inside a caller's operation).
          # Undo keeps an accidental binding reversible; the caller is
          # responsible for only calling this AFTER validation succeeded.
          def write!(binding)
            raise ArgumentError, 'binding must be valid' unless binding.is_a?(Binding) && binding.valid?
            return false unless @model.respond_to?(:set_attribute)
            return false unless @model.respond_to?(:start_operation)

            # rubocop:disable-next SketchupSuggestions/OperationName
            @model.start_operation('Conectar modelo a Granete', true)
            begin
              @model.set_attribute(ModelBinding::DICTIONARY, ModelBinding::BINDING_KEY,
                                   JSON.generate(binding.to_h))
              @model.commit_operation
              true
            rescue StandardError
              @model.abort_operation
              raise
            end
          end
        end

        # Fail-closed parser for the backend `binding:validate` response —
        # the Ruby mirror of the generated Go DTO. Unknown shapes, wrong
        # state values or missing identity fields raise instead of guessing.
        module Contract
          STATES = %w[valid design_archived].freeze
          DESIGN_STATUSES = %w[draft active archived].freeze

          Validation = Struct.new(:state, :schema_version, :organization, :project, :design,
                                  :working_copy, :capabilities, keyword_init: true)

          def self.parse!(body)
            raise ArgumentError, 'model binding payload must be present' if body.nil?

            payload = body.is_a?(Hash) ? body : JSON.parse(body)
            require_keys!(payload, 'state', 'schema_version', 'organization', 'project',
                          'design', 'working_copy', 'capabilities')

            state = payload['state']
            raise ArgumentError, "unknown model binding state: #{state.inspect}" unless STATES.include?(state)

            schema_version = payload['schema_version']
            unless schema_version.is_a?(Integer) && schema_version >= 1
              raise ArgumentError, "invalid schema_version: #{schema_version.inspect}"
            end

            Validation.new(
              state: state,
              schema_version: schema_version,
              organization: summary!(payload['organization'], 'organization'),
              project: summary!(payload['project'], 'project'),
              design: design_summary!(payload['design']),
              working_copy: working_copy!(payload['working_copy']),
              capabilities: capabilities!(payload['capabilities'])
            )
          end

          def self.summary!(value, label)
            raise ArgumentError, "#{label} must be an object" unless value.is_a?(Hash)
            raise ArgumentError, "#{label}.id must be a uuid" unless ModelBinding.uuid?(value['id'])
            raise ArgumentError, "#{label}.name must be a string" unless value['name'].is_a?(String)

            { 'id' => value['id'], 'name' => value['name'] }
          end

          def self.design_summary!(value)
            summary = summary!(value, 'design')
            status = value['status']
            raise ArgumentError, "unknown design status: #{status.inspect}" unless DESIGN_STATUSES.include?(status)

            summary['status'] = status
            summary
          end

          def self.working_copy!(value)
            raise ArgumentError, 'working_copy must be an object' unless value.is_a?(Hash)

            base = value['base_revision_id']
            unless base.nil? || ModelBinding.uuid?(base)
              raise ArgumentError,
                    'working_copy.base_revision_id must be a uuid or null'
            end

            number = value['base_revision_number']
            unless number.nil? || (number.is_a?(Integer) && number >= 1)
              raise ArgumentError,
                    'working_copy.base_revision_number must be a positive integer or null'
            end

            { 'base_revision_id' => base, 'base_revision_number' => number }
          end

          def self.capabilities!(value)
            raise ArgumentError, 'capabilities must be an object' unless value.is_a?(Hash)

            %w[can_edit_working_copy can_publish_revision].each do |key|
              raise ArgumentError, "capabilities.#{key} must be boolean" unless [true, false].include?(value[key])
            end
            value.slice('can_edit_working_copy', 'can_publish_revision')
          end

          def self.require_keys!(payload, *keys)
            keys.each do |key|
              raise ArgumentError, "missing model binding key: #{key}" unless payload.key?(key)
            end
          end
        end

        # #499 Slice 3 — fail-closed parser for the pairing exchange
        # response. The payload embeds the same #388 sub-objects
        # (organization/project/design/working_copy/capabilities), so the
        # parsing rules stay identical; only the grant envelope is new.
        module PairingContract
          PairingExchange = Struct.new(:grant_id, :action, :pinned_base_revision_id, :state,
                                       :schema_version, :organization, :project, :design,
                                       :working_copy, :capabilities, keyword_init: true)

          PAIRING_ACTIONS = %w[open_design].freeze
          PAIRING_STATES = %w[valid design_archived].freeze

          def self.pairing_exchange!(body)
            raise ArgumentError, 'pairing exchange payload must be present' if body.nil?

            payload = body.is_a?(Hash) ? body : JSON.parse(body)
            Contract.require_keys!(payload, 'grant_id', 'action', 'pinned_base_revision_id', 'state',
                                   'schema_version', 'organization', 'project', 'design',
                                   'working_copy', 'capabilities')

            unless PAIRING_ACTIONS.include?(payload['action'])
              raise ArgumentError,
                    "unknown pairing action: #{payload['action'].inspect}"
            end
            unless PAIRING_STATES.include?(payload['state'])
              raise ArgumentError,
                    "unknown pairing state: #{payload['state'].inspect}"
            end

            pinned = payload['pinned_base_revision_id']
            unless pinned.nil? || ModelBinding.uuid?(pinned)
              raise ArgumentError,
                    'pinned base revision must be a uuid or null'
            end

            PairingExchange.new(
              grant_id: payload['grant_id'],
              action: payload['action'],
              pinned_base_revision_id: pinned,
              state: payload['state'],
              schema_version: payload['schema_version'],
              organization: Contract.summary!(payload['organization'], 'organization'),
              project: Contract.summary!(payload['project'], 'project'),
              design: Contract.design_summary!(payload['design']),
              working_copy: Contract.working_copy!(payload['working_copy']),
              capabilities: Contract.capabilities!(payload['capabilities'])
            )
          end

          # Minimal fail-closed parser for confirm/status responses: only the
          # terminal status matters to the dialog flow.
          PAIRING_GRANT_STATUSES = %w[pending exchanged confirmed cancelled expired].freeze

          def self.pairing_status!(body)
            raise ArgumentError, 'pairing status payload must be present' if body.nil?

            payload = body.is_a?(Hash) ? body : JSON.parse(body)
            Contract.require_keys!(payload, 'status')
            status = payload['status']
            unless PAIRING_GRANT_STATUSES.include?(status)
              raise ArgumentError,
                    "unknown pairing grant status: #{status.inspect}"
            end

            { 'status' => status }
          end
        end

        # HTTP client for the model-binding surface: project/design discovery
        # and the authoritative binding validation (#388 extension contract).
        # Errors are typed — never message-substring behavior.
        class Service
          class Error < StandardError
            attr_reader :kind

            def initialize(kind, message = nil)
              @kind = kind
              super(message || kind.to_s)
            end
          end

          def initialize(transport:, auth_provider:, logger: SafeLogger.new)
            @transport = transport
            @auth_provider = auth_provider
            @logger = logger
          end

          def list_projects
            response = request(:get, '/projects')
            decode_list!(response) do |entry|
              ModelBinding.uuid?(entry['id']) && entry['name'].is_a?(String)
            end
            response['body'].map { |entry| { 'id' => entry['id'], 'name' => entry['name'] } }
          end

          def list_designs(project_id)
            response = request(:get, "/projects/#{project_id}/designs")
            decode_list!(response) do |entry|
              ModelBinding.uuid?(entry['id']) && entry['name'].is_a?(String) &&
                Contract::DESIGN_STATUSES.include?(entry['status'])
            end
            response['body'].map do |entry|
              { 'id' => entry['id'], 'name' => entry['name'], 'status' => entry['status'] }
            end
          end

          # Validates a binding candidate. base_revision_id carries the
          # stored binding's expectation (nil for a first binding).
          def validate(project_id:, design_id:, base_revision_id: nil)
            body = { 'client_schema_version' => ModelBinding::SCHEMA_VERSION }
            body['base_revision_id'] = base_revision_id if base_revision_id
            response = request(:post, "/projects/#{project_id}/designs/#{design_id}/binding:validate", body)
            Contract.parse!(response['body'])
          end

          # Same normalization semantics as the backend device code: case and
          # separator insensitive, alphanumerics only.
          PAIRING_CODE_LENGTH = 12

          def self.normalize_pairing_code(raw)
            raw.to_s.upcase.gsub(/[^A-Z0-9]/, '')
          end

          # #499 Slice 3: consume a one-time pairing code through the SAME
          # extension-authenticated transport every other call uses. The raw
          # code never enters the model or any persistence.
          def exchange_pairing_code(code)
            normalized = Service.normalize_pairing_code(code)
            raise Error.new(:bad_request, 'código de vinculación inválido') if normalized.length != PAIRING_CODE_LENGTH

            response = request(:post, '/design-pairing-grants:exchange', { 'code' => normalized })
            PairingContract.pairing_exchange!(response['body'])
          end

          # #499 Slice 3: confirm the exact persisted binding. Device-only
          # endpoint; carries exact IDs, never model data.
          def confirm_pairing_grant(grant_id:, project_id:, design_id:, base_revision_id:)
            body = { 'project_id' => project_id, 'design_id' => design_id,
                     'base_revision_id' => base_revision_id }
            response = request(:post, "/design-pairing-grants/#{grant_id}:confirm", body)
            PairingContract.pairing_status!(response['body'])
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
            when 200 then response
            when 401 then raise Error.new(:unauthenticated, 'sesión expirada o inválida')
            when 403 then raise Error.new(:unauthorized, 'no tenés permiso para este proyecto o diseño')
            when 404 then raise Error.new(:not_found, 'proyecto, diseño o revisión inexistente')
            when 409
              message = response.dig('body', 'message') || 'conflicto con el estado del servidor'
              raise Error.new(:conflict, message)
            else raise Error.new(:bad_response, "respuesta inesperada del servidor (#{status})")
            end
          rescue ::Granete::SketchUpExtension::Transport::RequestError => e
            @logger.error('model_binding_request_failed', error: e)
            raise Error.new(:unreachable, 'no se pudo contactar al servidor')
          end

          def decode_list!(response)
            body = response['body']
            raise Error.new(:bad_response, 'lista inválida') unless body.is_a?(Array)

            body.each do |entry|
              valid = entry.is_a?(Hash) && yield(entry)
              raise Error.new(:bad_response, 'entrada de lista inválida') unless valid
            end
          end
        end

        # Derives the canonical state machine from the stored binding plus
        # the authoritative validation (or typed service error).
        module State
          module_function

          # stored: Binding|nil, validation: Contract::Validation|nil,
          # error: Service::Error|nil
          def derive(stored:, validation: nil, error: nil)
            return error_state(error) if error
            return 'unbound' if stored.nil? && validation.nil?

            return 'incompatible' if validation && validation.schema_version > ModelBinding::SCHEMA_VERSION
            return 'design_archived' if validation && validation.state == 'design_archived'

            # Staleness is only knowable against an authoritative answer.
            if validation && stored &&
               !base_matches?(stored.base_revision_id, validation.working_copy['base_revision_id'])
              return 'stale_base'
            end

            # Without an authoritative answer a stored binding cannot be
            # confirmed — never reported as connected or unbound.
            return 'invalid' unless validation

            stored ? 'connected' : 'unbound'
          end

          def error_state(error)
            case error.kind
            when :unauthenticated then 'unauthenticated'
            when :unauthorized then 'unauthorized'
            when :unreachable then 'unreachable'
            else 'invalid' # not_found and unexpected kinds never pass as connected
            end
          end

          def base_matches?(stored_base, authoritative_base)
            normalized(stored_base) == normalized(authoritative_base)
          end

          def normalized(value)
            value.to_s.strip.empty? ? nil : value
          end
        end

        # Orchestrates bind/rebind/revalidate. Guarantees:
        #   * no metadata write before a successful authoritative validation;
        #   * failed validation leaves the previous binding and hierarchy
        #     intact;
        #   * rebind requires explicit confirmation and inventory review;
        #   * base-drift remediation (adopting the authoritative base) is explicit.
        # rubocop:disable-next Metrics/ClassLength
        class Connector
          REBIND_REQUIRED = :rebind_required
          USE_AUTHORITATIVE_WORKING_BASE = Object.new.freeze

          def initialize(store_factory:, service:, logger: SafeLogger.new)
            @store_factory = store_factory
            @service = service
            @logger = logger
            @last_error = nil
          end

          # The bridge reuses the same service for discovery lists; the
          # connector remains the only writer of binding metadata.
          attr_reader :service

          # Full status payload for the dialog: canonical state + display
          # summaries + capabilities + remediation hint.
          def status
            store = @store_factory.call
            stored = store.read
            return { 'state' => 'invalid', 'reason' => store.last_error.to_s } if stored.nil? && store.last_error
            return { 'state' => 'unbound' } if stored.nil?

            validation, = validate_or_failure(project_id: stored.project_id,
                                              design_id: stored.design_id,
                                              stored: stored, base_revision_id: stored.base_revision_id)
            return validation_error_status(stored) if validation.nil?

            {
              'state' => State.derive(stored: stored, validation: validation),
              'binding' => display_binding(stored, validation),
              'authoritativeBaseRevisionId' => validation.working_copy['base_revision_id'],
              'authoritativeBaseRevisionNumber' => validation.working_copy['base_revision_number'],
              'capabilities' => validation.capabilities
            }
          end

          # Binds (first time) or rebinds (explicit confirm) the active model
          # to one exact Project/Design. Returns a result payload:
          #   { 'ok' => true, 'status' => ... }
          #   { 'ok' => false, 'code' => 'rebind_required', 'current' => ...,
          #     'target' => ... }
          #   { 'ok' => false, 'code' => 'validation_failed'|..., 'reason' => ... }
          def bind(project_id:, design_id:, confirm_rebind: false)
            unless ModelBinding.uuid?(project_id) && ModelBinding.uuid?(design_id)
              return failure('invalid_target', 'proyecto o diseño inválido')
            end

            store = @store_factory.call
            current = store.read
            blocker = rebind_blocker(current, project_id, design_id, confirm_rebind)
            return blocker if blocker

            validation, error_failure = validate_or_failure(project_id: project_id,
                                                            design_id: design_id, stored: current)
            return error_failure if error_failure

            incompatible = incompatible_failure(validation)
            return incompatible if incompatible

            write_bound(store, validation)
          rescue StandardError => e
            @logger.error('model_bind_failed', error: e)
            failure('bind_failed', e.message)
          end

          # #499 Slice 3 — the normal Web→SketchUp demo path: consume a
          # one-time pairing code and converge into the SAME canonical
          # binding the manual flow writes. One-time semantics are honored
          # honestly: the exchange happens first, and if the LOCAL binding
          # fails afterwards the code stays consumed — the error says so and
          # the user returns to the Web for a fresh code.
          # rubocop:disable-next Metrics/AbcSize, Metrics/MethodLength
          def connect_with_code(code)
            normalized = Service.normalize_pairing_code(code)
            unless normalized.length == Service::PAIRING_CODE_LENGTH
              return failure('invalid_code', 'el código debe tener 12 caracteres (ignorá espacios y guiones)',
                             'pairing' => true)
            end

            exchange = @service.exchange_pairing_code(normalized)
            return pairing_exchange_failure(exchange) if exchange.state == 'design_archived'
            if exchange.schema_version > ModelBinding::SCHEMA_VERSION
              return failure('incompatible',
                             "el servidor usa la versión #{exchange.schema_version} del contrato de enlace",
                             'state' => 'incompatible', 'pairing' => true)
            end

            project_id = exchange.project['id']
            design_id = exchange.design['id']
            store = @store_factory.call
            current = store.read
            blocker = rebind_blocker(current, project_id, design_id, false)
            return blocker.merge('pairing' => true) if blocker

            # The exact frozen pin from the grant — never the (possibly
            # newer) authoritative working base. nil is an exact grant pin,
            # not an instruction to rebase. The manual flow alone selects its
            # authoritative working base through the explicit sentinel.
            written_base = exchange.pinned_base_revision_id
            write_bound(store, exchange, base_revision_id: written_base)

            # Confirmation requires a READBACK of the canonical dictionary:
            # compare the exact persisted identity, not a write's true.
            stored = store.read
            unless exact_readback?(stored, project_id, design_id, written_base)
              return failure('bind_readback_failed',
                             'el enlace no se pudo verificar en el modelo. Cerralo sin guardar y volvé a conectar; ' \
                             'si el problema persiste, generá un código nuevo en la web.',
                             'pairing' => true)
            end

            begin
              @service.confirm_pairing_grant(grant_id: exchange.grant_id,
                                             project_id: project_id,
                                             design_id: design_id,
                                             base_revision_id: stored.base_revision_id)
            rescue Service::Error => e
              @logger.error('pairing_confirm_failed', error: e)
              # The binding IS persisted and verified locally; only the Web
              # confirmation did not reach the server. Honest partial result.
              return { 'ok' => true, 'confirmationFailed' => true, 'pairing' => true,
                       'reason' => 'el modelo quedó conectado, pero la web no registró la confirmación; ' \
                                   'puede seguir mostrando "código aceptado".',
                       'status' => status }
            end

            { 'ok' => true, 'status' => status, 'pairing' => true }
          rescue Service::Error => e
            @logger.error('pairing_exchange_failed', error: e)
            pairing_error_failure(e)
          rescue StandardError => e
            @logger.error('pairing_connect_failed', error: e)
            failure('connect_failed', e.message, 'pairing' => true)
          end

          # Explicit base-drift remediation: adopt the authoritative working base
          # after the user reviews the drift. Re-validates first; never
          # writes a base the server did not just confirm.
          def adopt_authoritative_base
            store = @store_factory.call
            stored = store.read
            return failure('unbound', 'el modelo no está conectado') if stored.nil?

            validation, error_failure = validate_or_failure(project_id: stored.project_id,
                                                            design_id: stored.design_id, stored: stored)
            return error_failure if error_failure

            updated = Binding.new(
              project_id: stored.project_id,
              design_id: stored.design_id,
              base_revision_id: validation.working_copy['base_revision_id'],
              schema_version: ModelBinding::SCHEMA_VERSION
            )
            store.write!(updated)
            { 'ok' => true, 'status' => status }
          end

          private

          # Runs the authoritative validation and maps typed service errors
          # into connector failure payloads. Returns [validation, nil] on
          # success or [nil, failure]; status() uses validation == nil plus
          # @last_error to build the error status.
          def validate_or_failure(project_id:, design_id:, stored:, base_revision_id: nil)
            validation = @service.validate(project_id: project_id, design_id: design_id,
                                           base_revision_id: base_revision_id)
            [validation, nil]
          rescue Service::Error => e
            @last_error = e
            @logger.error('model_binding_validate_failed', error: e)
            [nil, failure('validation_failed', e.message, 'state' => State.derive(stored: stored, error: e))]
          end

          def validation_error_status(stored)
            error = @last_error
            { 'state' => State.derive(stored: stored, error: error),
              'reason' => error.message,
              'binding' => display_binding(stored, nil) }
          end

          # A stored binding pointing at a DIFFERENT Project/Design requires
          # the explicit reviewed switch: without confirmation nothing runs,
          # nothing is written (#388 rebind policy).
          def rebind_blocker(current, project_id, design_id, confirm_rebind)
            target = Binding.new(project_id: project_id, design_id: design_id, base_revision_id: nil)
            return nil unless current && !current.same_target?(target) && !confirm_rebind

            failure('rebind_required', 'este modelo ya está conectado a otro diseño',
                    'current' => display_binding(current, nil),
                    'target' => target_summary(project_id, design_id))
          end

          # Fail loud: never bind against a contract this plugin cannot
          # understand (#388 compatibility gate).
          def incompatible_failure(validation)
            return nil unless validation.schema_version > ModelBinding::SCHEMA_VERSION

            failure('incompatible',
                    "el servidor usa la versión #{validation.schema_version} del contrato de enlace",
                    'state' => 'incompatible')
          end

          # The sentinel is manual-flow-only. Pairing always passes the grant
          # pin explicitly, including its meaningful null value.
          def write_bound(store, validation, base_revision_id: USE_AUTHORITATIVE_WORKING_BASE)
            if base_revision_id.equal?(USE_AUTHORITATIVE_WORKING_BASE)
              base_revision_id = validation.working_copy['base_revision_id']
            end
            binding = Binding.new(
              project_id: validation.project['id'],
              design_id: validation.design['id'],
              base_revision_id: base_revision_id,
              schema_version: ModelBinding::SCHEMA_VERSION
            )
            store.write!(binding)
            @logger.info('model_bound',
                         project_id: binding.project_id, design_id: binding.design_id,
                         base_revision_id: binding.base_revision_id)
            { 'ok' => true, 'status' => status }
          end

          def display_binding(stored, validation)
            {
              'projectId' => stored.project_id,
              'designId' => stored.design_id,
              'baseRevisionId' => stored.base_revision_id
            }.tap do |display|
              if validation
                display['organizationName'] = validation.organization['name']
                display['projectName'] = validation.project['name']
                display['designName'] = validation.design['name']
                display['designStatus'] = validation.design['status']
              end
            end
          end

          def target_summary(project_id, design_id)
            { 'projectId' => project_id, 'designId' => design_id }
          end

          # Exact identity comparison against the canonical dictionary —
          # the #499 confirmation gate. nil-safe on both sides.
          def exact_readback?(stored, project_id, design_id, base_revision_id)
            return false if stored.nil?

            stored.project_id == project_id &&
              stored.design_id == design_id &&
              stored.base_revision_id.to_s == base_revision_id.to_s
          end

          def pairing_error_failure(error)
            case error.kind
            when :not_found
              failure('code_not_found', 'el código no existe o expiró; generá uno nuevo en la web', 'pairing' => true)
            when :conflict
              failure('code_unusable', 'el código ya fue usado, expiró o fue cancelado; generá uno nuevo en la web',
                      'pairing' => true)
            when :unauthenticated
              failure('unauthenticated', 'iniciá sesión con tu cuenta del taller para conectar el código',
                      'pairing' => true)
            when :unauthorized
              failure('unauthorized', 'no tenés permiso para conectar este diseño', 'pairing' => true)
            when :unreachable
              failure('unreachable',
                      'no se pudo confirmar el estado del código; volvé a intentarlo y, si falla, ' \
                      'generá uno nuevo en la web',
                      'pairing' => true)
            else
              failure('exchange_failed', error.message, 'pairing' => true)
            end
          end

          def pairing_exchange_failure(_exchange)
            failure('design_archived', 'el diseño fue archivado en Granete',
                    'state' => 'design_archived', 'pairing' => true)
          end

          def failure(code, reason, extra = {})
            { 'ok' => false, 'code' => code, 'reason' => reason }.merge(extra)
          end
        end
      end
    end
  end
end
