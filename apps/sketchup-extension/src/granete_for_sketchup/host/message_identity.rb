# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Correlation/message identity for the shared host runtime (#498 /
      # sketchup-backend-web-integration-excellence §6.2). One mutation owns
      # exactly one messageId + idempotencyKey pair from JS command → Ruby
      # bridge → backend request → accepted response → host operation, so a
      # late response can never masquerade as the answer to a newer command.
      module MessageIdentity
        MESSAGE_ID_PREFIX = 'mut'
        IDEMPOTENCY_PREFIX = 'sketchup-mutation'
        SEQUENCE_KEY = :granete_host_message_sequence

        module_function

        def allocate
          entropy = format('%012x', rand(0...(16**12)))
          seq = sequence
          {
            message_id: "#{MESSAGE_ID_PREFIX}-#{seq}-#{entropy}",
            idempotency_key: "#{IDEMPOTENCY_PREFIX}:#{seq}-#{entropy}"
          }
        end

        # Monotonic sequence keeps message ids ordable within a session; the
        # random suffix keeps them unique across sessions/restarts.
        def sequence
          @sequence = (@sequence || 0) + 1
        end
      end
    end
  end
end
