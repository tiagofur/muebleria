# frozen_string_literal: true

require_relative '../test_helper'

# Negative proof for the HOST STUB surface (#469 increment 3, review r3):
# the stub must never expose methods the real SketchUp API does not have
# — a phantom API makes host-unfaithful production code pass unit tests
# and only explode (or silently misbehave) on the real host. Pinned here
# after two such regressions:
#   * Geom::BoundingBox has NO #transform — footprints/boxes must be
#     derived from transformed Point3d data (e.g. Face vertex positions);
#   * Sketchup::ComponentInstance has NO #entities — its content lives
#     on entity.definition.entities (Group is the one with #entities).
class HostStubFaithfulnessTest < Minitest::Test
  def test_bounding_box_exposes_no_phantom_transform
    box = Geom::BoundingBox.new(10.0, 20.0, 30.0)

    refute_respond_to box, :transform,
                      'Geom::BoundingBox#transform does not exist on the real host — do not add it back'
  end

  def test_component_instance_exposes_no_phantom_entities
    definition = SketchupStub.active_model.definitions.add('stub-faithful')
    instance = definition.add_instance(Geom::Transformation.new)

    refute_respond_to instance, :entities,
                      'ComponentInstance#entities does not exist on the real host — traverse definition.entities'

    # The host-faithful access path the scans must use.
    assert_instance_of SketchupStub::EntitiesStub, definition.entities
    assert_same definition.entities, instance.definition.entities
  end

  def test_group_keeps_entities_and_transformation_surface
    group = SketchupStub.active_model.entities.add_group

    assert_respond_to group, :entities, 'Group#entities IS real host API'
    assert_respond_to group, :transformation
  end
end
