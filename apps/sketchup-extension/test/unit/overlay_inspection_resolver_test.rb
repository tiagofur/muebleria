# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'

# #470: the read-only inspection resolve — the request mirrors the mutation
# flow's authoring intent (definition + pinned revision + persisted
# parameters/choices + occurrence identities + MANUAL hardware placements
# only), with fresh #498 correlation, and no edit applied.
class OverlayInspectionResolverTest < Minitest::Test
  Overlay = Granete::SketchUpExtension::Overlay

  def setup
    SketchupStub.reset!
    @model = OverlayFixture.build_model
    @provider = OverlayFixture::FakeCatalogProvider.new(
      extra_hardware: [
        { 'placementId' => 'rel-shelf-01:dhp-side-side-left-01', 'placementKind' => 'derived',
          'hardwareId' => 'hw-minifix', 'hostComponentInstanceId' => 'side-left-01',
          'anchorFace' => 'front', 'offsetMm' => [50, 150] }
      ]
    )
    @resolver = Overlay::InspectionResolver.new(
      catalog_provider: @provider,
      metadata_store_factory: ->(m) { Granete::SketchUpExtension::Metadata::Store.new(m) }
    )
    @root = OverlayFixture.furniture_root(@model)
  end

  def test_resolve_returns_an_accepted_result_with_fresh_correlation
    resolved = @resolver.resolve(furniture_entity: @root, model: @model)

    assert resolved[:result].accepted?
    assert_equal 6, resolved[:result].operations.length
    assert resolved[:result].manufacturing_fingerprint.start_with?('sha256-')
    assert resolved[:message_id].start_with?('mut-')
    assert_equal resolved[:result].in_reply_to_message_id, resolved[:message_id]
  end

  def test_request_carries_the_full_current_authoring_intent
    @resolver.resolve(furniture_entity: @root, model: @model)
    request = @provider.requests.last
    furniture = request['furniture']

    assert_equal OverlayFixture::DEFINITION_ID, furniture['furnitureDefinitionId']
    assert_equal 'rev-overlay-test', furniture['catalogRevision']
    assert_equal OverlayFixture::PARAMETERS, furniture['parameters']
    assert_equal 7, furniture['components'].length
    assert(furniture['components'].all? { |component| component.key?('componentInstanceId') })
  end

  def test_derived_placements_are_never_echoed_as_manual_intent
    @resolver.resolve(furniture_entity: @root, model: @model)
    furniture = @provider.requests.last['furniture']
    placement_ids = furniture['hardwarePlacements'].map { |placement| placement['hardwarePlacementId'] }

    assert_includes placement_ids, 'hp-hinge-01'
    refute_includes placement_ids, 'rel-shelf-01:dhp-side-side-left-01',
                    'derived placements are re-derived server-side, never echoed'
  end

  def test_local_catalog_without_authoring_resolve_is_an_honest_error
    def @provider.resolve_authoring(_request); end

    error = assert_raises Granete::SketchUpExtension::Library::AuthoringResolveError do
      @resolver.resolve(furniture_entity: @root, model: @model)
    end
    assert_match 'catálogo local', error.message
  end

  def test_missing_definition_blocks_inspection_never_guesses
    def @provider.find_definition(_id); end

    error = assert_raises Granete::SketchUpExtension::Library::AuthoringResolveError do
      @resolver.resolve(furniture_entity: @root, model: @model)
    end
    assert_match 'definición', error.message
  end

  def test_no_layout_available_blocks_inspection_never_falls_back_to_geometry
    def @provider.resolved_native_layout(*); end

    error = assert_raises Granete::SketchUpExtension::Library::AuthoringResolveError do
      @resolver.resolve(furniture_entity: @root, model: @model)
    end
    assert_match 'composición', error.message
  end

  def test_request_includes_relationships_from_metadata_when_present
    stored_relationships = [
      {
        'relationshipId' => 'parameter-shelfCount-1',
        'kind' => 'shelf-support',
        'source' => { 'componentInstanceId' => 'shelf-01', 'role' => 'shelf-board' },
        'targets' => [
          { 'componentInstanceId' => 'side-left-01', 'role' => 'inside-face' },
          { 'componentInstanceId' => 'side-right-01', 'role' => 'inside-face' }
        ]
      }
    ]
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    existing = store.read(@root) || {}
    existing['relationships'] = stored_relationships
    store.write(@root, existing)

    @resolver.resolve(furniture_entity: @root, model: @model)
    furniture = @provider.requests.last['furniture']

    assert_equal stored_relationships, furniture['relationships'],
                 'inspection request must echo persisted relationships from metadata'
  end

  def test_request_omits_relationships_when_metadata_has_none
    @resolver.resolve(furniture_entity: @root, model: @model)
    furniture = @provider.requests.last['furniture']

    refute furniture.key?('relationships'),
           'inspection request must not include relationships key when metadata has none'
  end

  def test_stale_catalog_revision_refetches_once_and_retries_with_the_fresh_pin
    stale = stale_rejection
    attempts = 0
    refreshes = 0
    @provider.define_singleton_method(:catalog_revision) do
      attempts.zero? ? 'rev-overlay-test' : 'rev-overlay-fresh'
    end
    @provider.define_singleton_method(:refresh!) { refreshes += 1 }
    @provider.define_singleton_method(:resolve_authoring) do |request_payload|
      @requests << request_payload
      attempts += 1
      raise stale if attempts == 1

      OverlayFixture.accepted_result(
        message_id: request_payload['messageId'],
        idempotency_key: request_payload['idempotencyKey']
      )
    end

    resolved = @resolver.resolve(furniture_entity: @root, model: @model)

    assert resolved[:result].accepted?
    assert_equal 1, refreshes, 'a stale pin must refetch the catalog exactly once'
    assert_equal 2, @provider.requests.length
    assert_equal 'rev-overlay-test', @provider.requests.first['furniture']['catalogRevision']
    assert_equal 'rev-overlay-fresh', @provider.requests.last['furniture']['catalogRevision'],
                 'the retry must pin the fresh revision, never re-send the stale one'
  end

  def test_persistent_stale_after_one_refetch_propagates_the_rejection
    stale = stale_rejection
    @provider.define_singleton_method(:refresh!) { nil }
    @provider.define_singleton_method(:resolve_authoring) do |request_payload|
      @requests << request_payload
      raise stale
    end

    error = assert_raises Granete::SketchUpExtension::Library::AuthoringResolveError do
      @resolver.resolve(furniture_entity: @root, model: @model)
    end

    assert_equal 2, @provider.requests.length, 'exactly one retry, no retry loops'
    assert(error.issues.any? { |issue| issue.code == 'CATALOG_REVISION_STALE' })
  end

  def test_non_stale_rejection_never_refetches_or_retries
    @provider.define_singleton_method(:refresh!) { flunk 'refresh! must not run for other rejections' }
    rejection = Granete::SketchUpExtension::Library::AuthoringResolveError.new(
      'parámetro inválido',
      status: 422,
      issues: [Granete::SketchUpExtension::Library::AuthoringResolveIssue.new(
        'code' => 'PARAMETER_INVALID', 'severity' => 'error',
        'message' => 'parámetro inválido'
      )]
    )
    @provider.define_singleton_method(:resolve_authoring) do |request_payload|
      @requests << request_payload
      raise rejection
    end

    assert_raises Granete::SketchUpExtension::Library::AuthoringResolveError do
      @resolver.resolve(furniture_entity: @root, model: @model)
    end
    assert_equal 1, @provider.requests.length
  end

  private

  def stale_rejection
    Granete::SketchUpExtension::Library::AuthoringResolveError.new(
      'el request fue armado contra la revisión vieja del catálogo',
      status: 422,
      issues: [Granete::SketchUpExtension::Library::AuthoringResolveIssue.new(
        'code' => 'CATALOG_REVISION_STALE', 'severity' => 'error',
        'message' => 'el request fue armado contra la revisión vieja del catálogo'
      )]
    )
  end
end
