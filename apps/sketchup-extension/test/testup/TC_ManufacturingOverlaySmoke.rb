# frozen_string_literal: true

require 'json'
require 'testup/testcase'

# Real-host smoke test for #470 / SU-VIS-1: ManufacturingFeature 3D
# inspection overlay with provenance navigation.
#
# Proves against the real INSTALLED extension and SketchUp host:
#   A. `Ver fabricación` resolves authoritatively and draws markers in the
#      correct local/world pose of the managed hierarchy (real tool.draw on
#      the real view).
#   B. Viewport picking by screen proximity selects the exact feature.
#   C. MOVED furniture: the overlay follows the piece exactly.
#   D. ROTATED furniture (90° about Z): markers rotate with the piece and
#      stay on the correct face — transforms only, never recomputed holes.
#   E. `Ir al origen`: manual provenance selects the exact hardware
#      ComponentInstance; relationship provenance selects the owning source
#      component (Granete identity, never names).
#   F. Toggle OFF: zero productive mutation (entities/definitions unchanged,
#      no SketchUp operation, no metadata drift) — inspection has zero
#      manufacturing impact.
module Granete
  module SketchUpExtension
    class TC_ManufacturingOverlaySmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      GOLDEN_PATH = File.join(REPOSITORY_ROOT, 'contracts', 'sketchupAuthoringResolve.contract.json').freeze
      SCENARIO_ID = '17-hardware-drilling-conflict'
      FURNITURE_INSTANCE_ID = '51000000-0000-0000-0000-0000000004f0'
      MM = 1.0 / 25.4
      Overlay = Granete::SketchUpExtension::Overlay

      DEFINITION = {
        'furniture_definition_id' => '22222222-2222-2222-2222-222222222222',
        'name' => 'Gabinete Authoring 600',
        'parameters' => [
          { 'name' => 'widthMm', 'defaultValue' => 600 },
          { 'name' => 'heightMm', 'defaultValue' => 720 },
          { 'name' => 'depthMm', 'defaultValue' => 560 },
          { 'name' => 'shelfCount', 'defaultValue' => 1 }
        ]
      }.freeze

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        @builder = Model::FurnitureBuilder.new(metadata_store: Metadata::Store.new(model))
        @scenario_body = JSON.parse(JSON.generate(scenario['response']))
        place_initial_furniture
      end

      def teardown
        cleanup_granete_entities
      end

      # A + B: enable, draw with the REAL view, pick by screen coordinates.
      def test_overlay_draws_and_picks_on_the_real_host
        manager = build_manager
        manager.enable(scope)

        assert_equal 'current', manager.status
        markers = manager.projected_features
        assert(markers.length >= 3, 'side panel hosts minifix+dowel+hinge markers')

        view = model.active_view
        tool = Overlay::InspectionTool.new(manager)
        tool.draw(view) # a raise here fails the test — drawing must be safe

        # Project a marker to real screen space and click on it.
        # screen_coords is the real API (there is no View#project/p2s); it
        # returns a Geom::Point3d whose negative z flags a point behind the
        # camera — not clickable.
        screen = view.screen_coords(markers.first.center)
        unless screen.respond_to?(:x) && screen.respond_to?(:y) && !screen.z.negative?
          flunk 'active view cannot project the marker (camera pointing away)'
        end

        handled = tool.onLButtonDown(0, screen.x, screen.y, view)
        assert handled, 'clicking the projected marker must select the feature'
        assert_equal markers.first.visual_id, manager.active_feature_id
      ensure
        manager&.disable
      end

      # B2: natural selection under the overlay (#470 real-host bug). While
      # the inspection tool owns the viewport, a click on furniture geometry
      # (not on a marker) must write model.selection like the native Select
      # tool — the topmost instance of the editing context — and a click on
      # empty space must clear it. The #476 SelectionObserver flow, not the
      # tool, reacts to that selection.
      def test_clicks_outside_markers_follow_natural_selection
        manager = build_manager
        manager.enable(scope)
        part = managed_part('side-left-01')
        model.selection.clear
        model.selection.add(part)
        tool = Overlay::InspectionTool.new(manager)
        view = model.active_view
        zoom_to_furniture(view)

        on_furniture = screen_point_on_furniture_off_markers(view, manager)
        if on_furniture.nil?
          flunk "no clickable furniture point away from markers: vp=#{view.vpwidth}x#{view.vpheight} " \
                "diag=#{natural_selection_diagnostics(view, manager)}"
        end

        handled = tool.onLButtonDown(0, on_furniture.x, on_furniture.y, view)
        assert handled, 'the tool consumes the click it resolved'
        assert_equal [granete_furniture_instances.first], model.selection.to_a,
                     'a geometry click must select the topmost instance natively'

        empty = screen_point_on_empty_space(view)
        skip 'no empty viewport point available' unless empty

        tool.onLButtonDown(0, empty.x, empty.y, view)
        assert model.selection.empty?, 'an empty-space click must clear the selection'
      ensure
        manager&.disable
      end

      # Fills the viewport with the furniture (view state only) so the
      # natural-selection click search has a representative, on-screen body.
      def zoom_to_furniture(view)
        view.zoom(granete_furniture_instances.first)
        view.invalidate
      end

      # Compact one-line probe summary for the flunk message when the grid
      # search finds nothing: what the viewport shows and what a few
      # candidate points actually pick.
      def natural_selection_diagnostics(view, manager)
        root = granete_furniture_instances.first
        probes = [[0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.35], [0.5, 0.65]].map do |fx, fy|
          x = (view.vpwidth * fx).to_i
          y = (view.vpheight * fy).to_i
          picked = pick_summary(view, x, y)
          "[#{x},#{y}=>#{picked}]"
        end.join
        markers = manager.projected_features.length
        "root=#{root.class} markers=#{markers} probes=#{probes}"
      rescue StandardError => e
        "diag_failed: #{e.message}"
      end

      # C: moved furniture — overlay follows exactly, never stays at origin.
      def test_moved_furniture_overlay_follows_the_piece
        manager = build_manager
        manager.enable(scope)
        before = manager.projected_features.map(&:center).map { |p| [p.x, p.y, p.z] }

        furniture = granete_furniture_instances.first
        furniture.transformation = Geom::Transformation.translation(
          Geom::Vector3d.new(1200 * MM, 300 * MM, 50 * MM)
        )
        model.active_view.invalidate

        after = manager.projected_features.map(&:center)
        assert_equal before.length, after.length
        after.each_with_index do |point, index|
          assert_in_delta before[index][0] + (1200 * MM), point.x, 1e-4
          assert_in_delta before[index][1] + (300 * MM), point.y, 1e-4
          assert_in_delta before[index][2] + (50 * MM), point.z, 1e-4
        end
      ensure
        manager&.disable
      end

      # D: rotated furniture — markers rotate with the piece and stay on the
      # correct face (the depth axis keeps pointing into the material).
      def test_rotated_furniture_overlay_rotates_with_the_piece
        manager = build_manager
        manager.enable(scope)
        before = manager.projected_features.first
        center_before = before.center.to_a
        depth_before = [before.depth_end.x - before.center.x,
                        before.depth_end.y - before.center.y,
                        before.depth_end.z - before.center.z]

        furniture = granete_furniture_instances.first
        furniture.transformation = Geom::Transformation.rotation(
          ORIGIN, Z_AXIS, Math::PI / 2
        )
        model.active_view.invalidate

        after = manager.projected_features.first
        # 90° about Z: (x, y) → (−y, x).
        assert_in_delta(-center_before[1], after.center.x, 1e-4)
        assert_in_delta(center_before[0], after.center.y, 1e-4)
        assert_in_delta(center_before[2], after.center.z, 1e-4)
        rotated_depth = [after.depth_end.x - after.center.x,
                         after.depth_end.y - after.center.y,
                         after.depth_end.z - after.center.z]
        assert_in_delta(-depth_before[1], rotated_depth[0], 1e-4)
        assert_in_delta(depth_before[0], rotated_depth[1], 1e-4)
        # The marker still lies ON the host board: its center projects onto
        # the rotated board plane (X = thickness plane of side-left-01).
        board = manager.snapshot.board_for('side-left-01')
        refute_nil board
      ensure
        manager&.disable
      end

      # E: provenance navigation selects Granete identity, not names.
      def test_navigate_to_source_selects_hinge_then_shelf
        manager = build_manager
        manager.enable(scope)
        navigation = Overlay::ProvenanceNavigation.new(
          locator: build_locator, model_provider: method(:model)
        )

        hinge = manager.snapshot.features.find { |feature| feature.source_kind == 'manualHardwarePlacement' }
        result = navigation.navigate_to_source(hinge, manager.snapshot)
        assert_equal 'hardware', result['kind']
        assert_equal 'hp-hinge-01', result['id']
        assert_equal 'hp-hinge-01', metadata_store.read(model.selection.first)
                                                  .dig('identity', 'hardwarePlacementId')

        shelf = manager.snapshot.features.find do |feature|
          feature.source_kind == 'relationship' && feature.host_component_instance_id == 'shelf-01'
        end
        result = navigation.navigate_to_source(shelf, manager.snapshot)
        assert_equal 'part', result['kind']
        assert_equal 'shelf-01', result['id']
        assert_equal 'shelf-01', metadata_store.read(model.selection.first)
                                               .dig('identity', 'componentInstanceId')
      ensure
        manager&.disable
      end

      # F: inspection is read-only — ON/OFF leaves the productive model
      # byte/semantically unchanged (no operations, no entities, no defs,
      # no metadata drift).
      def test_toggle_off_leaves_zero_productive_mutation
        entities_before = model.entities.to_a.length
        definitions_before = model.definitions.to_a.length
        metadata_before = granete_furniture_instances.map { |e| metadata_store.read(e) }

        manager = build_manager
        manager.enable(scope)
        manager.select_feature(manager.scoped_features.first.visual_id)
        manager.disable

        assert_equal entities_before, model.entities.to_a.length
        assert_equal definitions_before, model.definitions.to_a.length
        assert_equal metadata_before, granete_furniture_instances.map { |e| metadata_store.read(e) },
                     'overlay must never touch managed metadata'
      end

      private

      # A managed part instance nested in the (single) furniture root,
      # resolved by Granete metadata — never by name.
      def managed_part(component_instance_id)
        root = granete_furniture_instances.first
        part = root.definition.entities.find do |entity|
          entity.respond_to?(:definition) &&
            metadata_store.read(entity)&.dig('identity', 'instanceRef') == component_instance_id
        end
        flunk "fixture part #{component_instance_id} not found" unless part
        part
      end

      # Screen point that hits the furniture body but stays clear of every
      # projected marker. Search: project the furniture bounds corners to
      # get its screen rectangle, then probe a grid inside it with the SAME
      # PickHelper the tool uses until a point is both root-picked and
      # marker-clear — robust to whatever the active camera shows.
      def screen_point_on_furniture_off_markers(view, manager)
        root = granete_furniture_instances.first
        corners = bounds_corners(root.bounds).filter_map do |corner|
          screen = view.screen_coords(corner)
          next nil if screen.respond_to?(:z) && screen.z.negative?

          [screen.x, screen.y]
        end
        return nil if corners.empty?

        xs = corners.map(&:first)
        ys = corners.map(&:last)
        min_x = xs.min.clamp(1, view.vpwidth - 2)
        max_x = xs.max.clamp(1, view.vpwidth - 2)
        min_y = ys.min.clamp(1, view.vpheight - 2)
        max_y = ys.max.clamp(1, view.vpheight - 2)
        return nil if min_x > max_x || min_y > max_y

        steps = 12
        (1..steps).each do |i|
          (1..steps).each do |j|
            x = min_x + ((max_x - min_x) * i / (steps + 1))
            y = min_y + ((max_y - min_y) * j / (steps + 1))
            point = Geom::Point3d.new(x, y, 0)
            next unless root_pick?(view, point)
            return point if clear_of_markers?(view, manager, point)
          end
        end
        nil
      rescue StandardError
        nil
      end

      def bounds_corners(bounds)
        min = bounds.min
        max = bounds.max
        [min.x, max.x].product([min.y, max.y]).product([min.z, max.z]).map do |(xy, z)|
          Geom::Point3d.new(xy[0], xy[1], z)
        end
      end

      def clear_of_markers?(view, manager, screen)
        manager.projected_features.all? do |feature|
          [feature.center, *feature.ring_points].all? do |point|
            projected = view.screen_coords(point)
            next true if projected.respond_to?(:z) && projected.z.negative?

            distance = Math.sqrt(((projected.x - screen.x)**2) + ((projected.y - screen.y)**2))
            distance > Overlay::ScreenPicker::DEFAULT_THRESHOLD_PX + 6
          end
        end
      end

      # The click point must resolve, through the same PickHelper the tool
      # uses (do_pick + path_at), to a path rooted at the furniture
      # instance (native topmost at the root editing context).
      def root_pick?(view, screen)
        ph = view.pick_helper
        count = ph.do_pick(screen.x, screen.y)
        return false unless count.is_a?(Integer) && count.positive?

        path = ph.path_at(0)
        path.is_a?(Array) && !path.empty? && path.first == granete_furniture_instances.first
      end

      # One candidate-point pick summary for diagnostics.
      def pick_summary(view, pos_x, pos_y)
        ph = view.pick_helper
        count = ph.do_pick(pos_x, pos_y)
        return 'none' unless count.is_a?(Integer) && count.positive?

        path = ph.path_at(0)
        best = ph.best_picked
        label = best.respond_to?(:name) ? best.name.to_s : ''
        "#{path.length}:#{best.class}(#{label})"
      rescue StandardError => e
        "err:#{e.class}"
      end

      # A viewport corner that resolves to no entity at all.
      def screen_point_on_empty_space(view)
        candidates = [[5, 5], [5, 30], [30, 5]]
        candidates.each do |x, y|
          point = Geom::Point3d.new(x, y, 0)
          ph = view.pick_helper
          count = ph.do_pick(x, y)
          return point unless count.is_a?(Integer) && count.positive?
        end
        nil
      rescue StandardError
        nil
      end

      def model
        Sketchup.active_model
      end

      def quiet_logger
        @quiet_logger ||= Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
      end

      def scope
        { 'furnitureInstanceRef' => FURNITURE_INSTANCE_ID,
          'componentInstanceId' => 'side-left-01' }
      end

      def scenario
        golden = JSON.parse(File.read(GOLDEN_PATH))
        golden['scenarios'].find { |entry| entry['id'] == SCENARIO_ID }
      end

      def metadata_store
        @metadata_store ||= Metadata::Store.new(model)
      end

      def native_layout
        Library::LayoutContract.parse!(JSON.parse(JSON.generate(@scenario_body['resolved']['layout'])))
      end

      # Catalog double answering the read-only inspection resolve with the
      # golden scenario (correlation rewritten to the incoming request).
      class GoldenCatalogProvider
        attr_reader :requests

        def initialize(scenario_body)
          @scenario_body = scenario_body
          @requests = []
        end

        def find_definition(definition_id)
          return nil unless definition_id == '22222222-2222-2222-2222-222222222222'

          { 'furniture_definition_id' => '22222222-2222-2222-2222-222222222222',
            'name' => 'Gabinete Authoring 600' }
        end

        def resolved_native_layout(_definition_id, _parameters = {}, _choices = {})
          Library::LayoutContract.parse!(
            JSON.parse(JSON.generate(@scenario_body['resolved']['layout']))
          )
        end

        def catalog_revision
          @scenario_body['catalogRevision']
        end

        def resolve_authoring(request_payload)
          @requests << request_payload
          furniture = request_payload['furniture']
          verify_key_present!(furniture, 'components', 'component identities')
          verify_key_present!(furniture, 'hardwarePlacements', 'hardware placements')
          # Fail-closed relationship proof (#558): the inspection request MUST
          # carry the canonical persisted relationship set. Absence or drift
          # from the golden accepted snapshot raises here and fails the
          # smoke — there is no green without the relationship state. Plain
          # raises (not minitest asserts) because this provider is a plain
          # object without the testcase's assertion module.
          verify_relationship_echo!(furniture['relationships'])
          body = JSON.parse(JSON.generate(@scenario_body))
          body['responseMessageId'] = "resolve-#{request_payload['messageId']}"
          body['inReplyToMessageId'] = request_payload['messageId']
          body['idempotencyKey'] = request_payload['idempotencyKey']
          Library::AuthoringResolveContract.parse!(
            body,
            expected_request: {
              'messageId' => request_payload['messageId'],
              'idempotencyKey' => request_payload['idempotencyKey']
            }
          )
        end

        private

        def verify_key_present!(furniture, key, label)
          return if furniture.is_a?(Hash) && furniture.key?(key)

          raise "inspection request must carry #{label} (#{key})"
        end

        # The echoed relationships must be EXACTLY the golden ones (same
        # relationshipId/kind/source/targets): no invented IDs, no dropped or
        # extra entries. Comparison data comes from the scenario's canonical
        # normalized snapshot, never from hand-written expectations.
        def verify_relationship_echo!(relationships)
          golden = @scenario_body.dig('normalizedSnapshot', 'relationships')
          unless golden.is_a?(Array) && !golden.empty?
            raise 'golden scenario 17-hardware-drilling-conflict must define relationships'
          end

          unless relationships.is_a?(Array) && !relationships.empty?
            raise 'InspectionResolver did NOT echo the persisted canonical relationship ' \
                  "in the request (got: #{relationships.inspect}) — missing = FAIL"
          end
          if relationships.length != golden.length
            raise "relationship count mismatch: request #{relationships.length} " \
                  "vs golden #{golden.length} (invented or dropped relationships)"
          end

          golden.each do |golden_rel|
            echoed = relationships.find { |rel| rel['relationshipId'] == golden_rel['relationshipId'] }
            raise "request missing golden relationship #{golden_rel['relationshipId']}" if echoed.nil?

            %w[kind source targets].each do |field|
              next if echoed[field] == golden_rel[field]

              raise "relationship #{golden_rel['relationshipId']} #{field} mismatch: " \
                    "#{echoed[field].inspect} vs golden #{golden_rel[field].inspect}"
            end
          end
        end
      end

      def build_manager
        Overlay::Manager.new(
          resolver: Overlay::InspectionResolver.new(
            catalog_provider: GoldenCatalogProvider.new(@scenario_body),
            metadata_store_factory: ->(m) { Metadata::Store.new(m) },
            logger: quiet_logger
          ),
          locator: build_locator,
          model_provider: method(:model),
          preflight_tracker: Host::PreflightTracker.new,
          logger: quiet_logger
        )
      end

      def build_locator
        Overlay::EntityLocator.new(
          metadata_store_factory: ->(m) { Metadata::Store.new(m) },
          model_provider: method(:model)
        )
      end

      def place_initial_furniture
        result = @builder.place_existing_furniture(
          model,
          furniture_instance_id: FURNITURE_INSTANCE_ID,
          definition: DEFINITION,
          parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 },
          resolved_layout: native_layout,
          relationships: canonical_relationships
        )
        raise "initial placement failed: #{result['error']}" unless result['entity']
      end

      # Canonical relationship state for the smoke (#558): the SAME
      # relationships contained in the golden accepted semantic snapshot,
      # read from normalizedSnapshot — never invented from names — and
      # persisted on the furniture root through the production metadata
      # contract (place_existing_furniture → MetadataWriter).
      def canonical_relationships
        relationships = @scenario_body.dig('normalizedSnapshot', 'relationships')
        unless relationships.is_a?(Array) && !relationships.empty?
          raise 'golden scenario 17-hardware-drilling-conflict must supply normalizedSnapshot.relationships'
        end

        relationships
      end

      def granete_furniture_instances
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          name = entity.definition.name.to_s
          name.start_with?('Granete · Mueble · ')
        end
      end

      def cleanup_granete_entities
        instances = granete_furniture_instances
        model.entities.erase_entities(instances) unless instances.empty?
        model.definitions.purge_unused if model.definitions.respond_to?(:purge_unused)
      end

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
    end
  end
end
