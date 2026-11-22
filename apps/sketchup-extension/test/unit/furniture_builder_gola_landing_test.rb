# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'

# #1689 — the gola landing in the model: (1) a DERIVED hardware box (the
# gola run) builds as the engine's [0,dims] corner box, never the centered
# mount proxy that floated the run outside the cabinet; (2) the width
# reflection flips the local X DIRECTION of boards whose local X leaves the
# width plane (the laterals), so the X-addressed notch/bevel bands must
# re-anchor inside [0,extent] — the side notches keep cutting the FRONT edge
# after the mirror. Numbers are the owner's vivo (MOD-BAJ-1P, L 8006 top
# run; lateral basis x=[0,-1,0], notch start x=0 = front edge).
class FurnitureBuilderGolaLandingTest < Minitest::Test
  MM = 1.0 / 25.4

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
  end

  def face_x_bounds(definition)
    xs = definition.entities.faces.flat_map(&:points).map(&:x)
    xs.minmax
  end

  def face_y_bounds(definition)
    ys = definition.entities.faces.flat_map(&:points).map(&:y)
    ys.minmax
  end

  # The gola run from the vivo: dims [600, 27.2, 56.5], basis identity,
  # min-corner translation. A corner box spans [0,600]×[0,27.2] around the
  # definition origin; the pre-#1689 centered proxy spanned [-300,300]×
  # [-13.6,13.6] and floated half the run outside the cabinet.
  def test_derived_run_builds_as_corner_box_not_centered_proxy
    placement = Struct.new(
      :placement_kind, :dimensions, :basis, :translation, :local_translation,
      :placement_id, :name, :color_hex, :hardware_id, :asset_id, :anchor_face, :offset_mm,
      :host_component_instance_id, :option_role, :representation,
      keyword_init: true
    ).new(
      placement_kind: 'derived', dimensions: [600.0, 27.2, 56.5],
      basis: { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] },
      translation: [0.0, 532.8, 663.5], placement_id: 'opening-profile-run',
      name: 'Perfil GOLA L', hardware_id: 'hw-run'
    )

    fallback = @builder.send(:build_fallback_hardware, @model, @model, 'Perfil GOLA L',
                             placement, placement.translation)

    assert_in_delta 0.0, face_x_bounds(fallback.definition)[0], 1.0e-6, 'corner box starts at local X=0'
    assert_in_delta 600.0 * MM, face_x_bounds(fallback.definition)[1], 1.0e-6, 'corner box ends at local X=600'
    assert_in_delta 0.0, face_y_bounds(fallback.definition)[0], 1.0e-6, 'corner box starts at local Y=0'
    assert_in_delta 27.2 * MM, face_y_bounds(fallback.definition)[1], 1.0e-6, 'corner box ends at local Y=27.2'
  end

  # A MOUNTED handle keeps the #1453 F2 centered mount proxy — the derived
  # corner convention must not leak into face-mounted hardware.
  def test_mounted_hardware_keeps_centered_proxy
    placement = Struct.new(
      :placement_kind, :dimensions, :basis, :translation, :local_translation,
      :placement_id, :name, :color_hex, :hardware_id, :asset_id, :anchor_face, :offset_mm,
      :host_component_instance_id, :option_role, :representation,
      keyword_init: true
    ).new(
      placement_kind: nil, dimensions: [160.0, 32.0, 12.0],
      basis: nil, translation: [40.0, 560.0, 360.0],
      placement_id: 'door-hw-0', name: 'Jaladera', hardware_id: 'hw-handle'
    )

    fallback = @builder.send(:build_fallback_hardware, @model, @model, 'Jaladera',
                             placement, placement.translation)

    assert_in_delta(-80.0 * MM, face_x_bounds(fallback.definition)[0], 1.0e-6,
                    'mounted proxy stays centered in-plane on the mount point')
    assert_in_delta(80.0 * MM, face_x_bounds(fallback.definition)[1], 1.0e-6)
  end

  # The owner's lateral: basis x=[0,-1,0] (local X runs along the depth —
  # local X=0 IS the front edge), notch start x=0 with size 27.2 → the front
  # band. Under the width reflection the local X direction flips, so the band
  # must re-anchor to [532.8, 560] to keep cutting the FRONT.
  def test_mirrored_lateral_band_flips_to_keep_the_front_edge
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    notch = {
      'startMm' => [0.0, 0.0, 663.5], 'sizeMm' => [27.2, 18.0, 56.5],
      'profileId' => 'profile.gola-l.8006', 'boundary' => 'top'
    }
    lateral_basis = { 'x' => [0, -1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }

    flipped, = builder.send(:mirrored_local_bands, [notch], [], 560.0, lateral_basis)

    assert_in_delta 532.8, flipped[0]['startMm'][0], 1.0e-6, 'band re-anchors to the front edge [532.8, 560]'
    assert_in_delta 0.0, flipped[0]['startMm'][1], 1.0e-6, 'Y start untouched'
    assert_in_delta 663.5, flipped[0]['startMm'][2], 1.0e-6, 'Z start untouched'
    assert_equal 27.2, flipped[0]['sizeMm'][0], 'size untouched'
    assert_equal 0.0, notch['startMm'][0], 'the engine band stays the untouched truth'
  end

  # A door's local X runs along the WIDTH — the reflection moving its band
  # to the other width edge is the truthful mirror; no flip.
  def test_width_running_board_keeps_its_band
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    notch = { 'startMm' => [100.0, 0.0, 663.5], 'sizeMm' => [27.2, 18.0, 56.5] }
    door_basis = { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }

    bands, = builder.send(:mirrored_local_bands, [notch], [], 560.0, door_basis)

    assert_same notch, bands[0], 'a width-running board never re-anchors its band'
  end
end
