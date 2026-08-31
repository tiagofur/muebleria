# frozen_string_literal: true

require_relative '../../test_helper'
require_relative '../../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../../src/granete_for_sketchup/metadata/store'
require_relative '../../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../../src/granete_for_sketchup/migration/scanner'
require_relative '../../../src/granete_for_sketchup/migration/migrator'
require_relative '../../support/legacy_model_builder'

# #416 — batch migrator. Pins the safety pipeline of the issue: authoritative
# pre-flight outside any operation, ONE undoable operation for the whole
# batch, source erased only after its validated replacement exists, honest
# reporting (no total success with leftovers), identity preserved verbatim.
class MigrationMigratorTest < Minitest::Test
  GOLDEN_PATH = File.expand_path('../../../../../contracts/sketchupLayoutTransform.contract.json', __dir__)

  # Duck-typed catalog provider: the migrator only needs find_definition and
  # resolved_native_layout. Layouts can be injected per definition id.
  class FakeCatalogProvider
    attr_reader :requested_resolves

    def initialize(definitions, layouts_by_id)
      @definitions = definitions
      @layouts_by_id = layouts_by_id
      @requested_resolves = []
    end

    def find_definition(definition_id)
      @definitions.find { |d| d['furniture_definition_id'] == definition_id }
    end

    def resolved_native_layout(definition_id, _parameters = {}, _choices = {})
      layout = @layouts_by_id[definition_id]
      raise layout if layout.is_a?(StandardError)

      @requested_resolves << definition_id
      layout
    end
  end

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @definition = {
      'furniture_definition_id' => 'kitchen-base-standard',
      'name' => 'Bajo estándar',
      'revisionId' => 'rev-2'
    }
    @native_layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(
      JSON.parse(File.read(GOLDEN_PATH))
    )
  end

  def migrator(provider)
    Granete::SketchUpExtension::Migration::Migrator.new(
      metadata_store: @store,
      furniture_builder: @builder,
      catalog_provider: provider
    )
  end

  def provider_with_layout
    FakeCatalogProvider.new([@definition], { 'kitchen-base-standard' => @native_layout })
  end

  def scan
    Granete::SketchUpExtension::Migration::Scanner.new(metadata_store: @store).scan(@model)
  end

  def groups
    @model.active_entities.groups
  end

  def instances
    @model.active_entities.instances
  end

  def operation_names
    @model.operations.filter_map { |frame| frame.is_a?(Array) && frame[0] == :start ? frame[1] : nil }
  end

  # ── happy path ────────────────────────────────────────────────────────────

  def test_successful_batch_migrates_in_one_operation_preserving_identity_and_transform
    placement = Geom::Transformation.translation(Geom::Vector3d.new(120.0, 40.0, 35.0))
    legacy = Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-keep',
                      parameters: { 'widthMm' => 600 }, material_choices: { 'FRENTE' => 'mat-a' },
                      transform: placement
    )

    report = migrator(provider_with_layout).migrate(@model, scan)

    assert report['success'], report.inspect
    assert report['allMigrated']
    assert_equal 1, report['migratedCount']
    assert_equal 0, report['remainingLegacyCount']

    # One coherent undo step for the whole batch (policy documented in #416).
    assert_equal ['Migrar 1 mueble a representación nativa'], operation_names

    # Legacy source replaced by a native ComponentInstance hierarchy.
    refute groups.include?(legacy)
    assert_equal 1, instances.length
    native = instances.first
    assert_kind_of Sketchup::ComponentInstance, native
    assert native.definition.entities.to_a.length.positive?

    # World placement preserved exactly.
    assert_equal placement, native.transformation

    # Identity preserved verbatim — a representation change NEVER allocates
    # new business identity (negative proof: instanceRef unchanged, and no
    # Project furnitureInstanceId is invented).
    metadata = @store.read(native)
    assert_equal 'inst-keep', metadata.dig('identity', 'instanceRef')
    assert_nil metadata.dig('identity', 'furnitureInstanceId')
    assert_equal 'kitchen-base-standard', metadata.dig('intent', 'furnitureDefinitionId')
    assert_equal({ 'FRENTE' => 'mat-a' }, metadata.dig('intent', 'materialChoices'))
    assert_equal({ 'widthMm' => 600 }, metadata.dig('intent', 'parameters'))

    # Migration provenance marker retained (#416 step 6).
    assert_equal({ 'from' => 'legacy-group', 'markerVersion' => 1 },
                 metadata.dig('provenance', 'representationMigration'))

    # AC8: a post-migration scan finds nothing legacy → save/reopen stays quiet.
    refute scan.any_legacy?
  end

  def test_batch_of_two_migrates_all_in_one_operation
    2.times do |index|
      Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
        @model, @store, definition: @definition, instance_ref: "inst-#{index}", parameters: {}
      )
    end

    report = migrator(provider_with_layout).migrate(@model, scan)

    assert report['allMigrated']
    assert_equal 2, report['migratedCount']
    assert_equal ['Migrar 2 muebles a representación nativa'], operation_names
    assert_empty groups
    assert_equal 2, instances.length
    refs = instances.map { |i| @store.read(i).dig('identity', 'instanceRef') }.sort
    assert_equal %w[inst-0 inst-1], refs
  end

  # ── pre-flight demotions (source untouched, outside the operation) ────────

  def test_definition_not_found_demotes_item_and_leaves_source_intact
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-gone', parameters: {}
    )
    empty_provider = FakeCatalogProvider.new([], {})

    report = migrator(empty_provider).migrate(@model, scan)

    refute report['success']
    refute report['allMigrated']
    assert_equal 0, report['migratedCount']
    assert_equal 1, report['remainingLegacyCount']
    assert_equal 'definition-not-found', report['requiresReview'].first['reason']
    assert_equal 1, groups.length
    assert_empty operation_names
  end

  def test_resolve_unavailable_demotes_item_without_host_mutation
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-offline', parameters: {}
    )
    nil_provider = FakeCatalogProvider.new([@definition], { 'kitchen-base-standard' => nil })

    report = migrator(nil_provider).migrate(@model, scan)

    assert_equal 'resolve-unavailable', report['requiresReview'].first['reason']
    assert_equal 1, groups.length
    assert_empty instances
    assert_empty operation_names
  end

  def test_partial_batch_reports_honestly_and_never_claims_total_success
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-ok', parameters: {}
    )
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-bad', parameters: {}
    )
    provider = FakeCatalogProvider.new([@definition], { 'kitchen-base-standard' => @native_layout })

    scan_result = scan
    # Force only one item to resolve: simulate a catalog where the second
    # lookup fails by demoting it after the scan, before migrate.
    scan_result.ready.select { |e| e.instance_ref == 'inst-bad' }.each do |e|
      e.state = Granete::SketchUpExtension::Migration::STATE_REQUIRES_REVIEW
      e.reason = 'resolve-failed'
    end

    report = migrator(provider).migrate(@model, scan_result)

    # AC10: committed batch, but the summary can never read as total success.
    assert report['success']
    refute report['allMigrated']
    assert_equal 1, report['migratedCount']
    assert_equal 1, report['remainingLegacyCount']
    assert_equal 1, groups.length
    assert_match(/inst-bad/, groups.first.name)
  end

  # ── in-operation failure → total abort, all sources intact ───────────────

  def test_in_operation_failure_aborts_the_whole_batch_leaving_sources_intact
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-a', parameters: {}
    )
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-b', parameters: {}
    )
    exploding_builder = Object.new
    exploding_builder.define_singleton_method(:build_migrated_furniture) do |*_args|
      raise 'boom inside the operation'
    end
    migrator = Granete::SketchUpExtension::Migration::Migrator.new(
      metadata_store: @store,
      furniture_builder: exploding_builder,
      catalog_provider: provider_with_layout
    )

    report = migrator.migrate(@model, scan)

    # Honest total failure: nothing migrated, abort flagged, sources intact.
    refute report['success']
    assert report['aborted']
    assert_equal 0, report['migratedCount']
    assert_equal 'batch-aborted', report['reason']
    assert_equal 2, groups.length
    assert_empty instances
    # The aborted operation stays in the journal; its mutations were rolled back.
    assert_equal :abort, @model.operations.last
  end

  def test_source_is_never_erased_before_its_replacement_validates
    legacy = Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-validate', parameters: {}
    )
    # Builder whose build succeeds but whose validation gate fails: the
    # migrator must abort before erasing the legacy Group.
    invalid_builder = Object.new
    invalid_builder.define_singleton_method(:build_migrated_furniture) do |*_args|
      raise 'migración: el layout resuelto no produjo componentes'
    end
    migrator = Granete::SketchUpExtension::Migration::Migrator.new(
      metadata_store: @store,
      furniture_builder: invalid_builder,
      catalog_provider: provider_with_layout
    )

    report = migrator.migrate(@model, scan)

    refute report['success']
    assert groups.include?(legacy)
    assert_equal 'inst-validate', @store.read(legacy).dig('identity', 'instanceRef')
  end

  # Negative proof: arbitrary user groups are never touched by a batch that
  # migrates Granete-marked entities.
  def test_arbitrary_user_groups_survive_a_migration_batch
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-mine', parameters: {}
    )
    user_group = @model.active_entities.add_group
    user_group.name = 'Marcos de ventana del cliente'

    report = migrator(provider_with_layout).migrate(@model, scan)

    assert report['allMigrated']
    assert_equal [user_group], groups
    assert_equal 'Marcos de ventana del cliente', groups.first.name
  end

  # Negative proof: identity never derives from the entity's own name — the
  # migrator reads it from the namespaced metadata only.
  def test_identity_does_not_follow_the_legacy_display_name
    legacy = Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: 'inst-real-id', parameters: {}
    )
    legacy.name = 'otro nombre totalmente distinto'

    migrator(provider_with_layout).migrate(@model, scan)

    native = instances.first
    assert_equal 'inst-real-id', @store.read(native).dig('identity', 'instanceRef')
  end
end

# #416 — provenance marker envelope validation (Metadata::Store contract).
class MigrationProvenanceMetadataTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @group = @model.active_entities.add_group
  end

  def envelope(payload)
    {
      'namespace' => Granete::SketchUpExtension::Metadata::Store::NAMESPACE,
      'metadataVersion' => 1,
      'kind' => 'furnitureInstance',
      'identity' => { 'instanceRef' => 'inst-p', 'projectRef' => 'project-x' },
      'intent' => { 'semanticRole' => 'furniture-instance' }
    }.merge(payload)
  end

  def test_accepts_the_legacy_group_provenance_marker
    @store.write(@group, envelope('provenance' => {
                                    'representationMigration' => { 'from' => 'legacy-group', 'markerVersion' => 1 }
                                  }))
    assert_equal 'legacy-group', @store.read(@group).dig('provenance', 'representationMigration', 'from')
  end

  def test_rejects_unknown_provenance_source
    error = assert_raises Granete::SketchUpExtension::Metadata::InvalidMetadataError do
      @store.write(@group, envelope('provenance' => {
                                      'representationMigration' => { 'from' => 'somewhere-else', 'markerVersion' => 1 }
                                    }))
    end
    assert_match(/from must be one of/, error.message)
  end

  def test_rejects_wrong_marker_version
    error = assert_raises Granete::SketchUpExtension::Metadata::InvalidMetadataError do
      @store.write(@group, envelope('provenance' => {
                                      'representationMigration' => { 'from' => 'legacy-group', 'markerVersion' => 2 }
                                    }))
    end
    assert_match(/markerVersion must equal 1/, error.message)
  end

  def test_provenance_survives_a_later_native_edit
    definition = { 'furniture_definition_id' => 'd', 'name' => 'N', 'revisionId' => 'r' }
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, @group, 'inst-p', definition, {}, migrated_from: 'legacy-group'
    )
    # A later edit rewrites metadata from the existing payload — historical
    # provenance is retained, not dropped.
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, @group, 'inst-p', definition, { 'widthMm' => 800 },
      existing_metadata: @store.read(@group)
    )
    assert_equal 'legacy-group', @store.read(@group).dig('provenance', 'representationMigration', 'from')
  end
end
