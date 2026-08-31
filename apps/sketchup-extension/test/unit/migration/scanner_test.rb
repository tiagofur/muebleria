# frozen_string_literal: true

require_relative '../../test_helper'
require_relative '../../../src/granete_for_sketchup/metadata/store'
require_relative '../../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../../src/granete_for_sketchup/migration/scanner'
require_relative '../../support/legacy_model_builder'

# #416 — scanner classification. The four taxonomies are decided by
# namespaced metadata and entity class ONLY; the negative proofs pin that
# display names, arbitrary user groups and loose geometry never influence
# classification.
class MigrationScannerTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @scanner = Granete::SketchUpExtension::Migration::Scanner.new(metadata_store: @store)
    @definition = { 'furniture_definition_id' => 'kitchen-base-standard', 'name' => 'Bajo estándar' }
  end

  def test_classifies_legacy_group_with_valid_metadata_as_ready
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-legacy-1', parameters: { 'widthMm' => 600 }
    )

    result = @scanner.scan(@model)

    assert_equal 1, result.counts['detected']
    assert_equal 1, result.counts['ready']
    assert_equal 0, result.counts['requiresReview']
    entity = result.legacy.first
    assert_equal Granete::SketchUpExtension::Migration::TAXONOMY_LEGACY, entity.taxonomy
    assert_equal 'inst-legacy-1', entity.instance_ref
    assert_equal 'kitchen-base-standard', entity.furniture_definition_id
  end

  def test_classifies_native_component_instance_furniture_as_native
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-old', parameters: {}
    )
    native = @model.active_entities.add_instance(
      @model.definitions.add('Granete · Mueble · Prueba · inst-native'),
      Geom::Transformation.new
    )
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, native, 'inst-native', @definition.merge('revisionId' => 'rev-1'), {}
    )

    result = @scanner.scan(@model)

    assert_equal(1, result.entities.count { |e| e.taxonomy == Granete::SketchUpExtension::Migration::TAXONOMY_NATIVE })
    # Detected counts stay legacy-only: native entities never enter the batch.
    assert_equal 1, result.counts['detected']
    assert_equal 1, result.counts['ready']
  end

  def test_classifies_legacy_group_without_definition_id_as_requires_review
    group = @model.active_entities.add_group
    @store.write(group, {
                   'namespace' => Granete::SketchUpExtension::Metadata::Store::NAMESPACE,
                   'metadataVersion' => 1,
                   'kind' => 'furnitureInstance',
                   'identity' => { 'instanceRef' => 'inst-no-def', 'projectRef' => 'project-x' },
                   'intent' => { 'semanticRole' => 'furniture-instance', 'parameters' => {} }
                 })

    result = @scanner.scan(@model)

    assert_equal 1, result.counts['requiresReview']
    assert_equal 0, result.counts['ready']
    assert_equal 'missing-furniture-definition-id', result.requires_review.first.reason
  end

  def test_classifies_unreadable_granete_metadata_as_corrupt
    group = @model.active_entities.add_group
    group.set_attribute(Granete::SketchUpExtension::Metadata::Store::DICTIONARY,
                        Granete::SketchUpExtension::Metadata::Store::ATTRIBUTE_KEY,
                        '{not valid json')

    result = @scanner.scan(@model)

    assert_equal 1, result.counts['unsupported']
    entity = result.unsupported.first
    assert_equal 'corrupt-metadata', entity.reason
    # Detected counts stay legacy-only: corrupt entities are surfaced but
    # never enter the migratable batch.
    assert_equal 0, result.counts['detected']
  end

  def test_classifies_granete_marked_non_furniture_root_as_unsupported
    group = @model.active_entities.add_group
    @store.write(group, {
                   'namespace' => Granete::SketchUpExtension::Metadata::Store::NAMESPACE,
                   'metadataVersion' => 1,
                   'kind' => 'componentInstance',
                   'identity' => { 'instanceRef' => 'orphan-child', 'projectRef' => 'project-x' },
                   'intent' => { 'semanticRole' => 'slot_0' }
                 })

    result = @scanner.scan(@model)

    assert_equal 1, result.counts['unsupported']
    assert_equal 'root-kind-not-furniture', result.unsupported.first.reason
  end

  def test_ignores_arbitrary_user_groups_and_loose_geometry_as_unmanaged
    @model.active_entities.add_group.name = 'Mueble de cocina' # display name says furniture…
    @model.active_entities.add_face([Geom::Point3d.new(0, 0, 0), Geom::Point3d.new(1, 0, 0),
                                     Geom::Point3d.new(1, 1, 0), Geom::Point3d.new(0, 1, 0)])

    result = @scanner.scan(@model)

    assert_equal 2, result.counts['unmanaged']
    assert_equal 0, result.counts['detected']
    refute result.any_legacy?
  end

  # Negative proof (AC1): renaming a legacy furniture must not change its
  # classification — detection reads namespaced metadata, never display name.
  def test_rename_does_not_change_classification
    group = Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-renamed', parameters: {}
    )
    before = @scanner.scan(@model)

    group.name = 'Cualquier cosa que dibujó el cliente'
    after = @scanner.scan(@model)

    assert_equal before.counts, after.counts
    assert_equal 'inst-renamed', after.legacy.first.instance_ref
  end
end
