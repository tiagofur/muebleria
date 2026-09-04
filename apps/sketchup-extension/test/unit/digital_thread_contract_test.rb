# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'tmpdir'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/identity'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/connection/duplicate_resolver'
require_relative '../../src/granete_for_sketchup/connection/design_publish'

# #398 / DT-14 — Digital Thread End-to-End Contract and Regression Suite (Ruby Client Layer).
# Validates client-side compliance with contracts/digitalThreadE2E.json:
# - Scenario A (Quote-first): Root placement, parameter fidelity, transform preservation
# - Scenario B (Quantity > 1): Placed subset in manifest, unplaced excluded
# - Scenario D (Duplicate identity): In-host duplicate detection and resolution (origin: duplicate)
# - Scenario E (Unmanaged exclusion): Raw geometry and unmanaged groups excluded from manifest
# - Invariant G7: Component Definition is not identity; nested sub-parts are not top-level roots
# - Invariant G8: Deterministic manifest serialization
# - Invariant G9: Fail-closed verification
#
# Catalog placement identity (Scenario C, design-first) is covered by
# project_furniture_test.rb (#389), which pins the placer against the real
# backend contract; this suite does not duplicate it.
class DigitalThreadContractTest < Minitest::Test
  CONTRACT_PATH = File.expand_path('../../../../contracts/digitalThreadE2E.json', __dir__)

  MB = Granete::SketchUpExtension::Connection::ModelBinding
  DP = Granete::SketchUpExtension::Connection::DesignPublish
  PF = Granete::SketchUpExtension::Connection::ProjectFurniture
  MS = Granete::SketchUpExtension::Metadata::Store
  DR = Granete::SketchUpExtension::Connection::DuplicateResolver

  class TestModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  class FakeWorkingCopyService
    attr_accessor :working_copy, :duplicate_calls, :duplicate_records

    def initialize(working_copy:)
      @working_copy = working_copy
      @duplicate_calls = []
      @duplicate_records = {}
      @instances_by_id = {}
    end

    def register_instance(instance)
      @instances_by_id[instance.id] = instance
    end

    def list_project_furniture(_project_id)
      PF::Contract::ListResponse.new(items: @instances_by_id.values)
    end

    def get_working_copy(_design_id)
      @working_copy
    end

    def duplicate_furniture_instance(project_id, instance_id, idempotency_key: nil)
      @duplicate_calls << [project_id, instance_id, idempotency_key]
      new_id = "51000000-0000-0000-0000-#{format('%012d', @duplicate_calls.length + 100)}"
      new_inst = PF::Contract::Instance.new(
        id: new_id,
        project_id: project_id,
        furniture_definition_id: 'd1000000-0000-4000-8000-000000000001',
        origin: 'duplicate',
        lifecycle_status: 'active'
      )
      @instances_by_id[new_id] = new_inst
      new_inst
    end

    def update_working_copy(design_id, items:, base_revision_id:)
      @working_copy = PF::Contract::WorkingCopy.new(
        design_id: design_id,
        base_revision_id: base_revision_id,
        items: items
      )
    end
  end

  def setup
    @contract = JSON.parse(File.read(CONTRACT_PATH))
    @project_id = @contract['canonicalEntities']['projectId']
    @design_id = '52000000-0000-4000-8000-000000000001'
    @revision_r1 = '53000000-0000-4000-8000-000000000001'

    @model = TestModel.new
    SketchupStub.active_model = @model

    @binding = MB::Binding.new(
      project_id: @project_id,
      design_id: @design_id,
      base_revision_id: @revision_r1
    )
    MB::Store.new(@model).write!(@binding)

    @metadata_store = MS.new(@model)
    @model_binding_service = Object.new
    proj_id = @project_id
    des_id = @design_id
    rev_id = @revision_r1
    @model_binding_service.define_singleton_method(:validate) do |*|
      MB::Contract::Validation.new(
        state: 'valid',
        schema_version: 1,
        organization: { 'id' => '10000000-0000-0000-0000-00000000000a', 'name' => 'Carpintería Test' },
        project: { 'id' => proj_id, 'name' => 'Project E2E' },
        design: { 'id' => des_id, 'name' => 'Design E2E', 'status' => 'active' },
        working_copy: { 'base_revision_id' => rev_id, 'base_revision_number' => 1 },
        capabilities: { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
      )
    end

    @wc_service = FakeWorkingCopyService.new(
      working_copy: PF::Contract::WorkingCopy.new(
        design_id: @design_id,
        base_revision_id: @revision_r1,
        items: []
      )
    )
  end

  def teardown
    SketchupStub.active_model = nil
  end

  # Helper to create a managed instance with full Granete metadata
  def create_managed(id:, def_id:, name: 'Cabinet', params: {}, transform: nil)
    definition = @model.definitions.add(name)
    transform ||= Geom::Transformation.new
    instance = @model.entities.add_instance(definition, transform)

    metadata = {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'furnitureInstance',
      'identity' => {
        'instanceRef' => id,
        'furnitureInstanceId' => id,
        'projectId' => @project_id,
        'designId' => @design_id,
        'definitionId' => def_id
      },
      'intent' => {
        'parameters' => params,
        'materialChoices' => {}
      }
    }
    @metadata_store.write(instance, metadata)
    instance
  end

  # Scenario A (Quote-first): Placed instances must match canonical fixture IDs and parameters
  def test_scenario_a_quote_first_contract_conformance
    sc_a = @contract['scenarios']['scenarioA_quoteFirst']
    fi_list = sc_a['furnitureInstances']
    assert_equal 2, fi_list.length

    # Create instances according to fixture
    instances = fi_list.map do |fi_spec|
      def_key = fi_spec['definitionKey']
      def_id = @contract['canonicalEntities']['definitions'][def_key]['id']
      create_managed(
        id: fi_spec['id'],
        def_id: def_id,
        name: def_key,
        params: { 'widthMm' => fi_spec['modifiedWidthMm'] }
      )
    end

    # Build manifest
    manifest = DP::ManifestBuilder.build(
      @model, @binding, @metadata_store,
      sketchup_version: '24.0.0', plugin_version: '1.0.0'
    )

    assert_equal 1, manifest['schemaVersion']
    assert_equal @design_id, manifest['designId']
    assert_equal 2, manifest['items'].length

    manifest_ids = manifest['items'].map { |entry| entry['furnitureInstanceId'] }
    assert_includes manifest_ids, fi_list[0]['id']
    assert_includes manifest_ids, fi_list[1]['id']

    # Verify parameter fidelity stored in instance metadata
    cajonero_inst = instances.find do |inst|
      @metadata_store.read(inst)['identity']['furnitureInstanceId'] == fi_list[1]['id']
    end
    assert_equal 650, @metadata_store.read(cajonero_inst)['intent']['parameters']['widthMm']
  end

  # Scenario B (Quantity > 1): Placed subset appears in manifest, unplaced omitted
  def test_scenario_b_quantity_multiple_manifest_filtering
    sc_b = @contract['scenarios']['scenarioB_quantityMultiple']
    assert_equal 3, sc_b['quoteQuantity']
    assert_equal 2, sc_b['modeledCount']

    fi_ids = %w[
      f1000000-0000-4000-8000-000000000001
      f2000000-0000-4000-8000-000000000002
      f3000000-0000-4000-8000-000000000003
    ]
    def_id = @contract['canonicalEntities']['definitions']['gabinete1p']['id']

    # Place only 2 of the 3 instances in the model
    create_managed(id: fi_ids[0], def_id: def_id, name: 'Gabinete 1')
    create_managed(id: fi_ids[1], def_id: def_id, name: 'Gabinete 2')
    # fi_ids[2] is deliberately left unplaced in model

    manifest = DP::ManifestBuilder.build(
      @model, @binding, @metadata_store,
      sketchup_version: '24.0.0', plugin_version: '1.0.0'
    )

    assert_equal 2, manifest['items'].length
    manifest_ids = manifest['items'].map { |entry| entry['furnitureInstanceId'] }
    assert_includes manifest_ids, fi_ids[0]
    assert_includes manifest_ids, fi_ids[1]
    refute_includes manifest_ids, fi_ids[2]
  end

  # Scenario D (Duplicate Identity): Duplicated instances in model flagged and resolved
  def test_scenario_d_duplicate_identity_preflight_and_resolution
    def_id = @contract['canonicalEntities']['definitions']['gabinete1p']['id']
    original_fi_id = 'f1000000-0000-4000-8000-000000000001'

    # Place original and seed working copy
    inst1 = create_managed(id: original_fi_id, def_id: def_id, name: 'Original')
    orig_meta = @metadata_store.read(inst1)
    orig_meta['identity']['origin'] = 'design'
    @metadata_store.write(inst1, orig_meta)

    orig_item = PF::Contract::WorkingItem.new(
      furniture_instance_id: original_fi_id,
      transform: { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] },
      technical_client_locator: PF::ManagedFurniture.persistent_locator(inst1),
      parameters: { 'widthMm' => 600 }
    )
    @wc_service.working_copy.items << orig_item

    # Simulate SketchUp copy: second instance referencing SAME component definition and SAME metadata
    inst2 = @model.entities.add_instance(inst1.definition, Geom::Transformation.new)
    @metadata_store.write(inst2, @metadata_store.read(inst1))

    # DuplicateResolver should detect duplicates
    resolver = DR.new(
      model_provider: -> { @model },
      binding_store_factory: -> { MB::Store.new(@model) },
      model_binding_service: @model_binding_service,
      service: @wc_service,
      metadata_store_factory: ->(m) { MS.new(m) },
      logger: Granete::SketchUpExtension::SafeLogger.new
    )

    duplicates = resolver.scan_duplicates(@model)
    assert_equal 1, duplicates.length
    assert_equal 2, duplicates[original_fi_id].length

    result = resolver.rescan_and_resolve(@model)
    assert result['ok'], "Resolution failed: #{result}"
    assert_equal 1, result['resolved']

    # Verify inst1 kept original ID, inst2 got a fresh server-allocated ID
    meta1 = @metadata_store.read(inst1)
    meta2 = @metadata_store.read(inst2)

    assert_equal original_fi_id, meta1['identity']['furnitureInstanceId']
    refute_equal original_fi_id, meta2['identity']['furnitureInstanceId']
    assert_match DR::UUID_PATTERN, meta2['identity']['furnitureInstanceId']
    assert_equal 'duplicate', meta2['identity']['origin']
    assert_equal original_fi_id, meta2['identity']['originFurnitureInstanceId']
  end

  # Scenario E (Semantic Scope / Unmanaged Exclusion): Raw geometry and unmanaged entities are ignored
  def test_scenario_e_unmanaged_geometry_exclusion
    def_id = @contract['canonicalEntities']['definitions']['gabinete1p']['id']
    managed_id = 'f1000000-0000-4000-8000-000000000001'

    # Add 1 managed instance
    create_managed(id: managed_id, def_id: def_id, name: 'Managed')

    # Add unmanaged entities: raw group, unmanaged component, loose edges/faces
    @model.entities.add_group # raw group with no metadata
    unmanaged_def = @model.definitions.add('Decoration Lamp')
    @model.entities.add_instance(unmanaged_def, Geom::Transformation.new)

    manifest = DP::ManifestBuilder.build(
      @model, @binding, @metadata_store,
      sketchup_version: '24.0.0', plugin_version: '1.0.0'
    )

    # Only the managed instance enters manifest
    assert_equal 1, manifest['items'].length
    assert_equal managed_id, manifest['items'][0]['furnitureInstanceId']
  end

  # Invariant G7: ComponentDefinition is not identity; nested subcomponents are not top-level roots
  def test_invariant_g7_nested_subcomponents_do_not_produce_root_instances
    def_id = @contract['canonicalEntities']['definitions']['gabinete1p']['id']
    root_id = 'f1000000-0000-4000-8000-000000000001'

    root_def = @model.definitions.add('Root Cabinet')
    # Add a nested subcomponent definition inside the root cabinet's entities
    sub_def = @model.definitions.add('Shelf Part')
    sub_inst = root_def.entities.add_instance(sub_def, Geom::Transformation.new)

    # Even if someone accidentally stamped metadata on a sub-part, it's not a top-level model entity
    sub_metadata = {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'furnitureInstance',
      'identity' => {
        'instanceRef' => 'sub-part-fake-id',
        'furnitureInstanceId' => 'sub-part-fake-id',
        'projectId' => @project_id,
        'designId' => @design_id
      }
    }
    @metadata_store.write(sub_inst, sub_metadata)

    # Add root to top-level model entities
    root_inst = @model.entities.add_instance(root_def, Geom::Transformation.new)
    root_metadata = {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'furnitureInstance',
      'identity' => {
        'instanceRef' => root_id,
        'furnitureInstanceId' => root_id,
        'projectId' => @project_id,
        'designId' => @design_id,
        'definitionId' => def_id
      },
      'intent' => { 'parameters' => {}, 'materialChoices' => {} }
    }
    @metadata_store.write(root_inst, root_metadata)

    manifest = DP::ManifestBuilder.build(
      @model, @binding, @metadata_store,
      sketchup_version: '24.0.0', plugin_version: '1.0.0'
    )

    # Manifest must only contain the top-level root instance, NEVER the nested sub-part
    assert_equal 1, manifest['items'].length
    assert_equal root_id, manifest['items'][0]['furnitureInstanceId']
  end

  # Invariant G8: Deterministic manifest serialization
  def test_invariant_g8_deterministic_manifest_serialization
    def_id = @contract['canonicalEntities']['definitions']['gabinete1p']['id']
    create_managed(id: 'f2000000-0000-4000-8000-000000000002', def_id: def_id, name: 'B')
    create_managed(id: 'f1000000-0000-4000-8000-000000000001', def_id: def_id, name: 'A')

    manifest1 = DP::ManifestBuilder.build(
      @model, @binding, @metadata_store,
      sketchup_version: '24.0', plugin_version: '1.0'
    )
    manifest2 = DP::ManifestBuilder.build(
      @model, @binding, @metadata_store,
      sketchup_version: '24.0', plugin_version: '1.0'
    )

    assert_equal JSON.generate(manifest1), JSON.generate(manifest2)
    assert_equal manifest1['items'], manifest2['items']
    assert_equal 2, manifest1['items'].length
  end

  # Invariant G9: Fail-closed on corrupted or unknown server session responses
  def test_invariant_g9_fail_closed_session_parser
    # Missing required keys
    assert_raises(ArgumentError) do
      DP::Contract.parse_session!('id' => '54000000-0000-0000-0000-000000000001')
    end

    # Non-UUID id
    assert_raises(ArgumentError) do
      DP::Contract.parse_session!(
        'id' => 'not-a-uuid',
        'design_id' => '52000000-0000-0000-0000-000000000001',
        'status' => 'prepared',
        'expires_at' => '2026-09-04T00:00:00Z',
        'required_artifacts' => ['model']
      )
    end

    # Unknown status
    assert_raises(ArgumentError) do
      DP::Contract.parse_session!(
        'id' => '54000000-0000-0000-0000-000000000001',
        'design_id' => '52000000-0000-0000-0000-000000000001',
        'status' => 'rogue_status',
        'expires_at' => '2026-09-04T00:00:00Z',
        'required_artifacts' => ['model']
      )
    end
  end
end
