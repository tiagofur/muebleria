# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/ui/bridges/design_inspector_bridge'
require_relative '../../src/granete_for_sketchup/ui/bridges/design_inheritance_bridge'

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

    def initialize(working_copy: nil, design_inheritance: nil, error: nil)
      @working_copy = working_copy
      @design_inheritance = design_inheritance
      @error = error
      @calls = []
    end

    def get_working_copy(design_id)
      @calls << [:get_working_copy, design_id]
      raise @error if @error

      @working_copy
    end

    def get_design_inheritance(design_id)
      @calls << [:get_design_inheritance, design_id]
      raise @error if @error

      @design_inheritance
    end

    def update_working_copy(_design_id, items:, expected_working_version:, authoring_defaults:)
      @calls << [:update_working_copy, { items: items, expected_working_version: expected_working_version,
                                         authoring_defaults: authoring_defaults }]
      raise @error if @error

      Struct.new(:updated_at, :authoring_defaults, keyword_init: true).new(
        updated_at: '2026-09-28T11:00:00.000000Z', authoring_defaults: authoring_defaults
      )
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
  WorkingStubWithItems = Struct.new(:updated_at, :authoring_defaults, :items, keyword_init: true)

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
    @bridge.extend(Granete::SketchUpExtension::UserInterface::DesignInheritanceBridge)
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

  def apply_request(request_id, token, choices = {})
    JSON.generate({
                    'requestId' => request_id, 'designId' => DESIGN_A,
                    'expectedWorkingVersion' => token,
                    'authoringDefaults' => { 'materialChoices' => choices }
                  })
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

  # --- R2: apply design defaults — ONE working-copy PUT, items verbatim ---
  def test_apply_builds_one_put_with_token_merged_defaults_and_verbatim_items
    with_model_bound_to(DESIGN_A)
    WorkingStub.new(
      updated_at: '2026-09-28T10:00:00.000000Z',
      authoring_defaults: { 'INTERIOR' => 'mat-white' }
    )
    working_item = Granete::SketchUpExtension::Connection::ProjectFurniture::Contract::WorkingItem.new(
      furniture_instance_id: '51000000-0000-0000-0000-0000000000f1',
      parameters: { 'widthMm' => 600 },
      material_choices: { 'INTERIOR' => 'mat-white' }
    )
    working_with_items = WorkingStubWithItems.new(
      updated_at: '2026-09-28T10:00:00.000000Z',
      authoring_defaults: { 'INTERIOR' => 'mat-white' },
      items: [working_item]
    )
    recording = RecordingService.new(working_with_items)
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(recording))

    merged_block = { 'INTERIOR' => 'mat-oak', 'FRENTES' => 'mat-blanco' }
    apply_request = JSON.generate({
                                    'requestId' => 31, 'designId' => DESIGN_A,
                                    'expectedWorkingVersion' => '2026-09-28T10:00:00.000000Z',
                                    'authoringDefaults' => { 'materialChoices' => merged_block }
                                  })
    @bridge.handle_apply_design_defaults(@dialog, apply_request)

    payload = pushed_payloads.fetch(0)
    assert_equal 'onDesignDefaultsApplied', @dialog.scripts.first[/window\.(\w+)/, 1]
    assert_equal 'ok', payload['status']
    assert_equal 31, payload['requestId']
    # Exactly one GET (authoritative items) + exactly ONE PUT.
    assert_equal %i[get_working_copy update_working_copy], recording.calls.map(&:first)
    put = recording.calls.last.last
    assert_equal '2026-09-28T10:00:00.000000Z', put[:expected_working_version]
    assert_equal({ 'materialChoices' => { 'INTERIOR' => 'mat-oak', 'FRENTES' => 'mat-blanco' } },
                 put[:authoring_defaults], 'the durable block travels with its canonical wrapper')
    # Items travel VERBATIM (the parsed structs, untouched — the service
    # serializes them through the shared to_contract_h contract, which
    # carries no modes key, so the backend preserves the persisted lineage
    # for unchanged values via the legacy merge).
    assert_equal [working_item], put[:items]
    assert_nil working_item.to_contract_h['material_choice_modes']
  end

  def test_apply_with_a_stale_token_answers_conflict_without_writing
    with_model_bound_to(DESIGN_A)
    recording = RecordingService.new(WorkingStub.new(
                                       updated_at: '2026-09-28T12:00:00.000000Z', authoring_defaults: {}
                                     ))
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(recording))

    @bridge.handle_apply_design_defaults(@dialog,
                                         apply_request(32, '2026-09-28T10:00:00.000000Z', 'INTERIOR' => 'mat-oak'))

    payload = pushed_payloads.fetch(0)
    assert_equal 'conflict', payload['status']
    assert_equal 32, payload['requestId']
    assert_equal [:get_working_copy], recording.calls.map(&:first), 'a stale token never reaches a PUT'
  end

  def test_apply_unbound_answers_without_touching_the_service
    model = FakeModel.new(nil)
    @bridge.define_singleton_method(:active_model) { model }
    @bridge.handle_apply_design_defaults(@dialog, apply_request(33, '2026-09-28T10:00:00.000000Z'))
    assert_equal 'unbound', pushed_payloads.fetch(0)['status']
    assert_empty @service.calls
  end

  # Scripted service recording both reads and writes.
  class RecordingService
    attr_reader :calls

    def initialize(working_copy)
      @working_copy = working_copy
      @calls = []
    end

    def get_working_copy(design_id)
      @calls << [:get_working_copy, design_id]
      @working_copy
    end

    def update_working_copy(_design_id, items:, expected_working_version:, authoring_defaults:)
      @calls << [:update_working_copy, { items: items, expected_working_version: expected_working_version,
                                         authoring_defaults: authoring_defaults }]
      Struct.new(:updated_at, :authoring_defaults, keyword_init: true).new(
        updated_at: '2026-09-28T11:00:00.000000Z', authoring_defaults: authoring_defaults
      )
    end
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

  def test_get_design_inheritance_forwards_summary_and_furniture_definition_id
    with_model_bound_to(DESIGN_A)
    summary_entry = Granete::SketchUpExtension::Connection::ProjectFurniture::Contract::RoleInheritanceCount.new(
      role: 'FRONT', items: 3, design_backed: 2, definition_backed: 1,
      needs_rollout: 1, design_current: 1, overridden: 1
    )
    role_entry = Granete::SketchUpExtension::Connection::ProjectFurniture::Contract::RoleInheritance.new(
      role: 'FRONT', mode: 'design', applied_material_id: 'mat-old', design_default_material_id: 'mat-new',
      needs_rollout: true
    )
    item = Granete::SketchUpExtension::Connection::ProjectFurniture::Contract::InheritanceItem.new(
      furniture_instance_id: '51000000-0000-0000-0000-000000000001',
      furniture_definition_id: 'def-1',
      inheritance: [role_entry]
    )
    projection = Granete::SketchUpExtension::Connection::ProjectFurniture::Contract::DesignInheritance.new(
      design_id: DESIGN_A, project_id: PROJECT, items: [item], inheritance_summary: [summary_entry]
    )
    service = FakeService.new(design_inheritance: projection)
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(service))

    @bridge.handle_get_design_inheritance(@dialog, JSON.generate({ 'requestId' => 42, 'designId' => DESIGN_A }))

    payload = pushed_payloads.fetch(0)
    assert_equal 'ready', payload['status']
    assert_equal 42, payload['requestId']
    assert_equal [{ 'role' => 'FRONT', 'items' => 3, 'designBacked' => 2, 'definitionBacked' => 1,
                    'needsRollout' => 1, 'designCurrent' => 1, 'overridden' => 1 }],
                 payload['inheritanceSummary']
    assert_equal 'def-1', payload['items'].first['furnitureDefinitionId']
  end
end
