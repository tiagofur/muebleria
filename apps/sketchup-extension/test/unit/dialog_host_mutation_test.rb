# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/metadata/store'
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
require_relative '../support/host_runtime'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'

# #498 dialog wiring: the versioned authoring_mutation channel runs through
# the shared coordinator, pushes the correlated mutation_state envelope plus
# preflight invalidation, honest degraded state at dialog ready, and dialog
# reopen never multiplies callbacks (5 open/close cycles → one command →
# one Ruby-side bridge emission).
class DialogHostMutationTest < Minitest::Test
  class StatusProvider
    def call
      { 'state' => 'configured', 'heading' => 'Conexión configurada', 'message' => 'x' }
    end
  end

  # Catalog double resolving layouts through the #414 contract and
  # reporting local provenance for the degraded-state push.
  class LayoutResolvingCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
    def last_source
      'local'
    end

    def resolved_layout(_definition_id, _parameters = {}, _choices = {})
      { 'transformContract' => 'granete.local-basis.v1',
        'components' => [
          { 'componentInstanceId' => 'st-door-0', 'componentDefinitionId' => 'st-door',
            'slotId' => 'puerta', 'name' => 'Puerta',
            'role' => 'FRENTE',
            'transform' => { 'translationMm' => [2, 560, 2] }, 'dimensionsMm' => [596, 18, 716],
            'localTransform' => {
              'translationMm' => [2, 560, 2],
              'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
            },
            'lengthMm' => 716, 'widthMm' => 596, 'thicknessMm' => 18 },
          { 'componentInstanceId' => 'st-shelf-0', 'componentDefinitionId' => 'st-shelf',
            'slotId' => 'shelf', 'name' => 'Entrepaño',
            'role' => 'INTERIOR',
            'transform' => { 'translationMm' => [18, 18, 150] }, 'dimensionsMm' => [542, 564, 18],
            'localTransform' => {
              'translationMm' => [18, 18, 150],
              'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
            },
            'lengthMm' => 564, 'widthMm' => 542, 'thicknessMm' => 18 }
        ],
        'hardware' => [
          { 'placementId' => 'HP-TOP', 'hardwareId' => 'hw-hinge', 'name' => 'Bisagra TOP',
            'placementKind' => 'manual', 'hostComponentInstanceId' => 'st-door-0',
            'anchorFace' => 'front', 'offsetMm' => [298, 100],
            'transform' => { 'translationMm' => [298, 560, 100] } },
          { 'placementId' => 'HP-BOTTOM', 'hardwareId' => 'hw-hinge', 'name' => 'Bisagra BOTTOM',
            'placementKind' => 'manual', 'hostComponentInstanceId' => 'st-door-0',
            'anchorFace' => 'front', 'offsetMm' => [298, 600],
            'transform' => { 'translationMm' => [298, 560, 600] } },
          { 'placementId' => 'HP-HANDLE', 'hardwareId' => 'hw-handle', 'name' => 'Manija',
            'placementKind' => 'manual', 'hostComponentInstanceId' => 'st-door-0',
            'anchorFace' => 'front', 'offsetMm' => [40, 360],
            'transform' => { 'translationMm' => [40, 560, 360] } },
          { 'placementId' => 'HP-DERIVED-1', 'hardwareId' => 'hw-hinge', 'name' => 'Bisagra Derivada',
            'placementKind' => 'derived', 'hostComponentInstanceId' => 'st-door-0',
            'anchorFace' => 'front', 'offsetMm' => [298, 300],
            'transform' => { 'translationMm' => [298, 560, 300] } }
        ] }
    end
  end

  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      catalog_provider: LayoutResolvingCatalog.new
    )
  end

  def native_furniture(instance_ref)
    definition = @model.definitions.add("Granete · Mueble · #{instance_ref}")
    furniture = @model.active_entities.add_instance(definition, Geom::Transformation.identity)
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, furniture, instance_ref,
      { 'furniture_definition_id' => 'kitchen-base-standard' }, {}
    )
    furniture
  end

  def update_envelope(command_message_id, target_ref = 'inst-498')
    {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => command_message_id,
      'mutation' => 'update_furniture',
      'semanticTarget' => { 'furnitureInstanceRef' => target_ref },
      'payload' => {
        'definitionId' => 'kitchen-base-standard',
        'parameters' => { 'widthMm' => 900 }
      }
    }
  end

  def test_versioned_channel_commits_and_pushes_correlated_state_plus_preflight
    native_furniture('inst-498')
    dialog = @controller.show

    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(update_envelope('cmd-from-js-1')))

    mutation_script = dialog.executed_scripts.find { |s| s.include?('onMutationState') }
    refute_nil mutation_script, 'the versioned outcome must reach the dialog'
    assert_includes mutation_script, '"outcome":"committed"'
    assert_includes mutation_script, '"inReplyTo":"cmd-from-js-1"'
    assert_includes mutation_script, '"resolveKind":"native_layout"'
    assert_includes mutation_script, '"degraded":"resolved_current"'

    preflight_script = dialog.executed_scripts.find { |s| s.include?('onPreflightState') }
    refute_nil preflight_script, 'a committed manufacturing-affecting mutation must invalidate preflight'
    assert_includes preflight_script, '"state":"stale"'
    refute_includes preflight_script, 'ready'

    # The legacy channel keeps working for the existing inspector UX.
    update_script = dialog.executed_scripts.find { |s| s.include?('onUpdateResult') }
    refute_nil update_script
    assert_includes update_script, '"success":true'
  end

  def test_versioned_channel_rejects_contract_violations_without_mutation
    dialog = @controller.show
    @controller.mutation_coordinator # ensure initialized before counting

    invalid = update_envelope('cmd-bad').merge('mutation' => 'move_shelf')
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(invalid))

    mutation_script = dialog.executed_scripts.find { |s| s.include?('onMutationState') }
    refute_nil mutation_script
    assert_includes mutation_script, '"outcome":"rejected"'
    assert_includes mutation_script, '"invalid_authoring_input"'
    assert_includes mutation_script, 'Mutación desconocida'
    # No host operation was ever started for an unparseable command.
    assert_empty @model.entities.to_a.grep(->(e) { e.respond_to?(:definition) })
  end

  def test_legacy_update_flow_rides_the_coordinator_and_shares_correlation
    native_furniture('inst-legacy')
    dialog = @controller.show

    dialog.callbacks.fetch('update_furniture').call(
      nil,
      'messageId' => 'cmd-legacy-1',
      'instanceId' => 'inst-legacy',
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 800 }
    )

    mutation_script = dialog.executed_scripts.find { |s| s.include?('onMutationState') }
    refute_nil mutation_script
    assert_includes mutation_script, '"inReplyTo":"cmd-legacy-1"'
    assert_includes mutation_script, '"outcome":"committed"'
  end

  def test_dialog_ready_pushes_honest_degraded_state
    dialog = @controller.show
    dialog.callbacks.fetch('dialog_ready').call(nil)

    degraded_script = dialog.executed_scripts.find { |s| s.include?('onDegradedState') }
    refute_nil degraded_script
    # Static/local catalog → explicit non-productive preview, never ready.
    assert_includes degraded_script, '"state":"unresolved_preview"'
  end

  def test_dialog_reopen_five_times_registers_callbacks_once_and_emits_one_bridge_per_command
    5.times do
      dialog = @controller.show
      dialog.close
    end
    dialog = @controller.show
    native_furniture('inst-reopen')
    before = dialog.executed_scripts.length

    dialog.callbacks.fetch('update_furniture').call(
      nil,
      'instanceId' => 'inst-reopen',
      'definitionId' => 'kitchen-base-standard',
      'parameters' => { 'widthMm' => 700 }
    )

    emissions = dialog.executed_scripts.drop(before)
    update_results = emissions.count { |s| s.include?('onUpdateResult') }
    mutation_states = emissions.count { |s| s.include?('onMutationState') }
    assert_equal 1, update_results, 'one command → exactly one Ruby→JS onUpdateResult'
    assert_equal 1, mutation_states, 'one command → exactly one Ruby→JS onMutationState'
  end

  def test_hardware_update_moves_hinge_and_preserves_identity_and_selection
    dialog = @controller.show
    furniture = native_furniture('inst-hw-1')
    dialog.callbacks.fetch('update_furniture').call(
      nil, 'instanceId' => 'inst-hw-1', 'definitionId' => 'kitchen-base-standard'
    )

    cmd = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-move-hinge-1',
      'mutation' => 'update_hardware_placement',
      'semanticTarget' => {
        'furnitureInstanceRef' => 'inst-hw-1',
        'hardwarePlacementId' => 'HP-TOP'
      },
      'payload' => { 'offsetMm' => 120 }
    }
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(cmd))

    mutation_script = dialog.executed_scripts.find { |s| s.include?('onMutationState') && s.include?('cmd-move-hinge-1') }
    refute_nil mutation_script
    assert_includes mutation_script, '"outcome":"committed"'

    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    top_instance = Granete::SketchUpExtension::Host::SelectionRestore
                   .new(metadata_store_factory: ->(_) { store }, model_provider: -> { @model })
                   .send(:locate_child, furniture, 'hardwarePlacementId' => 'HP-TOP')
    refute_nil top_instance, 'HP-TOP placement must survive rebuild'
    meta = store.read(top_instance)
    assert_equal 'HP-TOP', meta.dig('identity', 'hardwarePlacementId')
    assert_equal 120, meta.dig('intent', 'offsetMm', 1)

    bottom_instance = Granete::SketchUpExtension::Host::SelectionRestore
                      .new(metadata_store_factory: ->(_) { store }, model_provider: -> { @model })
                      .send(:locate_child, furniture, 'hardwarePlacementId' => 'HP-BOTTOM')
    refute_nil bottom_instance
    assert_equal 600, store.read(bottom_instance).dig('intent', 'offsetMm', 1), 'HP-BOTTOM must remain unchanged'

    assert_equal [top_instance], @model.selection.to_a
  end

  def test_hardware_update_derived_placement_is_blocked_without_mutation
    dialog = @controller.show
    native_furniture('inst-derived-1')
    dialog.callbacks.fetch('update_furniture').call(
      nil, 'instanceId' => 'inst-derived-1', 'definitionId' => 'kitchen-base-standard'
    )

    cmd = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-derived-fail',
      'mutation' => 'update_hardware_placement',
      'semanticTarget' => {
        'furnitureInstanceRef' => 'inst-derived-1',
        'hardwarePlacementId' => 'HP-DERIVED-1'
      },
      'payload' => { 'offsetMm' => 320, 'placementKind' => 'derived' }
    }
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(cmd))

    mutation_script = dialog.executed_scripts.find { |s| s.include?('cmd-derived-fail') }
    refute_nil mutation_script
    assert_includes mutation_script, '"outcome":"rejected"'
    assert_includes mutation_script, 'HARDWARE_DERIVED_EDIT'
  end

  def test_hardware_update_shelf_interference_causes_drilling_conflict_issue
    dialog = @controller.show
    native_furniture('inst-conflict-1')
    dialog.callbacks.fetch('update_furniture').call(
      nil, 'instanceId' => 'inst-conflict-1', 'definitionId' => 'kitchen-base-standard'
    )

    cmd = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-conflict-fail',
      'mutation' => 'update_hardware_placement',
      'semanticTarget' => {
        'furnitureInstanceRef' => 'inst-conflict-1',
        'hardwarePlacementId' => 'HP-TOP'
      },
      'payload' => { 'offsetMm' => 150 }
    }
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(cmd))

    mutation_script = dialog.executed_scripts.find { |s| s.include?('cmd-conflict-fail') }
    refute_nil mutation_script
    assert_includes mutation_script, '"outcome":"rejected"'
    assert_includes mutation_script, 'DRILLING_CONFLICT'

    cmd_fix = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-conflict-fix',
      'mutation' => 'update_hardware_placement',
      'semanticTarget' => {
        'furnitureInstanceRef' => 'inst-conflict-1',
        'hardwarePlacementId' => 'HP-TOP'
      },
      'payload' => { 'offsetMm' => 110 }
    }
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(cmd_fix))

    fix_script = dialog.executed_scripts.find { |s| s.include?('cmd-conflict-fix') }
    refute_nil fix_script
    assert_includes fix_script, '"outcome":"committed"'
  end

  def test_hardware_update_out_of_range_rejected_without_mutation
    dialog = @controller.show
    native_furniture('inst-range-1')
    dialog.callbacks.fetch('update_furniture').call(
      nil, 'instanceId' => 'inst-range-1', 'definitionId' => 'kitchen-base-standard'
    )

    cmd = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-range-fail',
      'mutation' => 'update_hardware_placement',
      'semanticTarget' => {
        'furnitureInstanceRef' => 'inst-range-1',
        'hardwarePlacementId' => 'HP-TOP'
      },
      'payload' => { 'offsetMm' => 1500 }
    }
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(cmd))

    mutation_script = dialog.executed_scripts.find { |s| s.include?('cmd-range-fail') }
    refute_nil mutation_script
    assert_includes mutation_script, '"outcome":"rejected"'
    assert_includes mutation_script, 'HARDWARE_PLACEMENT_INVALID'
  end

  def test_hardware_substitute_compatible_preserves_placement_id
    dialog = @controller.show
    furniture = native_furniture('inst-sub-1')
    dialog.callbacks.fetch('update_furniture').call(
      nil, 'instanceId' => 'inst-sub-1', 'definitionId' => 'kitchen-base-standard'
    )

    cmd = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-sub-comp',
      'mutation' => 'substitute_hardware',
      'semanticTarget' => {
        'furnitureInstanceRef' => 'inst-sub-1',
        'hardwarePlacementId' => 'HP-TOP'
      },
      'payload' => { 'targetHardwareDefinitionId' => 'hw-hinge-b' }
    }
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(cmd))

    mutation_script = dialog.executed_scripts.find { |s| s.include?('cmd-sub-comp') }
    refute_nil mutation_script
    assert_includes mutation_script, '"outcome":"committed"'

    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    top_instance = Granete::SketchUpExtension::Host::SelectionRestore
                   .new(metadata_store_factory: ->(_) { store }, model_provider: -> { @model })
                   .send(:locate_child, furniture, 'hardwarePlacementId' => 'HP-TOP')
    refute_nil top_instance
    meta = store.read(top_instance)
    assert_equal 'HP-TOP', meta.dig('identity', 'hardwarePlacementId'), 'placementId must survive substitution'
    assert_equal 'hw-hinge-b', meta.dig('intent', 'hardwareDefinitionId'), 'hardwareDefinitionId must be updated'
  end

  def test_hardware_substitute_incompatible_rejected_without_mutation
    dialog = @controller.show
    native_furniture('inst-sub-incomp-1')
    dialog.callbacks.fetch('update_furniture').call(
      nil, 'instanceId' => 'inst-sub-incomp-1', 'definitionId' => 'kitchen-base-standard'
    )

    cmd = {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => 'cmd-sub-incomp',
      'mutation' => 'substitute_hardware',
      'semanticTarget' => {
        'furnitureInstanceRef' => 'inst-sub-incomp-1',
        'hardwarePlacementId' => 'HP-TOP'
      },
      'payload' => { 'targetHardwareDefinitionId' => 'hw-slide-heavy' }
    }
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(cmd))

    mutation_script = dialog.executed_scripts.find { |s| s.include?('cmd-sub-incomp') }
    refute_nil mutation_script
    assert_includes mutation_script, '"outcome":"rejected"'
    assert_includes mutation_script, 'HARDWARE_INCOMPATIBLE'
  end
end
