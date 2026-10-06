# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      module ProjectFurniture
        # Fail-closed parsers for the generated backend DTOs. Unknown shapes
        # raise instead of guessing — the Ruby mirror of the Go handlers, with
        # no parallel hand-rolled contract.
        module Contract
          class ContractError < StandardError; end

          WorkingItem = Struct.new(:furniture_instance_id, :furniture_definition_id, :definition_version,
                                   :parameters, :material_choices, :material_choice_modes,
                                   :transform, :technical_client_locator, :room_id,
                                   keyword_init: true)
          # updated_at is kept as the VERBATIM server string: it is the
          # canonical workingVersion token every write must echo back as
          # expected_working_version (#810).
          # authoring_defaults is the durable Design-scoped defaults block
          # (#784): {role => material id}, canonical empty map when absent.
          WorkingCopy = Struct.new(:design_id, :project_id, :base_revision_id, :items, :updated_at,
                                   :authoring_defaults,
                                   keyword_init: true)
          Instance = Struct.new(:id, :project_id, :furniture_definition_id, :origin, :lifecycle_status,
                                # #1177: optimistic-concurrency token of the unit —
                                # the If-Match version the terminal :remove command
                                # must echo back.
                                :version,
                                :display_name, :display_dimensions, :display_material_choices,
                                # #977 recovery seed captured when the design
                                # working copy dropped this unit's item —
                                # re-placement overlays it when the live item
                                # is gone (nil when nothing was captured).
                                :authoring_parameters, :authoring_material_choices,
                                :authoring_material_choice_modes,
                                keyword_init: true)
          # #784 R3: one role's server-side inheritance projection — the ONLY
          # badge authority (mode is persisted lineage, never derived from
          # value equality client-side).
          RoleInheritance = Struct.new(:role, :mode, :applied_material_id, :design_default_material_id,
                                       :needs_rollout, keyword_init: true)
          RoleInheritanceCount = Struct.new(:role, :items, :design_backed, :definition_backed, :needs_rollout,
                                            :design_current, :overridden, keyword_init: true)
          InheritanceItem = Struct.new(:furniture_instance_id, :inheritance, :furniture_definition_id,
                                       keyword_init: true)
          DesignInheritance = Struct.new(:design_id, :project_id, :items, :inheritance_summary, keyword_init: true)

          # #784 R4: server-resolved definition-aware effective materials and modes
          EffectiveMaterials = Struct.new(:furniture_definition_id, :material_choices, :material_choice_modes,
                                          keyword_init: true)

          # Canonical wire shape of one working item (generated contract):
          # string keys, absent-when-null optional fields.
          class WorkingItem
            def to_contract_h
              item = {
                'furniture_instance_id' => furniture_instance_id,
                'parameters' => parameters || {},
                'material_choices' => material_choices || {}
              }
              modes = contract_material_choice_modes
              item['material_choice_modes'] = modes if modes
              item['furniture_definition_id'] = furniture_definition_id if furniture_definition_id
              version = Contract.authoritative_definition_version(definition_version)
              item['definition_version'] = version unless version.nil?
              item['transform'] = transform if transform
              item['technical_client_locator'] = technical_client_locator if technical_client_locator
              item['room_id'] = room_id if room_id
              item
            end

            private

            # #784 R3: explicit lineage travels ONLY as a full-parity
            # statement (keys == material_choices keys) — the backend
            # rejects partial statements. Absent keeps the legacy shape
            # (the backend preserves the persisted lineage of unchanged
            # values).
            def contract_material_choice_modes
              return nil unless material_choice_modes.is_a?(Hash) && !material_choice_modes.empty?

              choices = material_choices || {}
              return nil if choices.empty?

              choices.each_key.with_object({}) do |role, modes|
                mode = material_choice_modes[role]
                modes[role] = Contract::WorkingCopyContract::MODES.include?(mode) ? mode : 'override'
              end
            end
          end

          def self.authoritative_definition_version(*values)
            values.find { |value| value.is_a?(Integer) }
          end

          def self.assert_instance_field!(entry, field)
            return if yield(entry[field])

            raise ContractError, "campo #{field} inválido: #{entry[field].inspect}"
          end

          # Presentation block parsers. Returns [name, dimensions_mm,
          # material_choices] — the quoted finish (role -> material id) is
          # presentation-only identity-free data the server derives from the
          # current quote line (#620).
          def self.parse_display!(display)
            return [nil, nil, nil] if display.nil?
            raise ContractError, 'display inválido' unless display.is_a?(Hash)

            name = display['name'] if display['name'].is_a?(String) && !display['name'].strip.empty?
            raw_dims = display['dimensions_mm']
            dims = nil
            if raw_dims.is_a?(Hash)
              dims = %w[width height depth].map do |axis|
                value = raw_dims[axis]
                value.is_a?(Numeric) ? value.to_i : nil
              end
              dims = nil if dims.compact.empty?
            end
            [name, dims, parse_material_choices!(display['material_choices'])]
          end

          def self.parse_material_choices!(raw)
            return nil if raw.nil?
            raise ContractError, 'material_choices inválidos' unless raw.is_a?(Hash) && raw.values.all?(String)

            raw.empty? ? nil : raw
          end

          def self.parse_instances!(body)
            raise ContractError, 'la lista de muebles del proyecto debe ser un arreglo' unless body.is_a?(Array)

            body.map { |entry| parse_instance!(entry) }
          end

          def self.parse_instance!(entry)
            raise ContractError, 'entrada de mueble inválida' unless entry.is_a?(Hash)

            assert_instance_field!(entry, 'id') { |v| ProjectFurniture.uuid?(v) }
            assert_instance_field!(entry, 'lifecycle_status') { |v| LIFECYCLE_STATUSES.include?(v) }
            assert_instance_field!(entry, 'origin') { |v| ORIGINS.include?(v) }
            assert_instance_field!(entry, 'version') { |v| v.is_a?(Integer) && v >= 1 }
            raise ContractError, 'project_id faltante' unless entry['project_id'].is_a?(String)

            definition_id = entry['furniture_definition_id']
            unless definition_id.nil? || (definition_id.is_a?(String) && !definition_id.strip.empty?)
              raise ContractError, 'furniture_definition_id inválido'
            end

            name, dims, choices = parse_display!(entry['display'])
            authoring = parse_authoring_snapshot!(entry['authoring_snapshot'])

            Instance.new(
              id: entry['id'], project_id: entry['project_id'],
              furniture_definition_id: definition_id, origin: entry['origin'],
              lifecycle_status: entry['lifecycle_status'], version: entry['version'],
              display_name: name, display_dimensions: dims,
              display_material_choices: choices,
              authoring_parameters: authoring[0],
              authoring_material_choices: authoring[1],
              authoring_material_choice_modes: authoring[2]
            )
          end

          # #977: fail-closed parse of the instance's authoring snapshot.
          # Absent/nil keeps every recovery field nil; a present-but-invalid
          # block raises — recovery never guesses from a malformed capture.
          def self.parse_authoring_snapshot!(snapshot)
            return [nil, nil, nil] if snapshot.nil?

            raise ContractError, 'authoring_snapshot inválido' unless snapshot.is_a?(Hash)

            parameters = snapshot['parameters']
            unless parameters.nil? || parameters.is_a?(Hash)
              raise ContractError, 'authoring_snapshot parameters inválidos'
            end

            choices = snapshot['material_choices']
            unless choices.nil? || (choices.is_a?(Hash) && choices.values.all?(String))
              raise ContractError, 'authoring_snapshot material_choices inválidos'
            end

            modes = snapshot['material_choice_modes']
            unless modes.nil? || (modes.is_a?(Hash) && modes.values.all? { |m| WorkingCopyContract::MODES.include?(m) })
              raise ContractError, 'authoring_snapshot material_choice_modes inválidos'
            end

            [parameters, choices, modes]
          end

          # Working-copy (GET/PUT) parsing: same fail-closed rules, split
          # from the instance parser so each contract stays focused.
          module WorkingCopyContract
            # #784 canonical lineage modes (server contract): design lineage,
            # explicit furniture exception, curated definition fallback.
            MODES = %w[design override definition].freeze
            def self.parse_working_copy!(body)
              raise ContractError, 'el working copy debe ser un objeto' unless body.is_a?(Hash)
              unless ProjectFurniture.uuid?(body['design_id']) && ProjectFurniture.uuid?(body['project_id'])
                raise ContractError, 'working copy sin design_id/project_id válidos'
              end
              raise ContractError, 'items del working copy inválidos' unless body['items'].is_a?(Array)

              base = body['base_revision_id']
              base = nil if base.to_s.strip.empty?
              raise ContractError, 'base_revision_id inválido' unless base.nil? || ProjectFurniture.uuid?(base)

              updated_at = body['updated_at']
              unless updated_at.is_a?(String) && !updated_at.strip.empty?
                raise ContractError, 'working copy sin updated_at (token workingVersion) válido'
              end

              WorkingCopy.new(
                design_id: body['design_id'], project_id: body['project_id'],
                base_revision_id: base, updated_at: updated_at,
                authoring_defaults: parse_authoring_defaults!(body['authoring_defaults']),
                items: body['items'].map { |entry| parse_working_item!(entry) }
              )
            end

            # #784 durable Design authoring defaults. Only the known wrapper
            # is accepted (materialChoices; hardware/parameters stay out
            # until a real capability contract exists) — unknown top-level
            # keys reject instead of guessing. Absence is the canonical
            # empty map; Ruby never recalculates or completes defaults.
            def self.parse_authoring_defaults!(raw)
              return {} if raw.nil?

              raise ContractError, 'authoring_defaults inválidos' unless raw.is_a?(Hash)
              unless (raw.keys - ['materialChoices']).empty?
                raise ContractError,
                      "authoring_defaults con claves desconocidas: #{(raw.keys - ['materialChoices']).inspect}"
              end

              choices = raw['materialChoices']
              return {} if choices.nil?
              unless choices.is_a?(Hash) &&
                     choices.keys.all? { |role| role.is_a?(String) && !role.strip.empty? } &&
                     choices.values.all?(String)
                raise ContractError, 'materialChoices de authoring_defaults inválidos'
              end

              choices
            end

            def self.parse_working_item!(entry)
              raise ContractError, 'item de trabajo inválido' unless entry.is_a?(Hash)
              unless ProjectFurniture.uuid?(entry['furniture_instance_id'])
                raise ContractError,
                      "item con furniture_instance_id inválido: #{entry['furniture_instance_id'].inspect}"
              end

              shape = normalize_working_item_shape!(entry)

              WorkingItem.new(
                furniture_instance_id: entry['furniture_instance_id'],
                furniture_definition_id: shape[:definition_id], definition_version: shape[:version],
                parameters: shape[:parameters], material_choices: shape[:choices],
                material_choice_modes: shape[:modes],
                transform: shape[:transform], technical_client_locator: shape[:locator],
                room_id: shape[:room_id]
              )
            end

            def self.normalize_working_item_shape!(entry)
              parameters = entry['parameters']
              parameters = {} unless parameters.is_a?(Hash)
              choices = entry['material_choices']
              choices = {} unless choices.is_a?(Hash) && choices.values.all?(String)
              modes = parse_modes!(entry['material_choice_modes'])

              transform = parse_transform!(entry['transform'])
              locator = parse_locator!(entry['technical_client_locator'])

              definition_id = entry['furniture_definition_id']
              definition_id = nil unless definition_id.is_a?(String) && !definition_id.strip.empty?
              version = Contract.authoritative_definition_version(entry['definition_version'])
              room_id = entry['room_id']
              room_id = nil unless room_id.is_a?(String) && !room_id.strip.empty?

              {
                parameters: parameters, choices: choices, modes: modes,
                transform: transform, locator: locator,
                definition_id: definition_id, version: version, room_id: room_id
              }
            end

            def self.parse_modes!(raw)
              return nil if raw.nil?
              raise Contract::ContractError, 'material_choice_modes inválidos' unless raw.is_a?(Hash)
              unless raw.values.all? { |m| MODES.include?(m) }
                raise Contract::ContractError,
                      "material_choice_modes con modos desconocidos: #{raw.values.inspect}"
              end

              raw
            end

            def self.parse_transform!(raw)
              return nil unless raw.is_a?(Hash)

              {
                'translation_mm' => numeric_triple(raw['translation_mm']),
                'rotation_deg' => numeric_triple(raw['rotation_deg'])
              }
            end

            def self.parse_locator!(raw)
              return nil unless raw.is_a?(Hash)

              { 'kind' => raw['kind'].to_s, 'value' => raw['value'].to_s }
            end

            def self.numeric_triple(value)
              return nil unless value.is_a?(Array) && value.length == 3 && value.all?(Numeric)

              value.map(&:to_f)
            end
          end
        end

        # #784 R3: the material-provenance projection the plugin renders
        # badges from. Fail-closed: known shapes only, mode enum enforced,
        # role keys non-empty.
        module DesignInheritanceContract
          MODES = Contract::WorkingCopyContract::MODES
          SUMMARY_FIELDS = %w[items design_backed definition_backed needs_rollout design_current overridden].freeze

          def self.parse!(body)
            raise Contract::ContractError, 'la proyección de herencia debe ser un objeto' unless body.is_a?(Hash)
            unless ProjectFurniture.uuid?(body['design_id']) && ProjectFurniture.uuid?(body['project_id'])
              raise Contract::ContractError, 'proyección sin design_id/project_id válidos'
            end
            raise Contract::ContractError, 'items de herencia inválidos' unless body['items'].is_a?(Array)

            Contract::DesignInheritance.new(
              design_id: body['design_id'], project_id: body['project_id'],
              items: body['items'].map { |entry| parse_item!(entry) },
              inheritance_summary: parse_summary(body['inheritance_summary'])
            )
          end

          def self.parse_summary(summary)
            return [] if summary.nil?
            raise Contract::ContractError, 'inheritance_summary debe ser un array' unless summary.is_a?(Array)

            summary.map { |entry| parse_summary_entry!(entry) }
          end

          def self.parse_summary_entry!(entry)
            raise Contract::ContractError, 'entrada de inheritance_summary inválida' unless entry.is_a?(Hash)

            role = entry['role']
            unless role.is_a?(String) && !role.strip.empty?
              raise Contract::ContractError, 'rol de inheritance_summary vacío'
            end

            validate_summary_fields!(entry, role)
            Contract::RoleInheritanceCount.new(
              role: role, items: entry['items'], design_backed: entry['design_backed'],
              definition_backed: entry['definition_backed'],
              needs_rollout: entry['needs_rollout'], design_current: entry['design_current'],
              overridden: entry['overridden']
            )
          end

          def self.validate_summary_fields!(entry, role)
            SUMMARY_FIELDS.each do |field|
              val = entry[field]
              unless val.is_a?(Integer) && val >= 0
                raise Contract::ContractError, "#{field} inválido en inheritance_summary para #{role}"
              end
            end
          end

          def self.parse_item!(entry)
            raise Contract::ContractError, 'item de herencia inválido' unless entry.is_a?(Hash)
            unless ProjectFurniture.uuid?(entry['furniture_instance_id'])
              raise Contract::ContractError,
                    "item de herencia con furniture_instance_id inválido: #{entry['furniture_instance_id'].inspect}"
            end
            raise Contract::ContractError, 'inheritance del item inválido' unless entry['inheritance'].is_a?(Array)

            # Final review hardening: a PRESENT material_choice_modes must be
            # a valid object of known modes — never silently dropped.
            if entry.key?('material_choice_modes')
              Contract::WorkingCopyContract.parse_modes!(entry['material_choice_modes'])
            end

            definition_id = entry['furniture_definition_id']
            if definition_id && (!definition_id.is_a?(String) || definition_id.strip.empty?)
              raise Contract::ContractError, 'furniture_definition_id inválido en item'
            end

            Contract::InheritanceItem.new(
              furniture_instance_id: entry['furniture_instance_id'],
              furniture_definition_id: definition_id,
              inheritance: entry['inheritance'].map { |role_entry| parse_role!(role_entry) }
            )
          end

          def self.parse_role!(entry)
            raise Contract::ContractError, 'entrada de rol inválida' unless entry.is_a?(Hash)

            role = entry['role']
            raise Contract::ContractError, 'rol de herencia vacío' unless role.is_a?(String) && !role.strip.empty?
            unless MODES.include?(entry['mode'])
              raise Contract::ContractError, "modo de herencia desconocido: #{entry['mode'].inspect}"
            end
            unless entry['applied_material_id'].is_a?(String) && !entry['applied_material_id'].empty?
              raise Contract::ContractError, "applied_material_id inválido para #{role}"
            end

            default_id = entry['design_default_material_id']
            if default_id && !default_id.is_a?(String)
              raise Contract::ContractError, "design_default_material_id inválido para #{role}"
            end
            unless entry['needs_rollout'].is_a?(TrueClass) || entry['needs_rollout'].is_a?(FalseClass)
              raise Contract::ContractError, "needs_rollout inválido para #{role}"
            end

            Contract::RoleInheritance.new(
              role: role, mode: entry['mode'],
              applied_material_id: entry['applied_material_id'],
              design_default_material_id: default_id,
              needs_rollout: entry['needs_rollout'] == true
            )
          end
        end

        # #784 R4: Fail-closed parser for POST /api/designs/:design_id/effective-materials
        # response (definition-aware composition of materials & lineage modes).
        module EffectiveMaterialsContract
          MODES = Contract::WorkingCopyContract::MODES

          def self.parse!(body)
            unless body.is_a?(Hash)
              raise Contract::ContractError, 'la respuesta de materiales efectivos debe ser un objeto'
            end

            def_id = body['furnitureDefinitionId'] || body['furniture_definition_id']
            if !def_id.is_a?(String) || def_id.strip.empty?
              raise Contract::ContractError, 'furniture_definition_id inválido en materiales efectivos'
            end

            choices, modes = parse_choices_and_modes!(body)

            Contract::EffectiveMaterials.new(
              furniture_definition_id: def_id,
              material_choices: choices,
              material_choice_modes: modes
            )
          end

          def self.parse_choices_and_modes!(body)
            choices = body['materialChoices'] || body['material_choices']
            unless choices.is_a?(Hash)
              raise Contract::ContractError, 'materialChoices inválidos en materiales efectivos'
            end

            modes = body['materialChoiceModes'] || body['material_choice_modes']
            unless modes.is_a?(Hash)
              raise Contract::ContractError, 'materialChoiceModes inválidos en materiales efectivos'
            end

            validate_parity!(choices, modes)
            validate_choices!(choices)
            validate_modes!(modes)
            [choices, modes]
          end

          def self.validate_parity!(choices, modes)
            return if (choices.keys - modes.keys).empty? && (modes.keys - choices.keys).empty?

            raise Contract::ContractError, 'paridad incompleta entre materialChoices y materialChoiceModes'
          end

          def self.validate_choices!(choices)
            choices.each do |role, mat_id|
              raise Contract::ContractError, 'rol vacío en materialChoices' if !role.is_a?(String) || role.strip.empty?
              if !mat_id.is_a?(String) || mat_id.strip.empty?
                raise Contract::ContractError,
                      "material_id inválido para rol #{role}"
              end
            end
          end

          def self.validate_modes!(modes)
            modes.each do |role, mode|
              unless MODES.include?(mode)
                raise Contract::ContractError, "modo desconocido #{mode.inspect} para rol #{role}"
              end
            end
          end
        end

        # Merge rule (#389 §14 + review fix, extended by #810): the PUT
        # carries the COMPLETE desired state. An EXISTING working item keeps
        # every authoritative authoring field (definition, version,
        # parameters, materials, room) verbatim — SketchUp updates ONLY the
        # placement-owned transform and technical locator — UNLESS the entity
        # carries the persisted authoring-dirty flag (#810 rule C): a local,
        # server-resolved edit the backend has not confirmed yet. Then the
        # item's parameters/material choices/definition come from the
        # persisted placement intent (what was rendered), still preserving
        # every field SketchUp does not author (room). A first-time item is
        # always built from the placement intent metadata.
        module WorkingCopyMerger
          module_function

          def merge(working, furniture_instance_id, entity, intent: {}, locator: nil, authoring_dirty: false)
            existing = working.items.find { |item| item.furniture_instance_id == furniture_instance_id }
            if existing
              updated = existing.dup
              updated.transform = TransformContract.from_host(entity.transformation)
              updated.technical_client_locator = locator
              apply_authoring_intent!(updated, intent) if authoring_dirty
              return working.items.map do |item|
                item.furniture_instance_id == furniture_instance_id ? updated : item
              end
            end

            working.items + [new_working_item(furniture_instance_id, entity, intent, locator)]
          end

          # #810 rule A: authoring fields of an existing item are replaced
          # ONLY from the entity's persisted intent, and only while the
          # authoring-dirty flag is set (a local edit awaiting confirmed
          # sync). Absent intent keys keep the server value verbatim.
          # #810 rule A + R2: authoring fields of an existing item are
          # replaced ONLY from the entity's persisted intent, and only while
          # the authoring-dirty flag is set. PRESENCE of the key defines the
          # authoring statement — never emptiness:
          #   key absent          → preserve the server value verbatim;
          #   key present with {} → explicit clear (replace with {});
          #   key present, values → replace with those values.
          def apply_authoring_intent!(item, intent)
            return item unless intent.is_a?(Hash)

            item.parameters = intent['parameters'] if intent.key?('parameters') && intent['parameters'].is_a?(Hash)
            choices = intent['materialChoices']
            item.material_choices = choices if intent.key?('materialChoices') && choices.is_a?(Hash)
            # #784 R3: explicit lineage markers (role → design|override).
            # Present only when authoring declared them (e.g. a role
            # restore); everything else stays server-owned.
            modes = intent['materialChoiceModes']
            if modes.is_a?(Hash) && !modes.empty?
              item.material_choice_modes = (item.material_choice_modes || {}).merge(modes)
            end
            definition_id = intent['furnitureDefinitionId']
            item.furniture_definition_id = definition_id if definition_id.is_a?(String) && !definition_id.strip.empty?
            version = Contract.authoritative_definition_version(
              intent['definitionVersion'], intent['definition_version']
            )
            item.definition_version = version unless version.nil?
            item
          end

          def new_working_item(furniture_instance_id, entity, intent, locator)
            parameters = intent['parameters'].is_a?(Hash) ? intent['parameters'] : {}
            choices = intent['materialChoices'].is_a?(Hash) ? intent['materialChoices'] : {}
            version = Contract.authoritative_definition_version(
              intent['definitionVersion'], intent['definition_version']
            )
            Contract::WorkingItem.new(
              furniture_instance_id: furniture_instance_id,
              furniture_definition_id: intent['furnitureDefinitionId'],
              definition_version: version,
              parameters: parameters, material_choices: choices,
              material_choice_modes: build_material_choice_modes(choices, intent),
              transform: TransformContract.from_host(entity.transformation),
              technical_client_locator: locator
            )
          end

          # #784 R3: lineage for a NEW item. Without an explicit intent
          # declaration the item keeps the legacy absent shape (the backend
          # preserves the persisted lineage of unchanged values). With at
          # least one declaration the FULL parity statement is emitted:
          # declared roles carry their mode, the rest are explicit overrides
          # — a new item never inherits by equality.
          def build_material_choice_modes(choices, intent)
            declared = intent['materialChoiceModes'].is_a?(Hash) ? intent['materialChoiceModes'] : {}
            return nil if declared.empty?

            modes = {}
            choices.each_key do |role|
              mode = declared[role]
              modes[role] = Contract::WorkingCopyContract::MODES.include?(mode) ? mode : 'override'
            end
            modes
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

          # #977: with no live working item the authoring snapshot's
          # parameters are the unit's truth — the display's module-default
          # dims would reset a 450mm unit to the catalog 600. Absent
          # snapshot keeps the historical placement_parameters seed.
          def recovery_placement_parameters(instance, definition)
            snapshot = instance.authoring_parameters
            return snapshot.dup if snapshot.is_a?(Hash) && !snapshot.empty?

            placement_parameters(instance, definition)
          end

          def catalog_parameters(definition, selected_parameters = {})
            parameters = {}
            (definition['parameters'] || []).each do |parameter|
              parameters[parameter['name']] = parameter['defaultValue'] if parameter.key?('defaultValue')
            end
            if selected_parameters.is_a?(Hash)
              selected_parameters.each do |k, v|
                parameters[k.to_s] = v unless v.nil?
              end
            end
            parameters
          end

          def resolve_layout(catalog_provider, definition, parameters, material_choices = {})
            return nil unless catalog_provider.respond_to?(:resolved_native_layout)

            catalog_provider.resolved_native_layout(
              definition['furniture_definition_id'], parameters, material_choices || {}
            )
          rescue Library::LayoutResolutionError => e
            raise PlacementResolutionError,
                  "Granete no pudo resolver la composición de este mueble (#{e.message})"
          end
        end
      end
    end
  end
end
