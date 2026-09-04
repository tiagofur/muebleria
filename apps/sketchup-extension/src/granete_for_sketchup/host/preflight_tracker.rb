# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Shared preflight invalidation state (#498; #466 owns the review UX).
      # After an accepted manufacturing-affecting mutation the previous
      # preflight becomes stale; a generic-preview resolve has no
      # manufacturing truth at all. The tracker NEVER produces ready — only
      # Granete's authoritative preflight may (#466/#477 preflight section).
      class PreflightTracker
        STATES = %w[unknown stale unavailable].freeze

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

        # A committed manufacturing-affecting mutation invalidates whatever
        # preflight the furniture had; the accepted fingerprint/revision ride
        # along so #470 overlays and future #466 refresh can correlate.
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
