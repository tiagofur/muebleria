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
                                   :parameters, :material_choices, :transform, :technical_client_locator,
                                   keyword_init: true)
          WorkingCopy = Struct.new(:design_id, :project_id, :base_revision_id, :items, keyword_init: true)
          Instance = Struct.new(:id, :project_id, :furniture_definition_id, :origin, :lifecycle_status,
                                :display_name, :display_dimensions, keyword_init: true)

          # Canonical wire shape of one working item (generated contract):
          # string keys, absent-when-null optional fields.
          class WorkingItem
            def to_contract_h
              item = {
                'furniture_instance_id' => furniture_instance_id,
                'parameters' => parameters || {},
                'material_choices' => material_choices || {}
              }
              item['furniture_definition_id'] = furniture_definition_id if furniture_definition_id
              item['definition_version'] = definition_version if definition_version
              item['transform'] = transform if transform
              item['technical_client_locator'] = technical_client_locator if technical_client_locator
              item
            end
          end

          def self.assert_instance_field!(entry, field)
            return if yield(entry[field])

            raise ContractError, "campo #{field} inválido: #{entry[field].inspect}"
          end

          def self.parse_display!(display)
            return [nil, nil] if display.nil?
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
            [name, dims]
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
            raise ContractError, 'project_id faltante' unless entry['project_id'].is_a?(String)

            definition_id = entry['furniture_definition_id']
            unless definition_id.nil? || (definition_id.is_a?(String) && !definition_id.strip.empty?)
              raise ContractError, 'furniture_definition_id inválido'
            end

            name, dims = parse_display!(entry['display'])

            Instance.new(
              id: entry['id'], project_id: entry['project_id'],
              furniture_definition_id: definition_id, origin: entry['origin'],
              lifecycle_status: entry['lifecycle_status'],
              display_name: name, display_dimensions: dims
            )
          end

          # Working-copy (GET/PUT) parsing: same fail-closed rules, split
          # from the instance parser so each contract stays focused.
          module WorkingCopyContract
            def self.parse_working_copy!(body)
              raise ContractError, 'el working copy debe ser un objeto' unless body.is_a?(Hash)
              unless ProjectFurniture.uuid?(body['design_id']) && ProjectFurniture.uuid?(body['project_id'])
                raise ContractError, 'working copy sin design_id/project_id válidos'
              end
              raise ContractError, 'items del working copy inválidos' unless body['items'].is_a?(Array)

              base = body['base_revision_id']
              base = nil if base.to_s.strip.empty?
              raise ContractError, 'base_revision_id inválido' unless base.nil? || ProjectFurniture.uuid?(base)

              WorkingCopy.new(
                design_id: body['design_id'], project_id: body['project_id'],
                base_revision_id: base,
                items: body['items'].map { |entry| parse_working_item!(entry) }
              )
            end

            def self.parse_working_item!(entry)
              raise ContractError, 'item de trabajo inválido' unless entry.is_a?(Hash)
              unless ProjectFurniture.uuid?(entry['furniture_instance_id'])
                raise ContractError,
                      "item con furniture_instance_id inválido: #{entry['furniture_instance_id'].inspect}"
              end

              parameters = entry['parameters']
              parameters = {} unless parameters.is_a?(Hash)
              choices = entry['material_choices']
              choices = {} unless choices.is_a?(Hash) && choices.values.all?(String)

              transform = parse_transform!(entry['transform'])
              locator = parse_locator!(entry['technical_client_locator'])

              definition_id = entry['furniture_definition_id']
              definition_id = nil unless definition_id.is_a?(String) && !definition_id.strip.empty?
              version = entry['definition_version']
              version = nil unless version.is_a?(Integer)

              WorkingItem.new(
                furniture_instance_id: entry['furniture_instance_id'],
                furniture_definition_id: definition_id, definition_version: version,
                parameters: parameters, material_choices: choices,
                transform: transform, technical_client_locator: locator
              )
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
      end
    end
  end
end
