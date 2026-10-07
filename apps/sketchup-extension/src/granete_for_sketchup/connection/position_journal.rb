# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Connection
      # #1189 — durable position journal for project furniture, per open
      # SketchUp file. The authoritative position lives in the design working
      # copy item (`design_working_items.transform`); the explicit design
      # sync deliberately deletes that row (#810 Caso 1) and the #977
      # authoring snapshot that survives the drop carries finishes but NOT a
      # transform. This journal is the local recovery record that lets
      # "↶ Restaurar posición" survive the drop: the last CONFIRMED transform
      # per furnitureInstanceId, written only after an authoritative readback
      # proved the server accepted it.
      #
      # Authority rules this module enforces:
      #   * recovery metadata ONLY — never authority, never a second source
      #     of truth. Readers consult it exclusively for units the working
      #     copy no longer contains (`unplaced` rows); a live working item
      #     always wins;
      #   * stored in the Granete-owned model dictionary `com.granete.project`
      #     as one versioned JSON envelope — it survives save/reopen with the
      #     file and dies with it (a different file offers only "Colocar",
      #     the honest limit the issue accepts);
      #   * MODEL-level (not per-entity) exactly because the recovery case is
      #     a deleted component: a per-entity dictionary would die with it;
      #   * writes are plain set_attribute WITHOUT an undo operation wrapper:
      #     they ride network-confirmed syncs and wrapping each one would
      #     flood the undo stack; undoing geometry re-triggers a position
      #     sync that rewrites the entry, so journal undo is irrelevant;
      #   * a terminal `:remove` forgets the entry — a removed unit must
      #     never offer position recovery.
      module PositionJournal
        DICTIONARY = 'com.granete.project'
        JOURNAL_KEY = 'granete.position-journal.v1'
        SCHEMA_VERSION = 1
        UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/

        def self.uuid?(value)
          value.is_a?(String) && value.match?(UUID_PATTERN)
        end

        # Per-file journal of last confirmed transforms. Methods take the
        # model explicitly: the coordinator observes several models across
        # document switches, and one stateless store serves them all.
        class Store
          # Records the confirmed transform for one unit. Invalid input and
          # non-attribute models fail closed (false) without ever raising:
          # a journal write must never fail the confirmed sync it mirrors.
          def record(model, furniture_instance_id, transform)
            return false unless journable?(model, furniture_instance_id, transform)

            entries = read_entries(model)
            entries[furniture_instance_id] =
              transform.merge('recordedAt' => Time.now.utc.strftime('%Y-%m-%dT%H:%M:%SZ'))
            write_entries(model, entries)
            true
          rescue StandardError
            false
          end

          # The stored record for one unit, or nil when absent/invalid. The
          # transform keys must be a valid canonical Transform3D — a corrupt
          # or stale-shaped entry degrades to "no entry" (the card honestly
          # offers only "Colocar"), never to a guessed placement.
          def entry(model, furniture_instance_id)
            return nil unless journable_id?(furniture_instance_id)

            stored = read_entries(model)[furniture_instance_id]
            return nil unless ProjectFurniture::TransformContract.transform_contract?(stored)

            stored
          rescue JSON::ParserError
            nil
          end

          def recorded?(model, furniture_instance_id)
            !entry(model, furniture_instance_id).nil?
          end

          # Terminal units drop their entry: the reconciliation never shows
          # them a recovery lane and the journal must not pretend otherwise.
          def forget(model, furniture_instance_id)
            return false unless journable_id?(furniture_instance_id)

            entries = read_entries(model)
            return false unless entries.delete(furniture_instance_id)

            write_entries(model, entries)
            true
          rescue StandardError
            false
          end

          private

          def journable?(model, furniture_instance_id, transform)
            journable_id?(furniture_instance_id) &&
              model.respond_to?(:set_attribute) &&
              ProjectFurniture::TransformContract.transform_contract?(transform)
          end

          def journable_id?(furniture_instance_id)
            PositionJournal.uuid?(furniture_instance_id)
          end

          def read_entries(model)
            return {} unless model.respond_to?(:get_attribute)

            raw = model.get_attribute(PositionJournal::DICTIONARY, PositionJournal::JOURNAL_KEY)
            return {} if raw.nil? || raw.to_s.strip.empty?

            payload = JSON.parse(raw)
            # Corrupt/unknown envelope self-heals to empty: the next record
            # rewrites a valid one and recovery honestly degrades to
            # "Colocar" until then — it never guesses from garbage.
            return {} unless payload.is_a?(Hash) && payload['schemaVersion'] == SCHEMA_VERSION
            return {} unless payload['entries'].is_a?(Hash)

            payload['entries']
          rescue JSON::ParserError
            {}
          end

          def write_entries(model, entries)
            model.set_attribute(PositionJournal::DICTIONARY, PositionJournal::JOURNAL_KEY,
                                JSON.generate('schemaVersion' => SCHEMA_VERSION, 'entries' => entries))
          end
        end
      end
    end
  end
end
