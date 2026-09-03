# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/connection/duplicate_resolver'
require_relative '../../src/granete_for_sketchup/observers/entities_observer'

# #391 / DT-7 — Detect and resolve duplicated managed furniture identity in SketchUp.
# Test suite covering all 9 negative proofs, server authority, idempotency,
# working-copy sync, and publish precheck validation.
class DuplicateResolverTest < Minitest::Test
  MB = Granete::SketchUpExtension::Connection::ModelBinding
  PF = Granete::SketchUpExtension::Connection::ProjectFurniture
  MS = Granete::SketchUpExtension::Metadata::Store
  DR = Granete::SketchUpExtension::Connection::DuplicateResolver

  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  PROJECT_B_ID = '41000000-0000-0000-0000-000000000002'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'

  FI_1 = '51000000-0000-0000-0000-0000000000f1'
  FI_2 = '51000000-0000-0000-0000-0000000000f2'
  FI_3 = '51000000-0000-0000-0000-0000000000f3'

  class TestModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  class FakeService
    attr_accessor :duplicate_calls, :duplicate_idempotency_keys, :working_copy,
                  :duplicate_error, :update_working_copy_error

    def initialize(working_copy: nil)
      @duplicate_calls = []
      @duplicate_idempotency_keys = []
      @working_copy = working_copy || PF::Contract::WorkingCopy.new(
        design_id: DESIGN_ID,
        base_revision_id: REVISION_R1,
        items: []
      )
      @duplicate_error = nil
      @update_working_copy_error = nil
      @instances_by_id = {}
    end

    def register_instance(instance)
      @instances_by_id[instance.id] = instance
    end

    def list_project_furniture(project_id)
      @instances_by_id.values.select { |i| i.project_id == project_id }
    end

    def duplicate_furniture_instance(project_id, instance_id, idempotency_key: nil)
      @duplicate_calls << [project_id, instance_id]
      @duplicate_idempotency_keys << idempotency_key if idempotency_key

      raise @duplicate_error if @duplicate_error

      # Idempotency replay simulation
      return @instances_by_id[idempotency_key] if idempotency_key && @instances_by_id[idempotency_key]

      next_id = @duplicate_calls.length == 1 ? FI_2 : FI_3
      instance = PF::Contract::Instance.new(
        id: next_id,
        project_id: project_id,
        furniture_definition_id: DEFINITION_ID,
        origin: 'duplicate',
        lifecycle_status: 'active'
      )
      @instances_by_id[idempotency_key] = instance if idempotency_key
      @instances_by_id[next_id] = instance
      instance
    end

    def get_working_copy(_design_id)
      @working_copy
    end

    def update_working_copy(design_id, items:, base_revision_id:)
      raise @update_working_copy_error if @update_working_copy_error

      @working_copy = PF::Contract::WorkingCopy.new(
        design_id: design_id,
        base_revision_id: base_revision_id,
        items: items
      )
    end
  end

  def setup
    @model = TestModel.new
    SketchupStub.active_model = @model

    # Set up active model binding to PROJECT_ID, DESIGN_ID
    binding = MB::Binding.new(
      project_id: PROJECT_ID,
      design_id: DESIGN_ID,
      base_revision_id: REVISION_R1
    )
    MB::Store.new(@model).write!(binding)

    @binding_store = MB::Store.new(@model)
    @model_binding_service = Object.new
    def @model_binding_service.validate(*)
      MB::Contract::Validation.new(
        state: 'valid',
        schema_version: 1,
        organization: { 'id' => '10000000-0000-0000-0000-00000000000a', 'name' => 'Carpintería García' },
        project: { 'id' => PROJECT_ID, 'name' => 'Cocina García' },
        design: { 'id' => DESIGN_ID, 'name' => 'Cocina principal', 'status' => 'active' },
        working_copy: { 'base_revision_id' => REVISION_R1, 'base_revision_number' => 1 },
        capabilities: { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
      )
    end

    @metadata_store = MS.new(@model)
    @service = FakeService.new
    @service.register_instance(
      PF::Contract::Instance.new(
        id: FI_1,
        project_id: PROJECT_ID,
        furniture_definition_id: DEFINITION_ID,
        origin: 'design',
        lifecycle_status: 'active'
      )
    )
    @service.register_instance(
      PF::Contract::Instance.new(
        id: FI_2,
        project_id: PROJECT_ID,
        furniture_definition_id: DEFINITION_ID,
        origin: 'design',
        lifecycle_status: 'active'
      )
    )

    @resolver = DR.new(
      model_provider: -> { @model },
      binding_store_factory: -> { @binding_store },
      model_binding_service: @model_binding_service,
      service: @service,
      metadata_store_factory: ->(m) { MS.new(m) },
      logger: Granete::SketchUpExtension::SafeLogger.new
    )
  end

  def teardown
    SketchupStub.active_model = nil
  end

  # Helper to create a placed furniture instance in the model
  def create_managed_instance(furniture_instance_id:, project_id: PROJECT_ID, design_id: DESIGN_ID)
    definition = @model.definitions.add("Gabinete #{furniture_instance_id}")
    transform = Geom::Transformation.new
    instance = @model.entities.add_instance(definition, transform)

    metadata = {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'furnitureInstance',
      'identity' => {
        'instanceRef' => furniture_instance_id,
        'furnitureInstanceId' => furniture_instance_id,
        'furnitureDefinitionId' => DEFINITION_ID,
        'projectId' => project_id,
        'designId' => design_id,
        'origin' => 'design'
      },
      'intent' => {
        'parameters' => { 'ancho' => 600 },
        'materialChoices' => {}
      }
    }
    @metadata_store.write(instance, metadata)
    instance
  end

  # Proof 1: Simple copy detection and resolution
  def test_simple_copy_creates_new_backend_id_and_rewrites_copy_only
    original = create_managed_instance(furniture_instance_id: FI_1)
    orig_pid = original.persistent_id.to_s

    # Seed working copy with the original entity
    orig_item = PF::Contract::WorkingItem.new(
      furniture_instance_id: FI_1,
      transform: { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] },
      technical_client_locator: PF::ManagedFurniture.persistent_locator(original),
      parameters: { 'ancho' => 600 }
    )
    @service.working_copy.items << orig_item

    # User performs Move+Copy in SketchUp: creates a second instance with the same definition and copied metadata
    copy = create_managed_instance(furniture_instance_id: FI_1)
    copy_pid = copy.persistent_id.to_s
    refute_equal orig_pid, copy_pid

    # Duplicate detected
    duplicates = @resolver.scan_duplicates(@model)
    assert_equal 1, duplicates.length
    assert_equal [original, copy].sort_by(&:persistent_id), duplicates[FI_1].sort_by(&:persistent_id)

    # Resolve duplicates
    result = @resolver.rescan_and_resolve(@model)
    assert result['ok'], "Resolution failed: #{result}"
    assert_equal 1, result['resolved']

    # Original preserved: still FI_1
    orig_meta = @metadata_store.read(original)
    assert_equal FI_1, orig_meta['identity']['furnitureInstanceId']
    assert_equal 'design', orig_meta['identity']['origin']

    # Copy receives NEW authoritative backend ID (FI_2)
    copy_meta = @metadata_store.read(copy)
    assert_equal FI_2, copy_meta['identity']['furnitureInstanceId']
    assert_equal 'duplicate', copy_meta['identity']['origin']
    assert_equal FI_1, copy_meta['identity']['originFurnitureInstanceId']

    # Backend was called with deterministic idempotency key
    assert_equal 1, @service.duplicate_calls.length
    assert_equal [PROJECT_ID, FI_1], @service.duplicate_calls.first
    expected_key = "dup:#{PROJECT_ID}:#{DESIGN_ID}:#{FI_1}:#{copy_pid}"
    assert_equal expected_key, @service.duplicate_idempotency_keys.first

    # WorkingCopy has both units
    wc_items = @service.working_copy.items
    assert_equal 2, wc_items.length
    assert(wc_items.any? { |i| i.furniture_instance_id == FI_1 })
    assert(wc_items.any? { |i| i.furniture_instance_id == FI_2 })
  end

  # Proof 2: Repeated callback idempotency
  def test_repeated_resolution_is_idempotent
    _original = create_managed_instance(furniture_instance_id: FI_1)
    copy = create_managed_instance(furniture_instance_id: FI_1)

    # First resolution
    @resolver.resolve_observed_addition(@model, copy)
    assert_equal 1, @service.duplicate_calls.length
    copy_meta = @metadata_store.read(copy)
    assert_equal FI_2, copy_meta['identity']['furnitureInstanceId']

    # Subsequent check: no duplicate remains
    duplicates = @resolver.scan_duplicates(@model)
    assert_empty duplicates
  end

  # Proof 3: Original preserves its ID
  def test_original_preserves_its_id_and_metadata
    original = create_managed_instance(furniture_instance_id: FI_1)
    original.name = 'Gabinete FI-1'
    copy = create_managed_instance(furniture_instance_id: FI_1)

    @resolver.resolve_observed_addition(@model, copy)

    orig_meta = @metadata_store.read(original)
    assert_equal FI_1, orig_meta['identity']['furnitureInstanceId']
    assert_equal 'Gabinete FI-1', original.name
  end

  # Proof 4: Server failure leaves local copy in explicit unresolved state
  def test_server_failure_leaves_copy_unresolved_without_deleting_it
    _original = create_managed_instance(furniture_instance_id: FI_1)
    copy = create_managed_instance(furniture_instance_id: FI_1)

    # Simulate network failure / 500
    @service.duplicate_error = StandardError.new('500 Internal Server Error')

    result = @resolver.resolve_observed_addition(@model, copy)
    refute result['ok']

    # Copy is NOT deleted
    assert @model.entities.include?(copy)

    # Copy has unresolved duplicate marker
    copy_meta = @metadata_store.read(copy)
    assert_equal 'unresolved', copy_meta['identity']['duplicateStatus']
    assert_equal FI_1, copy_meta['identity']['duplicateSourceInstanceId']

    # Publish precheck fails
    precheck = @resolver.validate_model(@model)
    refute precheck['valid']
  end

  # Proof 5: Reopen duplicate rescan
  def test_reopen_duplicate_rescan_resolves_using_working_copy_evidence
    original = create_managed_instance(furniture_instance_id: FI_1)
    copy = create_managed_instance(furniture_instance_id: FI_1)

    # Seed working copy with original locator
    orig_item = PF::Contract::WorkingItem.new(
      furniture_instance_id: FI_1,
      transform: { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] },
      technical_client_locator: PF::ManagedFurniture.persistent_locator(original)
    )
    @service.working_copy.items << orig_item

    # Model open rescan
    result = @resolver.rescan_and_resolve(@model)
    assert result['ok']
    assert_equal 1, result['resolved']

    assert_equal FI_1, @metadata_store.read(original)['identity']['furnitureInstanceId']
    assert_equal FI_2, @metadata_store.read(copy)['identity']['furnitureInstanceId']
  end

  # Proof 6: Save / reopen resolved does NOT create extra instances
  def test_save_reopen_resolved_does_not_create_extra_instances
    _original = create_managed_instance(furniture_instance_id: FI_1)
    _copy = create_managed_instance(furniture_instance_id: FI_2) # already resolved

    duplicates = @resolver.scan_duplicates(@model)
    assert_empty duplicates

    result = @resolver.rescan_and_resolve(@model)
    assert result['ok']
    assert_equal 0, result['resolved']
    assert_empty @service.duplicate_calls
  end

  # Proof 7: Random / invented UUID detection in publish precheck
  def test_validate_model_detects_random_or_fake_uuid
    _instance = create_managed_instance(furniture_instance_id: 'fake-locally-invented-id')

    precheck = @resolver.validate_model(@model)
    refute precheck['valid']
    assert_equal 'invalid_furniture_identity', precheck['code']
  end

  # Proof 8: Cross-project duplicate rejected in publish precheck
  def test_validate_model_detects_foreign_project_identity
    _instance = create_managed_instance(furniture_instance_id: FI_1, project_id: PROJECT_B_ID)

    precheck = @resolver.validate_model(@model)
    refute precheck['valid']
    assert_equal 'foreign_project_identity', precheck['code']
  end

  # Proof 9: ComponentDefinition is NOT identity
  def test_component_definition_is_not_identity
    definition = @model.definitions.add('Shared Definition Standard')
    inst1 = @model.entities.add_instance(definition, Geom::Transformation.new)
    inst2 = @model.entities.add_instance(definition, Geom::Transformation.new)

    @metadata_store.write(inst1, {
                            'namespace' => 'com.granete.sketchup_extension',
                            'metadataVersion' => 1,
                            'kind' => 'furnitureInstance',
                            'identity' => { 'instanceRef' => FI_1, 'furnitureInstanceId' => FI_1,
                                            'projectId' => PROJECT_ID }
                          })
    @metadata_store.write(inst2, {
                            'namespace' => 'com.granete.sketchup_extension',
                            'metadataVersion' => 1,
                            'kind' => 'furnitureInstance',
                            'identity' => { 'instanceRef' => FI_2, 'furnitureInstanceId' => FI_2,
                                            'projectId' => PROJECT_ID }
                          })

    duplicates = @resolver.scan_duplicates(@model)
    assert_empty duplicates

    precheck = @resolver.validate_model(@model)
    assert precheck['valid']
  end

  # Proof 10: Ambiguous duplicate without locator evidence marks both unresolved
  def test_ambiguous_duplicate_without_locator_evidence_marks_unresolved
    inst1 = create_managed_instance(furniture_instance_id: FI_1)
    inst2 = create_managed_instance(furniture_instance_id: FI_1)

    # Empty working copy — no locator evidence
    @service.working_copy = PF::Contract::WorkingCopy.new(
      design_id: DESIGN_ID,
      base_revision_id: REVISION_R1,
      items: []
    )

    result = @resolver.rescan_and_resolve(@model)
    assert result['ok']
    assert_equal 0, result['resolved']

    # Both marked unresolved, no guessing
    assert_equal 'unresolved', @metadata_store.read(inst1)['identity']['duplicateStatus']
    assert_equal 'unresolved', @metadata_store.read(inst2)['identity']['duplicateStatus']

    precheck = @resolver.validate_model(@model)
    refute precheck['valid']
  end

  # Proof 11: EntitiesObserver integration
  def test_entities_observer_dispatches_to_resolver
    observer = Granete::SketchUpExtension::Observers::EntitiesObserver.new(
      duplicate_resolver: @resolver,
      model_provider: -> { @model }
    )

    _original = create_managed_instance(furniture_instance_id: FI_1)
    copy = create_managed_instance(furniture_instance_id: FI_1)

    observer.onElementAdded(@model.entities, copy)

    copy_meta = @metadata_store.read(copy)
    assert_equal FI_2, copy_meta['identity']['furnitureInstanceId']
    assert_equal 'duplicate', copy_meta['identity']['origin']
  end

  # Proof 12: Syntactically valid but unknown backend UUID rejected in precheck (#391 / DT-7)
  def test_validate_model_rejects_syntactically_valid_but_unknown_backend_uuid
    unknown_uuid = '51000000-aaaa-bbbb-cccc-999999999999'
    create_managed_instance(furniture_instance_id: unknown_uuid)

    precheck = @resolver.validate_model(@model)
    refute precheck['valid'], 'precheck must reject unknown backend furniture identity'
    assert_equal 'unknown_furniture_identity', precheck['code']
    assert precheck['unknown_ids'].include?(unknown_uuid)
  end

  # Proof 13: WorkingCopy sync failure leaves FI allocated and unsynced, retry preserves ID
  def test_working_copy_sync_failure_leaves_fi_allocated_and_unsynced_and_retry_preserves_id
    _original = create_managed_instance(furniture_instance_id: FI_1)
    copy = create_managed_instance(furniture_instance_id: FI_1)

    # 1. Backend duplicate succeeds (allocating FI_2), but WorkingCopy PUT fails
    @service.update_working_copy_error = StandardError.new('WorkingCopy PUT failed: 503 Unavailable')

    result = @resolver.resolve_observed_addition(@model, copy)
    refute result['ok']
    assert_equal 'working_copy_unsynced', result['code']

    # Copy has server-authoritative FI_2 (NOT deleted, NOT recycled, NOT reverted to FI_1)
    copy_meta = @metadata_store.read(copy)
    assert_equal FI_2, copy_meta['identity']['furnitureInstanceId']
    assert_equal 'duplicate', copy_meta['identity']['origin']
    assert_equal FI_1, copy_meta['identity']['originFurnitureInstanceId']
    assert_equal 'working_copy_unsynced', copy_meta['identity']['duplicateStatus']

    # Publish precheck is BLOCKED
    precheck = @resolver.validate_model(@model)
    refute precheck['valid'], 'publish precheck must block working_copy_unsynced state'
    assert_equal 'working_copy_unsynced', precheck['code']

    # 2. Retry: WorkingCopy PUT recovers. Must NOT call duplicate endpoint again to mint FI_3!
    @service.update_working_copy_error = nil
    assert_equal 1, @service.duplicate_calls.length

    retry_result = @resolver.rescan_and_resolve(@model)
    assert retry_result['ok']
    assert_equal 1, retry_result['resolved']

    # NO second duplicate backend call:
    assert_equal 1, @service.duplicate_calls.length, 'must NOT mint a third FI on retry'

    # Unsynced marker cleared, business ID stays FI_2
    copy_meta = @metadata_store.read(copy)
    assert_equal FI_2, copy_meta['identity']['furnitureInstanceId']
    assert_nil copy_meta['identity']['duplicateStatus']

    # WorkingCopy contains FI_2
    wc_items = @service.working_copy.items
    assert(wc_items.any? { |i| i.furniture_instance_id == FI_2 })

    # Model now passes precheck
    assert @resolver.validate_model(@model)['valid']
  end

  # Proof 14: Duplicate WorkingCopy item preserves complete authoring snapshot
  def test_duplicate_working_copy_item_preserves_complete_authoring_snapshot
    original = create_managed_instance(furniture_instance_id: FI_1)

    # Seed source WorkingCopy item with complete authoring state
    source_params = { 'width' => 900, 'depth' => 600, 'drawers' => 4 }
    source_materials = { 'front' => 'natural-oak', 'carcass' => 'graphite' }
    orig_item = PF::Contract::WorkingItem.new(
      furniture_instance_id: FI_1,
      furniture_definition_id: 'def-kitchen-island',
      definition_version: 7,
      room_id: 'room-main-kitchen',
      parameters: source_params,
      material_choices: source_materials,
      transform: { 'translation_mm' => [100.0, 200.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] },
      technical_client_locator: PF::ManagedFurniture.persistent_locator(original)
    )
    @service.working_copy.items << orig_item

    copy = create_managed_instance(furniture_instance_id: FI_1)
    copy.transformation = Geom::Transformation.new

    result = @resolver.rescan_and_resolve(@model)
    assert result['ok']

    # Inspect the duplicate working copy item
    copy_item = @service.working_copy.items.find { |i| i.furniture_instance_id == FI_2 }
    assert copy_item, 'copy item must exist in working copy'

    # Preserves authoring snapshot from source
    assert_equal 'def-kitchen-island', copy_item.furniture_definition_id
    assert_equal 7, copy_item.definition_version
    assert_equal 'room-main-kitchen', copy_item.room_id
    assert_equal source_params, copy_item.parameters
    assert_equal source_materials, copy_item.material_choices

    # Identity differs
    assert_equal FI_2, copy_item.furniture_instance_id
    refute_equal orig_item.technical_client_locator, copy_item.technical_client_locator
  end

  # Proof 15: Fail-closed precheck when service is unavailable (#391 / DT-7 hardening)
  def test_validate_model_fail_closed_when_service_unavailable
    create_managed_instance(furniture_instance_id: FI_1)

    # Case A: When service is nil
    resolver_without_service = DR.new(
      model_provider: -> { @model },
      binding_store_factory: -> { @binding_store },
      model_binding_service: @model_binding_service,
      service: nil,
      metadata_store_factory: ->(m) { MS.new(m) },
      logger: Granete::SketchUpExtension::SafeLogger.new
    )
    precheck = resolver_without_service.validate_model(@model)
    refute precheck['valid'], 'precheck must be fail-closed when service is unavailable'
    assert_equal 'backend_verification_failed', precheck['code']

    # Case B: When service.list_project_furniture raises an error (e.g. backend down / 500)
    service_with_error = Object.new
    def service_with_error.list_project_furniture(_project_id)
      raise StandardError, 'backend unreachable'
    end

    precheck_err = @resolver.validate_model(@model, service: service_with_error)
    refute precheck_err['valid'], 'precheck must be fail-closed when backend query fails'
    assert_equal 'backend_verification_failed', precheck_err['code']
  end
end
