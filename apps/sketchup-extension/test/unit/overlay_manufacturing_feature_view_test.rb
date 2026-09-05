# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'

# #470: the neutral feature view model — provenance REQUIRED and unambiguous,
# deterministic visualization identity, backend-decided conflicts attached by
# operation pair, Spanish display labels over raw contract values.
class OverlayManufacturingFeatureViewTest < Minitest::Test
  Overlay = Granete::SketchUpExtension::Overlay

  def setup
    @result = OverlayFixture.accepted_result
  end

  def test_builds_one_view_per_hole_with_deterministic_visual_identity
    features = Overlay::ManufacturingFeatureView::Factory.from_operations(@result.operations, [])

    assert_equal @result.operations.sum { |operation| operation.holes.length }, features.length
    hinge = features.find { |feature| feature.operation_id == 'hp-hinge-01:op-1' }
    assert_equal 'hp-hinge-01:op-1#h0', hinge.visual_id
    assert_equal 'hole', hinge.kind
    assert_equal 35, hinge.diameter_mm
    assert_equal 12.5, hinge.depth_mm
    assert_equal 'front', hinge.face
    assert_equal 'frontal', hinge.face_label
    assert_equal 'Bisagra', hinge.type_label
  end

  def test_provenance_is_carried_verbatim_from_the_contract
    features = Overlay::ManufacturingFeatureView::Factory.from_operations(@result.operations, [])
    hinge = features.find { |feature| feature.source_kind == 'manualHardwarePlacement' }
    assert_equal 'hp-hinge-01', hinge.hardware_placement_id
    assert_equal 'hp-hinge-01', hinge.source_label_es

    shelf = features.find { |feature| feature.source_kind == 'relationship' }
    assert_equal 'rel-shelf-01', shelf.relationship_id
    assert_equal 'minifix-dowel', shelf.catalog_rule_id
    assert_equal 'rel-shelf-01', shelf.source_label_es
  end

  def test_missing_provenance_fails_closed_never_guessed
    broken = Granete::SketchUpExtension::Library::AuthoringMachiningOperation.new(
      operation_id: 'anon:op-1', host_component_instance_id: 'side-left-01',
      provenance: {}, holes: [{ 'face' => 'front', 'xMm' => 1, 'yMm' => 1,
                                'diameterMm' => 8, 'depthMm' => 8, 'type' => 'dowel' }]
    )
    error = assert_raises ArgumentError do
      Overlay::ManufacturingFeatureView::Factory.from_operations([broken], [])
    end
    assert_match 'sin provenance', error.message
  end

  def test_conflict_attaches_to_both_backend_decided_operations
    features = Overlay::ManufacturingFeatureView::Factory.from_operations(
      @result.operations, @result.issues
    )
    conflicting = features.select(&:conflict?)
    involved = conflicting.map(&:operation_id).uniq.sort
    assert_equal ['hp-hinge-01:op-1', 'rel-shelf-01:op-1'], involved

    hinge = conflicting.find { |feature| feature.operation_id == 'hp-hinge-01:op-1' }
    assert_equal 'DRILLING_CONFLICT', hinge.conflict_issue.code
    payload = hinge.to_payload
    assert_equal 'rel-shelf-01:op-1', payload['conflict']['otherOperationId']
    refute_nil payload['conflict']['remediation']
  end

  def test_unrelated_operations_never_inherit_conflicts
    features = Overlay::ManufacturingFeatureView::Factory.from_operations(
      @result.operations, @result.issues
    )
    side_right = features.select { |feature| feature.host_component_instance_id == 'side-right-01' }
    assert side_right.any?
    refute side_right.any?(&:conflict?)
  end

  def test_payload_shape_is_stable_for_the_dialog
    features = Overlay::ManufacturingFeatureView::Factory.from_operations(
      @result.operations, @result.issues
    )
    payload = features.first.to_payload
    %w[visualId operationId kind hostComponentInstanceId face faceLabel xMm yMm
       diameterMm depthMm type typeLabel provenance sourceLabel].each do |key|
      assert payload.key?(key), "payload missing #{key}"
    end
  end

  def test_features_only_come_from_contract_operations_never_geometry
    # The factory accepts ONLY parsed contract operations: arbitrary Ruby or
    # geometry hashes are not part of its surface, and no code path derives
    # features from SketchUp entities (enforced by absence — see the
    # boundary test for the full-module scan).
    assert_equal 6, @result.operations.length
    assert(@result.operations.all?(Granete::SketchUpExtension::Library::AuthoringMachiningOperation))
  end
end
