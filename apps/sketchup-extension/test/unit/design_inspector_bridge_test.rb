# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/ui/bridges/design_inspector_bridge'

# #784 R1 — Design Inspector read bridge: the ONLY backend surface this
# slice touches is GET working-copy. The bridge reads the model binding,
# refuses to answer for a design the model is not bound to, forwards the
# durable authoring_defaults + the verbatim workingVersion, and never
# mutates anything (zero working-copy PUTs, zero host operations).
class DesignInspectorBridgeTest < Minitest::Test
  DESIGN_A = '51000000-0000-0000-0000-0000000000aa'
  DESIGN_B = '51000000-0000-0000-0000-0000000000bb'
  PROJECT = '40000000-0000-0000-0000-000000000001'

  class FakeDialog
    attr_reader :scripts

    def initialize
      @scripts = []
    end

    def execute_script(script)
      @scripts << script
    end
  end

  class FakeService
    attr_reader :calls

    def initialize(working_copy: nil, error: nil)
      @working_copy = working_copy
      @error = error
      @calls = []
    end

    def get_working_copy(design_id)
      @calls << [:get_working_copy, design_id]
      raise @error if @error

      @working_copy
    end
  end

  class FakePlacer
    attr_reader :service

    def initialize(service)
      @service = service
    end
  end

  class FakeModel
    def initialize(binding_json)
      @binding_json = binding_json
    end

    def get_attribute(_dictionary, _key)
      @binding_json
    end
  end

  WorkingStub = Struct.new(:updated_at, :authoring_defaults, keyword_init: true)

  attr_reader :bridge, :dialog, :service

  def setup
    @dialog = FakeDialog.new
    @service = FakeService.new(working_copy: WorkingStub.new(
      updated_at: '2026-09-28T10:00:00.000000Z',
      authoring_defaults: { 'INTERIOR' => 'mat-white', 'FRENTES' => 'mat-oak' }
    ))
    logger = Struct.new(:error_handler) do
      def error(*_args); end
    end.new
    @bridge = Object.new
    @bridge.extend(Granete::SketchUpExtension::UserInterface::DesignInspectorBridge)
    @bridge.instance_variable_set(:@logger, logger)
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(@service))
    @bridge.define_singleton_method(:execute_bridge) do |dialog, method, payload|
      json = JSON.generate(payload)
      dialog.execute_script(format('window.%<method>s && %<method>s(%<json>s);', method: method, json: json))
    end
  end

  def with_model_bound_to(design_id)
    binding_json = JSON.generate({
                                   'projectId' => PROJECT, 'designId' => design_id,
                                   'baseRevisionId' => nil, 'schemaVersion' => 1
                                 })
    model = FakeModel.new(binding_json)
    @bridge.define_singleton_method(:active_model) { model }
  end

  def pushed_payloads
    @dialog.scripts.map { |script| JSON.parse(script.match(/\((.*)\);?\z/m)[1]) }
  end

  def test_ready_payload_carries_durable_defaults_and_working_version
    with_model_bound_to(DESIGN_A)
    @bridge.handle_get_design_defaults(@dialog, JSON.generate({ 'requestId' => 7, 'designId' => DESIGN_A }))

    payload = pushed_payloads.fetch(0)
    assert_equal 'onDesignDefaults', @dialog.scripts.first[/window\.(\w+)/, 1]
    assert_equal 7, payload['requestId']
    assert_equal 'ready', payload['status']
    assert_equal DESIGN_A, payload['designId']
    assert_equal PROJECT, payload['projectId']
    assert_equal '2026-09-28T10:00:00.000000Z', payload['workingVersion']
    assert_equal({ 'INTERIOR' => 'mat-white', 'FRENTES' => 'mat-oak' },
                 payload['authoringDefaults']['materialChoices'])
    # Read-only: exactly one GET, no writes crossed the service.
    assert_equal [[:get_working_copy, DESIGN_A]], @service.calls
  end

  def test_unbound_model_answers_unbound_without_touching_the_service
    model = FakeModel.new(nil)
    @bridge.define_singleton_method(:active_model) { model }
    @bridge.handle_get_design_defaults(@dialog, JSON.generate({ 'requestId' => 1, 'designId' => DESIGN_A }))

    payload = pushed_payloads.fetch(0)
    assert_equal 'unbound', payload['status']
    assert_empty @service.calls
  end

  def test_request_for_a_design_the_model_is_not_bound_to_is_refused
    with_model_bound_to(DESIGN_A)
    @bridge.handle_get_design_defaults(@dialog, JSON.generate({ 'requestId' => 2, 'designId' => DESIGN_B }))

    payload = pushed_payloads.fetch(0)
    assert_equal 'stale_binding', payload['status']
    assert_equal DESIGN_A, payload['designId']
    assert_empty @service.calls, 'never fetch a working copy for a foreign design'
  end

  def test_service_failure_answers_error_without_inventing_defaults
    with_model_bound_to(DESIGN_A)
    failing = FakeService.new(error: Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error.new(
      :unreachable, 'no se pudo contactar al servidor'
    ))
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(failing))
    @bridge.handle_get_design_defaults(@dialog, JSON.generate({ 'requestId' => 3, 'designId' => DESIGN_A }))

    payload = pushed_payloads.fetch(0)
    assert_equal 'error', payload['status']
    assert_equal 3, payload['requestId']
    assert_nil payload['authoringDefaults']
  end
end
