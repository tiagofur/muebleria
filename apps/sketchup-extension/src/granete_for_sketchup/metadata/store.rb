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
        KIND = 'bootstrapIntent'
        TOP_LEVEL_KEYS = %w[identity intent kind metadataVersion namespace nonManufacturable].freeze
        IDENTITY_KEYS = %w[instanceRef projectRef sourceRevisionRef].freeze
        INTENT_KEYS = %w[semanticRole].freeze

        def initialize(model)
          @model = model
        end

        def write(target, payload)
          normalized = validate(payload)
          operation_started = false

          @model.start_operation('Actualizar Intención', true)
          operation_started = true
          target.set_attribute(DICTIONARY, ATTRIBUTE_KEY, JSON.generate(normalized))
          @model.commit_operation
          normalized
        rescue StandardError
          @model.abort_operation if operation_started
          raise
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
          validate_identity(normalized['identity'])
          validate_intent(normalized['intent'])
          normalized
        rescue JSON::GeneratorError, TypeError => e
          raise InvalidMetadataError, "Metadata is not JSON-safe: #{e.message}"
        end

        def validate_envelope(normalized)
          assert_keys(normalized, TOP_LEVEL_KEYS, 'metadata')
          assert_equal(normalized['namespace'], NAMESPACE, 'namespace')
          assert_equal(normalized['metadataVersion'], METADATA_VERSION, 'metadataVersion')
          assert_equal(normalized['kind'], KIND, 'kind')
          assert_equal(normalized['nonManufacturable'], true, 'nonManufacturable')
        end

        def validate_identity(identity)
          assert_keys(identity, IDENTITY_KEYS, 'identity')
          IDENTITY_KEYS.each { |key| assert_opaque_string(identity[key], "identity.#{key}") }
        end

        def validate_intent(intent)
          assert_keys(intent, INTENT_KEYS, 'intent')
          assert_opaque_string(intent['semanticRole'], 'intent.semanticRole', max_length: 64)
        end

        def assert_keys(value, expected, path)
          raise InvalidMetadataError, "#{path} must be an object" unless value.is_a?(Hash)
          return if value.keys.sort == expected.sort

          raise InvalidMetadataError, "#{path} contains unsupported fields"
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
