# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'

# #470: `Ir al origen` — provenance navigation by Granete semantic identity
# only. Manual placements land on the exact hardware ComponentInstance
# (which fires the #468 hardware inspector); relationships land on the owning
# source component. Names never participate.
class OverlayNavigationTest < Minitest::Test
  Overlay = Granete::SketchUpExtension::Overlay

  def setup
    SketchupStub.reset!
    @model = OverlayFixture.build_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @locator = Overlay::EntityLocator.new(
      metadata_store_factory: ->(m) { Granete::SketchUpExtension::Metadata::Store.new(m) },
      model_provider: -> { @model }
    )
    @navigation = Overlay::ProvenanceNavigation.new(locator: @locator,
                                                    model_provider: -> { @model })
    @snapshot = Overlay::InspectionSnapshot.new(
      scope: { 'furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID },
      result: OverlayFixture.accepted_result,
      message_id: 'msg-nav'
    )
  end

  def manual_hinge_feature
    @snapshot.features.find { |feature| feature.source_kind == 'manualHardwarePlacement' }
  end

  def shelf_feature
    @snapshot.features.find do |feature|
      feature.source_kind == 'relationship' && feature.host_component_instance_id == 'side-left-01'
    end
  end

  def test_manual_placement_navigates_to_the_exact_hardware_instance
    result = @navigation.navigate_to_source(manual_hinge_feature, @snapshot)

    assert_equal 'hardware', result['kind']
    assert_equal 'hp-hinge-01', result['id']
    selected = @model.selection.first
    assert_equal 'hp-hinge-01', @store.read(selected)&.dig('identity', 'hardwarePlacementId'),
                 'selecting the hinge fires the #468 hardware inspector flow'
  end

  def test_relationship_navigates_to_the_owning_source_component
    result = @navigation.navigate_to_source(shelf_feature, @snapshot)

    assert_equal 'part', result['kind']
    assert_equal 'shelf-01', result['id'], 'rel-shelf-01 source is the shelf occurrence'
    assert_equal 'rel-shelf-01', result['relationshipId']
    selected = @model.selection.first
    assert_equal 'shelf-01', @store.read(selected)&.dig('identity', 'componentInstanceId')
  end

  # Negative proof (#470 §15/§17): identity resolution ignores SketchUp
  # names entirely — renaming entities cannot break or fake navigation.
  def test_navigation_is_blind_to_sketchup_names
    hinge_entity = @locator.locate_child(OverlayFixture.furniture_root(@model), 'hp-hinge-01')
    hinge_entity.name = 'definitely not a hinge'

    result = @navigation.navigate_to_source(manual_hinge_feature, @snapshot)
    assert result, 'renamed hardware stays reachable through Granete identity'
    selected = @model.selection.first
    assert_equal 'hp-hinge-01', @store.read(selected)&.dig('identity', 'hardwarePlacementId')
  end

  def test_unknown_provenance_kind_navigates_nowhere
    ghost = feature_with_provenance('sourceKind' => 'joint')
    assert_nil @navigation.navigate_to_source(ghost, @snapshot)
  end

  def test_missing_target_honestly_returns_nil
    ghost = feature_with_provenance('sourceKind' => 'manualHardwarePlacement',
                                    'hardwarePlacementId' => 'hp-ghost')
    assert_nil @navigation.navigate_to_source(ghost, @snapshot)
  end

  private

  def feature_with_provenance(provenance)
    Overlay::ManufacturingFeatureView.new(
      visual_id: 'g#h0', operation_id: 'g', kind: 'hole',
      host_component_instance_id: 'side-left-01', face: 'front',
      x_mm: 1, y_mm: 1, diameter_mm: 8, depth_mm: 8, hole_type: 'dowel',
      provenance: provenance
    )
  end
end
