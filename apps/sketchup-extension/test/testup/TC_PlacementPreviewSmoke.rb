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
        view = model.active_view
        tool2.onLButtonDown(0, 0, 0, view)
        tool2.onLButtonDown(0, 0, 0, view) # double click: one gesture only

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
                        'the accepted transform keeps Z vertical (quarter turns only)'

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
        assert_equal 3, tool.active_snap[:rotation_quarters], 'front maps to +X (q3)'

        # --- Exact gap through the VCB path: 40mm off the wall.
        assert_equal true, tool.onUserText('40', model.active_view)
        tool.onLButtonDown(0, 0, 0, model.active_view)
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
        tool2.onLButtonDown(0, 0, 0, model.active_view)
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

      private

      # Shared tool factory for the snap walk: the SAME provider wiring the
      # dialog controller uses (managed neighbors by server identity).
      def snap_tool(placer, extents, commits, furniture_instance_id)
        metadata_store = Metadata::Store.new(model)
        provider = lambda do
          index = Connection::ProjectFurniture::ManagedFurniture.index(model, metadata_store)
          index[:by_id].flat_map do |fi_id, entries|
            next [] if entries.length != 1

            entity = entries.first[:entity]
            next [] unless entity.respond_to?(:bounds) && entity.respond_to?(:transformation)
            next [] if entity.respond_to?(:valid?) && !entity.valid?

            mm = 25.4
            front_axis = entity.transformation.yaxis
            front = if front_axis.x.abs < 1e-6 && (front_axis.y.abs - 1.0).abs < 1e-6
                      [0.0, 1.0, 0.0]
                    elsif front_axis.y.abs < 1e-6 && (front_axis.x.abs - 1.0).abs < 1e-6
                      [front_axis.x.positive? ? 1.0 : -1.0, 0.0, 0.0]
                    end
            next [] unless front

            [{ 'furniture_instance_id' => fi_id,
               'label' => entity.name.to_s.sub(/\s*\([^()]*\)\s*\z/, '').strip,
               'min_mm' => [entity.bounds.min.x * mm, entity.bounds.min.y * mm, entity.bounds.min.z * mm],
               'max_mm' => [entity.bounds.max.x * mm, entity.bounds.max.y * mm, entity.bounds.max.z * mm],
               'front_dir' => front }]
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
          furniture_targets_provider: provider
        )
        model.select_tool(tool)
        tool.activate
        tool
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
    end
  end
end
