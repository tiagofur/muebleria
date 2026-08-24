# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/metadata/store'

class MetadataStoreTest < Minitest::Test
  class Model
    attr_reader :operations

    def initialize
      @operations = []
    end

    def abort_operation
      @operations << :abort
    end

    def commit_operation
      @operations << :commit
    end

    def start_operation(name, disable_ui)
      @operations << [:start, name, disable_ui]
    end
  end

  class Entity
    def initialize
      @attributes = {}
    end

    def get_attribute(dictionary, key)
      @attributes[[dictionary, key]]
    end

    def set_attribute(dictionary, key, value)
      @attributes[[dictionary, key]] = value
    end
  end

  def setup
    @model = Model.new
    @entity = Entity.new
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    fixture_path = File.join(PROJECT_ROOT, 'test', 'fixtures', 'non_manufacturable_metadata.json')
    @fixture = JSON.parse(File.read(fixture_path))
  end

  def test_writes_and_reads_versioned_semantic_metadata_in_an_undoable_operation
    written = @store.write(@entity, @fixture)

    assert_equal @fixture, written
    assert_equal @fixture, @store.read(@entity)
    assert_equal [[:start, 'Actualizar Intención', true], :commit], @model.operations
  end

  def test_rejects_unknown_fields_before_mutating_the_model
    invalid = @fixture.merge('accessToken' => 'never-store-this')

    assert_raises(Granete::SketchUpExtension::Metadata::InvalidMetadataError) do
      @store.write(@entity, invalid)
    end
    assert_empty @model.operations
  end

  def test_does_not_derive_identity_from_host_entity_ids
    refute Entity.method_defined?(:entityID)
    assert_equal 'instance-fixture-opaque',
                 @store.write(@entity, @fixture).dig('identity', 'instanceRef')
  end
end
