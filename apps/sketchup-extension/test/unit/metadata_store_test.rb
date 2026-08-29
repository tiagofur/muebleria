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

  def test_writes_and_reads_versioned_semantic_metadata_without_opening_operations
    written = @store.write(@entity, @fixture)

    assert_equal @fixture, written
    assert_equal @fixture, @store.read(@entity)
    # The caller owns the undoable operation; the store must not nest one,
    # because nested commits invalidate entity references in the real host.
    assert_empty @model.operations
  end

  def test_writes_and_reads_furniture_instance_metadata
    furniture_meta = {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'furnitureInstance',
      'identity' => {
        'instanceRef' => 'inst-k-01',
        'projectRef' => 'proj-active'
      },
      'intent' => {
        'semanticRole' => 'furniture-instance',
        'furnitureDefinitionId' => 'kitchen-base-standard',
        'parameters' => { 'widthMm' => 600, 'shelfCount' => 2 }
      }
    }

    written = @store.write(@entity, furniture_meta)
    assert_equal furniture_meta, written
    assert_equal 'furnitureInstance', @store.read(@entity)['kind']
  end

  def test_writes_and_reads_component_instance_metadata
    comp_meta = {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'componentInstance',
      'identity' => {
        'instanceRef' => 'comp-k-01-left',
        'projectRef' => 'proj-active'
      },
      'intent' => {
        'semanticRole' => 'left_side'
      }
    }

    written = @store.write(@entity, comp_meta)
    assert_equal comp_meta, written
    assert_equal 'componentInstance', @store.read(@entity)['kind']
  end

  def test_writes_and_reads_hardware_semantic_discriminators
    hardware_meta = {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'componentInstance',
      'identity' => {
        'instanceRef' => 'place-hw-01',
        'hardwarePlacementId' => 'place-hw-01',
        'projectRef' => 'proj-active'
      },
      'intent' => {
        'entityClass' => 'hardware',
        'hardwareDefinitionId' => 'hw-handle',
        'placementKind' => 'manual',
        'hostComponentInstanceId' => 'mod-comp-door-copy-0'
      }
    }

    written = @store.write(@entity, hardware_meta)
    assert_equal hardware_meta, written
    intent = @store.read(@entity)['intent']
    assert_equal 'hardware', intent['entityClass']
    assert_equal 'manual', intent['placementKind']
    assert_equal 'place-hw-01', written.dig('identity', 'hardwarePlacementId')
  end

  def test_rejects_invalid_entity_class_and_placement_origin
    invalid_class = @fixture.merge('intent' => @fixture['intent'].merge('entityClass' => 'widget'))

    error = assert_raises(Granete::SketchUpExtension::Metadata::InvalidMetadataError) do
      @store.write(@entity, invalid_class)
    end
    assert_includes error.message, 'intent.entityClass'

    invalid_origin = @fixture.merge('intent' => @fixture['intent'].merge('placementKind' => 'guessed'))

    assert_raises(Granete::SketchUpExtension::Metadata::InvalidMetadataError) do
      @store.write(@entity, invalid_origin)
    end
  end

  def test_rejects_unsupported_kind
    invalid = @fixture.merge('kind' => 'unknownKindX')

    assert_raises(Granete::SketchUpExtension::Metadata::InvalidMetadataError) do
      @store.write(@entity, invalid)
    end
  end

  def test_does_not_derive_identity_from_host_entity_ids
    refute Entity.method_defined?(:entityID)
    assert_equal 'instance-fixture-opaque',
                 @store.write(@entity, @fixture).dig('identity', 'instanceRef')
  end

  def test_project_ref_reads_and_writes_project_identity
    model = Entity.new
    store = Granete::SketchUpExtension::Metadata::Store.new(model)

    assert_equal 'project-sketchup-active', store.project_ref
    store.project_ref = 'project-obra-123'
    assert_equal 'project-obra-123', store.project_ref
  end
end
