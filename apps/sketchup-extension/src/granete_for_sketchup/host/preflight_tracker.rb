# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Shared preflight invalidation state (#498; #466 owns the review UX).
      # After an accepted manufacturing-affecting mutation the previous
      # preflight becomes stale; a generic-preview resolve has no
      # manufacturing truth at all. The tracker NEVER derives `ready` from
      # local state: `record!` only stores what Granete's authoritative
      # preflight returned (`ready|warning|blocked`), and requires the
      # accepted fingerprint/revision so #466 reviews and #470 overlays can
      # correlate.
      class PreflightTracker
        STATES = %w[unknown stale unavailable ready warning blocked].freeze
        REVIEW_STATES = %w[ready warning blocked].freeze

        Entry = Struct.new(:state, :fingerprint, :catalog_revision, :message_id, keyword_init: true) do
          def to_payload(key)
            {
              'furniture' => key,
              'state' => state,
              'fingerprint' => fingerprint,
              'catalogRevision' => catalog_revision,
              'messageId' => message_id
            }.compact
          end
        end

        def initialize
          @entries = {}
        end

        # Key-based invalidation (canonical semantic target key). Prefer
        # `invalidate_target!`, which also writes the furniture-scoped alias.
        def invalidate!(key, fingerprint: nil, catalog_revision: nil, message_id: nil)
          @entries[key] = Entry.new(
            state: 'stale', fingerprint: fingerprint, catalog_revision: catalog_revision,
            message_id: message_id
          )
        end

        # Generic-preview furniture carries no manufacturing truth: honest
        # unavailability, never ready.
        def mark_unavailable!(key, message_id: nil)
          @entries[key] = Entry.new(state: 'unavailable', message_id: message_id)
        end

        # A committed manufacturing-affecting mutation invalidates whatever
        # preflight the furniture had; the accepted fingerprint/revision ride
        # along so #470 overlays and #466 refresh can correlate. The
        # furniture-scoped alias keeps lookups keyed by the OWNING furniture
        # (overlay scope, #466 review) coherent even when the mutation target
        # was a child occurrence.
        def invalidate_target!(semantic_target, fingerprint: nil, catalog_revision: nil, message_id: nil)
          CommandContract.target_keys_for(semantic_target).each do |key|
            invalidate!(key, fingerprint: fingerprint, catalog_revision: catalog_revision,
                             message_id: message_id)
          end
        end

        def mark_unavailable_target!(semantic_target, message_id: nil)
          CommandContract.target_keys_for(semantic_target).each do |key|
            mark_unavailable!(key, message_id: message_id)
          end
        end

        # Records an AUTHORITATIVE preflight outcome for a furniture scope
        # (#466 review). Fail-closed: only review states are accepted, the
        # correlation message is mandatory, and ready/warning must carry the
        # accepted fingerprint (a blocked rejection may legitimately lack
        # one). Nothing local can mint `ready`.
        def record!(key, status, fingerprint: nil, catalog_revision: nil, message_id: nil)
          unless REVIEW_STATES.include?(status)
            raise ArgumentError, "estado de preflight no autoritativo: #{status.inspect}"
          end
          unless message_id.is_a?(String) && !message_id.strip.empty?
            raise ArgumentError, 'record! requiere correlación messageId del resolve'
          end
          if status != 'blocked' && fingerprint.nil?
            raise ArgumentError, "preflight #{status} requiere el fingerprint aceptado"
          end

          @entries[key] = Entry.new(state: status, fingerprint: fingerprint,
                                    catalog_revision: catalog_revision, message_id: message_id)
        end

        def state_for(key)
          @entries.fetch(key, Entry.new(state: 'unknown')).state
        end

        def payload
          @entries.map { |key, entry| entry.to_payload(key) }
        end

        def payload_for(key)
          return [] unless @entries.key?(key)

          [@entries[key].to_payload(key)]
        end
      end
    end
  end
end
