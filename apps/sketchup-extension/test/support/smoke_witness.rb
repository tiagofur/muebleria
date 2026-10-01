# frozen_string_literal: true

require 'json'
require 'fileutils'

module Granete
  module SketchUpExtension
    # Bounded, sanitized in-memory witness recorder for lifecycle and host
    # smoke diagnostics (#873).
    #
    # Records phase transitions around reset, place, save, reopen, and locate.
    # Emits structured, sanitized witness artifacts strictly upon invariant
    # failure or test error, never masks original exceptions, and caps payload
    # size cleanly within 64 KB.
    class SmokeWitness
      MAX_BYTES = 64 * 1024
      SANITIZE_HOMEDIR_REGEX = %r{(?:/[a-zA-Z0-9._-]+)+/([a-zA-Z0-9._-]+\.skp)}

      attr_reader :events, :last_write_error

      def initialize(run_id: nil, test_name: nil)
        @run_id = run_id || "run-#{Time.now.to_i}"
        @test_name = test_name
        @events = []
        @last_write_error = nil
      end

      # Records a phase event in memory.
      def record(phase, model: nil, expected_model: nil, details: {})
        entry = {
          'phase' => phase.to_s,
          'timestamp' => Time.now.utc.iso8601,
          'expected_model_id' => expected_model&.object_id,
          'active_model_id' => model&.object_id,
          'guid_observation' => (model.respond_to?(:guid) ? model.guid : nil),
          'details' => sanitize(details)
        }
        @events << entry
        entry
      end

      # Invariant check: reset must yield a clean model with 0 entities.
      def verify_reset_precondition!(model)
        count = model.entities.count
        return if count.zero?

        details = {
          'invariant' => 'MODEL_RESET_PRECONDITION_FAILED',
          'entity_count' => count
        }
        record(:reset_check_failed, model: model, details: details)
        raise InvariantError.new('MODEL_RESET_PRECONDITION_FAILED', "model has #{count} unreset entities")
      end

      # Invariant check: active document must match the expected document object.
      def verify_active_model!(model, expected_model)
        return if model == expected_model

        details = {
          'invariant' => 'ACTIVE_MODEL_CHANGED_UNEXPECTEDLY',
          'model_id' => model&.object_id,
          'expected_id' => expected_model&.object_id
        }
        record(:active_model_check_failed, model: model, expected_model: expected_model, details: details)
        raise InvariantError.new('ACTIVE_MODEL_CHANGED_UNEXPECTEDLY',
                                 "active model #{model&.object_id} != expected #{expected_model&.object_id}")
      end

      # Invariant check: expected furniture identity must resolve with 1 duplicate.
      def verify_furniture_identity!(located, expected_fi_id)
        entity = located['entity']
        duplicates = located['duplicates']

        if entity.nil?
          details = {
            'invariant' => 'EXPECTED_FURNITURE_IDENTITY_MISSING',
            'expected_fi_id' => expected_fi_id
          }
          record(:identity_missing, details: details)
          raise InvariantError.new('EXPECTED_FURNITURE_IDENTITY_MISSING',
                                   "furniture #{expected_fi_id} not located")
        end

        return if duplicates == 1

        details = {
          'invariant' => 'DUPLICATE_FURNITURE_IDENTITY',
          'expected_fi_id' => expected_fi_id,
          'duplicates' => duplicates
        }
        record(:duplicate_identity, details: details)
        raise InvariantError.new('DUPLICATE_FURNITURE_IDENTITY',
                                 "furniture #{expected_fi_id} has #{duplicates} roots")
      end

      # Safely writes the witness payload to destination path.
      # If writing fails, it records the write error without masking original_exception.
      def write_witness(target_path, original_exception: nil)
        capped_events = @events.last(50)
        payload = {
          'run_id' => @run_id,
          'test_name' => @test_name,
          'total_events' => @events.size,
          'events' => capped_events,
          'original_error' => original_exception ? format_error(original_exception) : nil
        }
        json = JSON.pretty_generate(payload)
        if json.bytesize > MAX_BYTES
          payload['events'] = capped_events.map do |ev|
            ev.merge('details' => '[truncated_oversized_payload]')
          end
          json = JSON.pretty_generate(payload)
        end

        FileUtils.mkdir_p(File.dirname(target_path))
        File.write(target_path, json)
        target_path
      rescue StandardError => e
        @last_write_error = e
        nil
      end

      def sanitize(val)
        case val
        when Hash
          val.each_with_object({}) { |(k, v), acc| acc[k.to_s] = sanitize(v) }
        when Array
          val.map { |elem| sanitize(elem) }
        when String
          sanitize_string(val)
        else
          val
        end
      end

      private

      def sanitize_string(str)
        str.gsub(SANITIZE_HOMEDIR_REGEX, '[sanitized]/\1')
      end

      def format_error(err)
        {
          'class' => err.class.name,
          'message' => err.message,
          'backtrace' => err.backtrace&.first(10)
        }
      end

      class InvariantError < StandardError
        attr_reader :code

        def initialize(code, message)
          @code = code
          super("[#{code}] #{message}")
        end
      end
    end
  end
end
