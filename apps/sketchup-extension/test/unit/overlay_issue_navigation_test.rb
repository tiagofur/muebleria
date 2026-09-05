# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'
require_relative '../../src/granete_for_sketchup/host/preflight_review_copy'
require_relative '../../src/granete_for_sketchup/host/preflight_review'
require_relative '../../src/granete_for_sketchup/overlay/issue_navigation'

# #466 viewport problem navigation: identity-only location (never names or
# geometry), most-specific candidate first, camera framing as view state
# (selection + zoom, zero SketchUp operations) and the owning-furniture
# fallback when the exact child is unreachable.
class OverlayIssueNavigationTest < Minitest::Test
  Host = Granete::SketchUpExtension::Host
  Overlay = Granete::SketchUpExtension::Overlay

  SCOPE = { 'furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID }.freeze

  def setup
    SketchupStub.reset!
    @model = OverlayFixture.build_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @review = Host::PreflightReview.from_accepted_result(
      result: OverlayFixture.accepted_result, scope: SCOPE, message_id: 'msg-nav'
    )
    @navigation = Overlay::IssueNavigation.new(locator: locator, model_provider: -> { @model })
  end

  def test_primary_navigation_selects_and_frames_the_manual_hinge_by_identity
    operations_before = @model.operations.length
    result = @navigation.navigate(@review, 'issue-0', 'primary')

    assert_equal({ 'kind' => 'hardware', 'id' => 'hp-hinge-01', 'fallback' => false }, result)
    selected = @model.selection.first
    assert_equal 'hp-hinge-01', @store.read(selected)&.dig('identity', 'hardwarePlacementId'),
                 'selection is the exact managed hinge, located by Granete identity'
    assert_includes @model.active_view.zoomed_entities, selected,
                    'camera framing targets the selected entity'
    assert_equal operations_before, @model.operations.length,
                 'navigation never opens a SketchUp operation'
  end

  def test_part_navigation_selects_the_host_board
    result = @navigation.navigate(@review, 'issue-0', 'part')

    assert_equal({ 'kind' => 'part', 'id' => 'side-left-01', 'fallback' => false }, result)
    selected = @model.selection.first
    assert_equal 'side-left-01', @store.read(selected)&.dig('identity', 'componentInstanceId')
  end

  # NEGATIVE PROOF (#466): a stale child locator (the exact child was
  # regenerated and its identity metadata no longer resolves) must not
  # permanently break navigation — the owning furniture frames the problem
  # honestly.
  def test_unreachable_child_falls_back_to_the_owning_furniture
    hinge = locate_child('hp-hinge-01')
    metadata = @store.read(hinge) || {}
    metadata.delete('identity')
    @store.write(hinge, metadata)

    result = @navigation.navigate(@review, 'issue-0', 'hardware')

    assert_equal({ 'kind' => 'furniture', 'id' => nil, 'fallback' => true }, result)
    selected = @model.selection.first
    assert_equal OverlayFixture::FURNITURE_INSTANCE_ID,
                 @store.read(selected)&.dig('identity', 'instanceRef')
  end

  # Rebuild proof: navigation is keyed by Granete identity, so rebuilding
  # the furniture (fresh entities, SAME persisted identity metadata) keeps
  # the issue reachable — persistent_id/geometry never participate.
  def test_navigation_survives_child_regeneration_while_identity_persists
    @navigation.navigate(@review, 'issue-0', 'hardware')
    original_hinge = @model.selection.first

    # Full regeneration: erase and rebuild from the same authoritative
    # layout — new entities carrying the same Granete identities.
    @model.active_entities.erase_entities([OverlayFixture.furniture_root(@model)])
    @model = OverlayFixture.build_model
    rebuilt_hinge = locate_child('hp-hinge-01')
    refute_same original_hinge, rebuilt_hinge, 'the entity reference must have changed'

    result = Overlay::IssueNavigation.new(locator: locator, model_provider: -> { @model })
                                     .navigate(@review, 'issue-0', 'hardware')

    assert_equal({ 'kind' => 'hardware', 'id' => 'hp-hinge-01', 'fallback' => false }, result)
    assert_same rebuilt_hinge, @model.selection.first
  end

  def test_navigation_without_a_locatable_scope_returns_nil
    missing_scope_review = Host::PreflightReview.from_accepted_result(
      result: OverlayFixture.accepted_result,
      scope: { 'furnitureInstanceRef' => 'inst-not-in-model' }, message_id: 'm'
    )
    assert_nil @navigation.navigate(missing_scope_review, 'issue-0', 'primary')
  end

  def test_furniture_preference_frames_the_owning_root
    result = @navigation.navigate(@review, 'issue-0', 'furniture')

    assert_equal({ 'kind' => 'furniture', 'id' => nil, 'fallback' => true }, result)
    assert_equal OverlayFixture::FURNITURE_INSTANCE_ID,
                 @store.read(@model.selection.first)&.dig('identity', 'instanceRef')
  end

  private

  def locator
    Overlay::EntityLocator.new(
      metadata_store_factory: ->(model) { @store_for ||= Granete::SketchUpExtension::Metadata::Store.new(model) },
      model_provider: -> { @model }
    )
  end

  def locate_child(child_id)
    OverlayFixture.furniture_root(@model).definition.entities.find do |entity|
      entity.respond_to?(:definition) &&
        @store.read(entity)&.dig('identity', 'hardwarePlacementId') == child_id
    end
  end
end
