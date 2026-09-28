# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/selection/batch_context'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'

# #471 R1: a multi-selection of two or more managed furniture publishes a
# BatchContext — a SET of semantic identities, never selection.first
# authority. Every other multi-selection keeps the historical
# single-context payload of the first entity.
class SelectionBatchTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)

    @last_context = :unset
    @observer = Granete::SketchUpExtension::Observers::SelectionObserver.new(
      metadata_store: @store,
      catalog_provider: @provider,
      on_selection_change: ->(context) { @last_context = context }
    )
  end

  def test_two_managed_furniture_publish_batch_kind_with_individual_identities
    insert_furniture('kitchen-base-standard', 'widthMm' => 600)
    insert_furniture('kitchen-base-standard', 'widthMm' => 900)
    furniture = @model.active_entities.instances

    @model.selection.add_observer(@observer)
    @model.selection.clear
    furniture.each { |f| @model.selection.add(f) }

    payload = @last_context
    assert_equal 'batch', payload['kind']
    assert_equal 'selection', payload['origin']
    assert_equal 2, payload['selectionCount']
    assert_equal 2, payload['furniture'].length
    # Individual identities survive: each member keeps its own context.
    widths = payload['furniture'].map { |f| f['parameters']['widthMm'] }.sort
    assert_equal [600, 900], widths
    assert_empty payload['excluded']
    # Honest intersection: the local test catalog definitions expose no
    # materialRoles, so the material-roles batch operation denies with the
    # full-member count while parameters stay supported.
    assert payload['capabilities']['canBatchEditParameters']['supported']
    material_roles = payload['capabilities']['canBatchEditMaterialRoles']
    refute material_roles['supported']
    assert_includes material_roles['reason'], '2 de 2'
  end

  def test_mixed_selection_excludes_non_furniture_with_honest_reason
    insert_furniture('kitchen-base-standard', 'widthMm' => 600)
    insert_furniture('kitchen-base-standard', 'widthMm' => 800)
    furniture = @model.active_entities.instances
    group = @model.active_entities.add_group

    @model.selection.add_observer(@observer)
    @model.selection.clear
    @model.selection.add(furniture[0])
    @model.selection.add(group)
    @model.selection.add(furniture[1])

    payload = @last_context
    assert_equal 'batch', payload['kind']
    assert_equal 3, payload['selectionCount']
    assert_equal 2, payload['furniture'].length
    excluded = payload['excluded']
    assert_equal 1, excluded.length
    assert_equal 'unmanaged', excluded.first['kind']
    refute_nil excluded.first['reason'], 'excluded entities carry an honest reason, never a silent skip'
  end

  def test_single_furniture_plus_unmanaged_keeps_historical_single_payload
    insert_furniture('kitchen-base-standard', 'widthMm' => 600)
    furniture = @model.active_entities.instances.first
    group = @model.active_entities.add_group

    @model.selection.add_observer(@observer)
    @model.selection.clear
    @model.selection.add(furniture)
    @model.selection.add(group)

    # Below the batch minimum: the historical single-context payload of the
    # first entity (with its honest count) is preserved for existing lanes.
    assert_equal 'furniture', @last_context['kind']
    assert_equal 2, @last_context['selectionCount']
  end

  def test_batch_requires_two_members_constructor_fails_closed
    insert_furniture('kitchen-base-standard', 'widthMm' => 600)
    contexts = resolved_furniture_contexts
    refute_empty contexts
    error = assert_raises(ArgumentError) do
      Granete::SketchUpExtension::Selection::BatchContext.new(
        members: contexts.first(1), others: [], selection_count: 1
      )
    end
    assert_includes error.message, 'at least two'
  end

  def test_duplicate_identities_collapse_to_one_member
    insert_furniture('kitchen-base-standard', 'widthMm' => 600)
    insert_furniture('kitchen-base-standard', 'widthMm' => 600)
    furniture = @model.active_entities.instances

    # Legacy copy edge: force both entities to carry the same instanceRef so
    # they are one semantic identity.
    @store.write(furniture[1], @store.read(furniture[0]))

    @model.selection.add_observer(@observer)
    @model.selection.clear
    furniture.each { |f| @model.selection.add(f) }

    # One semantic identity → below batch minimum → historical single payload.
    assert_equal 'furniture', @last_context['kind']
  end

  def test_batch_capability_intersection_names_deniers
    insert_furniture('kitchen-base-standard', 'widthMm' => 600)
    furniture = @model.active_entities.instances.first

    # A legacy Group with its OWN furniture identity resolves representation
    # 'legacy-group': canEditParameters/canEditMaterialRoles are unsupported
    # for it, so the batch operations must deny naming the denier count.
    legacy_group = @model.active_entities.add_group
    legacy_metadata = @store.read(furniture).merge('kind' => 'furnitureInstance')
    legacy_metadata['identity'] = legacy_metadata['identity'].merge('instanceRef' => 'legacy-batch-ref-1')
    @store.write(legacy_group, legacy_metadata)

    @model.selection.add_observer(@observer)
    @model.selection.clear
    @model.selection.add(furniture)
    @model.selection.add(legacy_group)

    payload = @last_context
    assert_equal 'batch', payload['kind']
    assert_equal 2, payload['furniture'].length
    params = payload['capabilities']['canBatchEditParameters']
    refute params['supported']
    assert_includes params['reason'], '1 de 2'
    refute payload['capabilities']['canBatchEditMaterialRoles']['supported']
  end

  private

  def insert_furniture(definition_id, parameters)
    definition = @provider.find_definition(definition_id)
    @builder.insert_furniture(@model, definition, parameters)
  end

  def resolved_furniture_contexts
    resolver = Granete::SketchUpExtension::Selection::Resolver.new(
      metadata_store: @store, catalog_provider: @provider
    )
    @model.active_entities.instances.filter_map { |entity| resolver.resolve(entity) }
  end
end
