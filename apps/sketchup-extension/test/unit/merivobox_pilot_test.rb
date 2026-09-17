# frozen_string_literal: true

require 'tmpdir'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/assets/mount_frame'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'

class MerivoboxPilotTest < Minitest::Test
  MM = 1.0 / 25.4
  MountFrame = Granete::SketchUpExtension::Assets::MountFrame
  BasisData = MountFrame::BasisData
  MountFrameData = MountFrame::MountFrameData

  class FakeDownloader
    def initialize(paths_by_revision = {})
      @paths_by_revision = paths_by_revision
    end

    def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
      _ = [asset_id, sha256, expected_bytes, org_id]
      @paths_by_revision[revision_id]
    end
  end

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @tmp_dir = Dir.mktmpdir('merivobox_pilot_test')
    @cache = Granete::SketchUpExtension::Assets::HardwareAssetCache.new(cache_dir: @tmp_dir)

    @side_skp = File.join(@tmp_dir, 'merivobox_side.skp')
    File.binwrite(@side_skp, 'SKP MERIVOBOX SIDE')

    @runner_450_skp = File.join(@tmp_dir, 'merivobox_runner_450.skp')
    File.binwrite(@runner_450_skp, 'SKP MERIVOBOX RUNNER 450')

    @runner_500_skp = File.join(@tmp_dir, 'merivobox_runner_500.skp')
    File.binwrite(@runner_500_skp, 'SKP MERIVOBOX RUNNER 500')

    @downloader = FakeDownloader.new(
      'rev-mbx-side-1' => @side_skp,
      'rev-mbx-450-1' => @runner_450_skp,
      'rev-mbx-500-1' => @runner_500_skp
    )
    @asset_loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: @downloader,
      cache: @cache
    )
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: @store,
      asset_loader: @asset_loader
    )
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
  end

  # E1 & E2: W600 LayoutContract parsing and fabricated component calculation (LW-58, NL-16)
  def test_e1_e2_merivobox_pilot_w600_parsing_and_resolution
    layout_data = build_merivobox_pilot_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

    assert_equal 1, parsed.assemblies.length
    assembly = parsed.assemblies.first
    assert_equal 'inst-merivobox-1', assembly.assembly_instance_id
    assert_equal 'agr-merivobox-m', assembly.agregado_id
    assert_equal 4, assembly.rigid_members.length
    assert_equal 2, assembly.fabricated_components.length

    # Verify fabricated components: bottom board = 542 x 484 mm (600 - 58, 500 - 16)
    bottom = assembly.fabricated_components.find { |c| c.component_id == 'comp-bottom' }
    refute_nil bottom
    assert_in_delta 542.0, bottom.width_mm, 1e-4
    assert_in_delta 484.0, bottom.length_mm, 1e-4
    assert_in_delta 16.0, bottom.thickness_mm, 1e-4

    # Back board = 542 x 69 mm
    back = assembly.fabricated_components.find { |c| c.component_id == 'comp-back' }
    refute_nil back
    assert_in_delta 542.0, back.width_mm, 1e-4
    assert_in_delta 69.0, back.length_mm, 1e-4
  end

  # E3 & E20: Continuous parametric width: W800 moves right members +200mm, W700 +100mm, no scaling
  def test_e3_e20_parametric_width_delta_and_zero_scaling
    layout_w600 = build_merivobox_pilot_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
    layout_w700 = build_merivobox_pilot_layout(width_mm: 700.0, nominal_depth_mm: 500.0)
    layout_w800 = build_merivobox_pilot_layout(width_mm: 800.0, nominal_depth_mm: 500.0)

    parsed600 = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_w600)
    parsed700 = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_w700)
    parsed800 = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_w800)

    right600 = parsed600.assemblies.first.rigid_members.find { |m| m.member_id == 'side-right' }
    right700 = parsed700.assemblies.first.rigid_members.find { |m| m.member_id == 'side-right' }
    right800 = parsed800.assemblies.first.rigid_members.find { |m| m.member_id == 'side-right' }

    # Translation X deltas: +100mm for W700, +200mm for W800
    delta700 = right700.local_transform['translation'][0] - right600.local_transform['translation'][0]
    delta800 = right800.local_transform['translation'][0] - right600.local_transform['translation'][0]
    assert_in_delta 100.0, delta700, 1e-4
    assert_in_delta 200.0, delta800, 1e-4

    # Fabricated bottom panel width increases continuously: 542 -> 642 -> 742 mm
    bottom600 = parsed600.assemblies.first.fabricated_components.find { |c| c.component_id == 'comp-bottom' }
    bottom700 = parsed700.assemblies.first.fabricated_components.find { |c| c.component_id == 'comp-bottom' }
    bottom800 = parsed800.assemblies.first.fabricated_components.find { |c| c.component_id == 'comp-bottom' }

    assert_in_delta 542.0, bottom600.width_mm, 1e-4
    assert_in_delta 642.0, bottom700.width_mm, 1e-4
    assert_in_delta 742.0, bottom800.width_mm, 1e-4

    # Length of bottom panel is preserved across width changes (484 mm)
    assert_in_delta 484.0, bottom600.length_mm, 1e-4
    assert_in_delta 484.0, bottom700.length_mm, 1e-4
    assert_in_delta 484.0, bottom800.length_mm, 1e-4

    # Rigidity: all members have scale [1,1,1] and det = +1.0
    definition = { 'name' => 'MERIVOBOX Unit 800', 'furniture_definition_id' => 'f-def-mbx-800' }
    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: parsed800)
    assert result['success']

    furniture = @model.active_entities.instances.first
    rigid_names = ['Lateral Izquierdo', 'Lateral Derecho', 'Guía Izquierda', 'Guía Derecha']
    rigid_instances = furniture.definition.entities.instances.select { |inst| rigid_names.include?(inst.name) }

    assert_equal 4, rigid_instances.length
    rigid_instances.each do |inst|
      t = inst.transformation
      det = compute_transform_determinant(t)
      assert_in_delta 1.0, det, 1e-4, "Instance #{inst.name} det must be +1.0"

      x_scale = Math.sqrt((t.to_a[0]**2) + (t.to_a[1]**2) + (t.to_a[2]**2))
      y_scale = Math.sqrt((t.to_a[4]**2) + (t.to_a[5]**2) + (t.to_a[6]**2))
      z_scale = Math.sqrt((t.to_a[8]**2) + (t.to_a[9]**2) + (t.to_a[10]**2))

      assert_in_delta 1.0, x_scale, 1e-4
      assert_in_delta 1.0, y_scale, 1e-4
      assert_in_delta 1.0, z_scale, 1e-4
    end
  end

  # E5 & E6: Discrete variant change (NL 450 vs NL 500) without scaling
  def test_e5_e6_discrete_variant_depth_a_vs_depth_b
    layout_a = build_merivobox_pilot_layout(width_mm: 600.0, nominal_depth_mm: 450.0)
    layout_b = build_merivobox_pilot_layout(width_mm: 600.0, nominal_depth_mm: 500.0)

    parsed_a = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_a)
    parsed_b = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_b)

    runner_a = parsed_a.assemblies.first.rigid_members.find { |m| m.member_id == 'runner-left' }
    runner_b = parsed_b.assemblies.first.rigid_members.find { |m| m.member_id == 'runner-left' }

    assert_equal 'hw-merivobox-450', runner_a.hardware_id
    assert_equal 'rev-mbx-450-1', runner_a.asset_revision_id
    assert_equal 'hw-merivobox-500', runner_b.hardware_id
    assert_equal 'rev-mbx-500-1', runner_b.asset_revision_id

    # Bottom board lengths: 450-16=434mm vs 500-16=484mm
    bottom_a = parsed_a.assemblies.first.fabricated_components.find { |c| c.component_id == 'comp-bottom' }
    bottom_b = parsed_b.assemblies.first.fabricated_components.find { |c| c.component_id == 'comp-bottom' }

    assert_in_delta 434.0, bottom_a.length_mm, 1e-4
    assert_in_delta 484.0, bottom_b.length_mm, 1e-4

    # Both variants maintain identical width (542mm)
    assert_in_delta 542.0, bottom_a.width_mm, 1e-4
    assert_in_delta 542.0, bottom_b.width_mm, 1e-4
  end

  # Negative test: LayoutContract fails closed on mirrored basis (det = -1) or scaling (det != 1)
  def test_rejects_mirrored_and_scaled_basis
    layout_data = build_merivobox_pilot_layout(width_mm: 600.0, nominal_depth_mm: 500.0)

    # 1. Mirrored basis
    mirrored = JSON.parse(JSON.generate(layout_data))
    mirrored['assemblies'].first['rigidMembers'].first['localTransform']['basis']['x'] = [-1.0, 0.0, 0.0]
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(mirrored)
    end

    # 2. Scaled basis (det = 2.0)
    scaled = JSON.parse(JSON.generate(layout_data))
    scaled['assemblies'].first['rigidMembers'].first['localTransform']['basis']['x'] = [2.0, 0.0, 0.0]
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(scaled)
    end
  end

  # R7: Visual binding independence (mechanical properties identical with vs without visual pins)
  def test_r7_visual_binding_independence
    layout_pinned = build_merivobox_pilot_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
    layout_unpinned = JSON.parse(JSON.generate(layout_pinned))
    layout_unpinned['assemblies'].first['rigidMembers'].each do |m|
      m.delete('assetId')
      m.delete('assetRevisionId')
      m.delete('mountFrame')
      m['preparationState'] = 'unprepared'
    end

    parsed_pinned = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_pinned)
    parsed_unpinned = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_unpinned)

    ass_pinned = parsed_pinned.assemblies.first
    ass_unpinned = parsed_unpinned.assemblies.first

    # 1. Member transforms identical
    ass_pinned.rigid_members.each_with_index do |m_pinned, idx|
      m_unpinned = ass_unpinned.rigid_members[idx]
      assert_equal m_pinned.member_id, m_unpinned.member_id
      assert_equal m_pinned.hardware_id, m_unpinned.hardware_id
      assert_equal m_pinned.local_transform['translation'], m_unpinned.local_transform['translation']
      assert_equal m_pinned.local_transform['basis'], m_unpinned.local_transform['basis']
    end

    # 2. Fabricated components identical
    ass_pinned.fabricated_components.each_with_index do |c_pinned, idx|
      c_unpinned = ass_unpinned.fabricated_components[idx]
      assert_equal c_pinned.component_id, c_unpinned.component_id
      assert_in_delta c_pinned.width_mm, c_unpinned.width_mm, 1e-4
      assert_in_delta c_pinned.length_mm, c_unpinned.length_mm, 1e-4
      assert_in_delta c_pinned.thickness_mm, c_unpinned.thickness_mm, 1e-4
    end
  end

  # E9 & E10: MountFrame non-identity normalization composition
  def test_e9_e10_mount_frame_normalization_composition
    mount_frame_data = MountFrameData.new(
      origin_mm: [15.0, 5.0, 2.0], # PILOT_ASSUMPTION non-identity
      basis: BasisData.new(x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0])
    )

    norm = MountFrame.derive_normalization(mount_frame_data)
    refute_nil norm

    # Applying normalization to asset origin [15, 5, 2] yields [0, 0, 0]
    pt_origin = Geom::Point3d.new(15.0 * MM, 5.0 * MM, 2.0 * MM)
    normalized = pt_origin.transform(norm.to_sketchup_transformation)

    assert_in_delta 0.0, normalized.x, 1e-4
    assert_in_delta 0.0, normalized.y, 1e-4
    assert_in_delta 0.0, normalized.z, 1e-4

    # Arbitrary asset point [100, 200, 50] -> [85, 195, 48]
    pt_test = Geom::Point3d.new(100.0 * MM, 200.0 * MM, 50.0 * MM)
    norm_test = pt_test.transform(norm.to_sketchup_transformation)

    assert_in_delta 85.0 * MM, norm_test.x, 1e-4
    assert_in_delta 195.0 * MM, norm_test.y, 1e-4
    assert_in_delta 48.0 * MM, norm_test.z, 1e-4
  end

  private

  def compute_transform_determinant(trans)
    m = trans.to_a
    ((m[0] * ((m[5] * m[10]) - (m[6] * m[9]))) -
      (m[1] * ((m[4] * m[10]) - (m[6] * m[8])))) +
      (m[2] * ((m[4] * m[9]) - (m[5] * m[8])))
  end

  def build_merivobox_pilot_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
    delta_w = width_mm - 600.0
    is450 = (nominal_depth_mm - 450.0).abs < 1e-4
    hw_id = is450 ? 'hw-merivobox-450' : 'hw-merivobox-500'
    rev_id = is450 ? 'rev-mbx-450-1' : 'rev-mbx-500-1'
    bottom_length = nominal_depth_mm - 16.0 # REAL_VERIFIED: NL - 16
    bottom_width = width_mm - 58.0          # REAL_VERIFIED: LW - 58

    {
      'furnitureDefinitionId' => '50000000-0000-0000-0000-0000000000d1',
      'definitionName' => "MERIVOBOX Mueble #{width_mm.to_i}",
      'transformContract' => 'granete.local-basis.v1',
      'dimensionsMm' => [width_mm, 720.0, 560.0],
      'components' => [
        {
          'componentInstanceId' => 'cabinet-side-l',
          'name' => 'Lateral Carcasa',
          'slotId' => 'lateral_carcasa',
          'widthMm' => 18.0,
          'thicknessMm' => 560.0,
          'lengthMm' => 720.0,
          'localTransform' => {
            'translationMm' => [0.0, 0.0, 0.0],
            'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
          }
        }
      ],
      'assemblies' => [
        {
          'assemblyInstanceId' => 'inst-merivobox-1',
          'agregadoId' => 'agr-merivobox-m',
          'recipeRevision' => 1,
          'isHistorical' => false,
          'dimensionsMm' => [width_mm, 200.0, nominal_depth_mm],
          'commercialKitHardwareId' => 'kit-merivobox-m',
          'placement' => {
            'translationMm' => [0.0, 50.0, 100.0],
            'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
          },
          'rigidMembers' => [
            {
              'memberId' => 'side-left',
              'role' => 'drawer_side_left',
              'name' => 'Lateral Izquierdo',
              'hardwareId' => hw_id,
              'assetId' => 'ast-mbx-side',
              'assetRevisionId' => 'rev-mbx-side-1',
              'preparationState' => 'prepared',
              'mountFrame' => {
                'originMm' => [15.0, 5.0, 2.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'localTransform' => {
                'translationMm' => [0.0, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            },
            {
              'memberId' => 'side-right',
              'role' => 'drawer_side_right',
              'name' => 'Lateral Derecho',
              'hardwareId' => hw_id,
              'assetId' => 'ast-mbx-side',
              'assetRevisionId' => 'rev-mbx-side-1',
              'preparationState' => 'prepared',
              'mountFrame' => {
                'originMm' => [15.0, 5.0, 2.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'localTransform' => {
                'translationMm' => [600.0 + delta_w, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            },
            {
              'memberId' => 'runner-left',
              'role' => 'runner_left',
              'name' => 'Guía Izquierda',
              'hardwareId' => hw_id,
              'assetId' => 'ast-mbx-runner',
              'assetRevisionId' => rev_id,
              'preparationState' => 'prepared',
              'mountFrame' => {
                'originMm' => [15.0, 5.0, 2.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'localTransform' => {
                'translationMm' => [0.0, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            },
            {
              'memberId' => 'runner-right',
              'role' => 'runner_right',
              'name' => 'Guía Derecha',
              'hardwareId' => hw_id,
              'assetId' => 'ast-mbx-runner',
              'assetRevisionId' => rev_id,
              'preparationState' => 'prepared',
              'mountFrame' => {
                'originMm' => [15.0, 5.0, 2.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'localTransform' => {
                'translationMm' => [600.0 + delta_w, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            }
          ],
          'fabricatedComponents' => [
            {
              'componentId' => 'comp-bottom',
              'name' => 'Fondo MERIVOBOX',
              'slotId' => 'drawer_bottom',
              'widthMm' => bottom_width,
              'thicknessMm' => 16.0,
              'lengthMm' => bottom_length,
              'materialColorHex' => '#e0d8cc',
              'localTransform' => {
                'translationMm' => [29.0, 16.0, 16.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            },
            {
              'componentId' => 'comp-back',
              'name' => 'Trasera MERIVOBOX',
              'slotId' => 'drawer_back',
              'widthMm' => bottom_width,
              'thicknessMm' => 16.0,
              'lengthMm' => 69.0,
              'materialColorHex' => '#e0d8cc',
              'localTransform' => {
                'translationMm' => [29.0, bottom_length, 32.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            }
          ]
        }
      ]
    }
  end
end
