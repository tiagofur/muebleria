# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'

# #417 — canonical carpentry validation fixture (BODY 16 / FRONT 18 / BACK 6,
# door + three-drawer-front aggregate sharing one authoring
# componentDefinitionId, visible hardware). This offline pass proves the
# fixture itself satisfies the published contract and renders through the
# builder as a fully native hierarchy; the real-host evidence (SketchUp
# structural checks + OpenCutList interoperability) lives in the TestUp suites
# TC_NativeValidationSmoke / TC_OpenCutListInteropSmoke.
class NativeValidationFixtureTest < Minitest::Test
  FIXTURE_PATH = File.expand_path('../fixtures/cabinet_validation_layout.json', __dir__)
  EXPECTED_BOARD_COUNT = 10
  EXPECTED_HARDWARE_COUNT = 3
  EXPECTED_ROLE_THICKNESS = { 'BODY' => 16.0, 'FRONT' => 18.0, 'BACK' => 6.0 }.freeze

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
  end

  def test_fixture_is_a_contract_valid_cabinet
    body = JSON.parse(File.read(FIXTURE_PATH))

    assert_equal 'granete.local-basis.v1', body['transformContract']
    assert_equal EXPECTED_BOARD_COUNT, body['components'].length
    assert_equal EXPECTED_HARDWARE_COUNT, body['hardware'].length

    counts = body['components'].group_by { |board| board['optionRole'] }.transform_values(&:length)
    assert_equal({ 'BODY' => 5, 'FRONT' => 4, 'BACK' => 1 }, counts)

    # The parser accepts the fixture verbatim (right-handed orthonormal bases,
    # positive extents, opaque ids) — no repair, no guess.
    layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
    assert_equal EXPECTED_BOARD_COUNT, layout.boards.length
    assert_equal EXPECTED_HARDWARE_COUNT, layout.hardware.length
  end

  def test_fixture_renders_full_native_hierarchy_offline
    insert_cabinet
    top = @model.active_entities.instances.first

    assert_instance_of SketchupStub::ComponentInstanceStub, top
    children = top.definition.entities.instances
    assert_equal EXPECTED_BOARD_COUNT + EXPECTED_HARDWARE_COUNT, children.length
    assert top.definition.entities.groups.empty?
    children.each do |child|
      assert_instance_of SketchupStub::ComponentInstanceStub, child
      assert_equal 1, child.definition.entities.faces.length,
                   "#{child.name} local geometry is one box face pushed to length"
    end
  end

  def test_role_thickness_is_local_geometry_per_board
    insert_cabinet
    top = @model.active_entities.instances.first

    fixture_boards.each do |board|
      child = children_by_name(top)[board['name']]
      refute_nil child, "missing rendered child #{board['name']}"
      expected = EXPECTED_ROLE_THICKNESS.fetch(board['optionRole'])
      assert_in_delta expected, local_thickness_mm(child), 1e-6,
                      "#{board['name']} local thickness must follow its material role"
    end
  end

  def test_drawer_fronts_share_authoring_id_but_not_host_definitions
    insert_cabinet
    top = @model.active_entities.instances.first
    drawers = ['Frente Cajón 1', 'Frente Cajón 2', 'Frente Cajón 3'].map { |name| children_by_name(top)[name] }

    assert_equal 3, drawers.map(&:definition).uniq.length,
                 'V1: every copy keeps its own generated host definition'
    authoring_ids = drawers.map { |drawer| @store.read(drawer).dig('identity', 'componentDefinitionId') }
    assert_equal ['gab-drawer-front'], authoring_ids.uniq
    instance_ids = drawers.map { |drawer| @store.read(drawer).dig('identity', 'componentInstanceId') }
    assert_equal ['Frente Cajón 1', 'Frente Cajón 2', 'Frente Cajón 3'], drawers.map(&:name)
    assert_equal 3, instance_ids.uniq.length
  end

  def test_fi_b_front16_rebuild_leaves_fi_a_untouched_offline
    insert_cabinet
    insert_cabinet
    top_a, top_b = @model.active_entities.instances.first(2)

    fi_a_before = hierarchy_snapshot(top_a)
    result = @builder.update_furniture(@model, top_b, definition, {},
                                       resolved_layout: parsed_layout(front16_layout_body),
                                       material_choices: { 'FRONT' => 'mat-white16' })
    assert result['success'], "FI-B rebuild failed: #{result['error']}"

    puerta_b = children_by_name(top_b)['Puerta']
    assert_in_delta 16.0, local_thickness_mm(puerta_b), 1e-6
    puerta_a = children_by_name(top_a)['Puerta']
    assert_in_delta 18.0, local_thickness_mm(puerta_a), 1e-6
    assert_equal fi_a_before, hierarchy_snapshot(top_a),
                 'FI-B divergence must never mutate FI-A'
  end

  def test_fixture_boxes_stay_inside_the_cabinet_envelope
    body = JSON.parse(File.read(FIXTURE_PATH))
    width, height, depth = body['dimensionsMm']

    body['components'].each do |board|
      min = board['transform']['translationMm']
      size = board['dimensionsMm']
      max = [min[0] + size[0], min[1] + size[1], min[2] + size[2]]
      assert min[0] >= -1e-6 && min[1] >= -1e-6 && min[2] >= -1e-6,
             "#{board['name']} starts before the cabinet envelope"
      assert max[0] <= width + 1e-6, "#{board['name']} overflows cabinet width"
      assert max[2] <= height + 1e-6, "#{board['name']} overflows cabinet height"
      # Fronts legitimately overlay the carcass front by their own thickness;
      # every other board stays inside the nominal depth.
      depth_limit = board['optionRole'] == 'FRONT' ? depth + board['thicknessMm'] : depth
      assert max[1] <= depth_limit + 1e-6, "#{board['name']} overflows cabinet depth"
    end
  end

  DEFINITION = {
    'furniture_definition_id' => 'gab-cajonero-600',
    'name' => 'Gabinete Base Puerta y Cajones 600',
    'parameters' => [
      { 'name' => 'widthMm', 'defaultValue' => 600 },
      { 'name' => 'heightMm', 'defaultValue' => 720 },
      { 'name' => 'depthMm', 'defaultValue' => 560 }
    ]
  }.freeze

  private

  def definition
    DEFINITION
  end

  def cabinet_layout_body
    JSON.parse(File.read(FIXTURE_PATH))
  end

  def front16_layout_body
    body = JSON.parse(File.read(FIXTURE_PATH))
    body['components'].each do |component|
      next unless component['optionRole'] == 'FRONT'

      component['thicknessMm'] = 16
      component['dimensionsMm'][1] = 16
      component['materialId'] = 'mat-white16'
      component['materialCode'] = 'MDG-BLANCO-16'
      component['materialName'] = 'MDF Blanco 16'
      component['materialColorHex'] = '#f2f0eb'
    end
    body
  end

  def parsed_layout(body = nil)
    Granete::SketchUpExtension::Library::LayoutContract.parse!(body || cabinet_layout_body)
  end

  def insert_cabinet
    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: parsed_layout)
    assert result['success'], "insert failed: #{result['error']}"
    result
  end

  def fixture_boards
    cabinet_layout_body['components']
  end

  def children_by_name(top)
    top.definition.entities.instances.to_h { |child| [child.name, child] }
  end

  # Stub geometry is authored in inches (host convention); report millimeters.
  def local_thickness_mm(child)
    child.definition.entities.faces.first.points.map(&:y).max * 25.4
  end

  def hierarchy_snapshot(top)
    top.definition.entities.instances.map do |child|
      [child.name, child.definition.name, child.transformation.to_a,
       local_thickness_mm(child), @store.read(child)['identity']]
    end.sort
  end
end
