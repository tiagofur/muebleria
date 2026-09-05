# frozen_string_literal: true

require 'stringio'
require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/identity'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/connection/design_publish'
require_relative '../../src/granete_for_sketchup/host/command_contract'
require_relative '../../src/granete_for_sketchup/host/preflight_tracker'
require_relative '../../src/granete_for_sketchup/host/publication_preflight_gate'

# #466 final closure — design-wide publish gate. The gate universe is the
# COMPLETE #392 publication scope (the same ManifestBuilder inventory the
# publisher manifests), never the PreflightTracker entries: unverified
# furniture blocks, stale/unavailable/blocked block, unrelated tracker
# entries outside the scope are ignored, and alias entries of one physical
# unit never count as two furnitures. Fail-closed: without a computable
# scope the gate blocks — it never falls back to a guessed scope.
class PublicationPreflightGateTest < Minitest::Test
  Host = Granete::SketchUpExtension::Host
  MB = Granete::SketchUpExtension::Connection::ModelBinding
  DP = Granete::SketchUpExtension::Connection::DesignPublish
  MS = Granete::SketchUpExtension::Metadata::Store

  FINGERPRINT = "sha256-#{'a' * 64}".freeze

  FI_A = '51000000-0000-0000-0000-0000000000a1'
  FI_B = '51000000-0000-0000-0000-0000000000b2'
  FI_C = '51000000-0000-0000-0000-0000000000c3'
  FI_X = '51000000-0000-0000-0000-0000000000x9' # outside the publication scope

  def setup
    @tracker = Host::PreflightTracker.new
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
  end

  def gate_with_scope(*furniture_ids)
    Host::PublicationPreflightGate.new(
      scope_provider: -> { furniture_ids.map { |id| { 'furnitureInstanceId' => id } } },
      tracker: @tracker,
      logger: @logger
    )
  end

  def record_ready(key)
    @tracker.record!(key, 'ready', fingerprint: FINGERPRINT, message_id: "m-#{key}")
  end

  # Case 1: every scope furniture ready/warning → allowed.
  def test_all_ready_is_allowed
    record_ready("furnitureInstanceId=#{FI_A}")
    @tracker.record!("furnitureInstanceId=#{FI_B}", 'warning',
                     fingerprint: FINGERPRINT, message_id: 'm-b')
    projection = gate_with_scope(FI_A, FI_B).projection

    assert_equal true, projection['allowed']
    assert_equal 2, projection['total']
    assert_equal 2, projection['verified']
    assert_equal 0, projection['pending']
  end

  # Case 2: furniture in scope without any preflight entry → blocked. The
  # denominator is the scope, so never-verified furniture is visible.
  def test_missing_furniture_preflight_blocks
    record_ready("furnitureInstanceId=#{FI_A}")
    projection = gate_with_scope(FI_A, FI_B).projection

    assert_equal false, projection['allowed']
    assert_equal 2, projection['total']
    assert_equal 1, projection['verified']
    assert_equal 1, projection['pending']
    assert_equal 1, projection['unverified']
  end

  # Case 3: a mutation invalidated a verified furniture → stale blocks.
  def test_stale_blocks
    record_ready("furnitureInstanceId=#{FI_A}")
    @tracker.invalidate!("furnitureInstanceId=#{FI_B}", message_id: 'mut-1')
    projection = gate_with_scope(FI_A, FI_B).projection

    assert_equal false, projection['allowed']
    assert_equal 1, projection['stale']
  end

  # Case 4: unreachable resolve marked unavailable → blocks.
  def test_unavailable_blocks
    record_ready("furnitureInstanceId=#{FI_A}")
    @tracker.mark_unavailable!("furnitureInstanceId=#{FI_B}", message_id: 'm-x')
    projection = gate_with_scope(FI_A, FI_B).projection

    assert_equal false, projection['allowed']
    assert_equal 1, projection['unavailable']
  end

  # Case 5: authoritative blocked rejection → blocks.
  def test_blocked_blocks
    record_ready("furnitureInstanceId=#{FI_A}")
    @tracker.record!("furnitureInstanceId=#{FI_B}", 'blocked', message_id: 'm-b')
    projection = gate_with_scope(FI_A, FI_B).projection

    assert_equal false, projection['allowed']
    assert_equal 1, projection['blocked']
  end

  # Case 6: a tracker entry for furniture OUTSIDE the publication scope is
  # ignored — it cannot block (nor verify) this design's publication.
  def test_unrelated_tracker_entry_outside_scope_is_ignored
    record_ready("furnitureInstanceId=#{FI_A}")
    @tracker.record!("furnitureInstanceId=#{FI_X}", 'blocked', message_id: 'm-x')
    projection = gate_with_scope(FI_A).projection

    assert_equal true, projection['allowed']
    assert_equal 1, projection['total']
    assert_equal 1, projection['verified']
  end

  # No authoritative results at all → blocked (never a vacuous pass from
  # entries alone; only a genuinely EMPTY scope is vacuously allowed).
  def test_no_authoritative_results_block
    projection = gate_with_scope(FI_A, FI_B).projection

    assert_equal false, projection['allowed']
    assert_equal 2, projection['pending']
  end

  def test_empty_publication_scope_is_vacuously_allowed
    projection = gate_with_scope.projection

    assert_equal true, projection['allowed']
    assert_equal 0, projection['total']
  end

  # FAIL CLOSED: an uncomputable scope (no model/binding/read error) can
  # never degrade into "current furniture only" — publication stays
  # blocked with an honest scopeAvailable=false projection.
  def test_scope_unavailable_fails_closed
    gate = Host::PublicationPreflightGate.new(
      scope_provider: -> { raise StandardError, 'binding unreadable' },
      tracker: @tracker, logger: @logger
    )
    projection = gate.projection

    assert_equal false, projection['scopeAvailable']
    assert_equal false, projection['allowed']
    assert_equal false, gate.allowed?
  end

  def test_nil_scope_fails_closed
    gate = Host::PublicationPreflightGate.new(
      scope_provider: -> {}, tracker: @tracker, logger: @logger
    )
    projection = gate.projection

    assert_equal false, projection['scopeAvailable']
    assert_equal false, projection['allowed']
  end

  # ALIASES: furnitureInstanceId and furnitureInstanceRef entries for the
  # same physical unit are ONE furniture — never two counts, never a
  # partial verification.
  def test_duplicate_aliases_of_one_furniture_do_not_double_count
    record_ready("furnitureInstanceId=#{FI_A}")
    record_ready("furnitureInstanceRef=#{FI_A}")
    projection = gate_with_scope(FI_A).projection

    assert_equal 1, projection['total']
    assert_equal 1, projection['verified']
    assert_equal 0, projection['pending']
    assert_equal true, projection['allowed']
  end

  # An invalidation on a sibling alias is honest: the unit is stale until a
  # fresh authoritative result supersedes the alias markers.
  def test_stale_on_sibling_alias_blocks_until_reverified
    record_ready("furnitureInstanceId=#{FI_A}")
    @tracker.invalidate!("furnitureInstanceRef=#{FI_A}", message_id: 'mut-1')
    projection = gate_with_scope(FI_A).projection

    assert_equal false, projection['allowed']
    assert_equal 1, projection['stale']

    # Re-verification records through the review scope and supersedes the
    # sibling alias markers coherently (rescue loop at design level).
    @tracker.record_furniture!({ 'furnitureInstanceId' => FI_A, 'furnitureInstanceRef' => FI_A },
                               'ready', fingerprint: FINGERPRINT, message_id: 'm-again')
    projection = gate_with_scope(FI_A).projection

    assert_equal true, projection['allowed']
    assert_equal 1, projection['verified']
  end

  # Child-occurrence markers (#470 per-part/part-hardware invalidations)
  # are not furniture-level truth: they must not veto a furniture-scoped
  # authoritative ready.
  def test_child_occurrence_marker_is_not_furniture_truth
    record_ready("furnitureInstanceRef=#{FI_A}")
    @tracker.invalidate!("furnitureInstanceRef=#{FI_A}|hardwarePlacementId=hp-hinge-01",
                         message_id: 'mut-1')
    projection = gate_with_scope(FI_A).projection

    assert_equal true, projection['allowed']
  end

  # record_furniture! keeps the fail-closed validation of record!.
  def test_record_furniture_is_fail_closed_like_record
    scope = { 'furnitureInstanceRef' => FI_A }
    assert_raises(ArgumentError) do
      @tracker.record_furniture!(scope, 'ready', message_id: 'm1')
    end
    assert_raises(ArgumentError) do
      @tracker.record_furniture!(scope, 'not_a_state', message_id: 'm1')
    end
    assert_raises(ArgumentError) do
      @tracker.record_furniture!(scope, 'blocked')
    end
    assert_equal [], @tracker.furniture_entries_for(FI_A)
  end

  # A blocked rejection always dominates sibling alias states.
  def test_blocked_dominates_sibling_aliases
    @tracker.record!("furnitureInstanceRef=#{FI_A}", 'blocked', message_id: 'm-b')
    record_ready("furnitureInstanceId=#{FI_A}")
    projection = gate_with_scope(FI_A).projection

    assert_equal false, projection['allowed']
    assert_equal 1, projection['blocked']
  end

  # ---- canonical #392 scope authority integration ----

  # The scope the gate evaluates is EXACTLY what #392 will publish: built
  # by the same ManifestBuilder (managed furniture of the bound project;
  # unmanaged geometry and foreign-project furniture never enter).
  class TestModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  def test_gate_scope_comes_from_the_392_manifest_authority
    model = TestModel.new
    SketchupStub.active_model = model
    binding = MB::Binding.new(
      project_id: '41000000-0000-0000-0000-000000000001',
      design_id: '52000000-0000-0000-0000-000000000001', base_revision_id: nil
    )
    MB::Store.new(model).write!(binding)
    store = MS.new(model)
    create_managed_instance(model, store, FI_A)
    create_managed_instance(model, store, FI_B)
    model.entities.add_group # unmanaged decoration: never in the scope

    gate = Host::PublicationPreflightGate.new(
      scope_provider: lambda {
        manifest = DP::ManifestBuilder.build(
          model, binding, store, sketchup_version: '25.0', plugin_version: 'test'
        )
        manifest['items']
      },
      tracker: @tracker, logger: @logger
    )

    # Only FI_A verified → FI_B pending → blocked (Case 2 against the real
    # manifest authority).
    record_ready("furnitureInstanceId=#{FI_A}")
    projection = gate.projection

    assert_equal false, projection['allowed']
    assert_equal 2, projection['total']
    assert_equal 1, projection['verified']
    assert_equal 1, projection['pending']

    # Verify FI_B too → allowed (Case 1 against the real authority).
    @tracker.record_furniture!({ 'furnitureInstanceId' => FI_B }, 'ready',
                               fingerprint: FINGERPRINT, message_id: 'm-fi-b')
    projection = gate.projection

    assert_equal true, projection['allowed']
    assert_equal 2, projection['verified']
  ensure
    SketchupStub.active_model = nil
  end

  # Unbound model → no publication scope → fail closed.
  def test_unbound_model_scope_fails_closed
    model = TestModel.new
    SketchupStub.active_model = model
    gate = Host::PublicationPreflightGate.new(
      scope_provider: lambda {
        binding = MB::Store.new(model).read
        next nil unless binding

        DP::ManifestBuilder.build(model, binding, MS.new(model),
                                  sketchup_version: '25.0', plugin_version: 'test')['items']
      },
      tracker: @tracker, logger: @logger
    )
    record_ready("furnitureInstanceId=#{FI_A}")

    assert_equal false, gate.allowed?
    assert_equal false, gate.projection['scopeAvailable']
  ensure
    SketchupStub.active_model = nil
  end

  private

  def create_managed_instance(model, store, furniture_instance_id)
    definition = model.definitions.add("Gabinete #{furniture_instance_id}")
    instance = model.entities.add_instance(definition, Geom::Transformation.new)
    store.write(instance, {
                  'namespace' => 'com.granete.sketchup_extension',
                  'metadataVersion' => 1,
                  'kind' => 'furnitureInstance',
                  'identity' => {
                    'instanceRef' => furniture_instance_id,
                    'furnitureInstanceId' => furniture_instance_id,
                    'projectId' => '41000000-0000-0000-0000-000000000001'
                  },
                  'intent' => { 'parameters' => {}, 'materialChoices' => {} }
                })
  end
end
