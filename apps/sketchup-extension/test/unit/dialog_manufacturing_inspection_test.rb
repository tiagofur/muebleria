# frozen_string_literal: true

require 'stringio'
require 'json'
require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'

# #470 dialog wiring: `Ver fabricación` rides the versioned inspection
# channel end-to-end — command envelopes are validated fail-closed, the
# overlay state reaches the dialog as manufacturing_state envelopes, the
# overlay lifecycle follows dialog close and mutation outcomes invalidate it.
class DialogManufacturingInspectionTest < Minitest::Test
  Host = Granete::SketchUpExtension::Host

  class StatusProvider
    def call
      { 'state' => 'configured', 'heading' => 'Conexión configurada', 'message' => 'x' }
    end
  end

  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model = OverlayFixture.build_model
    @provider = OverlayFixture::FakeCatalogProvider.new
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      catalog_provider: @provider
    )
    @dialog = @controller.show
  end

  def teardown
    @controller&.close
  end

  def manufacturing_scripts
    @dialog.executed_scripts.select { |script| script.include?('onManufacturingState') }
  end

  def inspection_envelope(command, payload = {}, target = default_target)
    {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'type' => 'manufacturing_command',
      'messageId' => 'insp-cmd-1',
      'command' => command,
      'semanticTarget' => target,
      'payload' => payload
    }
  end

  def default_target
    { 'furnitureInstanceRef' => OverlayFixture::FURNITURE_INSTANCE_ID,
      'componentInstanceId' => 'side-left-01' }
  end

  def test_set_mode_on_resolves_and_pushes_manufacturing_state
    @controller.handle_manufacturing_inspection(@dialog, JSON.generate(inspection_envelope('set_mode',
                                                                                           { 'mode' => 'on' })))

    overlay = @controller.manufacturing_overlay
    assert overlay.mode_on?
    assert_equal 'current', overlay.status

    pushed = manufacturing_scripts.last
    refute_nil pushed, 'a manufacturing_state envelope must reach the dialog'
    payload = JSON.parse(pushed.match(/onManufacturingState\((.*)\)\z/m)[1])
    assert_equal 'manufacturing_state', payload['type']
    assert_equal 'on', payload['state']['mode']
    assert payload['state']['fingerprint'].start_with?('sha256-')
    assert payload['state']['features'].length >= 3
  end

  def test_set_mode_off_leaves_the_model_untouched_and_clears_state
    @controller.handle_manufacturing_inspection(@dialog, JSON.generate(inspection_envelope('set_mode',
                                                                                           { 'mode' => 'on' })))
    entities_before = @model.active_entities.to_a.length

    @controller.handle_manufacturing_inspection(@dialog, JSON.generate(inspection_envelope('set_mode',
                                                                                           { 'mode' => 'off' })))

    assert_equal 'off', @controller.manufacturing_overlay.status
    assert_equal entities_before, @model.active_entities.to_a.length
    refute_empty manufacturing_scripts
  end

  def test_unknown_command_is_rejected_fail_closed_without_state_change
    @controller.handle_manufacturing_inspection(@dialog, JSON.generate(inspection_envelope('teleport')))

    refute @controller.manufacturing_overlay.mode_on?
    # The contract rejection is logged, the dialog keeps coherent state.
    assert_equal 'off', @controller.manufacturing_overlay.status
  end

  def test_navigate_to_source_selects_the_hinge_for_manual_provenance
    @controller.handle_manufacturing_inspection(@dialog, JSON.generate(inspection_envelope('set_mode',
                                                                                           { 'mode' => 'on' })))
    hinge = @controller.manufacturing_overlay.snapshot.features.find do |feature|
      feature.source_kind == 'manualHardwarePlacement'
    end

    @controller.handle_manufacturing_inspection(
      @dialog,
      JSON.generate(inspection_envelope('navigate_to_source', { 'visualId' => hinge.visual_id }))
    )

    selected = @model.selection.first
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    assert_equal 'hp-hinge-01', store.read(selected)&.dig('identity', 'hardwarePlacementId')
  end

  def test_mutation_outcome_for_scoped_furniture_refreshes_the_overlay
    @controller.handle_manufacturing_inspection(@dialog, JSON.generate(inspection_envelope('set_mode',
                                                                                           { 'mode' => 'on' })))
    outcome = Host::MutationOutcome.new(
      outcome: 'committed', semantic_target: default_target.except('componentInstanceId'),
      resolve_kind: 'authoring_resolve'
    )

    @controller.send(:push_mutation_outcome, @dialog, outcome, in_reply_to: 'cmd-1')

    assert_equal 'current', @controller.manufacturing_overlay.status
    assert_equal 2, @provider.resolved_layout_calls, 'committed resolve refreshes from F2'
    assert(manufacturing_scripts.length >= 2, 'overlay state must be re-pushed after the mutation')
  end

  def test_dialog_close_disables_the_overlay_no_orphans
    @controller.handle_manufacturing_inspection(@dialog, JSON.generate(inspection_envelope('set_mode',
                                                                                           { 'mode' => 'on' })))

    @controller.close

    assert_equal 'off', @controller.manufacturing_overlay.status
    assert_nil @model.selected_tools.last
  end
end
