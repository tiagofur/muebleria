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
    assert furniture['components'].all? { |component| component.key?('componentInstanceId') }
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
end
