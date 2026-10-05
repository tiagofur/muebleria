# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Library
      module CatalogParameterContract # rubocop:disable Metrics/ModuleLength
        ERROR_CODE = 'PARAMETER_DEFINITION_INVALID'
        MAX_CATALOG_BYTES = 5 * 1024 * 1024
        MAX_DEFINITIONS = 1000
        MAX_PARAMETERS = 64
        MAX_OPTIONS = 64
        MAX_NAME_LENGTH = 64
        MAX_LABEL_LENGTH = 160
        MAX_OPTION_LENGTH = 128
        MAX_STRING_LENGTH = 512
        HASH_PATTERN = /\Asha256-[0-9a-f]{64}\z/
        TYPES = %w[number string boolean enum].freeze
        UNITS = %w[mm deg count].freeze
        CATEGORIES = %w[dimension configuration style hardware metadata].freeze
        RESERVED_DIMENSIONS = %w[widthMm heightMm depthMm].freeze
        BINDING_KINDS = %w[componentQuantity componentCondition dimensionColumn structureRelationship].freeze
        DEFINITION_KEYS = %w[
          furnitureDefinitionId code name category categoryId version schemaRevision definitionHash description
          imageUrl thumbnailUrl previewUrl parameters estimatedPartCount estimatedHardwareCount materialRoles
        ].freeze
        PARAMETER_KEYS = %w[
          name label sortOrder type defaultValue required unit category min max step
          options optionLabels integer maxLength binding
        ].freeze
        BINDING_KEYS = %w[version kind componentId dimension relationship].freeze
        RELATIONSHIP_KEYS = %w[kind sourceRole sourceFace targets station families recipes].freeze
        TARGET_KEYS = %w[componentId role face].freeze
        STATION_KEYS = %w[startMarginMm endMarginMm maxSpacingMm].freeze
        FAMILY_KEYS = %w[familyId count startMarginMm endMarginMm].freeze
        # Closed face vocabulary for construction-declared relationship anchors,
        # mirroring Go's FurnitureRelationshipAnchorFaces.
        ANCHOR_FACES = %w[top bottom left right front back].freeze
        # Kinds that resolve contacts through declared anchor faces; targets
        # must declare one, or the contact can never verify (Go #874 J1-B/J2-B).
        FACE_VERIFIED_RELATIONSHIP_KINDS = %w[floor-side fixed-shelf-side back-panel].freeze

        class ContractError < StandardError
          attr_reader :code, :path

          def initialize(path, message)
            super("#{ERROR_CODE} at #{path}: #{message}")
            @code = ERROR_CODE
            @path = path
          end
        end

        module_function

        def validate_catalog!(body)
          fail_at('$', 'catalog must be an object') unless body.is_a?(Hash)
          fail_at('$', 'catalog exceeds the maximum encoded size') if JSON.generate(body).bytesize > MAX_CATALOG_BYTES

          definitions = body['definitions']
          fail_at('definitions', 'must be an object') unless definitions.is_a?(Hash)
          fail_at('definitions', "must not exceed #{MAX_DEFINITIONS} entries") if definitions.length > MAX_DEFINITIONS

          definitions.each do |key, definition|
            validate_definition!(definition, "definitions.#{key}", expected_id: key)
          end
          body
        rescue JSON::GeneratorError
          fail_at('$', 'catalog must contain JSON-compatible values')
        end

        def validate_definition!(definition, path, expected_id: nil)
          fail_at(path, 'must be an object') unless definition.is_a?(Hash)
          validate_closed_shape!(definition, DEFINITION_KEYS, path)
          definition_id = definition['furnitureDefinitionId']
          validate_text!(definition_id, "#{path}.furnitureDefinitionId", max: 256)
          if expected_id && definition_id != expected_id
            fail_at("#{path}.furnitureDefinitionId",
                    'must match the definitions map key')
          end
          fail_at("#{path}.schemaRevision", 'must equal 1') unless definition['schemaRevision'] == 1
          unless HASH_PATTERN.match?(definition['definitionHash'].to_s)
            fail_at("#{path}.definitionHash",
                    'must be a sha256 content hash')
          end

          parameters = definition['parameters']
          validate_parameter_definitions!(parameters, path: "#{path}.parameters")
          definition
        end

        def parse_parameter_definitions!(raw_json)
          validate_parameter_definitions!(JSON.parse(raw_json))
        rescue JSON::ParserError
          fail_at('definitions', 'must be valid JSON')
        end

        def validate_parameter_definitions!(parameters, path: 'definitions')
          fail_at(path, 'must be an array') unless parameters.is_a?(Array)
          fail_at(path, "must not exceed #{MAX_PARAMETERS} entries") if parameters.length > MAX_PARAMETERS
          seen = {}
          parameters.each_with_index do |parameter, index|
            parameter_path = "#{path}[#{index}]"
            validate_parameter!(parameter, parameter_path)
            name = parameter['name']
            fail_at("#{parameter_path}.name", 'must be unique') if seen[name]

            seen[name] = true
          end
          parameters
        end

        def validate_parameter!(parameter, path) # rubocop:disable Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/PerceivedComplexity
          fail_at(path, 'must be an object') unless parameter.is_a?(Hash)
          validate_closed_shape!(parameter, PARAMETER_KEYS, path)
          name = parameter['name']
          validate_text!(name, "#{path}.name", max: MAX_NAME_LENGTH)
          fail_at("#{path}.name", 'must not contain surrounding whitespace') unless name == name.strip
          validate_text!(parameter['label'], "#{path}.label", max: MAX_LABEL_LENGTH)

          type = parameter['type']
          fail_at("#{path}.type", 'must be number, string, boolean, or enum') unless TYPES.include?(type)
          category = parameter['category']
          fail_at("#{path}.category", 'is invalid') unless CATEGORIES.include?(category)
          sort_order = parameter['sortOrder']
          if !sort_order.nil? && (!sort_order.is_a?(Integer) || sort_order.negative?)
            fail_at("#{path}.sortOrder", 'must be a non-negative integer')
          end
          unit = parameter['unit']
          fail_at("#{path}.unit", 'is invalid') if !unit.nil? && !UNITS.include?(unit)
          if parameter.key?('required') && ![true, false].include?(parameter['required'])
            fail_at("#{path}.required", 'must be a boolean')
          end
          if parameter.key?('integer') && ![true, false].include?(parameter['integer'])
            fail_at("#{path}.integer", 'must be a boolean')
          end

          validate_type_rules!(parameter, path)
          validate_binding!(parameter, path)
          validate_reserved_dimension!(parameter, path) if RESERVED_DIMENSIONS.include?(name)
          if parameter.key?('defaultValue')
            validate_value!(parameter, parameter['defaultValue'],
                            "#{path}.defaultValue")
          end
          parameter
        end

        # Dense by design: this is the single fail-closed type/rule boundary.
        def validate_type_rules!(parameter, path) # rubocop:disable Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/MethodLength, Metrics/PerceivedComplexity
          type = parameter['type']
          numeric_keys = %w[min max step]
          if type == 'number'
            numeric_keys.each do |key|
              next unless parameter.key?(key)

              validate_finite_number!(parameter[key], "#{path}.#{key}")
            end
            fail_at("#{path}.min|max", 'min must not exceed max') if parameter.key?('min') && parameter.key?('max') &&
                                                                     parameter['min'] > parameter['max']
            fail_at("#{path}.step", 'must be greater than zero') if parameter.key?('step') && parameter['step'] <= 0
            if parameter['unit'] == 'count' && parameter['integer'] != true
              fail_at("#{path}.integer",
                      'count parameters must be integer')
            end
          else
            if numeric_keys.any? { |key| parameter.key?(key) }
              fail_at("#{path}.min|max|step", 'numeric constraints require type number')
            end
            fail_at("#{path}.integer", 'integer requires type number') if parameter['integer'] == true
            fail_at("#{path}.unit", 'unit requires type number') if parameter.key?('unit')
          end

          if type == 'string'
            max_length = parameter['maxLength']
            unless max_length.is_a?(Integer) && max_length.between?(1, MAX_STRING_LENGTH)
              fail_at("#{path}.maxLength", "must be an integer between 1 and #{MAX_STRING_LENGTH}")
            end
          elsif parameter.key?('maxLength')
            fail_at("#{path}.maxLength", 'requires type string')
          end

          options = parameter['options']
          if type == 'enum'
            unless options.is_a?(Array) && !options.empty?
              fail_at("#{path}.options",
                      'enum requires a non-empty options array')
            end
            fail_at("#{path}.options", "must not exceed #{MAX_OPTIONS} entries") if options.length > MAX_OPTIONS
            options.each_with_index do |option, index|
              validate_text!(option, "#{path}.options[#{index}]", max: MAX_OPTION_LENGTH)
            end
            fail_at("#{path}.options", 'enum options must be unique') unless options.uniq.length == options.length
          elsif !options.nil? && options != []
            fail_at("#{path}.options", 'options require type enum')
          end

          # #529 optionLabels (display copy for enum options): pure
          # presentation — a closed string map, mirroring the TS/Go
          # validators (parity; a missing key here failed the WHOLE catalog
          # fail-closed on the plugin side).
          return unless parameter.key?('optionLabels')

          labels = parameter['optionLabels']
          valid = labels.is_a?(Hash) && labels.keys.all?(String) && labels.values.all?(String)
          fail_at("#{path}.optionLabels", 'must be a string map') unless valid
        end

        def validate_reserved_dimension!(parameter, path)
          valid = parameter['type'] == 'number' && parameter['unit'] == 'mm' &&
                  parameter['category'] == 'dimension' && parameter['integer'] == true &&
                  parameter['required'] == true && parameter.key?('defaultValue') &&
                  parameter.dig('binding', 'kind') == 'dimensionColumn' &&
                  parameter.dig('binding', 'dimension') == parameter['name']
          fail_at(path, 'reserved dimensions must be required integer mm number dimensions with a default') unless valid
        end

        # Binding variants are validated together so no new kind can bypass authority checks.
        def validate_binding!(parameter, path) # rubocop:disable Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/MethodLength, Metrics/PerceivedComplexity
          binding = parameter['binding']
          if parameter['category'] == 'metadata'
            unless binding.nil?
              fail_at("#{path}.binding",
                      'metadata parameters must not declare an authoritative consumer')
            end
            return
          end

          unless binding.is_a?(Hash)
            fail_at("#{path}.binding",
                    'non-metadata parameters require an authoritative consumer')
          end
          validate_closed_shape!(binding, BINDING_KEYS, "#{path}.binding")
          fail_at("#{path}.binding.version", 'must equal 1') unless binding['version'] == 1
          kind = binding['kind']
          fail_at("#{path}.binding.kind", 'is invalid') unless BINDING_KINDS.include?(kind)

          case kind
          when 'componentQuantity'
            valid = parameter['type'] == 'number' && parameter['integer'] == true
            fail_at("#{path}.binding.kind", 'componentQuantity requires an integer number parameter') unless valid
            validate_text!(binding['componentId'], "#{path}.binding.componentId", max: MAX_NAME_LENGTH)
            fail_at("#{path}.binding.dimension", 'is not allowed for componentQuantity') if binding.key?('dimension')
            if binding.key?('relationship')
              validate_relationship_binding!(binding['relationship'],
                                             "#{path}.binding.relationship")
            end
          when 'componentCondition'
            unless parameter['type'] == 'boolean'
              fail_at("#{path}.binding.kind", 'componentCondition requires a boolean parameter')
            end
            validate_text!(binding['componentId'], "#{path}.binding.componentId", max: MAX_NAME_LENGTH)
            if binding.key?('dimension') || binding.key?('relationship')
              fail_at("#{path}.binding", 'componentCondition only accepts one direct component target')
            end
          when 'dimensionColumn'
            valid = parameter['type'] == 'number' && parameter['integer'] == true && parameter['unit'] == 'mm' &&
                    RESERVED_DIMENSIONS.include?(binding['dimension']) && binding['dimension'] == parameter['name']
            unless valid
              fail_at("#{path}.binding.kind",
                      'dimensionColumn must match a reserved integer millimeter parameter')
            end
            fail_at("#{path}.binding", 'dimensionColumn cannot target composition') if binding.key?('componentId') ||
                                                                                       binding.key?('relationship')
          when 'structureRelationship'
            valid = parameter['type'] == 'number' && parameter['integer'] == true
            unless valid
              fail_at("#{path}.binding.kind",
                      'structureRelationship requires an integer number parameter (the station count)')
            end
            validate_text!(binding['componentId'], "#{path}.binding.componentId", max: MAX_NAME_LENGTH)
            if binding.key?('dimension')
              fail_at("#{path}.binding.dimension",
                      'is not allowed for structureRelationship')
            end
            relationship = binding['relationship']
            unless relationship.is_a?(Hash)
              fail_at("#{path}.binding.relationship", 'is required for structureRelationship')
            end
            validate_structure_relationship!(relationship, "#{path}.binding.relationship")
          end
        end

        # Mirrors the authoritative Go validator (furniture_parameters.go,
        # FurnitureParameterBindingStructureRelationship) so a catalog the
        # server published never fails closed on the plugin (#1044).
        def validate_structure_relationship!(relationship, path)
          validate_text!(relationship['kind'], "#{path}.kind", max: MAX_NAME_LENGTH)
          validate_text!(relationship['sourceRole'], "#{path}.sourceRole", max: MAX_NAME_LENGTH)
          if relationship.key?('sourceFace')
            validate_anchor_face!(relationship['sourceFace'], "#{path}.sourceFace",
                                  'must be one of the six concrete board faces')
          end
          targets = relationship['targets']
          fail_at("#{path}.targets", 'must be a non-empty array') unless targets.is_a?(Array) && !targets.empty?
          face_verified = FACE_VERIFIED_RELATIONSHIP_KINDS.include?(relationship['kind'])
          validate_structure_targets!(targets, face_verified, "#{path}.targets")
          validate_station_margins!(relationship['station'], "#{path}.station") if relationship.key?('station')
          validate_relationship_families!(relationship['families'], "#{path}.families") if relationship.key?('families')
        end

        def validate_structure_targets!(targets, face_verified, path)
          seen_components = {}
          targets.each_with_index do |target, index|
            target_path = "#{path}[#{index}]"
            fail_at(target_path, 'must be an object') unless target.is_a?(Hash)
            validate_closed_shape!(target, TARGET_KEYS, target_path)
            validate_text!(target['componentId'], "#{target_path}.componentId", max: MAX_NAME_LENGTH)
            validate_text!(target['role'], "#{target_path}.role", max: MAX_NAME_LENGTH)
            # Two targets on the same component can never both resolve to
            # distinct participants; ambiguity never selects silently.
            fail_at(path, 'each target must reference a distinct component') if seen_components[target['componentId']]
            seen_components[target['componentId']] = true
            if face_verified
              validate_anchor_face!(target['face'], "#{target_path}.face",
                                    'must declare one concrete contact face')
            elsif target.key?('face')
              validate_anchor_face!(target['face'], "#{target_path}.face",
                                    'must be one of the six concrete board faces')
            end
          end
        end

        def validate_anchor_face!(value, path, message)
          fail_at(path, message) unless ANCHOR_FACES.include?(value)
        end

        def validate_station_margins!(station, path)
          fail_at(path, 'must be an object') unless station.is_a?(Hash)
          validate_closed_shape!(station, STATION_KEYS, path)
          STATION_KEYS.each do |key|
            next unless station.key?(key)

            validate_finite_number!(station[key], "#{path}.#{key}")
            if key == 'maxSpacingMm'
              # #1065: el espaciado máximo define estaciones — 0 no produce
              # plan de estaciones, así que exige estrictamente positivo.
              fail_at("#{path}.#{key}", 'must be positive') unless station[key].positive?
            elsif station[key].negative?
              fail_at("#{path}.#{key}", 'must be nonnegative')
            end
          end
        end

        def validate_relationship_families!(families, path)
          fail_at(path, 'must be an array') unless families.is_a?(Array)
          seen_families = {}
          families.each_with_index do |family, index|
            family_path = "#{path}[#{index}]"
            fail_at(family_path, 'must be an object') unless family.is_a?(Hash)
            validate_closed_shape!(family, FAMILY_KEYS, family_path)
            validate_text!(family['familyId'], "#{family_path}.familyId", max: MAX_NAME_LENGTH)
            fail_at(path, 'each familyId must be unique') if seen_families[family['familyId']]
            seen_families[family['familyId']] = true
            count = family['count']
            fail_at("#{family_path}.count", 'must be an integer >= 2') unless count.is_a?(Integer) && count >= 2
            %w[startMarginMm endMarginMm].each do |key|
              next unless family.key?(key)

              validate_finite_number!(family[key], "#{family_path}.#{key}")
              fail_at("#{family_path}.#{key}", 'must be nonnegative') if family[key].negative?
            end
          end
        end

        def validate_relationship_binding!(relationship, path)
          fail_at(path, 'must be an object') unless relationship.is_a?(Hash)
          validate_closed_shape!(relationship, RELATIONSHIP_KEYS, path)
          validate_text!(relationship['kind'], "#{path}.kind", max: MAX_NAME_LENGTH)
          validate_text!(relationship['sourceRole'], "#{path}.sourceRole", max: MAX_NAME_LENGTH)
          targets = relationship['targets']
          fail_at("#{path}.targets", 'must be a non-empty array') unless targets.is_a?(Array) && !targets.empty?
          targets.each_with_index do |target, index|
            fail_at("#{path}.targets[#{index}]", 'must be an object') unless target.is_a?(Hash)
            validate_closed_shape!(target, TARGET_KEYS, "#{path}.targets[#{index}]")
            validate_text!(target['componentId'], "#{path}.targets[#{index}].componentId", max: MAX_NAME_LENGTH)
            validate_text!(target['role'], "#{path}.targets[#{index}].role", max: MAX_NAME_LENGTH)
          end
          target_keys = targets.map { |target| [target['componentId'], target['role']] }
          fail_at("#{path}.targets", 'targets must be unique') unless target_keys.uniq.length == target_keys.length
        end

        def validate_value!(parameter, value, path) # rubocop:disable Metrics/CyclomaticComplexity
          case parameter['type']
          when 'number'
            validate_finite_number!(value, path)
            fail_at(path, 'must be an integer') if parameter['integer'] == true && value != value.to_i
            fail_at(path, 'is below min') if parameter.key?('min') && value < parameter['min']
            fail_at(path, 'is above max') if parameter.key?('max') && value > parameter['max']
            validate_step!(parameter, value, path) if parameter.key?('step')
          when 'string'
            fail_at(path, 'must be a string') unless value.is_a?(String)
            fail_at(path, 'exceeds maxLength') if value.length > parameter['maxLength']
          when 'boolean'
            fail_at(path, 'must be a boolean') unless [true, false].include?(value)
          when 'enum'
            unless value.is_a?(String) && parameter['options'].include?(value)
              fail_at(path,
                      'must be one of the declared options')
            end
          end
        end

        def validate_step!(parameter, value, path)
          origin = parameter.fetch('min', 0)
          quotient = (value - origin).to_f / parameter['step']
          tolerance = 1e-9 * [1, quotient.abs].max
          fail_at(path, 'does not align with step') if (quotient - quotient.round).abs > tolerance
        end

        def validate_finite_number!(value, path)
          valid = value.is_a?(Numeric) && !value.is_a?(Complex) && value.finite?
          fail_at(path, 'must be a finite number') unless valid
        end

        def validate_text!(value, path, max:)
          fail_at(path, 'must be a non-empty string') unless value.is_a?(String) && !value.strip.empty?
          fail_at(path, "must not exceed #{max} characters") if value.length > max
        end

        def validate_closed_shape!(value, allowed_keys, path)
          unknown = value.keys.reject { |key| allowed_keys.include?(key) }.sort
          fail_at("#{path}.#{unknown.first}", 'is not allowed') unless unknown.empty?
        end

        def fail_at(path, message)
          raise ContractError.new(path, message)
        end
      end # rubocop:enable Metrics/ModuleLength
    end
  end
end
