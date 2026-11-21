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
    @bridge.handle_apply_project_grip_furniture(@dialog, apply_furniture_payload)

    payload = pushed_payloads.fetch(0)
    assert_equal 'ok', payload['status'], 'the server write must answer ok'
    assert_equal({ 'status' => 'converged', 'units' => 1 }, payload['model'])
    assert_equal 1, coordinator.batches.length, 'ONE batch for the whole convergence'
    assert_equal [['root-1', DESIGN]], @rebuild_calls, 'the rebuild is design-pinned'
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
end
