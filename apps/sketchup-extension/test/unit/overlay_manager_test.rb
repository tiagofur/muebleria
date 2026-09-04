# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'

# #470: overlay manager lifecycle — read-only authority, honest states and
# the #498 stale/refresh correlation.
class OverlayManagerTest < Minitest::Test
  Overlay = Granete::SketchUpExtension::Overlay
  Host = Granete::SketchUpExtension::Host

  attr_reader :model, :manager, :provider, :tracker, :states

  def setup
    SketchupStub.reset!
    @model = OverlayFixture.build_model
    @provider = OverlayFixture::FakeCatalogProvider.new
    @tracker = Host::PreflightTracker.new
    @states = []
    @manager = Overlay::Manager.new(
      resolver: Overlay::InspectionResolver.new(
        catalog_provider: provider,
        metadata_store_factory: ->(m) { Granete::SketchUpExtension::Metadata::Store.new(m) }
      ),
      locator: Overlay::EntityLocator.new(
        metadata_store_factory: ->(m) { Granete::SketchUpExtension::Metadata::Store.new(m) },
        model_provider: -> { model }
      ),
      model_provider: -> { model },
      preflight_tracker: tracker,
      on_state_change: ->(payload) { @states << payload }
    )
  end

  def scope(component_instance_id: 'side-left-01')
    { 'furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID,
      'componentInstanceId' => component_instance_id }
  end

  def test_enable_resolves_authoritatively_and_activates_the_tool
    manager.enable(scope)

    assert manager.mode_on?
    assert_equal 'current', manager.status
    assert_equal 1, model.selected_tools.length
    assert_instance_of Overlay::InspectionTool, model.selected_tools.first
    # Only the selected board's features are in scope (#470 §8).
    hosts = manager.scoped_features.map(&:host_component_instance_id).uniq
    assert_equal ['side-left-01'], hosts
    assert manager.scoped_features.length >= 3, 'side panel hosts minifix+dowel+hinge holes'
  end

  def test_furniture_scope_shows_all_boards_when_no_part_selected
    manager.enable(scope.merge('componentInstanceId' => nil))

    hosts = manager.scoped_features.map(&:host_component_instance_id).uniq.sort
    assert_equal %w[shelf-01 side-left-01 side-right-01], hosts
  end

  def test_projected_markers_follow_the_real_model_transforms
    manager.enable(scope)
    markers = manager.projected_features
    refute_empty markers
    # Every marker lands ON its host board (furniture-frame Y within the
    # side panel's depth span, X within its thickness band) — projected
    # through the canonical local-basis transform, not assumed at origin.
    mm = 1.0 / 25.4
    markers.each do |marker|
      assert_in_delta 18.0, marker.center.x / mm, 1e-3
      assert(marker.center.y / mm >= 0.0 && marker.center.y / mm <= 560.0,
             'hole must project inside the side panel depth span')
    end
  end

  # Negative proof (#470 §31/§39): toggling the overlay leaves the
  # productive model untouched — no operations, no entities, no tool residue.
  def test_enable_disable_never_touches_the_productive_model
    entities_before = model.active_entities.to_a.length
    definitions_before = model.definitions.to_a.length
    operations_before = model.operations.length

    manager.enable(scope)
    manager.disable

    assert_equal entities_before, model.active_entities.to_a.length
    assert_equal definitions_before, model.definitions.to_a.length
    assert_equal operations_before, model.operations.length,
                 'overlay must never open a SketchUp operation'
    # OFF pops the tool: the last selection is nil (deactivation).
    assert_nil model.selected_tools.last
    assert_equal 'off', manager.status
    assert_empty manager.projected_features
  end

  def test_disable_clears_snapshot_and_active_feature
    manager.enable(scope)
    manager.select_feature(manager.scoped_features.first.visual_id)
    manager.disable

    assert_nil manager.snapshot
    assert_nil manager.active_feature_id
  end

  def test_unavailable_when_resolve_cannot_reach_the_authority
    def provider.resolve_authoring(_request)
      nil
    end

    manager.enable(scope)
    assert_equal 'unavailable', manager.status
    assert_nil manager.snapshot
    refute_nil manager.unavailable_reason
    # Honest unavailable: no markers drawn, no tool pretending truth.
    assert_empty manager.projected_features
  end

  def test_mutation_start_of_scoped_furniture_marks_stale_immediately
    manager.enable(scope)
    manager.mutation_started(scope.merge('componentInstanceId' => nil))

    assert_equal 'stale', manager.status
    refute_nil manager.to_payload['staleReason']
    # The old truth stays drawn but marked (visible + honest), never current.
    refute_empty manager.projected_features
  end

  def test_committed_authoring_resolve_refreshes_from_the_new_fingerprint
    manager.enable(scope)
    fingerprint_one = manager.snapshot.manufacturing_fingerprint

    outcome = mutation_outcome('committed')
    manager.handle_mutation_outcome(outcome)

    assert_equal 'current', manager.status
    fingerprint_two = manager.snapshot.manufacturing_fingerprint
    assert_equal fingerprint_one, fingerprint_two # same intent → same truth
    assert fingerprint_two.start_with?('sha256-')
    assert_equal 2, provider.resolved_layout_calls, 'refresh re-resolves authoritatively'
  end

  def test_failed_mutation_keeps_previous_truth_marked_stale
    manager.enable(scope)

    manager.handle_mutation_outcome(mutation_outcome('rejected'))

    assert_equal 'stale', manager.status
    refute_nil manager.snapshot, 'old truth stays visible but never current'
  end

  def test_tracker_fingerprint_mismatch_is_stale_even_without_a_signal
    manager.enable(scope)
    other = 'sha256-' + ('f' * 64)
    tracker.invalidate!(Host::CommandContract.semantic_target_key(scope.except('componentInstanceId')),
                        fingerprint: other)

    assert_equal 'stale', manager.status
  end

  def test_late_snapshot_for_an_older_fetch_cannot_overwrite_newer_truth
    manager.enable(scope)
    current_snapshot = manager.snapshot

    # A late F1 answer for a superseded fetch id must be discarded (#470 §34).
    manager.apply_snapshot(OverlayFixture.accepted_result(message_id: 'old'),
                           'old', fetch_id: manager.send(:next_fetch_id) - 10)

    assert_equal current_snapshot.manufacturing_fingerprint,
                 manager.snapshot.manufacturing_fingerprint
  end

  def test_rescope_to_same_furniture_only_moves_the_part_filter
    manager.enable(scope)
    before = manager.snapshot.object_id

    manager.rescope(scope.merge('componentInstanceId' => 'side-right-01'))

    assert_equal before, manager.snapshot.object_id, 'no unnecessary re-resolve'
    hosts = manager.scoped_features.map(&:host_component_instance_id).uniq
    assert_equal ['side-right-01'], hosts
  end

  def test_rescope_to_unmanaged_selection_clears_honestly
    manager.enable(scope)
    manager.rescope({})

    assert_equal 'unavailable', manager.status
    assert_match 'pieza administrada', manager.unavailable_reason
    assert_empty manager.projected_features
  end

  def test_select_feature_and_filter_drive_the_view
    manager.enable(scope)
    first = manager.scoped_features.first

    manager.select_feature(first.visual_id)
    assert_equal first.visual_id, manager.active_feature_id

    manager.set_filter('holes')
    assert_equal 'holes', manager.filter
    assert(manager.scoped_features.all? { |feature| feature.kind == 'hole' })

    manager.select_feature('does-not-exist')
    assert_nil manager.active_feature_id
  end

  def test_payload_carries_correlation_for_the_dialog
    manager.enable(scope)
    payload = manager.to_payload

    assert_equal 'on', payload['mode']
    assert_equal 'current', payload['status']
    assert payload['fingerprint'].start_with?('sha256-')
    # The snapshot echoes the SERVER's pinned catalog revision verbatim.
    assert_equal OverlayFixture.scenario_body['catalogRevision'], payload['catalogRevision']
    assert payload['messageId'].start_with?('mut-')
    assert payload['features'].length == manager.scoped_features.length
  end

  def test_missing_furniture_in_model_is_honest_unavailable
    manager.enable(scope.merge('furnitureInstanceRef' => 'inst-gone'))
    assert_equal 'unavailable', manager.status
    assert_equal 'off', Overlay::Manager.new(
      resolver: nil, locator: nil, model_provider: -> { model }, preflight_tracker: tracker
    ).status
  end

  private

  def mutation_outcome(outcome)
    Host::MutationOutcome.new(
      outcome: outcome, semantic_target: scope.except('componentInstanceId'),
      resolve_kind: 'authoring_resolve'
    )
  end
end
