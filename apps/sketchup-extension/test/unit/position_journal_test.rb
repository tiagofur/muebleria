# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/position_journal'

module Granete
  module SketchUpExtension
    module Connection
      # #1189 — the durable per-file position journal. Written ONLY from
      # readback-confirmed syncs, read ONLY as recovery metadata for units
      # the working copy no longer contains, self-healing on corruption and
      # forgetting terminal units.
      class PositionJournalTest < Minitest::Test
        FI_1 = '51000000-0000-0000-0000-0000000000f1'
        FI_2 = '51000000-0000-0000-0000-0000000000f2'
        BAD_ID = 'not-a-uuid'

        TRANSFORM = { 'translation_mm' => [1250.0, -250.0, 80.0], 'rotation_deg' => [0.0, 0.0, 90.0] }.freeze

        def setup
          @model = JournalModel.new
          @store = PositionJournal::Store.new
        end

        # Models an OPEN SketchUp file: the Granete-owned attribute
        # dictionary IS the file-embedded persistence the journal rides.
        class JournalModel < SketchupStub::ModelStub
          include SketchupStub::AttributeContainer
        end

        def test_records_and_reads_back_the_confirmed_transform
          assert @store.record(@model, FI_1, TRANSFORM)

          assert @store.recorded?(@model, FI_1)
          entry = @store.entry(@model, FI_1)
          assert_equal TRANSFORM['translation_mm'], entry['translation_mm']
          assert_equal TRANSFORM['rotation_deg'], entry['rotation_deg']
          assert_match(/\A\d{4}-\d{2}-\d{2}T/, entry['recordedAt'])
        end

        def test_store_is_stateless_and_the_model_carries_the_envelope
          @store.record(@model, FI_1, TRANSFORM)

          # A second store (e.g. the Restorer's own instance) reads the same
          # file-embedded envelope — the journal has no session state.
          assert PositionJournal::Store.new.recorded?(@model, FI_1)

          raw = @model.get_attribute(PositionJournal::DICTIONARY, PositionJournal::JOURNAL_KEY)
          payload = JSON.parse(raw)
          assert_equal 1, payload['schemaVersion']
          assert_equal FI_1, payload['entries'].keys.first
        end

        def test_the_last_confirmed_transform_wins
          moved = { 'translation_mm' => [10.0, 20.0, 30.0], 'rotation_deg' => [0.0, 0.0, 0.0] }

          @store.record(@model, FI_1, TRANSFORM)
          @store.record(@model, FI_1, moved)

          assert_equal moved, @store.entry(@model, FI_1).slice('translation_mm', 'rotation_deg')
        end

        def test_entries_are_independent_per_unit
          other = { 'translation_mm' => [1.0, 2.0, 3.0], 'rotation_deg' => [0.0, 45.0, 0.0] }

          @store.record(@model, FI_1, TRANSFORM)
          @store.record(@model, FI_2, other)

          assert_equal TRANSFORM['translation_mm'], @store.entry(@model, FI_1)['translation_mm']
          assert_equal other['translation_mm'], @store.entry(@model, FI_2)['translation_mm']
        end

        def test_invalid_input_fails_closed_without_writing
          refute @store.record(@model, BAD_ID, TRANSFORM)
          refute @store.record(@model, FI_1, { 'translation_mm' => [0, 0, 0] })
          refute @store.record(@model, FI_1, 'not-a-transform')

          assert_nil @store.entry(@model, BAD_ID)
          refute @store.recorded?(@model, FI_1)
          raw = @model.get_attribute(PositionJournal::DICTIONARY, PositionJournal::JOURNAL_KEY)
          assert_nil raw, 'a rejected record must leave no partial envelope behind'
        end

        def test_corrupt_envelope_self_heals_to_no_entry
          @model.set_attribute(PositionJournal::DICTIONARY, PositionJournal::JOURNAL_KEY, '{not json')

          refute @store.recorded?(@model, FI_1)
          assert_nil @store.entry(@model, FI_1)

          # The next confirmed record rewrites a valid envelope.
          assert @store.record(@model, FI_1, TRANSFORM)
          assert @store.recorded?(@model, FI_1)
        end

        def test_unknown_schema_version_degrades_to_no_entry
          @model.set_attribute(PositionJournal::DICTIONARY, PositionJournal::JOURNAL_KEY,
                               JSON.generate('schemaVersion' => 99, 'entries' => { FI_1 => TRANSFORM }))

          refute @store.recorded?(@model, FI_1)
        end

        def test_malformed_entry_degrades_to_no_entry
          @model.set_attribute(PositionJournal::DICTIONARY, PositionJournal::JOURNAL_KEY,
                               JSON.generate('schemaVersion' => 1,
                                             'entries' => { FI_1 => { 'translation_mm' => 'garbage' } }))

          refute @store.recorded?(@model, FI_1), 'a guessed placement must never come from garbage'
        end

        def test_forget_drops_only_the_terminal_unit
          @store.record(@model, FI_1, TRANSFORM)
          @store.record(@model, FI_2, TRANSFORM)

          assert @store.forget(@model, FI_1)

          refute @store.recorded?(@model, FI_1)
          assert @store.recorded?(@model, FI_2)
          refute @store.forget(@model, FI_1), 'forgetting an absent entry is an honest no-op'
          refute @store.forget(@model, BAD_ID)
        end
      end
    end
  end
end
