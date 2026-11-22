# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/ui/bridges/design_opening_geometry_bridge'
require_relative '../../src/granete_for_sketchup/ui/bridges/project_grip_bridge'

# #1683 — after a COMMITTED grip write (style, furniture override, undo or
# redo) the bridge converges the model: every placed furniture of the bound
# design rebuilds through the #1264 pipeline in ONE batch. The convergence
# outcome rides the bridge answer; a convergence failure NEVER reverts or
# masks the committed server write.
class ProjectGripConvergenceTest < Minitest::Test
  PROJECT = '40000000-0000-0000-0000-000000000001'
  DESIGN = '51000000-0000-0000-0000-0000000000aa'
  INSTANCE = '96dfa0b2-2d96-402a-969e-8c8f1d9e69f3'
  STYLE_GOLA = '70c09226-8f44-49ec-9b4e-e368c056d102'
  STYLE_JALADERA = '59dcf78d-bca9-492d-86f9-dce240224a26'

  class FakeDialog
    attr_reader :scripts

    def initialize
      @scripts = []
    end

    def execute_script(script)
      @scripts << script
    end
  end

  class FakeGripService
    attr_reader :writes

    def initialize
      @writes = []
    end

    def get_working_copy(_design_id)
      Struct.new(:items).new([{ furniture_instance_id: INSTANCE, furniture_definition_id: 'mod-1' }])
    end

    def put_project_grip_furniture(project_id, overrides, expected_version:)
      @writes << [:furniture, project_id, overrides, expected_version]
      { 'gripVersion' => 21, 'overrides' => [] }
    end

    def put_project_grip_style(project_id, style_id, expected_version:)
      @writes << [:style, project_id, style_id, expected_version]
      { 'gripVersion' => 22, 'overrides' => [] }
    end
  end

  class FakePlacer
    attr_reader :service

    def initialize(service)
      @service = service
    end
  end

  class FakeModel
    def initialize(binding_json = nil)
      @binding_json = binding_json
    end

    def get_attribute(_dictionary, _key)
      @binding_json
    end

    def entities
      []
    end
  end

  FakeCommand = Struct.new(:name)
  BatchOutcome = Struct.new(:outcome, :reason, keyword_init: true)

  attr_reader :bridge, :dialog, :service, :coordinator

  def setup
    @dialog = FakeDialog.new
    @service = FakeGripService.new
    @coordinator = Struct.new(:batches) do
      attr_accessor :outcome

      def execute_batch(commands)
        batches << commands
        outcome
      end
    end.new([])
    @coordinator.outcome = BatchOutcome.new(outcome: 'committed')
    logger = Struct.new(:error_handler).new
    def logger.error(*_args); end
    @bridge = Object.new
    @bridge.extend(Granete::SketchUpExtension::UserInterface::DesignOpeningGeometryBridge)
    @bridge.extend(Granete::SketchUpExtension::UserInterface::ProjectGripBridge)
    @bridge.instance_variable_set(:@logger, logger)
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(@service))
    @bridge.define_singleton_method(:execute_bridge) do |dialog, method, payload|
      json = JSON.generate(payload)
      dialog.execute_script(format('window.%<method>s && %<method>s(%<json>s);', method: method, json: json))
    end
    coord = @coordinator
    @bridge.define_singleton_method(:mutation_coordinator) { coord }
    # The #1264 pipeline internals are stubbed at their seam: this test owns
    # the GRIP wiring (targets → design-pinned commands → ONE batch), not the
    # placement rebuild itself.
    @bridge.define_singleton_method(:collect_placed_design_targets) do |_model, _items|
      [[{ root: 'root-1', definition: { 'name' => 'Gabinete' } }], 1, 0]
    end
    rebuild_calls = @rebuild_calls = []
    @bridge.define_singleton_method(:design_opening_rebuild_command) do |root, _definition, design_id|
      rebuild_calls << [root, design_id]
      FakeCommand.new("rebuild-#{root}")
    end
  end

  def with_model_bound
    binding_json = JSON.generate({ 'projectId' => PROJECT, 'designId' => DESIGN,
                                   'baseRevisionId' => nil, 'schemaVersion' => 1 })
    @bridge.define_singleton_method(:active_model) { FakeModel.new(binding_json) }
  end

  def apply_furniture_payload
    JSON.generate({
                    'requestId' => 'req-1', 'projectId' => PROJECT,
                    'overrides' => [{ 'furnitureInstanceId' => INSTANCE, 'gripStyleId' => STYLE_GOLA }]
                  })
  end

  def pushed_payloads
    @dialog.scripts.map { |script| JSON.parse(script.match(/\((.*)\);?\z/m)[1]) }
  end

  def test_committed_furniture_override_converges_the_model_in_one_batch
    with_model_bound
    @bridge.define_singleton_method(:collect_placed_design_targets) do |_model, _items|
      [[{ root: 'root-1', definition: { 'name' => 'Gabinete' } },
        { root: 'root-2', definition: { 'name' => 'Alacena' } }], 2, 0]
    end
    @bridge.handle_apply_project_grip_furniture(@dialog, apply_furniture_payload)

    payload = pushed_payloads.fetch(0)
    assert_equal 'ok', payload['status'], 'the server write must answer ok'
    assert_equal({ 'status' => 'converged', 'units' => 2 }, payload['model'])
    assert_equal 1, coordinator.batches.length, 'ONE batch converges every unit (#1683 acceptance)'
    assert_equal 2, coordinator.batches.first.length, 'both units ride the single batch'
    assert_equal [['root-1', DESIGN], ['root-2', DESIGN]], @rebuild_calls,
                 'every rebuild is design-pinned'
  end

  def test_committed_style_apply_converges_the_model_too
    with_model_bound
    style_payload = JSON.generate({
                                    'requestId' => 'req-2', 'projectId' => PROJECT,
                                    'gripStyleId' => STYLE_GOLA, 'previousStyleId' => ''
                                  })
    @bridge.handle_apply_project_grip_style(@dialog, style_payload)

    payload = pushed_payloads.fetch(0)
    assert_equal 'ok', payload['status']
    assert_equal 'converged', payload['model']['status']
    assert_equal 1, coordinator.batches.length
  end

  def test_convergence_failure_never_reverts_or_masks_the_committed_write
    with_model_bound
    @coordinator.outcome = BatchOutcome.new(outcome: 'aborted', reason: 'resolve no disponible')
    @bridge.handle_apply_project_grip_furniture(@dialog, apply_furniture_payload)

    payload = pushed_payloads.fetch(0)
    assert_equal 'ok', payload['status'], 'the server write stays committed'
    refute_nil payload['grip'], 'the grip state still paints'
    assert_equal({ 'status' => 'failed', 'reason' => 'resolve no disponible' }, payload['model'])
    assert_equal 1, @service.writes.length, 'no write replay/rollback was attempted'
  end

  def test_unbound_model_refuses_the_write_before_any_convergence
    @bridge.define_singleton_method(:active_model) { FakeModel.new(nil) }
    @bridge.handle_apply_project_grip_furniture(@dialog, apply_furniture_payload)

    payload = pushed_payloads.fetch(0)
    assert_equal 'unbound', payload['status'], 'the bridge refuses writes for an unbound model'
    assert_nil payload['model'], 'no convergence answer without a write'
    assert_empty coordinator.batches
    assert_empty @service.writes
  end

  # Review r1 MAJOR: the undo/redo replay is the THIRD convergence call-site
  # — without this regression a refactor that drops its converge line reverts
  # the fix for exactly that path (#1683 acceptance «undo/redo también
  # convergen») with every other test still green.
  def test_undo_replays_the_previous_style_and_converges_the_model_again
    with_model_bound
    style_payload = JSON.generate({
                                    'requestId' => 'req-undo-1', 'projectId' => PROJECT,
                                    'gripStyleId' => STYLE_GOLA, 'previousStyleId' => STYLE_JALADERA
                                  })
    @bridge.handle_apply_project_grip_style(@dialog, style_payload)
    assert_equal 1, coordinator.batches.length, 'the apply converged once'

    @bridge.handle_undo_project_grip(@dialog, JSON.generate({
                                                              'requestId' => 'req-undo-2', 'projectId' => PROJECT
                                                            }))

    payloads = pushed_payloads
    undone = payloads.fetch(1)
    assert_equal 'onProjectGripUndone', @dialog.scripts[1][/window\.(\w+)/, 1]
    assert_equal 'ok', undone['status'], 'the replayed write committed'
    assert_equal 'converged', undone['model']['status'], 'undo converges the model too'
    assert_equal 1, undone['model']['units']
    assert_equal 2, coordinator.batches.length, 'ONE extra batch for the undo convergence'
    assert_equal :style, @service.writes.last[0], 'undo replays the previous STYLE intention'
  end

  # «Volver al del proyecto» rides the same furniture-override channel with a
  # null style — it converges exactly like an explicit pick.
  def test_clear_override_converges_the_model
    with_model_bound
    clear_payload = JSON.generate({
                                    'requestId' => 'req-clear', 'projectId' => PROJECT,
                                    'overrides' => [{ 'furnitureInstanceId' => INSTANCE, 'gripStyleId' => nil }]
                                  })
    @bridge.handle_apply_project_grip_furniture(@dialog, clear_payload)

    payload = pushed_payloads.fetch(0)
    assert_equal 'ok', payload['status']
    assert_equal 'converged', payload['model']['status']
    assert_equal 1, coordinator.batches.length
  end

  # Review r1 MINOR: a unit whose definition left the local catalog is a
  # different honest absence than a unit that is simply not placed.
  def test_unchanged_reason_distinguishes_missing_definition_from_not_placed
    with_model_bound
    @bridge.define_singleton_method(:collect_placed_design_targets) do |_model, _items|
      [[], 0, 2]
    end
    @bridge.handle_apply_project_grip_furniture(@dialog, apply_furniture_payload)

    payload = pushed_payloads.fetch(0)
    assert_equal 'ok', payload['status']
    assert_equal({ 'status' => 'unchanged',
                   'reason' => 'la definición del mueble no está en el catálogo local (2)' },
                 payload['model'])
    assert_empty coordinator.batches
  end
end
