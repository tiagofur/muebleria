# frozen_string_literal: true

require 'stringio'
require 'json'
require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/host/preflight_review_copy'
require_relative '../../src/granete_for_sketchup/host/preflight_review'
require_relative '../../src/granete_for_sketchup/host/preflight_review_session'
require_relative '../../src/granete_for_sketchup/overlay/issue_navigation'
require_relative '../../src/granete_for_sketchup/tools/internal_component_move_tool'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'

# #466 dialog wiring: `Verificar fabricación` rides the versioned
# preflight_command channel end-to-end — the review reaches the dialog as
# preflight_state envelopes with entries + review, navigation selects the
# exact managed context, a committed mutation marks the review stale and a
# re-run after the correction reaches ready ONLY when Granete returns it.
class DialogPreflightReviewTest < Minitest::Test
  Host = Granete::SketchUpExtension::Host
  Library = Granete::SketchUpExtension::Library

  class StatusProvider
    def call
      { 'state' => 'configured', 'heading' => 'Conexión configurada', 'message' => 'x' }
    end
  end

  # Serves the golden blocked scenario until the user applies the corrective
  # authoring intent (hinge moved to the cleared offset); then serves the
  # authoritative cleared scenario — the same shape of truth the backend
  # would return, replayed from the contract fixture.
  class SwitchableScenarioProvider < OverlayFixture::FakeCatalogProvider
    def initialize
      super
      @scenario_id = '17-hardware-drilling-conflict'
    end

    def apply_correction!
      @scenario_id = '18-hardware-conflict-cleared'
    end

    def resolve_authoring(request_payload)
      super
      body = scenario_body(@scenario_id)
      body['responseMessageId'] = "resolve-#{request_payload['messageId']}"
      body['inReplyToMessageId'] = request_payload['messageId']
      body['idempotencyKey'] = request_payload['idempotencyKey']
      Library::AuthoringResolveContract.parse!(
        body, expected_request: { 'messageId' => request_payload['messageId'],
                                  'idempotencyKey' => request_payload['idempotencyKey'] }
      )
    end

    private

    def scenario_body(scenario_id)
      scenario = OverlayFixture.golden['scenarios'].find { |entry| entry['id'] == scenario_id }
      JSON.parse(JSON.generate(scenario['response']))
    end
  end

  class RejectingProvider < OverlayFixture::FakeCatalogProvider
    def initialize(issues:)
      super()
      @issues = issues
    end

    def resolve_authoring(_request_payload)
      raise Library::AuthoringResolveError.new('La autoría fue rechazada (PARAMETER_OUT_OF_RANGE): x',
                                               status: 422, issues: @issues)
    end
  end

  class UnreachableProvider < OverlayFixture::FakeCatalogProvider
    def resolve_authoring(_request_payload)
      raise Library::AuthoringResolveError, 'Error del servidor al resolver autoría (HTTP 500)'
    end
  end

  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model = OverlayFixture.build_model
    @provider = SwitchableScenarioProvider.new
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new, catalog_provider: @provider
    )
    @dialog = @controller.show
  end

  def teardown
    @controller&.close
  end

  def preflight_scripts
    @dialog.executed_scripts.select { |script| script.include?('onPreflightState') }
  end

  def last_preflight_payload
    script = preflight_scripts.last
    JSON.parse(script.match(/onPreflightState\((.*)\)\z/m)[1])
  end

  def preflight_envelope(command, payload = {})
    {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'type' => 'preflight_command',
      'messageId' => "pf-cmd-#{command}",
      'command' => command,
      'semanticTarget' => default_target,
      'payload' => payload
    }
  end

  def default_target
    { 'furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID }
  end

  def run_review
    @controller.handle_preflight_review(@dialog, JSON.generate(preflight_envelope('run')))
    last_preflight_payload
  end

  def test_run_pushes_blocked_review_with_grouped_issues_and_tracker_entry
    payload = run_review

    assert_equal 'preflight_state', payload['type']
    review = payload['review']
    assert_equal 'blocked', review['status']
    assert_equal 1, review['issueCount']
    assert_equal 'DRILLING_CONFLICT', review['groups'].first['issues'].first['code']
    assert_equal 'Herrajes y perforaciones', review['groups'].first['label']
    # The tracker entry carries the AUTHORITATIVE blocked state — the only
    # source the publish gate may consume.
    entry = payload['entries'].find { |item| item['state'] == 'blocked' }
    refute_nil entry
    assert_equal "furnitureInstanceRef=#{OverlayFixture::FURNITURE_INSTANCE_ID}", entry['furniture']
    assert review['fingerprint'].start_with?('sha256-')
  end

  def test_navigate_issue_selects_the_manual_hinge_in_the_viewport
    run_review
    operations_before = @model.operations.length
    @controller.handle_preflight_review(
      @dialog,
      JSON.generate(preflight_envelope('navigate_issue', 'issueId' => 'issue-0', 'target' => 'hardware'))
    )

    selected = @model.selection.first
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    assert_equal 'hp-hinge-01', store.read(selected)&.dig('identity', 'hardwarePlacementId')
    assert_includes @model.active_view.zoomed_entities, selected
    assert_equal({ 'issueId' => 'issue-0', 'kind' => 'hardware', 'id' => 'hp-hinge-01',
                   'fallback' => false }, last_preflight_payload['review']['navigation'])
    assert_equal operations_before, @model.operations.length,
                 'navigation is view state: no SketchUp operation'
  end

  def test_the_full_rescue_loop_reaches_ready_only_when_granete_returns_it
    run_review
    assert_equal 'blocked', last_preflight_payload['review']['status']

    # The user applies the corrective authoring intent through the real
    # #468 editor channel; the committed mutation invalidates the review.
    target = default_target.merge('hardwarePlacementId' => 'hp-hinge-01')
    mutation_payload = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-loop-1',
      'mutation' => 'update_hardware_placement',
      'semanticTarget' => target,
      'payload' => { 'offsetMm' => [50, 500], 'placementKind' => 'manual' }
    }
    @controller.handle_authoring_mutation(@dialog, JSON.generate(mutation_payload))
    assert_equal 'stale', last_preflight_payload['review']['status'],
                 'a committed mutation makes the previous verdict honestly stale'
    assert_equal 'blocked', last_preflight_payload['review']['authoritativeStatus']

    # The correction reaches the authoritative server; the re-run reflects
    # Granete's new truth.
    @provider.apply_correction!
    payload = run_review

    assert_equal 'ready', payload['review']['status']
    assert_equal 0, payload['review']['issueCount']
    assert_empty payload['review']['groups']
    entry = payload['entries'].find do |item|
      item['furniture'] == "furnitureInstanceRef=#{OverlayFixture::FURNITURE_INSTANCE_ID}"
    end
    assert_equal 'ready', entry['state']
    assert_equal payload['review']['fingerprint'], entry['fingerprint'],
                 'the overlay (#470) can correlate the accepted fingerprint'
  end

  # NEGATIVE PROOF (#466): a rejected authoring intent is an authoritative
  # NOT-ready whose structured issues remain reviewable.
  def test_rejected_resolve_projects_blocked_review_with_structured_issues
    issue = Library::AuthoringResolveIssue.new(
      'code' => 'PARAMETER_OUT_OF_RANGE', 'message' => 'widthMm out of range', 'severity' => 'error'
    )
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: RejectingProvider.new(issues: [issue])
    )
    @dialog = @controller.show

    payload = run_review

    assert_equal 'blocked', payload['review']['status']
    assert_equal 'parameters', payload['review']['groups'].first['key']
    assert_equal 'blocked', payload['entries'].last['state']
  end

  # NEGATIVE PROOF (#466): unreachable/unavailable is honest and NEVER
  # rendered as ready — the tracker entry says unavailable.
  def test_unreachable_server_is_unavailable_never_ready
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new,
      catalog_provider: UnreachableProvider.new
    )
    @dialog = @controller.show

    payload = run_review

    assert_equal 'unavailable', payload['review']['status']
    assert_equal 0, payload['review']['issueCount']
    entry = payload['entries'].find { |item| item['state'] == 'unavailable' }
    refute_nil entry
    refute_equal 'ready', payload['review']['status']
  end

  def test_unknown_command_is_rejected_fail_closed_without_state_change
    @controller.handle_preflight_review(@dialog, JSON.generate(preflight_envelope('auto_fix')))

    # No review was recorded: the tracker holds no authoritative state.
    session = @controller.send(:preflight_review_session)
    assert_empty session.reviews
  end

  def test_run_for_missing_furniture_is_unavailable_not_blocked
    envelope = preflight_envelope('run')
    envelope['semanticTarget'] = { 'furnitureInstanceRef' => 'inst-not-in-model' }
    @controller.handle_preflight_review(@dialog, JSON.generate(envelope))

    assert_equal 'unavailable', last_preflight_payload['review']['status']
  end

  # --- design-wide publication gate (#466 final closure) ------------------

  # Controller whose gate evaluates the given stub scope against the SAME
  # tracker the controller's preflight review records into — the shared
  # runtime composition of the production wiring.
  def controller_with_gate(scope_items, design_publisher: nil, scope_provider: nil)
    tracker = Host::PreflightTracker.new
    coordinator = Host::AuthoringMutationCoordinator.new(
      model_provider: -> { @model }, logger: @logger, preflight_tracker: tracker
    )
    gate = Host::PublicationPreflightGate.new(
      scope_provider: scope_provider || -> { scope_items },
      tracker: tracker, logger: @logger
    )
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger, status_provider: StatusProvider.new, catalog_provider: @provider,
      design_publisher: design_publisher,
      mutation_coordinator: coordinator,
      publication_gate: gate
    )
    @dialog = @controller.show
  end

  def scope_item(id)
    { 'furnitureInstanceId' => id }
  end

  # The preflight_state envelope carries the Ruby-composed design-wide
  # projection: scope counts + allowed, never a JS-rebuilt scope.
  def test_run_pushes_the_design_wide_publication_gate_projection
    controller_with_gate(
      [scope_item(OverlayFixture::FURNITURE_INSTANCE_ID), scope_item('inst-not-verified')]
    )
    @provider.apply_correction! # the fixture furniture resolves ready

    payload = run_review

    gate = payload['publicationGate']
    refute_nil gate
    assert_equal true, gate['scopeAvailable']
    assert_equal false, gate['allowed'], 'one scope furniture was never verified'
    assert_equal 2, gate['total']
    assert_equal 1, gate['verified']
    assert_equal 1, gate['pending']
  end

  # Without a wired gate the envelope carries no projection and the dialog
  # stays fail-closed (blocked) — proven by the JS harness.
  def test_envelope_without_gate_keeps_the_dialog_fail_closed
    payload = run_review

    assert_nil payload['publicationGate']
  end

  # The publish callback enforces the design-wide gate Ruby-side: a scope
  # with unverified furniture never reaches the publisher.
  def test_publish_is_blocked_until_the_whole_design_scope_is_verified
    called = []
    publisher = Object.new
    publisher.define_singleton_method(:publish) do
      called << :publish
      { 'ok' => true }
    end
    controller_with_gate(
      [scope_item(OverlayFixture::FURNITURE_INSTANCE_ID), scope_item('inst-not-verified')],
      design_publisher: publisher
    )

    @provider.apply_correction! # the fixture furniture resolves ready
    run_review # verifies ONLY the fixture furniture

    @controller.handle_publish_design_revision(@dialog)
    result = publish_result_payload

    assert_equal false, result['ok']
    assert_equal 'preflight_incomplete', result['code']
    assert_empty called, 'the publisher must not run with unverified scope furniture'
    assert_match(/verificar/, result['reason'])
  end

  # Once every scope furniture holds a current authoritative ready/warning,
  # the publish callback proceeds to the real publisher.
  def test_publish_proceeds_once_the_whole_design_scope_is_verified
    called = []
    publisher = Object.new
    publisher.define_singleton_method(:publish) do |_kwargs|
      called << :publish
      { 'ok' => true }
    end
    controller_with_gate([scope_item(OverlayFixture::FURNITURE_INSTANCE_ID)],
                         design_publisher: publisher)

    @provider.apply_correction! # the authoritative resolve now clears
    run_review

    @controller.handle_publish_design_revision(@dialog)

    assert_equal [:publish], called
    assert_equal true, publish_result_payload['ok']
  end

  # A gate without scope (unbound design) blocks the callback fail-closed.
  def test_publish_fails_closed_when_the_publication_scope_is_unavailable
    called = []
    publisher = Object.new
    publisher.define_singleton_method(:publish) do
      called << :publish
      { 'ok' => true }
    end
    controller_with_gate([], design_publisher: publisher, scope_provider: -> {})

    @controller.handle_publish_design_revision(@dialog)
    result = publish_result_payload

    assert_equal false, result['ok']
    assert_equal 'preflight_incomplete', result['code']
    assert_empty called
  end

  def publish_result_payload
    script = @dialog.executed_scripts.reverse.find { |s| s.include?('onPublishResult') }
    raise 'no onPublishResult script executed' unless script

    JSON.parse(script.match(/onPublishResult\((.*)\)\z/m)[1])
  end
end
