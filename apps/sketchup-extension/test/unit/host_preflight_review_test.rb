# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../support/host_runtime'
require_relative '../support/overlay_fixture'
require_relative '../../src/granete_for_sketchup/host/preflight_review_copy'
require_relative '../../src/granete_for_sketchup/host/preflight_review'

# #466 authoritative preflight review projection: statuses come exclusively
# from the resolve preflight subset, issues keep their structured fields,
# copy is Spanish display-only, navigation candidates come from provenance
# identity, and the tracker records authoritative states fail-closed.
class HostPreflightReviewTest < Minitest::Test
  Host = Granete::SketchUpExtension::Host
  Library = Granete::SketchUpExtension::Library

  SCOPE = { 'furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID }.freeze

  def test_blocked_scenario_projects_blocked_review_with_spanish_copy_and_provenance
    result = OverlayFixture.accepted_result
    review = Host::PreflightReview.from_accepted_result(
      result: result, scope: SCOPE, message_id: 'msg-review-1'
    )

    assert_equal 'blocked', review.status
    assert_equal 1, review.issue_count
    counts = review.severity_counts
    assert_equal 1, counts['error']
    assert_equal 0, counts['warning']

    payload = review.to_payload
    assert_equal 'blocked', payload['status']
    assert_equal 'blocked', payload['authoritativeStatus']
    assert_equal result.manufacturing_fingerprint, payload['fingerprint']
    assert_equal result.catalog_revision, payload['catalogRevision']
    assert_equal 'msg-review-1', payload['messageId']

    group = payload['groups'].find { |entry| entry['key'] == 'hardware' }
    refute_nil group, 'DRILLING_CONFLICT groups under hardware'
    assert_equal 'Herrajes y perforaciones', group['label']
    issue = group['issues'].first
    assert_equal 'DRILLING_CONFLICT', issue['code']
    assert_equal 'Conflicto de perforación', issue['title']
    # Spanish remediation is visible and actionable; the verbatim server
    # remediation rides along as technical detail, never as behavior input.
    assert_match(/perforaciones|herraje|pieza/, issue['remediation'])
    assert_equal result.preflight_issues.first.remediation, issue['serverRemediation']
    assert_equal 'error', issue['severity']
  end

  def test_navigation_candidates_prefer_manual_hardware_provenance_then_host_part
    review = review_from_scenario
    candidates = review.candidates_by_issue_id('issue-0')

    # Most specific first: the manual hinge behind operationId2, then the
    # host board (entityId), both Granete identities from the envelope.
    assert_equal({ 'kind' => 'hardware', 'id' => 'hp-hinge-01' }, candidates.first)
    assert(candidates.any? { |candidate| candidate == { 'kind' => 'part', 'id' => 'side-left-01' } })

    issue_payload = review.issue_by_id('issue-0')
    assert_equal 'hardware', issue_payload['source']['kind']
    assert_equal 'hp-hinge-01', issue_payload['source']['id']
    assert_match(/Herraje/, issue_payload['source']['label'])
  end

  def test_fix_loop_actions_follow_provenance_and_capability_surface
    review = review_from_scenario
    issue_payload = review.issue_by_id('issue-0')

    # The conflict provenance is a MANUAL placement → the #468 editor may
    # fix it; part and furniture navigation are always offered.
    actions = issue_payload['actions']
    assert_includes actions, 'navigate'
    assert_includes actions, 'edit_hardware'
    assert_includes actions, 'select_part'
    assert_includes actions, 'select_furniture'
    refute_includes actions, 'review_relationship'
  end

  # #467: an issue anchored on a component relationship offers the internal
  # authoring editor — the relationship's source occurrence is the fix point.
  def test_relationship_anchored_issue_offers_component_editing
    relationship = {
      'relationshipId' => 'rel-shelf-01', 'kind' => 'shelf-support',
      'source' => { 'componentInstanceId' => 'shelf-01', 'role' => 'shelf-edge' },
      'targets' => [{ 'componentInstanceId' => 'side-left-01', 'role' => 'inside-face' }]
    }
    issue = Library::AuthoringResolveIssue.new(
      'code' => 'RESOLVE_GEOMETRY_INVALID', 'message' => 'unsupported shelf pose',
      'severity' => 'error', 'entityId' => 'shelf-01',
      'details' => { 'relationshipId' => 'rel-shelf-01' },
      'remediation' => 'Move the shelf to a supported position'
    )
    review = Host::PreflightReview.new(
      scope: SCOPE, status: 'blocked', issues: [issue], message_id: 'msg-review-467',
      relationships: [relationship]
    )

    issue_payload = review.issue_by_id('issue-0')
    actions = issue_payload['actions']
    assert_includes actions, 'edit_component'
    assert_includes actions, 'select_part'
    assert_equal 'part', issue_payload['source']['kind']
    assert_equal 'shelf-01', issue_payload['source']['id']
    refute_includes actions, 'edit_hardware', 'no manual provenance → no hardware editor'
  end

  def test_clear_scenario_without_issues_projects_ready
    result = accepted_result_for('18-hardware-conflict-cleared')
    review = Host::PreflightReview.from_accepted_result(
      result: result, scope: SCOPE, message_id: 'msg-review-2'
    )

    assert_equal 'ready', review.status
    assert_equal 0, review.issue_count
    assert_empty review.to_payload['groups']
  end

  def test_clear_with_authoritative_warnings_projects_warning_not_ready
    warning = Library::AuthoringResolveIssue.new(
      'code' => 'HARDWARE_REFERENCE_INVALID', 'message' => 'legacy hinge reference',
      'severity' => 'warning'
    )
    result = new_result(preflight_status: 'clear', preflight_issues: [warning])
    review = Host::PreflightReview.from_accepted_result(
      result: result, scope: SCOPE, message_id: 'msg-review-3'
    )

    assert_equal 'warning', review.status
    assert_equal 1, review.severity_counts['warning']
  end

  # NEGATIVE PROOF (#466): a result without the authoritative preflight
  # subset can never mint ready — local parameter validity is not a review.
  def test_result_without_authoritative_preflight_fails_closed
    result = new_result(preflight_status: nil, preflight_issues: [])
    assert_raises(ArgumentError) do
      Host::PreflightReview.review_status_from(result)
    end
  end

  def test_rejection_projects_blocked_with_structured_issues
    issues = [Library::AuthoringResolveIssue.new(
      'code' => 'PARAMETER_OUT_OF_RANGE', 'message' => 'widthMm out of range',
      'severity' => 'error', 'entityId' => nil,
      'remediation' => 'Choose a width within the catalog limits'
    )]
    review = Host::PreflightReview.from_rejection(
      issues: issues, scope: SCOPE, message_id: 'msg-review-4', reason: 'rechazado'
    )

    assert_equal 'blocked', review.status
    assert_equal 'rechazado', review.reason
    payload = review.to_payload
    group = payload['groups'].find { |entry| entry['key'] == 'parameters' }
    refute_nil group
    # No accepted resolve → no fingerprint to correlate.
    assert_nil payload['fingerprint']
    # Parameter issues carry no child provenance: the furniture is the
    # source and the actions stay at furniture level.
    issue = group['issues'].first
    assert_equal 'furniture', issue['source']['kind']
    refute_includes issue['actions'], 'edit_hardware'
    refute_includes issue['actions'], 'select_part'
  end

  def test_unavailable_review_is_distinct_from_every_success_state
    review = Host::PreflightReview.unavailable(scope: SCOPE, reason: 'sin conexión')
    payload = review.to_payload

    assert_equal 'unavailable', payload['status']
    assert_equal 'unavailable', payload['authoritativeStatus']
    assert_equal 'sin conexión', payload['reason']
    %w[ready warning blocked].each { |state| refute_equal state, payload['status'] }
  end

  def test_effective_status_override_renders_stale_without_losing_the_verdict
    review = review_from_scenario
    payload = review.to_payload(effective_status: 'stale')

    assert_equal 'stale', payload['status']
    assert_equal 'blocked', payload['authoritativeStatus'], 'the verdict stays recorded'
  end

  def test_relationship_issue_navigates_to_its_authoritative_source_part
    issue = Library::AuthoringResolveIssue.new(
      'code' => 'RELATIONSHIP_INVALID', 'message' => 'relationship not buildable',
      'severity' => 'error', 'entityId' => 'rel-shelf-01',
      'details' => { 'relationshipId' => 'rel-shelf-01' }
    )
    relationships = [{ 'relationshipId' => 'rel-shelf-01',
                       'source' => { 'componentInstanceId' => 'shelf-01', 'role' => 'shelf_1' } }]
    result = new_result(preflight_status: 'blocked', preflight_issues: [issue])
    review = Host::PreflightReview.from_accepted_result(
      result: result, scope: SCOPE, message_id: 'm'
    )
    # Inject the authoritative relationship table a full snapshot would carry.
    review.instance_variable_set(:@relationships, relationships)

    candidates = review.candidates_by_issue_id('issue-0')
    assert_includes candidates, { 'kind' => 'part', 'id' => 'shelf-01' }
  end

  # --- tracker: authoritative recording is fail-closed ------------------

  def test_tracker_records_authoritative_states_but_never_mints_them_locally
    tracker = Host::PreflightTracker.new
    key = 'furnitureInstanceRef=inst-r'

    # ready/warning REQUIRE the accepted fingerprint + correlation.
    assert_raises(ArgumentError) { tracker.record!(key, 'ready', message_id: 'm1') }
    assert_raises(ArgumentError) { tracker.record!(key, 'not_a_state', message_id: 'm1') }
    assert_raises(ArgumentError) { tracker.record!(key, 'ready', fingerprint: "sha256-#{'f' * 64}") }
    assert_equal 'unknown', tracker.state_for(key)

    tracker.record!(key, 'ready', fingerprint: "sha256-#{'f' * 64}",
                                  catalog_revision: 'rev-9', message_id: 'm2')
    assert_equal 'ready', tracker.state_for(key)

    # A committed mutation supersedes the verdict honestly.
    tracker.invalidate!(key, message_id: 'mut-9')
    assert_equal 'stale', tracker.state_for(key)

    # A blocked rejection may legitimately carry no fingerprint.
    tracker.record!(key, 'blocked', message_id: 'm3')
    assert_equal 'blocked', tracker.state_for(key)
  end

  def test_target_keys_alias_child_targets_to_the_owning_furniture
    contract = Host::CommandContract
    child_target = { 'furnitureInstanceRef' => 'inst-a', 'hardwarePlacementId' => 'hp-1' }

    keys = contract.target_keys_for(child_target)
    assert_includes keys, contract.semantic_target_key(child_target)
    assert_includes keys, 'furnitureInstanceRef=inst-a'

    tracker = Host::PreflightTracker.new
    tracker.invalidate_target!(child_target, message_id: 'mut-1')
    assert_equal 'stale', tracker.state_for('furnitureInstanceRef=inst-a')
    assert_equal 'stale', tracker.state_for(contract.semantic_target_key(child_target))

    tracker.mark_unavailable_target!(child_target, message_id: 'mut-2')
    assert_equal 'unavailable', tracker.state_for('furnitureInstanceRef=inst-a')
  end

  # --- command contract: the preflight_command channel closes the shape --

  def test_parse_preflight_command_accepts_run_and_navigate_issue
    contract = Host::CommandContract
    run = contract.parse_preflight_command!(JSON.generate(
                                              'schemaId' => contract::SCHEMA_ID, 'type' => 'preflight_command',
                                              'messageId' => 'pf-1', 'command' => 'run',
                                              'semanticTarget' => { 'furnitureInstanceRef' => 'inst-a',
                                                                    'componentInstanceId' => 'shelf-01' },
                                              'payload' => {}
                                            ))
    assert_equal 'run', run['command']
    navigate = contract.parse_preflight_command!(JSON.generate(
                                                   'schemaId' => contract::SCHEMA_ID, 'type' => 'preflight_command',
                                                   'messageId' => 'pf-2', 'command' => 'navigate_issue',
                                                   'semanticTarget' => { 'furnitureInstanceRef' => 'inst-a' },
                                                   'payload' => { 'issueId' => 'issue-0', 'target' => 'hardware' }
                                                 ))
    assert_equal 'navigate_issue', navigate['command']
    assert_equal 'issue-0', navigate['payload']['issueId']
  end

  def test_parse_preflight_command_rejects_unknown_command_child_only_target_and_missing_issue
    contract = Host::CommandContract
    base = { 'schemaId' => contract::SCHEMA_ID, 'type' => 'preflight_command', 'messageId' => 'pf-3' }
    assert_raises(contract::ContractError) do
      contract.parse_preflight_command!(base.merge('command' => 'fix_everything',
                                                   'semanticTarget' => { 'furnitureInstanceRef' => 'x' },
                                                   'payload' => {}))
    end
    # The review always targets the OWNING furniture: a child-only target is
    # not addressable.
    assert_raises(contract::ContractError) do
      contract.parse_preflight_command!(base.merge('command' => 'run',
                                                   'semanticTarget' => { 'componentInstanceId' => 'shelf-01' },
                                                   'payload' => {}))
    end
    assert_raises(contract::ContractError) do
      contract.parse_preflight_command!(base.merge('command' => 'navigate_issue',
                                                   'semanticTarget' => { 'furnitureInstanceRef' => 'x' },
                                                   'payload' => {}))
    end
  end

  def test_preflight_state_envelope_carries_the_review_payload
    envelope = Host::CommandContract.preflight_state_envelope(
      [{ 'furniture' => 'furnitureInstanceRef=inst-a', 'state' => 'blocked' }],
      review: { 'status' => 'blocked', 'groups' => [] }
    )
    assert_equal 'preflight_state', envelope['type']
    assert_equal 'blocked', envelope['review']['status']

    bare = Host::CommandContract.preflight_state_envelope([])
    refute bare.key?('review')
  end

  private

  def review_from_scenario
    Host::PreflightReview.from_accepted_result(
      result: OverlayFixture.accepted_result, scope: SCOPE, message_id: 'msg-review-x'
    )
  end

  def accepted_result_for(scenario_id)
    scenario = OverlayFixture.golden['scenarios'].find { |entry| entry['id'] == scenario_id }
    body = JSON.parse(JSON.generate(scenario['response']))
    body['responseMessageId'] = 'resolve-msg-review'
    body['inReplyToMessageId'] = 'msg-review'
    body['idempotencyKey'] = 'idemp-review'
    Library::AuthoringResolveContract.parse!(
      body, expected_request: { 'messageId' => 'msg-review', 'idempotencyKey' => 'idemp-review' }
    )
  end

  def new_result(preflight_status:, preflight_issues:)
    Library::AuthoringResolveResult.new(
      status: 'accepted', issues: [], machining: {
                                        operations: OverlayFixture.accepted_result.operations,
                                        derived_hardware_placements: [],
                                        manufacturing_fingerprint: "sha256-#{'0' * 64}"
                                      },
      catalog_revision: 'rev-test', preflight_status: preflight_status,
      preflight_issues: preflight_issues
    )
  end
end
