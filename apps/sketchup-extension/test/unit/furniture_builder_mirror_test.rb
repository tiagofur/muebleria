# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'

# #1575 — the host renders the resolved layout REFLECTED across the
# furniture's mid-width plane so a SketchUp viewer facing the front sees
# exactly what the web (the authoring surface) shows. The owner's
# experiment: a 600-wide cabinet with the left half-door at data x=0 and
# the right half-door at data x=300 must render SWAPPED in data terms
# (left door instance ends at x∈[300,600] = the viewer's LEFT in the
# host frame). Metadata always keeps the ENGINE's numbers.
class FurnitureBuilderMirrorTest < Minitest::Test
  MM = 1.0 / 25.4

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
  end

  def furniture_instance
    @model.active_entities.instances.first
  end

  def part_instances
    furniture_instance.definition.entities.instances
  end

  def part_named(name)
    part_instances.find { |part| part.name == name }
  end

  # The owner's experiment shape: W=600, two half-width doors
  # (izquierda x∈[0,300] / derecha x∈[300,600]) + rotZ-90 side panels
  # + one hinge on the RIGHT door's outer (max-x) data edge.
  MIRROR_LAYOUT_BODY = {
    'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
    'definitionName' => 'Gabinete 2 Puertas 600',
    'transformContract' => 'granete.local-basis.v1',
    'dimensionsMm' => [600, 720, 560],
    'components' => [
      { 'componentInstanceId' => 'st-side-l', 'componentDefinitionId' => 'st-side',
        'slotId' => 'lateral_izquierdo', 'role' => 'LATERAL',
        'name' => 'Lateral Izq', 'kind' => 'board',
        'transform' => { 'translationMm' => [0, 0, 0] }, 'dimensionsMm' => [18, 560, 684],
        'localTransform' => {
          'translationMm' => [0, 560, 0],
          'basis' => { 'x' => [0, -1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }
        },
        'lengthMm' => 684, 'widthMm' => 560, 'thicknessMm' => 18,
        'optionRole' => 'LATERAL', 'materialColorHex' => '#c8b89a' },
      { 'componentInstanceId' => 'st-side-r', 'componentDefinitionId' => 'st-side',
        'slotId' => 'lateral_derecho', 'role' => 'LATERAL',
        'name' => 'Lateral Der', 'kind' => 'board',
        'transform' => { 'translationMm' => [582, 0, 0] }, 'dimensionsMm' => [18, 560, 684],
        'localTransform' => {
          'translationMm' => [582, 560, 0],
          'basis' => { 'x' => [0, -1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }
        },
        'lengthMm' => 684, 'widthMm' => 560, 'thicknessMm' => 18,
        'optionRole' => 'LATERAL', 'materialColorHex' => '#c8b89a' },
      { 'componentInstanceId' => 'door-izq', 'componentDefinitionId' => 'door-half',
        'slotId' => 'puerta_izq', 'role' => 'FRENTE',
        'name' => 'Puerta Izq', 'kind' => 'board',
        'transform' => { 'translationMm' => [0, 556, 2] }, 'dimensionsMm' => [300, 18, 716],
        'localTransform' => {
          'translationMm' => [0, 556, 2],
          'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
        },
        'lengthMm' => 716, 'widthMm' => 300, 'thicknessMm' => 18,
        'optionRole' => 'FRENTE', 'materialColorHex' => '#c4a574' },
      { 'componentInstanceId' => 'door-der', 'componentDefinitionId' => 'door-half',
        'slotId' => 'puerta_der', 'role' => 'FRENTE',
        'name' => 'Puerta Der', 'kind' => 'board',
        'transform' => { 'translationMm' => [300, 556, 2] }, 'dimensionsMm' => [300, 18, 716],
        'localTransform' => {
          'translationMm' => [300, 556, 2],
          'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
        },
        'lengthMm' => 716, 'widthMm' => 300, 'thicknessMm' => 18,
        'optionRole' => 'FRENTE', 'materialColorHex' => '#c4a574' }
    ],
    'hardware' => [
      { 'placementId' => 'pl-hinge-der', 'hardwareId' => 'hw-hinge',
        'name' => 'Bisagra Der', 'shape' => 'hinge',
        'placementKind' => 'manual', 'hostComponentInstanceId' => 'door-der',
        'anchorFace' => 'back', 'offsetMm' => [289.5, 90],
        'transform' => { 'translationMm' => [590, 560, 10] }, 'dimensionsMm' => [10, 34, 30],
        'localTransform' => {
          'translationMm' => [590, 560, 10],
          'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
        },
        'colorHex' => '#8a8a8a' }
    ],
    'assemblies' => [
      { 'assemblyInstanceId' => 'asm-1', 'agregadoId' => 'agr-ent-1',
        'placement' => { 'translationMm' => [50, 0, 0],
                         'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } },
        'rigidMembers' => [
          { 'memberId' => 'm-riel', 'name' => 'riel',
            'localTransform' => { 'translationMm' => [10, 400, 5],
                                  'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } },
            'dimensionsMm' => [12, 450, 45], 'actorMembership' => 'actor:drawer',
            'hand' => 'left' },
          { 'memberId' => 'm-sym', 'name' => 'riel simetrico',
            'localTransform' => { 'translationMm' => [560, 400, 5],
                                  'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } },
            'dimensionsMm' => [12, 450, 45] }
        ] }
    ]
  }.freeze

  def insert_mirror_layout
    definition = JSON.parse(JSON.generate(@provider.find_definition('kitchen-base-standard')))
    definition['name'] = 'Gabinete 2 Puertas 600'
    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: native_layout(MIRROR_LAYOUT_BODY))
    assert result['success'], result['error']
    furniture_instance
  end

  def native_layout(body)
    Granete::SketchUpExtension::Library::LayoutContract.parse!(JSON.parse(JSON.generate(body)))
  end

  def test_half_doors_render_swapped_like_the_web_shows_them
    insert_mirror_layout

    izq = part_named('Puerta Izq')
    der = part_named('Puerta Der')
    refute_nil izq
    refute_nil der
    # Data x∈[0,300] renders at the +X end (the host viewer's LEFT, where
    # the web put it); data x∈[300,600] renders at x∈[0,300].
    assert_in_delta 300.0 * MM, izq.transformation.origin.x, 1e-6,
                    'la puerta izquierda del engine queda a la izquierda VISUAL (+X) del host'
    assert_in_delta 0.0 * MM, der.transformation.origin.x, 1e-6,
                    'la puerta derecha del engine queda en el origen del host (intercambio exacto)'
  end

  def test_rotated_side_panels_reflect_with_proper_basis
    insert_mirror_layout

    side_l = part_named('Lateral Izq')
    side_r = part_named('Lateral Der')
    # Left panel data x∈[0,18] → world x∈[582,600] (origin at the far end).
    assert_in_delta 600.0 * MM, side_l.transformation.origin.x, 1e-6
    # Right panel data x∈[582,600] → world x∈[0,18] (origin 18 = 600−582).
    assert_in_delta 18.0 * MM, side_r.transformation.origin.x, 1e-6
    # Both instances keep a RIGHT-HANDED basis (no SketchUp mirrored
    # instances): the composed transform's axes stay det=+1.
    [side_l, side_r].each do |side|
      m = side.transformation.to_a
      det = (m[0] * ((m[5] * m[10]) - (m[6] * m[9]))) -
            (m[4] * ((m[1] * m[10]) - (m[2] * m[9]))) +
            (m[8] * ((m[1] * m[6]) - (m[2] * m[5])))
      assert_in_delta 1.0, det, 1e-6, 'el espejo nunca produce instancias de det=−1'
    end
  end

  def test_hardware_mirrors_to_the_mirrored_edge
    insert_mirror_layout

    hinge = part_named('Bisagra Der')
    refute_nil hinge
    # Data x=590 (right door's outer edge) → world x = 600 − 590 = 10.
    assert_in_delta 10.0 * MM, hinge.transformation.origin.x, 1e-6
  end

  def test_assembly_members_follow_the_reflected_outer_frame
    insert_mirror_layout

    rail = part_named('riel')
    refute_nil rail
    # Only the assembly placement reflects: member world x =
    # W − (50 + 10) = 540. The member's own local transform composes
    # untouched (one reflection per chain, never two).
    assert_in_delta 540.0 * MM, rail.transformation.origin.x, 1e-6
  end

  # #1605: a HANDED kit member keeps its authored chirality while the
  # position reflection moves it to the opposite wall — its cross-section
  # would face away from the adjacent wall, reading as the opposite hand
  # mounted backwards (the owner's Gray profiles). The host mirrors the
  # instance's own X (det = −1, #1280 mirrored-legal) so the authored left
  # piece presents the right-hand shape at its new side — the same frame
  # the web's view presents. Hand-less members stay det = +1: rotated
  # placements (door hinges, y:180) are data-tuned for the position-only
  # reflection (#1591/#1592) and must not change.
  def test_handed_member_reflects_geometry_while_handless_stays_proper
    insert_mirror_layout

    det = lambda do |instance|
      m = instance.transformation.to_a
      (m[0] * ((m[5] * m[10]) - (m[6] * m[9]))) -
        (m[4] * ((m[1] * m[10]) - (m[2] * m[9]))) +
        (m[8] * ((m[1] * m[6]) - (m[2] * m[5])))
    end

    rail = part_named('riel')
    refute_nil rail
    assert_in_delta(-1.0, det.call(rail), 1e-6,
                    'el miembro con mano refleja su geometría (det=−1) bajo el espejo')

    symmetric = part_named('riel simetrico')
    refute_nil symmetric
    # Position mirror still applies (W − (50 + 560) = −10): the instance
    # lands outside the furniture but its geometry stays det = +1.
    assert_in_delta(-10.0 * MM, symmetric.transformation.origin.x, 1e-6)
    assert_in_delta 1.0, det.call(symmetric), 1e-6,
                    'un miembro sin mano jamás se vuelve instancia espejada'
  end

  def test_contract_parses_member_hand_for_the_mirror_decision
    layout = native_layout(MIRROR_LAYOUT_BODY)
    member = layout.assemblies.flat_map(&:rigid_members).find { |m| m.member_id == 'm-riel' }
    assert_equal 'left', member.hand
    symmetric = layout.assemblies.flat_map(&:rigid_members).find { |m| m.member_id == 'm-sym' }
    assert_nil symmetric.hand
  end

  def test_metadata_keeps_engine_numbers_not_mirrored_ones
    insert_mirror_layout

    der = part_named('Puerta Der')
    meta = @store.read(der)
    assert_equal [300.0, 556.0, 2.0], meta['intent']['assemblyTranslationMm'],
                 'la metadata conserva la verdad del engine; sólo la geometría se refleja'
  end

  def test_layout_without_root_width_mirrors_within_its_own_envelope
    # Local-lane preview shapes (#469) publish no root dimensionsMm: the
    # mirror uses the layout's own placement span as the plane. Here the
    # side panels define envelope x∈[0,600] — the SAME plane the published
    # width gives, so the doors render swapped exactly like the
    # dimensions-published test above.
    body = JSON.parse(JSON.generate(MIRROR_LAYOUT_BODY))
    body.delete('dimensionsMm')
    definition = JSON.parse(JSON.generate(@provider.find_definition('kitchen-base-standard')))

    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: native_layout(body))
    assert result['success'], result['error']

    izq = part_named('Puerta Izq')
    der = part_named('Puerta Der')
    assert_in_delta 300.0 * MM, izq.transformation.origin.x, 1e-6
    assert_in_delta 0.0 * MM, der.transformation.origin.x, 1e-6
  end

  def test_generic_composition_mirrors_side_positions
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition,
                                       { 'widthMm' => 600, 'shelfCount' => 2, 'doorCount' => 1 })
    assert result['success']

    left = part_instances.find { |part| part.name == 'Lateral Izquierdo' }
    right = part_instances.find { |part| part.name == 'Lateral Derecho' }
    refute_nil left
    refute_nil right
    # 18mm sides at data x=0 / x=582 swap to x'=582 / x'=0.
    assert_in_delta 582.0 * MM, left.transformation.origin.x, 1e-6
    assert_in_delta 0.0 * MM, right.transformation.origin.x, 1e-6
  end

  def test_mirror_placement_preserves_determinant_class_of_input_basis
    mirror = Granete::SketchUpExtension::Model::LocalGeometry
    identity = { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
    rot_z90 = { 'x' => [0, -1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }
    mirrored_hw = { 'x' => [-1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } # det −1, legal #1280

    det = lambda do |basis|
      bx = basis['x']
      by = basis['y']
      bz = basis['z']
      (bx[0] * ((by[1] * bz[2]) - (by[2] * bz[1]))) -
        (bx[1] * ((by[0] * bz[2]) - (by[2] * bz[0]))) +
        (bx[2] * ((by[0] * bz[1]) - (by[1] * bz[0])))
    end

    [identity, rot_z90].each do |basis|
      _t, mirrored = mirror.mirror_placement([100.0, 0.0, 0.0], basis, 300.0, 600.0)
      assert_in_delta 1.0, det.call(mirrored), 1e-9,
                      'un basis propio queda propio: nunca instancias espejadas de tablero'
    end

    _t, mirrored_hw_out = mirror.mirror_placement([100.0, 0.0, 0.0], mirrored_hw, 0, 600.0)
    assert_in_delta(-1.0, det.call(mirrored_hw_out), 1e-9,
                    'un basis espejado de herraje (#1280) conserva su clase legal')
  end
end
