# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/assets/mount_frame'
require_relative '../../src/granete_for_sketchup/tools/mount_frame_tool'
require_relative '../../src/granete_for_sketchup/ui/mount_frame_host_preview'
require_relative '../../src/granete_for_sketchup/ui/mount_frame_preparer_controller'

class MountFramePreparerTest < Minitest::Test
  MountFrame = Granete::SketchUpExtension::Assets::MountFrame
  MountFrameTool = Granete::SketchUpExtension::Tools::MountFrameTool
  MountFrameHostPreview = Granete::SketchUpExtension::UserInterface::MountFrameHostPreview
  MountFramePreparerController = Granete::SketchUpExtension::UserInterface::MountFramePreparerController

  class FakeLogger
    attr_reader :infos, :warns, :errors

    def initialize
      @infos = []
      @warns = []
      @errors = []
    end

    def info(msg, **data)
      @infos << [msg, data]
    end

    def warn(msg, **data)
      @warns << [msg, data]
    end

    def error(msg, **data)
      @errors << [msg, data]
    end
  end

  class FakeTransport
    attr_reader :requests

    def initialize(responses = {})
      @responses = responses
      @requests = []
    end

    def request(req, authorization_header: nil)
      @requests << { req: req, auth: authorization_header }
      path = req['path']
      method = req['method'] || 'GET'
      key = "#{method} #{path}"
      @responses[key] || @responses[path] || { 'id' => 'default-resp' }
    end
  end

  class FakeAuthProvider
    def authorization_header
      'Bearer fake-token'
    end
  end

  class FakeDownloader
    attr_reader :downloaded

    def initialize(path_to_return)
      @path_to_return = path_to_return
      @downloaded = []
    end

    def download_asset(asset_id:, revision_id:, sha256:, expected_bytes:)
      @downloaded << {
        asset_id: asset_id,
        revision_id: revision_id,
        sha256: sha256,
        expected_bytes: expected_bytes
      }
      @path_to_return
    end
  end

  class FakeValidator
    def validate_skp_file(_path)
      { valid: true, error: nil }
    end
  end

  class MockDefinition
    attr_reader :name, :instances, :attributes
    attr_accessor :bounds

    def initialize(name = 'handle.skp')
      @name = name
      @instances = []
      @attributes = {}
      @bounds = Geom::BoundingBox.new(3.7795, 0.7874, 1.1811) # ~96mm x 20mm x 30mm in inches
      @valid = true
    end

    def valid?
      @valid
    end

    def set_attribute(dict, key, value)
      @attributes["#{dict}:#{key}"] = value
    end

    def get_attribute(dict, key, _default = nil)
      @attributes["#{dict}:#{key}"]
    end

    def entities
      self
    end

    def clear!
      @cleared = true
    end
  end

  class MockGroup
    attr_reader :entities, :attributes
    attr_accessor :valid

    def initialize
      @attributes = {}
      @entities = MockEntities.new
      @valid = true
    end

    def valid?
      @valid
    end

    def set_attribute(dict, key, value)
      @attributes["#{dict}:#{key}"] = value
    end

    def get_attribute(dict, key, _default = nil)
      @attributes["#{dict}:#{key}"]
    end
  end

  class MockEntities
    attr_reader :added_instances, :erased

    def initialize
      @added_instances = []
      @erased = []
    end

    def add_instance(definition, transformation)
      @added_instances << { definition: definition, transform: transformation }
    end

    def add_group
      MockGroup.new
    end

    def erase_entities(entity)
      entity.valid = false if entity.respond_to?(:valid=)
      @erased << entity
    end
  end

  class MockDefinitions
    attr_reader :definitions, :removed

    def initialize
      @definitions = []
      @removed = []
    end

    def load(_path)
      defn = MockDefinition.new
      @definitions << defn
      defn
    end

    def remove(definition)
      @removed << definition
      @definitions.delete(definition)
    end
  end

  class MockModel
    attr_reader :definitions, :active_entities, :operations

    def initialize
      @definitions = MockDefinitions.new
      @active_entities = MockEntities.new
      @operations = []
      @current_tool = nil
    end

    def start_operation(name, _flags = nil)
      @operations << { name: name, state: :started }
    end

    def commit_operation
      @operations << { state: :committed }
    end

    def select_tool(tool)
      @current_tool = tool
    end

    def tools
      self
    end

    def active_tool
      @current_tool
    end

    def active_view
      self
    end

    def invalidate; end
  end

  # --- Tool Tests ---

  def test_mount_frame_tool_initial_state
    tool = MountFrameTool.new(expected_hole_spacing_mm: 96.0)
    assert_equal :pick_a, tool.step
    assert_nil tool.point_a_mm
    assert_nil tool.point_b_mm
    assert_nil tool.mount_frame
    refute tool.normal_inverted
  end

  def test_mount_frame_tool_sets_points_and_computes_basis
    tool = MountFrameTool.new(expected_hole_spacing_mm: 96.0)
    tool.set_points([0.0, 0.0, 0.0], [96.0, 0.0, 0.0])

    assert_equal :ready, tool.step
    assert_equal 96.0, tool.measured_spacing_mm

    mf = tool.mount_frame
    refute_nil mf
    assert_equal [48.0, 0.0, 0.0], mf.origin_mm
    assert_in_delta 1.0, mf.basis.x[0], 1e-4
    assert_in_delta 0.0, mf.basis.x[1], 1e-4
    assert_in_delta 0.0, mf.basis.x[2], 1e-4

    # Default outward normal +Z is [0, 0, 1]
    assert_equal [0.0, 0.0, 1.0], mf.basis.z
    # Y = Z x X = [0, 1, 0]
    assert_in_delta 0.0, mf.basis.y[0], 1e-4
    assert_in_delta 1.0, mf.basis.y[1], 1e-4
    assert_in_delta 0.0, mf.basis.y[2], 1e-4
  end

  def test_mount_frame_tool_inverts_normal
    tool = MountFrameTool.new(expected_hole_spacing_mm: 96.0)
    tool.set_points([0.0, 0.0, 0.0], [96.0, 0.0, 0.0])

    tool.invert_normal!
    assert tool.normal_inverted

    mf = tool.mount_frame
    assert_equal [0.0, 0.0, -1.0], mf.basis.z
    # Y = Z x X = [0, 0, -1] x [1, 0, 0] = [0, -1, 0]
    assert_in_delta 0.0, mf.basis.y[0], 1e-4
    assert_in_delta(-1.0, mf.basis.y[1], 1e-4)
    assert_in_delta 0.0, mf.basis.y[2], 1e-4

    # Toggling again returns to original normal
    tool.invert_normal!
    refute tool.normal_inverted
    assert_equal [0.0, 0.0, 1.0], tool.mount_frame.basis.z
  end

  def test_mount_frame_tool_spacing_comparison
    tool = MountFrameTool.new(expected_hole_spacing_mm: 96.0, tolerance_mm: 2.0)
    tool.set_points([0.0, 0.0, 0.0], [96.0, 0.0, 0.0])

    # Within tolerance returns nil (no discrepancy)
    assert_nil tool.spacing_comparison

    # Now with out of tolerance spacing
    tool.set_points([0.0, 0.0, 0.0], [100.0, 0.0, 0.0])
    comp = tool.spacing_comparison
    refute_nil comp
    assert_in_delta 4.0, comp['delta_mm'], 1e-4
    assert_equal 'distancia_entre_agujeros', comp['dimension']
  end

  def test_mount_frame_tool_reset
    tool = MountFrameTool.new(expected_hole_spacing_mm: 96.0)
    tool.set_points([0.0, 0.0, 0.0], [96.0, 0.0, 0.0])
    assert_equal :ready, tool.step

    tool.reset!
    assert_equal :pick_a, tool.step
    assert_nil tool.point_a_mm
    assert_nil tool.point_b_mm
    assert_nil tool.mount_frame
    refute tool.normal_inverted
  end

  def test_mount_frame_tool_origin_and_axis_mode
    # Test origin + axis reference mode (for hinges / single-anchor hardware)
    origin = [25.0, -15.0, 10.0]
    axis_pt = [25.0, 35.0, 10.0] # 50mm along +Y in raw asset space
    tool = MountFrameTool.new(anchor_mode: :origin_and_axis)
    tool.set_origin_and_axis(origin, axis_pt)

    assert_equal :ready, tool.step
    assert_equal :origin_and_axis, tool.anchor_mode

    mf = tool.mount_frame
    refute_nil mf
    # In origin_and_axis mode, origin is Point A directly
    assert_equal origin, mf.origin_mm

    # Longitudinal axis X points from A to B: [0, 50, 0] normalized -> [0, 1, 0]
    assert_in_delta 0.0, mf.basis.x[0], 1e-4
    assert_in_delta 1.0, mf.basis.x[1], 1e-4
    assert_in_delta 0.0, mf.basis.x[2], 1e-4

    # Default normal Z is [0, 0, 1]
    assert_in_delta 0.0, mf.basis.z[0], 1e-4
    assert_in_delta 0.0, mf.basis.z[1], 1e-4
    assert_in_delta 1.0, mf.basis.z[2], 1e-4

    # Y = Z x X = [0, 0, 1] x [0, 1, 0] = [-1, 0, 0]
    assert_in_delta(-1.0, mf.basis.y[0], 1e-4)
    assert_in_delta 0.0, mf.basis.y[1], 1e-4
    assert_in_delta 0.0, mf.basis.y[2], 1e-4

    # Validate basis is right-handed and orthonormal
    assert MountFrame.validate_basis!(mf.basis)
  end

  def test_mount_frame_tool_origin_and_axis_invert_normal
    origin = [25.0, -15.0, 10.0]
    axis_pt = [25.0, 35.0, 10.0]
    tool = MountFrameTool.new(anchor_mode: :origin_and_axis)
    tool.set_origin_and_axis(origin, axis_pt)

    tool.invert_normal!
    assert tool.normal_inverted

    mf = tool.mount_frame
    # Inverted normal Z is [0, 0, -1]
    assert_equal [0.0, 0.0, -1.0], mf.basis.z
    # Y = Z x X = [0, 0, -1] x [0, 1, 0] = [1, 0, 0]
    assert_in_delta 1.0, mf.basis.y[0], 1e-4
    assert_in_delta 0.0, mf.basis.y[1], 1e-4
    assert_in_delta 0.0, mf.basis.y[2], 1e-4

    assert MountFrame.validate_basis!(mf.basis)
  end

  def test_mount_frame_tool_defaults_to_midpoint_without_anchor_mode_or_spacing
    # R2 regression: absent anchorMode AND absent expectedHoleSpacingMm
    # must strictly default to legacy midpoint mode without guessing hardware topology.
    tool = MountFrameTool.new(expected_hole_spacing_mm: nil, anchor_mode: nil)
    assert_equal :midpoint, tool.anchor_mode

    # Points A and B define midpoint anchor
    tool.set_points([0.0, 0.0, 0.0], [128.0, 0.0, 0.0])
    assert_equal [64.0, 0.0, 0.0], tool.mount_frame.origin_mm
  end

  def test_mount_frame_tool_set_anchor_mode_switches_and_resets
    tool = MountFrameTool.new
    assert_equal :midpoint, tool.anchor_mode

    tool.set_points([0.0, 0.0, 0.0], [96.0, 0.0, 0.0])
    assert_equal :ready, tool.step
    refute_nil tool.mount_frame

    # Switching mode resets state and updates anchor_mode
    tool.set_anchor_mode(:origin_axis_plane)
    assert_equal :origin_axis_plane, tool.anchor_mode
    assert_equal :pick_a, tool.step
    assert_nil tool.point_a_mm
    assert_nil tool.mount_frame
  end

  def test_mount_frame_tool_origin_axis_plane_step_by_step_picking
    tool = MountFrameTool.new(anchor_mode: :origin_axis_plane)
    assert_equal :pick_a, tool.step

    # Step 1: Click A (origin)
    tool.send(:handle_click_at, [10.0, 20.0, 30.0], nil)
    assert_equal :pick_b, tool.step
    assert_equal [10.0, 20.0, 30.0], tool.point_a_mm
    assert_nil tool.mount_frame

    # Step 2: Click B (direction +X)
    tool.send(:handle_click_at, [60.0, 20.0, 30.0], nil)
    assert_equal :pick_c, tool.step
    assert_equal [60.0, 20.0, 30.0], tool.point_b_mm
    assert_nil tool.mount_frame

    # Step 3: Click C (plane reference)
    tool.send(:handle_click_at, [10.0, 70.0, 30.0], nil)
    assert_equal :ready, tool.step
    assert_equal [10.0, 70.0, 30.0], tool.point_c_mm

    mf = tool.mount_frame
    refute_nil mf
    assert_equal [10.0, 20.0, 30.0], mf.origin_mm
    assert_equal [1.0, 0.0, 0.0], mf.basis.x
    assert_equal [0.0, 1.0, 0.0], mf.basis.y
    assert_equal [0.0, 0.0, 1.0], mf.basis.z
  end

  def test_mount_frame_tool_origin_axis_plane_arbitrary_cad_orientation_r1_proof
    # R1 requirement:
    # Completely unaligned with global axes:
    #   origin != 0
    #   X != global X/Y/Z
    #   Z != global ±Z
    # Demonstrate:
    #   T_norm = inverse(T_mountFrame)
    #   mount origin -> canonical origin
    #   det = +1
    #   scale = [1,1,1]
    #   distances preserved across arbitrary physical points.
    origin = [120.0, -45.0, 78.0]
    # Vector AB: [30.0, 60.0, 60.0] -> dir: [1/3, 2/3, 2/3]
    pt_b = [150.0, 15.0, 138.0]
    # Vector AC: [40.0, 20.0, -40.0] -> dir: [2/3, 1/3, -2/3] (perpendicular to AB)
    pt_c = [160.0, -25.0, 38.0]

    tool = MountFrameTool.new(anchor_mode: :origin_axis_plane)
    tool.set_origin_axis_plane(origin, pt_b, pt_c)

    assert_equal :ready, tool.step
    mf = tool.mount_frame
    refute_nil mf

    # Origin check
    assert_equal origin, mf.origin_mm
    refute_equal [0.0, 0.0, 0.0], mf.origin_mm

    # X axis is unaligned with any global axis: [1/3, 2/3, 2/3]
    assert_in_delta(1.0 / 3.0, mf.basis.x[0], 1e-4)
    assert_in_delta(2.0 / 3.0, mf.basis.x[1], 1e-4)
    assert_in_delta(2.0 / 3.0, mf.basis.x[2], 1e-4)
    refute_equal [1.0, 0.0, 0.0], mf.basis.x
    refute_equal [0.0, 1.0, 0.0], mf.basis.x
    refute_equal [0.0, 0.0, 1.0], mf.basis.x

    # Z axis is normal to plane: [-2/3, 2/3, -1/3] -> NOT global ±Z
    assert_in_delta(-2.0 / 3.0, mf.basis.z[0], 1e-4)
    assert_in_delta(2.0 / 3.0, mf.basis.z[1], 1e-4)
    assert_in_delta(-1.0 / 3.0, mf.basis.z[2], 1e-4)
    refute_equal [0.0, 0.0, 1.0], mf.basis.z
    refute_equal [0.0, 0.0, -1.0], mf.basis.z

    # Orthonormal basis validation with det = +1
    assert MountFrame.validate_basis!(mf.basis)

    # Derive normalization and prove:
    # 1. Mount origin maps EXACTLY to canonical [0, 0, 0]
    norm = MountFrame.derive_normalization(mf)
    canonical_origin = norm.apply(origin)
    assert_in_delta 0.0, canonical_origin[0], 1e-4
    assert_in_delta 0.0, canonical_origin[1], 1e-4
    assert_in_delta 0.0, canonical_origin[2], 1e-4

    # 2. Point B along +X maps to [+X, 0, 0]
    canonical_b = norm.apply(pt_b)
    dist_ab = MountFrame.distance(origin, pt_b)
    assert_in_delta dist_ab, canonical_b[0], 1e-4
    assert_in_delta 0.0, canonical_b[1], 1e-4
    assert_in_delta 0.0, canonical_b[2], 1e-4

    # 3. Distance preservation across arbitrary test points
    p1 = [135.0, 10.0, 50.0]
    p2 = [90.0, -80.0, 120.0]
    p3 = [200.0, -10.0, -15.0]
    assert norm.distance_preserved?(origin, pt_b)
    assert norm.distance_preserved?(origin, pt_c)
    assert norm.distance_preserved?(p1, p2)
    assert norm.distance_preserved?(p2, p3)
    assert norm.distance_preserved?(p1, p3)

    # 4. Invert normal preserves det = +1 and scale = [1, 1, 1]
    tool.invert_normal!
    assert tool.normal_inverted
    mf_inv = tool.mount_frame
    assert MountFrame.validate_basis!(mf_inv.basis)
    assert_in_delta(2.0 / 3.0, mf_inv.basis.z[0], 1e-4)
    assert_in_delta(-2.0 / 3.0, mf_inv.basis.z[1], 1e-4)
    assert_in_delta(1.0 / 3.0, mf_inv.basis.z[2], 1e-4)

    norm_inv = MountFrame.derive_normalization(mf_inv)
    canonical_origin_inv = norm_inv.apply(origin)
    assert_in_delta 0.0, canonical_origin_inv[0], 1e-4
    assert_in_delta 0.0, canonical_origin_inv[1], 1e-4
    assert_in_delta 0.0, canonical_origin_inv[2], 1e-4
    assert norm_inv.distance_preserved?(p1, p2)
  end

  # --- Host Preview Tests ---

  def test_host_preview_load_and_extract_bounds
    preview = MountFrameHostPreview.new
    model = MockModel.new
    session_id = 'session-123'

    defn = preview.load_definition(model, '/path/to/handle.skp', session_id)
    refute_nil defn
    assert_equal session_id, defn.get_attribute('granete_preparer', 'session_id')

    bounds = preview.extract_measured_bounds(defn)
    refute_nil bounds
    assert_in_delta 96.0, bounds['widthMm'], 0.5
    assert_in_delta 20.0, bounds['heightMm'], 0.5
    assert_in_delta 30.0, bounds['depthMm'], 0.5
  end

  def test_host_preview_selective_cleanup
    preview = MountFrameHostPreview.new
    model = MockModel.new
    session_id = 'session-abc'

    defn = preview.load_definition(model, '/path/to/handle.skp', session_id)
    group = preview.create_preview_group(model, defn, session_id)
    assert group.valid?

    # Cleanup with matching session ID and 0 external instances
    preview.cleanup_preview(model, group, defn, session_id)
    refute group.valid?
    assert_includes model.definitions.removed, defn
  end

  def test_host_preview_cleanup_does_not_remove_definition_with_instances
    preview = MountFrameHostPreview.new
    model = MockModel.new
    session_id = 'session-safe'

    defn = preview.load_definition(model, '/path/to/handle.skp', session_id)
    defn.instances << 'external_instance_in_model'
    group = preview.create_preview_group(model, defn, session_id)

    preview.cleanup_preview(model, group, defn, session_id)
    refute group.valid? # Group is erased
    refute_includes model.definitions.removed, defn # Definition is preserved
  end

  # --- Controller Tests ---

  def test_preparer_controller_start_and_derive
    logger = FakeLogger.new
    temp_skp = File.join(Dir.tmpdir, "test_handle_#{rand(10_000)}.skp")
    File.write(temp_skp, 'dummy skp')

    downloader = FakeDownloader.new(temp_skp)
    validator = FakeValidator.new
    auth_provider = FakeAuthProvider.new

    asset_id = 'asset-handle-96'
    source_rev_id = 'rev-001'

    transport = FakeTransport.new({
                                    "GET /hardware-assets/#{asset_id}" => {
                                      'id' => asset_id,
                                      'display_name' => 'Tirador Barral 96mm',
                                      'revisions' => [
                                        {
                                          'id' => source_rev_id,
                                          'revision_number' => 1,
                                          'sha256' => ('a' * 64),
                                          'size_bytes' => 1024,
                                          'origin' => { 'source_units' => 'mm', 'up_axis' => 'z' }
                                        }
                                      ]
                                    },
                                    "POST /hardware-assets/#{asset_id}/revisions:derive" => {
                                      'id' => 'rev-002',
                                      'revision_number' => 2,
                                      'preparation_state' => 'prepared',
                                      'origin' => {
                                        'mount_frame' => { 'origin_mm' => [48.0, 0.0, 0.0] },
                                        'asset_normalization' => { 'translation_mm' => [-48.0, 0.0, 0.0] }
                                      }
                                    }
                                  })

    controller = MountFramePreparerController.new(
      downloader: downloader,
      validator: validator,
      transport: transport,
      auth_provider: auth_provider,
      logger: logger
    )

    # Verify build_derive_request payload structure
    controller.instance_variable_set(:@source_revision, {
                                       'id' => source_rev_id,
                                       'origin' => { 'source_units' => 'mm', 'up_axis' => 'z' }
                                     })

    tool = MountFrameTool.new(expected_hole_spacing_mm: 96.0)
    tool.set_points([0.0, 0.0, 0.0], [96.0, 0.0, 0.0])
    controller.instance_variable_set(:@tool, tool)

    derive_req = controller.send(:build_derive_request)
    assert_equal source_rev_id, derive_req['source_revision_id']
    origin = derive_req['origin']
    assert_equal 'mm', origin['source_units']
    assert_equal 'z', origin['up_axis']
    assert_equal [48.0, 0.0, 0.0], origin['mount_frame']['origin_mm']
    assert_equal [-48.0, 0.0, 0.0], origin['asset_normalization']['translation_mm']

    FileUtils.rm_f(temp_skp)
  end
end
