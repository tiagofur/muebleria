# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# #469 real-host rehearsal: preview → cancel → place → undo → redo against
# the INSTALLED extension, a REAL host model/view and the canonical place
# command with a scripted backend. Invariants pinned on the host:
#   * the transient preview never creates entities/definitions/metadata;
#   * Esc cancels with zero residue and the unit stays pending;
#   * the click commits the accepted transform with the SAME
#     furnitureInstanceId, no creation request, one undo operation;
#   * undo removes exactly the placement and redo restores the same
#     identity;
#   * cursor movement performs InputPoint picking only (no transport —
#     proven by the tool's construction plus this suite's request journal).
module Granete
  module SketchUpExtension
    class TC_PlacementPreviewSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      REVISION_R1 = '53000000-0000-0000-0000-000000000001'
      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FI_2 = '51000000-0000-0000-0000-0000000000f2'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      def fail_closed_unless_installed_extension_is_loaded
        extension = self.class.installed_extension
        flunk 'Install the Granete for SketchUp RBZ before running the host smoke' unless extension
        flunk 'Enable the installed extension and restart SketchUp before the host smoke' unless extension.loaded?
      end

      def fail_closed_if_loaded_from_checkout
        runtime_path = Granete::SketchUpExtension::Runtime.method(:start).source_location&.first
        flunk 'Installed Granete runtime is not loaded' if runtime_path.nil?

        expanded = File.expand_path(runtime_path)
        unless expanded.include?("#{File::SEPARATOR}Plugins#{File::SEPARATOR}")
          flunk "Granete runtime loaded outside the Plugins folder: #{expanded}"
        end
        return unless expanded.start_with?(REPOSITORY_ROOT + File::SEPARATOR)

        flunk 'Host smoke must test the installed RBZ, not the repository checkout'
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        Connection::ModelBinding::Store.new(model).write!(
          Connection::ModelBinding::Binding.new(
            project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: REVISION_R1
          )
        )
      end

      def teardown
        Sketchup.file_new
      end

      # The full walk on the real host. NOT_RUN in sessions without the
      # owner-installed SketchUp; never simulated.
      def test_preview_cancel_place_undo_redo_golden_sequence
        transport = ScriptedTransport.new
        transport.stub_working_copy([])
        placer = build_placer(transport)

        # --- Preparation (outside the cursor loop, server-authoritative).
        prepared = placer.prepare_placement_preview(FI_1)
        assert prepared['ok'], "prepare failed: #{prepared.inspect}"
        extents = Tools::FurniturePlacementTool.extents_from_layout(prepared['layout'])
        refute_nil extents, 'the authoritative layout must yield preview extents'

        entities_before = model.entities.count
        definitions_before = granete_definition_count
        commits = []
        tool = Tools::FurniturePlacementTool.new(
          label: prepared['definition']['name'], extents_mm: extents,
          on_commit: ->(transform) { commits << placer.place(FI_1, transformation: transform) },
          on_cancel: ->(_reason) {},
          model_provider: -> { Sketchup.active_model }
        )
        model.select_tool(tool)
        tool.activate

        # --- Rehearsal 1: Esc cancels with zero residue.
        move_to_view_center(tool)
        tool.draw(model.active_view)
        assert tool.active?
        assert_equal entities_before, model.entities.count,
                     'the preview must not create host entities'
        assert_equal definitions_before, granete_definition_count,
                     'the preview must not create productive definitions'
        assert_nil Connection::ProjectFurniture::ManagedFurniture
          .locate(model, Metadata::Store.new(model), FI_1)['entity'],
                   'the preview must stay invisible to managed scans'
        assert_empty transport.requests.select { |r| r['method'] == 'PUT' },
                     'the preview must not touch the working copy'

        tool.onKeyDown(27, false, 0, model.active_view) # Esc
        assert tool.cancelled?
        assert_equal entities_before, model.entities.count, 'cancel leaves zero residue'
        assert_empty commits

        # --- Rehearsal 2: click commits once, same identity, one undo op.
        tool2 = reactivate_preview(placer, extents, commits)
        move_to_view_center(tool2)
        click_view_center(tool2)
        click_view_center(tool2) # double click: one gesture only

        assert_equal 1, commits.length, 'a double click must commit exactly once'
        assert commits.first['ok'], commits.first.inspect

        located = Connection::ProjectFurniture::ManagedFurniture
                  .locate(model, Metadata::Store.new(model), FI_1)
        assert located['entity'], 'the committed placement must exist'
        assert_equal 1, located['duplicates'], 'no second unit may appear'
        # Prohibit FurnitureInstance CREATION specifically: binding:validate
        # is a legitimate POST the guards issue; creating business identity
        # while placing an existing unit is the actual invariant.
        instance_creations = transport.requests.select do |request|
          request['method'] == 'POST' && request['path'].match?(%r{/furniture-instances})
        end
        assert_empty instance_creations,
                     'placing an existing unit never creates business identity'

        root = located['entity']
        stored = Connection::ProjectFurniture::TransformContract.from_host(root.transformation)
        refute_nil stored, 'the committed root carries a contract-level transform'
        assert_in_delta 1.0, root.transformation.zaxis.z, 1e-6,
                        'the accepted transform keeps Z vertical (rigid yaw, no tilt)'

        # --- Undo: exactly the one placement operation disappears.
        entities_after_place = model.entities.count
        Sketchup.undo
        assert_equal entities_after_place - 1, model.entities.count,
                     'undo must remove exactly the placed top-level instance'
        assert_nil Connection::ProjectFurniture::ManagedFurniture
          .locate(model, Metadata::Store.new(model), FI_1)['entity'],
                   'undo removes the managed root'

        # --- Redo: the same identity returns.
        Sketchup.redo
        restored = Connection::ProjectFurniture::ManagedFurniture
                   .locate(model, Metadata::Store.new(model), FI_1)['entity']
        refute_nil restored, 'redo restores the placement'
        restored_metadata = Metadata::Store.new(model).read(restored)
        assert_equal FI_1, restored_metadata.dig('identity', 'furnitureInstanceId'),
                     'redo restores the SAME business identity'
      ensure
        model.select_tool(nil)
      end

      # #469 increment 2 — semantic snap walk on the REAL host: wall/face
      # snap with orientation, furniture side-to-side against a managed
      # root, exact mm gap through the VCB path, cancel with a live snap
      # and undo. NOT_RUN in sessions without the owner-installed host.
      def test_semantic_snaps_wall_side_gap_and_undo
        transport = ScriptedTransport.new
        transport.stub_working_copy([])
        placer = build_placer(transport)
        mm = 25.4

        # --- Fixture: a wall face at x=0 facing +X and a floor face z=0.
        wall = model.entities.add_face(
          [Geom::Point3d.new(0, 0, 0),
           Geom::Point3d.new(0, 4000 / mm, 0),
           Geom::Point3d.new(0, 4000 / mm, 3000 / mm),
           Geom::Point3d.new(0, 0, 3000 / mm)]
        )
        wall.reverse! if wall.normal.x.negative?
        model.entities.add_face(
          [Geom::Point3d.new(0, 0, 0),
           Geom::Point3d.new(6000 / mm, 0, 0),
           Geom::Point3d.new(6000 / mm, 4000 / mm, 0),
           Geom::Point3d.new(0, 4000 / mm, 0)]
        )

        prepared = placer.prepare_placement_preview(FI_1)
        assert prepared['ok'], prepared.inspect
        extents = Tools::FurniturePlacementTool.extents_from_layout(prepared['layout'])

        # --- Wall snap: aim at the wall face; the back face must align to
        # the plane and the front must face +X (away from the wall).
        aim_view_at(Geom::Point3d.new(0, 1500 / mm, 900 / mm))
        commits = []
        tool = snap_tool(placer, extents, commits, FI_1)
        move_to_view_center(tool)
        assert tool.active_snap, 'hovering the wall face must produce a snap'
        assert_equal :face, tool.active_snap[:primary][:kind]
        assert_in_delta 1.0, tool.active_snap[:front_dir_mm][0], 1e-6, 'front maps to +X'
        assert_in_delta 0.0, tool.active_snap[:front_dir_mm][1], 1e-6

        # --- Exact gap through the VCB path: 40mm off the wall.
        assert_equal true, tool.onUserText('40', model.active_view)
        click_view_center(tool)
        assert_equal 1, commits.length
        assert commits.first['ok'], commits.first.inspect
        root = Connection::ProjectFurniture::ManagedFurniture
               .locate(model, Metadata::Store.new(model), FI_1)['entity']
        assert root, 'the snapped placement must exist'
        box = root.bounds
        assert_in_delta 40.0, box.min.x * mm, 5.0,
                        'the back face rests 40mm off the wall (VCB gap)'
        Sketchup.undo # remove the placed unit; keep the fixture clean

        # --- Furniture side-to-side: FI_1 is placed canonically as the
        # neighbor; FI_2 is placed by the preview aiming right of the
        # neighbor's right side (gap 0, then exactly 5mm via the VCB).
        neighbor_place = placer.place(FI_1, transformation: Geom::Transformation.new)
        assert neighbor_place['ok'], neighbor_place.inspect
        neighbor = Connection::ProjectFurniture::ManagedFurniture
                   .locate(model, Metadata::Store.new(model), FI_1)['entity']
        refute_nil neighbor, 'the neighbor unit must be placed'
        side_x_mm = neighbor.bounds.max.x * mm
        aim_view_at(Geom::Point3d.new((side_x_mm + 100) / mm, 300 / mm, 0))
        commits2 = []
        tool2 = snap_tool(placer, extents, commits2, FI_2)
        move_to_view_center(tool2)
        side = tool2.active_snap && tool2.active_snap[:components]
                                         .find { |c| c[:kind] == :furniture_side }
        assert side, 'a Granete-managed neighbor must be offered as a side target'
        assert_equal FI_1, side[:furniture_instance_id]

        assert_equal true, tool2.onUserText('5', model.active_view)
        click_view_center(tool2)
        assert_equal 1, commits2.length
        assert commits2.first['ok'], commits2.first.inspect
        placed2 = Connection::ProjectFurniture::ManagedFurniture
                  .locate(model, Metadata::Store.new(model), FI_2)['entity']
        refute_nil placed2, 'FI_2 must be placed'
        assert_in_delta side_x_mm + 5.0, placed2.bounds.min.x * mm, 5.0,
                        'the new left side rests 5mm off the neighbor right side'
        Sketchup.undo

        # --- Cancel with a live snap leaves zero residue.
        aim_view_at(Geom::Point3d.new(0, 1500 / mm, 900 / mm))
        commits3 = []
        tool3 = snap_tool(placer, extents, commits3, FI_2)
        move_to_view_center(tool3)
        assert tool3.active_snap
        entities_before = model.entities.count
        tool3.onKeyDown(27, false, 0, model.active_view) # Esc
        assert tool3.cancelled?
        assert_empty commits3
        assert_equal entities_before, model.entities.count, 'cancel keeps zero residue'
      ensure
        model.select_tool(nil)
      end

      # #469 increment 3 — arbitrary-angle walk on the REAL host: a wall at
      # 30° (snap + exact 40mm gap along the rotated normal), the SAME wall
      # reversed (identical physical placement), a managed neighbor rotated
      # 30° around Z (side-to-side with a 5mm gap, fronts parallel),
      # wall+floor composition fed with REAL host face geometry, and
      # cancel/undo guarantees. NOT_RUN in sessions without the
      # owner-installed host.
      def test_arbitrary_angle_wall_neighbor_composition_and_undo
        transport = ScriptedTransport.new
        transport.stub_working_copy([])
        placer = build_placer(transport)
        mm = 25.4
        n = [0.5, Math.sqrt(3.0) / 2.0, 0.0] # 30° wall normal (room side)
        tangent = [-n[1], n[0], 0.0] # wall run direction

        # --- Fixture: floor (covering the aim's XY — base planes are
        # spatially FINITE now) + a vertical wall rotated 30°.
        model.entities.add_face(
          [Geom::Point3d.new(-6000 / mm, -4000 / mm, 0),
           Geom::Point3d.new(6000 / mm, -4000 / mm, 0),
           Geom::Point3d.new(6000 / mm, 4000 / mm, 0),
           Geom::Point3d.new(-6000 / mm, 4000 / mm, 0)]
        )
        wall = model.entities.add_face(
          [Geom::Point3d.new(0, 0, 0),
           Geom::Point3d.new((tangent[0] * 4000) / mm, (tangent[1] * 4000) / mm, 0),
           Geom::Point3d.new((tangent[0] * 4000) / mm, (tangent[1] * 4000) / mm, 3000 / mm),
           Geom::Point3d.new(0, 0, 3000 / mm)]
        )
        wall.reverse! if ((wall.normal.x * n[0]) + (wall.normal.y * n[1])).negative?

        prepared = placer.prepare_placement_preview(FI_1)
        assert prepared['ok'], prepared.inspect
        extents = Tools::FurniturePlacementTool.extents_from_layout(prepared['layout'])

        # --- A: wall snap at 30° + exact 40mm gap along the normal.
        aim = [(tangent[0] * 2000), (tangent[1] * 2000), 900.0]
        aim_camera_at_mm(aim, [n[0] * 4000, n[1] * 4000, 0.0])
        commits = []
        tool = snap_tool(placer, extents, commits, FI_1)
        move_to_view_center(tool)
        assert tool.active_snap, 'the 30° wall must offer a snap'
        assert_equal :face, tool.active_snap[:primary][:kind]
        assert_in_delta n[0], tool.active_snap[:front_dir_mm][0], 1e-6, 'front keeps the real 30° angle'
        assert_in_delta n[1], tool.active_snap[:front_dir_mm][1], 1e-6

        assert_equal true, tool.onUserText('40', model.active_view)
        click_view_center(tool)
        assert_equal 1, commits.length
        assert commits.first['ok'], commits.first.inspect
        root = Connection::ProjectFurniture::ManagedFurniture
               .locate(model, Metadata::Store.new(model), FI_1)['entity']
        assert root, 'the 30° snapped placement must exist'
        anchor_world = root.transformation.origin.to_a.map { |v| v * mm }
        signed_gap = (anchor_world[0] * n[0]) + (anchor_world[1] * n[1])
        assert_in_delta 40.0, signed_gap, 5.0,
                        'the back face rests exactly 40mm off the wall ALONG THE NORMAL'
        yaxis = root.transformation.yaxis
        assert_in_delta 1.0, (yaxis.x * n[0]) + (yaxis.y * n[1]), 1e-6, 'front parallel to the wall normal'
        wall_anchor_a = anchor_world
        Sketchup.undo

        # --- B: the SAME wall reversed must place identically.
        wall.reverse!
        aim_camera_at_mm(aim, [n[0] * 4000, n[1] * 4000, 0.0])
        commits_b = []
        tool_b = snap_tool(placer, extents, commits_b, FI_1)
        move_to_view_center(tool_b)
        assert tool_b.active_snap, 'the reversed 30° wall still snaps (eye resolves the room side)'
        assert_equal true, tool_b.onUserText('40', model.active_view)
        click_view_center(tool_b)
        assert_equal 1, commits_b.length
        root_b = Connection::ProjectFurniture::ManagedFurniture
                 .locate(model, Metadata::Store.new(model), FI_1)['entity']
        anchor_b = root_b.transformation.origin.to_a.map { |v| v * mm }
        assert_in_delta wall_anchor_a[0], anchor_b[0], 5.0, 'reversed wall: identical physical placement'
        assert_in_delta wall_anchor_a[1], anchor_b[1], 5.0
        Sketchup.undo
        wall.reverse!

        # --- C: managed neighbor rotated 30° around Z; FI_2 side-to-side
        # with an exact 5mm gap measured along the ORIENTED normal.
        neighbor_place = placer.place(FI_1, transformation: Geom::Transformation.new)
        assert neighbor_place['ok'], neighbor_place.inspect
        neighbor = Connection::ProjectFurniture::ManagedFurniture
                   .locate(model, Metadata::Store.new(model), FI_1)['entity']
        refute_nil neighbor
        neighbor.transformation = Geom::Transformation.rotation(
          Geom::Point3d.new(0, 0, 0), Geom::Vector3d.new(0, 0, 1), Math::PI / 6.0
        )
        front_n = [-0.5, Math.sqrt(3.0) / 2.0, 0.0] # local +Y rotated 30° about +Z
        right_n = [front_n[1], -front_n[0], 0.0]
        # The ORIENTED side plane comes from the PERSISTED placement
        # envelope the canonical commit just wrote (layout-derived box),
        # never the definition bounds.
        envelope = Metadata::Store.new(model).read(neighbor)['placementEnvelopeMm']
        refute_nil envelope, 'the canonical commit persists placementEnvelopeMm'
        side_x_mm = envelope['max_mm'][0].to_f
        run_mid_mm = ((envelope['min_mm'][1].to_f + envelope['max_mm'][1].to_f) / 2.0)
        aim_c = [(right_n[0] * (side_x_mm + 100.0)) + (front_n[0] * run_mid_mm),
                 (right_n[1] * (side_x_mm + 100.0)) + (front_n[1] * run_mid_mm), 0.0]
        aim_camera_at_mm(aim_c, [(right_n[0] * 4000) + 0.0, (right_n[1] * 4000) + 0.0, 2500.0])
        commits_c = []
        tool_c = snap_tool(placer, extents, commits_c, FI_2)
        move_to_view_center(tool_c)
        side = tool_c.active_snap && tool_c.active_snap[:components]
                                           .find { |c| c[:kind] == :furniture_side }
        assert side, 'the rotated managed neighbor must offer an ORIENTED side target'
        assert_equal FI_1, side[:furniture_instance_id]

        assert_equal true, tool_c.onUserText('5', model.active_view)
        click_view_center(tool_c)
        assert_equal 1, commits_c.length
        assert commits_c.first['ok'], commits_c.first.inspect
        placed2 = Connection::ProjectFurniture::ManagedFurniture
                  .locate(model, Metadata::Store.new(model), FI_2)['entity']
        refute_nil placed2, 'FI_2 must be placed'
        anchor_c = placed2.transformation.origin.to_a.map { |v| v * mm }
        separation = (anchor_c[0] * right_n[0]) + (anchor_c[1] * right_n[1]) - side_x_mm
        assert_in_delta 5.0, separation, 5.0,
                        'the sides separate by exactly 5mm along the ORIENTED normal'
        yaxis2 = placed2.transformation.yaxis
        assert_in_delta 1.0, (yaxis2.x * front_n[0]) + (yaxis2.y * front_n[1]), 1e-6,
                        'fronts stay parallel at 30° (no quarter-grid coercion)'
        Sketchup.undo

        # --- D (review P1): wall 30° + floor compose THROUGH THE REAL TOOL —
        # the picked wall constrains XY while the gesture-scoped base-plane
        # provider feeds the floor; preview and commit carry both. A hidden
        # floor CLOSER in Z must not even be a candidate (effective
        # visibility).
        hidden_floor = model.entities.add_face(
          [Geom::Point3d.new(-6000 / mm, -4000 / mm, 80 / mm),
           Geom::Point3d.new(6000 / mm, -4000 / mm, 80 / mm),
           Geom::Point3d.new(6000 / mm, 4000 / mm, 80 / mm),
           Geom::Point3d.new(-6000 / mm, 4000 / mm, 80 / mm)]
        )
        hidden_floor.visible = false # REAL Drawingelement#visible= API
        aim_d = [aim[0], aim[1], 100.0] # on the wall, near the floor corner
        aim_camera_at_mm(aim_d, [n[0] * 4000, n[1] * 4000, 0.0])
        commits_d = []
        tool_d = snap_tool(placer, extents, commits_d, FI_2)
        move_to_view_center(tool_d)
        assert tool_d.active_snap, 'aiming at the 30° wall near the floor must snap'
        kinds_d = tool_d.active_snap[:components].map { |c| c[:kind] }.sort
        assert_equal %i[face floor], kinds_d, 'wall + floor compose through the real tool'

        click_view_center(tool_d)
        assert_equal 1, commits_d.length
        assert commits_d.first['ok'], commits_d.first.inspect
        placed_d = Connection::ProjectFurniture::ManagedFurniture
                   .locate(model, Metadata::Store.new(model), FI_2)['entity']
        refute_nil placed_d, 'the composed placement must exist'
        anchor_d = placed_d.transformation.origin.to_a.map { |v| v * mm }
        assert_in_delta 0.0, (anchor_d[0] * n[0]) + (anchor_d[1] * n[1]), 5.0,
                        'committed back corner on the rotated wall plane'
        assert_in_delta 0.0, anchor_d[2], 5.0, 'committed base on the floor'
        Sketchup.undo

        # --- E: cancel with a live arbitrary-angle snap leaves zero residue.
        aim_camera_at_mm(aim, [n[0] * 4000, n[1] * 4000, 0.0])
        commits_e = []
        tool_e = snap_tool(placer, extents, commits_e, FI_2)
        move_to_view_center(tool_e)
        assert tool_e.active_snap
        entities_before = model.entities.count
        tool_e.onKeyDown(27, false, 0, model.active_view) # Esc
        assert tool_e.cancelled?
        assert_empty commits_e
        assert_equal entities_before, model.entities.count, 'cancel keeps zero residue'
      ensure
        model.select_tool(nil)
      end

      # #469 increment 4 — local/disconnected Biblioteca walk on the REAL
      # host: an UNBOUND model starts the shared preview through the REAL
      # dialog-controller entry point (begin_catalog_placement_preview),
      # the click commits ONE local furniture (instanceRef identity, no
      # FurnitureInstance, generic envelope) at a NON-ORIGIN transform,
      # and Esc leaves zero residue. NOT_RUN in sessions without the
      # owner-installed SketchUp; never simulated.
      def test_local_library_preview_commit_at_non_origin_and_undo
        Sketchup.file_new # the LOCAL lane runs on an UNBOUND model
        mm = 25.4
        model.entities.add_face(
          [Geom::Point3d.new(-6000 / mm, -4000 / mm, 0),
           Geom::Point3d.new(6000 / mm, -4000 / mm, 0),
           Geom::Point3d.new(6000 / mm, 4000 / mm, 0),
           Geom::Point3d.new(-6000 / mm, 4000 / mm, 0)]
        )
        aim_mm = [1500.0, 800.0, 0.0]
        aim_camera_at_mm(aim_mm, [aim_mm[0] - 3000.0, aim_mm[1] - 3000.0, 2500.0])

        catalog = LocalStaticCatalog.new
        controller = UserInterface::DialogController.new(
          logger: silent_logger, status_provider: StatusPayload.new,
          catalog_provider: catalog, project_furniture_placer: build_local_placer(catalog)
        )
        dialog = BridgeJournalDialog.new
        payload = { 'definitionId' => 'def-local', 'parameters' => { 'widthMm' => 750 },
                    'materialChoices' => { 'INTERIOR' => 'mat-roble' } }
        entities_before = model.entities.count
        definitions_before = granete_definition_count

        controller.handle_begin_catalog_placement_preview(dialog, JSON.generate(payload))
        tool = controller.instance_variable_get(:@active_placement_preview)['tool']
        assert tool.active?, 'the shared preview tool must be live on the unbound model'
        assert(dialog.scripts.any? { |s| s.include?('preview_active') })
        assert_equal entities_before, model.entities.count, 'preview creates no entities'
        assert_equal definitions_before, granete_definition_count, 'preview creates no definitions'

        # --- Esc: zero residue, honest cancel answer.
        move_to_view_center(tool)
        tool.onKeyDown(27, false, 0, model.active_view)
        assert tool.cancelled?
        assert_equal entities_before, model.entities.count, 'cancel leaves zero residue'
        assert_equal definitions_before, granete_definition_count
        assert(dialog.scripts.any? { |s| s.include?('preview_cancelled') })

        # --- Click at a NON-ORIGIN aim: one local furniture, right there.
        controller.handle_begin_catalog_placement_preview(dialog, JSON.generate(payload))
        tool = controller.instance_variable_get(:@active_placement_preview)['tool']
        move_to_view_center(tool)
        click_view_center(tool)

        assert dialog.scripts.any? { |s| s.include?('placed_via_preview') },
               'the local commit answers the library insert channel'
        roots = model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          Metadata::Store.new(model).read(entity).is_a?(Hash) &&
            Metadata::Store.new(model).read(entity)['kind'] == 'furnitureInstance'
        end
        assert_equal 1, roots.length, 'exactly one local furniture root'
        root = roots.first
        anchor = root.transformation.origin.to_a.map { |v| v * mm }
        assert_in_delta aim_mm[0], anchor[0], 5.0, 'committed at the aimed X — NOT the origin'
        assert_in_delta aim_mm[1], anchor[1], 5.0, 'committed at the aimed Y — NOT the origin'
        assert_in_delta 0.0, anchor[2], 5.0, 'the floor snap composes through the shared tool'

        metadata = Metadata::Store.new(model).read(root)
        assert metadata['identity']['instanceRef'], 'local identity is a local ref'
        assert_nil metadata['identity']['furnitureInstanceId'], 'no server identity is invented'
        assert_equal 750, metadata.dig('intent', 'parameters', 'widthMm'),
                     'the configured parameter survives the whole gesture'
        assert_equal 'mat-roble', metadata.dig('intent', 'materialChoices', 'INTERIOR')
        envelope = metadata['placementEnvelopeMm']
        assert_equal [750.0, 590.0, 720.0], envelope['max_mm'].map(&:to_f),
                     'the persisted envelope is the SAME generic box the preview showed'

        # --- #469 repeat placement: a second FULL gesture through the same
        # entry point places ANOTHER distinct local unit at its own pose.
        controller.handle_begin_catalog_placement_preview(dialog, JSON.generate(payload))
        tool = controller.instance_variable_get(:@active_placement_preview)['tool']
        aim2_mm = [2600.0, 900.0, 0.0]
        aim_camera_at_mm(aim2_mm, [aim2_mm[0] - 3000.0, aim2_mm[1] - 3000.0, 2500.0])
        move_to_view_center(tool)
        tool.onLButtonDown(0, 0, 0, model.active_view)

        roots = model.entities.grep(Sketchup::ComponentInstance)
                     .select { |e| Metadata::Store.new(model).read(e).is_a?(Hash) }
        assert_equal 2, roots.length, 'repeat placement adds a second unit'
        refs = roots.map { |r| Metadata::Store.new(model).read(r)['identity']['instanceRef'] }
        assert_equal refs.uniq.length, 2, 'each click is its own local unit'
        second_anchor = roots.last.transformation.origin.to_a.map { |v| v * mm }
        assert_in_delta aim2_mm[0], second_anchor[0], 5.0, 'the repeat lands at ITS OWN aim'

        # --- Undo removes the complete units (repeat included).
        Sketchup.undo
        Sketchup.undo
        remaining_after_undo = model.entities.grep(Sketchup::ComponentInstance)
                                    .select { |e| Metadata::Store.new(model).read(e).is_a?(Hash) }
        assert_empty remaining_after_undo, 'undo removes the whole local units'
      ensure
        model.select_tool(nil)
      end

      private

      # Shared tool factory for the snap walk: the SAME provider wiring
      # the dialog controller uses (managed neighbors by server identity
      # with the ORIENTED frame — rigid transform + the PERSISTED
      # layout-derived placement envelope, never the world AABB or the
      # definition bounds — plus the gesture-scoped horizontal base-plane
      # scan so wall+floor composes through the real tool).
      def snap_tool(placer, extents, commits, furniture_instance_id)
        metadata_store = Metadata::Store.new(model)
        provider = lambda do
          index = Connection::ProjectFurniture::ManagedFurniture.index(model, metadata_store)
          index[:by_id].flat_map do |fi_id, entries|
            next [] if entries.length != 1

            entity = entries.first[:entity]
            next [] unless entity.respond_to?(:transformation)
            next [] if entity.respond_to?(:valid?) && !entity.valid?

            frame = oriented_frame_mm(entity, metadata_store)
            next [] unless frame

            [{ 'furniture_instance_id' => fi_id,
               'label' => entity.name.to_s.sub(/\s*\([^()]*\)\s*\z/, '').strip,
               'origin_world_mm' => frame[:origin_world_mm],
               'front_dir_mm' => frame[:front_dir_mm],
               'right_dir_mm' => frame[:right_dir_mm],
               'local_min_mm' => frame[:local_min_mm],
               'local_max_mm' => frame[:local_max_mm] }]
          end
        end
        prepared = placer.prepare_placement_preview(furniture_instance_id)
        tool = Tools::FurniturePlacementTool.new(
          label: prepared['definition']['name'], extents_mm: extents,
          on_commit: lambda { |transform|
            commits << placer.place(furniture_instance_id, transformation: transform)
          },
          on_cancel: ->(_reason) {},
          model_provider: -> { Sketchup.active_model },
          furniture_targets_provider: provider,
          base_planes_provider: base_planes_provider
        )
        model.select_tool(tool)
        tool.activate
        tool
      end

      # Horizontal top-level host faces (either winding) as base planes —
      # the same gesture-scoped scan the controller wires, so the picked
      # wall and the floor COMPOSE through the real tool.
      def base_planes_provider
        lambda do
          scan_base_planes(model.entities, Geom::Transformation.new,
                           Metadata::Store.new(model), model, [])
        end
      end

      # Horizontal host faces (either winding, nested containers included
      # via the accumulated world transform — Group#entities vs
      # ComponentInstance#definition.entities, HOST-FAITHFUL; Granete
      # furniture roots PRUNED by managed metadata kind) as base planes
      # with a BOUNDING-RECTANGLE world footprint approximation —
      # mirrors the controller scan so the picked wall and the floor
      # COMPOSE through the real tool.
      def scan_base_planes(entities, world_transform, metadata_store, host_model, instance_path)
        mm = 25.4
        planes = []
        entities.each do |entity|
          child_path = instance_path + [entity]
          # EFFECTIVE visibility (real API, SU 2020+): own flag, Tag/Layer
          # and every parent under the current model state.
          visible = host_model.respond_to?(:drawing_element_visible?) &&
                    host_model.drawing_element_visible?(child_path)
          next unless visible

          case entity
          when Sketchup::Face
            normal = entity.normal.transform(world_transform)
            next unless normal.z.abs > 1.0 - 1e-6 && normal.x.abs < 1e-6 && normal.y.abs < 1e-6

            positions = entity.vertices
                              .map { |vertex| vertex.position.transform(world_transform) }
                              .map { |position| [position.x * mm, position.y * mm, position.z * mm] }
            next if positions.empty?

            min = [0, 1, 2].map { |axis| positions.map { |point| point[axis] }.min }
            max = [0, 1, 2].map { |axis| positions.map { |point| point[axis] }.max }
            planes << { 'point_mm' => positions.first, 'normal_mm' => [0.0, 0.0, 1.0],
                        'footprint_min_mm' => min, 'footprint_max_mm' => max }
          when Sketchup::Group, Sketchup::ComponentInstance
            metadata = metadata_store.read(entity)
            next if metadata.is_a?(Hash) && metadata['kind'] == 'furnitureInstance'

            children = entity.is_a?(Sketchup::Group) ? entity.entities : entity.definition.entities
            planes.concat(scan_base_planes(children,
                                           world_transform * entity.transformation,
                                           metadata_store, host_model, child_path))
          end
        end
        planes
      end

      # Oriented frame of a managed root in mm (mirrors the controller
      # provider): horizontal UNIT right/front, right-handed, zaxis +Z,
      # and the PERSISTED placementEnvelopeMm (the layout-derived box the
      # canonical commit writes — hardware/asset protrusions never move
      # it). nil fails closed.
      def oriented_frame_mm(entity, metadata_store)
        mm = 25.4
        transform = entity.transformation
        right = horizontal_unit_mm(transform.xaxis)
        front = horizontal_unit_mm(transform.yaxis)
        return nil unless right && front
        return nil unless (right[0] * front[1]) - (right[1] * front[0]) > 1.0 - 1e-6

        zaxis = transform.zaxis
        return nil unless zaxis.x.abs < 1e-6 && zaxis.y.abs < 1e-6 && ((zaxis.z - 1.0).abs < 1e-6)

        envelope = metadata_store.read(entity)['placementEnvelopeMm'] if metadata_store.read(entity)
        return nil unless envelope.is_a?(Hash)

        { origin_world_mm: [transform.origin.x * mm, transform.origin.y * mm, transform.origin.z * mm],
          front_dir_mm: front, right_dir_mm: right,
          local_min_mm: envelope['min_mm'].map(&:to_f),
          local_max_mm: envelope['max_mm'].map(&:to_f) }
      end

      def horizontal_unit_mm(vector)
        x = vector.x.to_f
        y = vector.y.to_f
        z = vector.z.to_f
        return nil unless z.abs < 1e-6
        return nil unless (Math.sqrt((x**2) + (y**2)) - 1.0).abs < 1e-6

        [x, y, 0.0]
      end

      # Centers the camera on an aim point so a view-center pick rays
      # through it (host-faithful aiming for the smoke).
      def aim_view_at(point)
        box = Geom::BoundingBox.new
        box.add(point)
        padding = Geom::Point3d.new(200 / 25.4, 200 / 25.4, 200 / 25.4)
        box.add(point.offset(Geom::Vector3d.new(padding.x, 0, 0)))
        box.add(point.offset(Geom::Vector3d.new(-padding.x, 0, 0)))
        model.active_view.zoom(box)
      end

      # Deterministic camera for ARBITRARY angles: an explicit eye offset
      # from the aim point (mm) fixes the room side the wall snap must
      # resolve from — no reliance on zoom defaults.
      def aim_camera_at_mm(target_mm, eye_offset_mm)
        target = Geom::Point3d.new(target_mm[0] / 25.4, target_mm[1] / 25.4, target_mm[2] / 25.4)
        eye = Geom::Point3d.new((target_mm[0] + eye_offset_mm[0]) / 25.4,
                                (target_mm[1] + eye_offset_mm[1]) / 25.4,
                                (target_mm[2] + eye_offset_mm[2]) / 25.4)
        model.active_view.camera = Sketchup::Camera.new(eye, target, Geom::Vector3d.new(0, 0, 1))
      end

      def reactivate_preview(placer, extents, commits)
        prepared = placer.prepare_placement_preview(FI_1)
        assert prepared['ok'], prepared.inspect
        tool = Tools::FurniturePlacementTool.new(
          label: prepared['definition']['name'], extents_mm: extents,
          on_commit: ->(transform) { commits << placer.place(FI_1, transformation: transform) },
          on_cancel: ->(_reason) {},
          model_provider: -> { Sketchup.active_model }
        )
        model.select_tool(tool)
        tool.activate
        tool
      end

      # Synthesizes cursor presence the way the host would: a real
      # InputPoint pick at the view center (host API: vpwidth/vpheight).
      def move_to_view_center(tool)
        view = model.active_view
        tool.onMouseMove(0, view.vpwidth / 2, view.vpheight / 2, view)
      end

      # The CONFIRMING click must land on the SAME viewport point the
      # preview picked: FurniturePlacementTool#onLButtonDown re-picks
      # fresh at the click's own coordinates, so a (0,0) click would
      # re-aim at the top-left corner instead of confirming the centered
      # pick (review P1 — preview and commit must address one point).
      def click_view_center(tool)
        view = model.active_view
        tool.onLButtonDown(0, view.vpwidth / 2, view.vpheight / 2, view)
      end

      def granete_definition_count
        model.definitions.select { |definition| definition.name.to_s.start_with?('Granete ·') }.count
      end

      def build_placer(transport)
        catalog = ScriptedCatalog.new
        Connection::ProjectFurniture::Placer.new(
          model_provider: -> { Sketchup.active_model },
          binding_store_factory: ->(m) { Connection::ModelBinding::Store.new(m) },
          model_binding_service: Connection::ModelBinding::Service.new(
            transport: transport, auth_provider: AlwaysAuth.new, logger: silent_logger
          ),
          service: Connection::ProjectFurniture::Service.new(
            transport: transport, auth_provider: AlwaysAuth.new, logger: silent_logger
          ),
          metadata_store_factory: ->(m) { Metadata::Store.new(m) },
          catalog_provider: catalog,
          furniture_builder_factory: ->(m) { Model::FurnitureBuilder.new(metadata_store: Metadata::Store.new(m)) },
          logger: silent_logger
        )
      end

      def silent_logger
        @silent_logger ||= Class.new do
          def info(_event, _context = {}); end

          def warn(_event, _context = {}); end

          def error(_event, _context = {}); end
        end.new
      end

      class AlwaysAuth
        def configured?
          true
        end

        def authorization_header
          'Bearer host-smoke'
        end

        def refresh_if_needed; end
      end

      # Minimal catalog over the same shape the unit fixtures use.
      class ScriptedCatalog
        def find_definition(_id)
          { 'furniture_definition_id' => 'def-smoke', 'code' => 'BASE-600', 'name' => 'Base 600',
            'category' => 'kitchen_base', 'version' => '1.0.0',
            'parameters' => [{ 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number',
                               'defaultValue' => 600, 'unit' => 'mm' }] }
        end

        def resolved_native_layout(_definition_id, _params = {}, _choices = {})
          Library::LayoutContract.parse!(
            'furnitureDefinitionId' => 'def-smoke', 'definitionName' => 'Base 600',
            'transformContract' => 'granete.local-basis.v1', 'dimensionsMm' => [600, 720, 560],
            'components' => [
              { 'componentInstanceId' => 'smoke-body', 'componentDefinitionId' => 'smoke-body',
                'slotId' => 'interior', 'role' => 'INTERIOR', 'optionRole' => 'INTERIOR',
                'name' => 'Lateral', 'kind' => 'board',
                'localTransform' => { 'translationMm' => [0, 0, 0],
                                      'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } },
                'widthMm' => 600, 'thicknessMm' => 18, 'lengthMm' => 720 }
            ],
            'hardware' => []
          )
        end
      end

      # Scripted backend: binding validation + instance list + working copy.
      class ScriptedTransport
        attr_reader :requests

        def initialize
          @requests = []
          @routes = {}
          stub_binding_validation
          stub_project_furniture
        end

        def configure?
          true
        end

        def respond(method, path, status, body)
          @routes[[method.to_s.upcase, path]] = { 'status' => status, 'body' => body }
        end

        def request(payload, _authorization_header = nil)
          method = payload['method'].to_s.upcase
          path = payload['path']
          @requests << { 'method' => method, 'path' => path }
          route = @routes[[method, path]]
          return route if route

          raise Granete::SketchUpExtension::Transport::RequestError, "no route for #{method} #{path}"
        end

        def stub_binding_validation
          respond(:post, "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate", 200,
                  { 'state' => 'valid', 'schema_version' => 1,
                    'organization' => { 'id' => '10000000-0000-0000-0000-00000000000a',
                                        'name' => 'Carpintería García' },
                    'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina García' },
                    'design' => { 'id' => DESIGN_ID, 'name' => 'Cocina principal', 'status' => 'active' },
                    'working_copy' => { 'base_revision_id' => REVISION_R1, 'base_revision_number' => 1 },
                    'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true,
                                        'can_create_initial_quote' => true } })
        end

        def stub_project_furniture
          respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200,
                  [{ 'id' => FI_1, 'project_id' => PROJECT_ID,
                     'furniture_definition_id' => 'def-smoke',
                     'origin' => 'quote', 'lifecycle_status' => 'active', 'version' => 1,
                     'created_at' => '2026-09-23T00:00:00Z', 'updated_at' => '2026-09-23T00:00:00Z',
                     'display' => { 'name' => 'Base 600',
                                    'dimensions_mm' => { 'width' => 600, 'height' => 720, 'depth' => 560 } } },
                   { 'id' => FI_2, 'project_id' => PROJECT_ID,
                     'furniture_definition_id' => 'def-smoke',
                     'origin' => 'quote', 'lifecycle_status' => 'active', 'version' => 1,
                     'created_at' => '2026-09-23T00:00:00Z', 'updated_at' => '2026-09-23T00:00:00Z',
                     'display' => { 'name' => 'Base 600',
                                    'dimensions_mm' => { 'width' => 600, 'height' => 720, 'depth' => 560 } } }])
        end

        def stub_working_copy(items)
          respond(:get, "/designs/#{DESIGN_ID}/working-copy", 200,
                  { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                    'base_revision_id' => REVISION_R1, 'source_type' => 'manual',
                    'updated_at' => '2026-09-23T00:00:00Z', 'items' => items })
        end
      end

      # #469 increment 4 — the DISCONNECTED local catalog: a static
      # definition with NO layout resolution (offline generic composition).
      class LocalStaticCatalog
        def find_definition(id)
          return nil unless id == 'def-local'

          { 'furniture_definition_id' => 'def-local', 'code' => 'LOCAL-750', 'name' => 'Bajo Local',
            'category' => 'kitchen_base', 'version' => '1.0.0',
            'parameters' => [
              { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => 600,
                'unit' => 'mm' },
              { 'name' => 'heightMm', 'label' => 'Alto', 'type' => 'number', 'defaultValue' => 720,
                'unit' => 'mm' },
              { 'name' => 'depthMm', 'label' => 'Fondo', 'type' => 'number', 'defaultValue' => 590,
                'unit' => 'mm' }
            ] }
        end

        def resolved_native_layout(_definition_id, _params = {}, _choices = {})
          nil
        end
      end

      # Minimal status payload for the controller seam (the local-lane
      # handlers never read it beyond availability).
      class StatusPayload
        def call
          { 'server_url' => nil }
        end
      end

      # Bridge journal standing in for the HtmlDialog: the controller only
      # needs #execute_script on this lane — every Ruby-side decision runs
      # for real against the host.
      class BridgeJournalDialog
        attr_reader :scripts

        def initialize
          @scripts = []
        end

        def execute_script(script)
          @scripts << script
          nil
        end
      end

      # Placer for the local smoke: unauthenticated seams are enough — the
      # local lane never talks to the server.
      def build_local_placer(catalog)
        Connection::ProjectFurniture::Placer.new(
          model_provider: -> { Sketchup.active_model },
          binding_store_factory: ->(m) { Connection::ModelBinding::Store.new(m) },
          model_binding_service: Connection::ModelBinding::Service.new(
            transport: nil, auth_provider: AlwaysAuth.new, logger: silent_logger
          ),
          service: Connection::ProjectFurniture::Service.new(
            transport: nil, auth_provider: AlwaysAuth.new, logger: silent_logger
          ),
          metadata_store_factory: ->(m) { Metadata::Store.new(m) },
          catalog_provider: catalog,
          furniture_builder_factory: ->(m) { Model::FurnitureBuilder.new(metadata_store: Metadata::Store.new(m)) },
          logger: silent_logger
        )
      end
    end
  end
end
