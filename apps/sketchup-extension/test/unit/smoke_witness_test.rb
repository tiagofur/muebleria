# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require_relative '../test_helper'
require_relative '../support/smoke_witness'

class SmokeWitnessTest < Minitest::Test
  class FakeModel
    attr_accessor :guid

    def initialize(guid = 'guid-123')
      @guid = guid
    end
  end

  class FakeEntities
    attr_accessor :count

    def initialize(count = 0)
      @count = count
    end
  end

  class DirtyModel
    attr_reader :entities

    def initialize(count = 3)
      @entities = FakeEntities.new(count)
    end
  end

  def test_records_events_and_sanitizes_paths
    witness = Granete::SketchUpExtension::SmokeWitness.new(run_id: 'test-1', test_name: 'test_demo')
    fake_model = FakeModel.new('guid-123')

    details = {
      'path' => '/Users/developer/designs/cocina.skp',
      'instanceId' => 'fi-01'
    }
    event = witness.record(:place, model: fake_model, details: details)

    assert_equal 'place', event['phase']
    assert_equal fake_model.object_id, event['active_model_id']
    assert_equal 'guid-123', event['guid_observation']
    assert_equal '[sanitized]/cocina.skp', event['details']['path']
    assert_equal 'fi-01', event['details']['instanceId']
  end

  def test_verify_reset_precondition_detects_contamination
    witness = Granete::SketchUpExtension::SmokeWitness.new(run_id: 'test-2')
    dirty_model = DirtyModel.new(3)

    err = assert_raises(Granete::SketchUpExtension::SmokeWitness::InvariantError) do
      witness.verify_reset_precondition!(dirty_model)
    end

    assert_equal 'MODEL_RESET_PRECONDITION_FAILED', err.code
    assert_equal 'reset_check_failed', witness.events.last['phase']
  end

  def test_verify_active_model_detects_mismatch
    witness = Granete::SketchUpExtension::SmokeWitness.new(run_id: 'test-3')
    model_a = Object.new
    model_b = Object.new

    err = assert_raises(Granete::SketchUpExtension::SmokeWitness::InvariantError) do
      witness.verify_active_model!(model_a, model_b)
    end

    assert_equal 'ACTIVE_MODEL_CHANGED_UNEXPECTEDLY', err.code
    assert_equal 'active_model_check_failed', witness.events.last['phase']
  end

  def test_verify_furniture_identity_detects_missing_and_duplicates
    witness = Granete::SketchUpExtension::SmokeWitness.new(run_id: 'test-4')

    # Missing
    err_missing = assert_raises(Granete::SketchUpExtension::SmokeWitness::InvariantError) do
      witness.verify_furniture_identity!({ 'entity' => nil, 'duplicates' => 0 }, 'fi-01')
    end
    assert_equal 'EXPECTED_FURNITURE_IDENTITY_MISSING', err_missing.code

    # Duplicate
    err_dup = assert_raises(Granete::SketchUpExtension::SmokeWitness::InvariantError) do
      witness.verify_furniture_identity!({ 'entity' => Object.new, 'duplicates' => 2 }, 'fi-01')
    end
    assert_equal 'DUPLICATE_FURNITURE_IDENTITY', err_dup.code
  end

  def test_write_witness_safely_writes_file_and_caps_size
    witness = Granete::SketchUpExtension::SmokeWitness.new(run_id: 'test-5', test_name: 'test_cap')
    witness.record(:init, details: { 'large' => 'x' * 70_000 })

    Dir.mktmpdir('smoke_witness_test') do |dir|
      out_path = File.join(dir, 'witness.json')
      written = witness.write_witness(out_path, original_exception: RuntimeError.new('boom'))

      assert_equal out_path, written
      content = File.read(out_path)
      assert content.bytesize <= Granete::SketchUpExtension::SmokeWitness::MAX_BYTES
      parsed = JSON.parse(content)
      assert_equal 'RuntimeError', parsed['original_error']['class']
      assert_equal 'boom', parsed['original_error']['message']
    end
  end

  def test_pf06_writing_failure_preserves_original_exception
    witness = Granete::SketchUpExtension::SmokeWitness.new(run_id: 'test-6')
    original_err = RuntimeError.new('original_test_failure')

    # Writing to a non-writable / impossible path fails silently within write_witness
    result = witness.write_witness('/dev/null/impossible/path/witness.json', original_exception: original_err)

    assert_nil result, 'failing write must return nil'
    refute_nil witness.last_write_error, 'last write error recorded'
    assert_equal 'original_test_failure', original_err.message
  end
end
