# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Metadata
      class InvalidMetadataError < StandardError; end

      class Store
        DICTIONARY = 'com.granete.sketchup_extension'
        ATTRIBUTE_KEY = 'bootstrap_intent.v1'
        NAMESPACE = 'com.granete.sketchup_extension'
        METADATA_VERSION = 1

        SUPPORTED_KINDS = %w[bootstrapIntent furnitureInstance componentInstance
                             partInstance].freeze

        def initialize(model)
          @model = model
        end

        # Writes semantic intent metadata. The caller owns the undoable SketchUp
        # operation: an inner start_operation/commit issued while entities are
        # being created in an outer operation invalidates Ruby references to
        # them in the real host ("reference to deleted Group"), so this method
        # must never open its own operation.
        def write(target, payload)
          normalized = validate(payload)
          target.set_attribute(DICTIONARY, ATTRIBUTE_KEY, JSON.generate(normalized))
          normalized
        end

        def read(target)
          raw = target.get_attribute(DICTIONARY, ATTRIBUTE_KEY)
          return nil if raw.nil?

          validate(JSON.parse(raw))
        rescue JSON::ParserError => e
          raise InvalidMetadataError, "Stored metadata is not valid JSON: #{e.message}"
        end

        private

        def validate(payload)
          normalized = JSON.parse(JSON.generate(payload))
          validate_envelope(normalized)
          validate_identity(normalized['identity']) if normalized.key?('identity')
          validate_intent(normalized['intent']) if normalized.key?('intent')
          normalized
        rescue JSON::GeneratorError, TypeError => e
          raise InvalidMetadataError, "Metadata is not JSON-safe: #{e.message}"
        end

        def validate_envelope(normalized)
          raise InvalidMetadataError, 'metadata must be an object' unless normalized.is_a?(Hash)

          assert_equal(normalized['namespace'], NAMESPACE, 'namespace')
          assert_equal(normalized['metadataVersion'], METADATA_VERSION, 'metadataVersion')

          kind = normalized['kind']
          return if SUPPORTED_KINDS.include?(kind)

          raise InvalidMetadataError,
                "kind '#{kind}' is not supported. Expected one of: #{SUPPORTED_KINDS.join(', ')}"
        end

        def validate_identity(identity)
          raise InvalidMetadataError, 'identity must be an object' unless identity.is_a?(Hash)

          identity.each do |k, v|
            assert_opaque_string(v, "identity.#{k}") if v.is_a?(String)
          end
        end

        def validate_intent(intent)
          raise InvalidMetadataError, 'intent must be an object' unless intent.is_a?(Hash)

          if intent.key?('semanticRole')
            assert_opaque_string(intent['semanticRole'], 'intent.semanticRole',
                                 max_length: 64)
          end
          if intent.key?('furnitureDefinitionId')
            assert_opaque_string(intent['furnitureDefinitionId'], 'intent.furnitureDefinitionId',
                                 max_length: 128)
          end
          return unless intent.key?('parameters') && !intent['parameters'].is_a?(Hash)

          raise InvalidMetadataError, 'intent.parameters must be an object'
        end

        def assert_equal(value, expected, path)
          return if value == expected

          raise InvalidMetadataError, "#{path} must equal #{expected.inspect}"
        end

        def assert_opaque_string(value, path, max_length: 128)
          valid = value.is_a?(String) && !value.strip.empty? && value.length <= max_length
          raise InvalidMetadataError, "#{path} must be a bounded opaque string" unless valid
        end
      end
    end
  end
end
