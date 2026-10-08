# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/ui/bridges/design_opening_bridge'

# #1137 — the design opening bridge: the dialog sends the semantic INTENT and
# renders the server's RESOLVED result. Ruby transports only. The binding
# store refuses foreign designs; an INVALID_OPENING_CONFIGURATION refusal
# arrives as status 'invalid' carrying the server's stable reason and
# message; ok answers with the fresh authoritative state.
class DesignOpeningBridgeTest < Minitest::Test
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

    def initialize(opening: nil, capabilities: nil, profiles: nil, error: nil)
      @opening = opening
      @capabilities = capabilities
      @profiles = profiles
      @error = error
      @calls = []
    end

    def get_design_opening(design_id)
      @calls << [:get_design_opening, design_id]
      raise @error if @error

      @opening
    end

    def fetch_opening_capabilities
      @calls << [:fetch_opening_capabilities]
      raise @error if @error

      @capabilities
    end

    def fetch_opening_profiles
      @calls << [:fetch_opening_profiles]
      raise @error if @error

      @profiles
    end

    def put_design_opening(design_id, selection, expected_working_version: nil)
      @calls << [:put_design_opening, design_id, selection, expected_working_version]
      raise @error if @error

      { 'opening' => selection, 'resolution' => nil, 'dimsKnown' => false,
        'workingVersion' => '2026-10-08T12:00:00.000000Z' }
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

  attr_reader :bridge, :dialog, :service

  def setup
    @dialog = FakeDialog.new
    @service = FakeService.new(
      opening: { 'opening' => nil, 'resolution' => nil, 'dimsKnown' => false },
      capabilities: { 'opening_capabilities' => { 'version' => 1, 'grips' => { 'handle' => { 'enabled' => true } } } },
      profiles: [{ 'id' => 'profile.gola-l.alu' }]
    )
    logger = Struct.new(:error_handler) do
      def error(*_args); end
    end.new
    @bridge = Object.new
    @bridge.extend(Granete::SketchUpExtension::UserInterface::DesignOpeningBridge)
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

  def last_script_payload
    JSON.generate({})
    script = @dialog.scripts.last
    match = script.match(/\((\{.*\})\);?\z/m)
    JSON.parse(match[1])
  end

  def test_get_composes_opening_capabilities_and_profiles
    with_model_bound_to(DESIGN_A)
    @bridge.handle_get_design_opening(@dialog, JSON.generate({ 'requestId' => 7, 'designId' => DESIGN_A }))

    assert_equal(
      [[:get_design_opening, DESIGN_A], [:fetch_opening_capabilities], [:fetch_opening_profiles]], @service.calls
    )
    payload = last_script_payload
    assert_equal 7, payload['requestId']
    assert_equal 'ready', payload['status']
    assert_equal({ 'version' => 1, 'grips' => { 'handle' => { 'enabled' => true } } }, payload['capabilities'])
    assert_equal false, payload['dimsKnown']
    assert_equal [{ 'id' => 'profile.gola-l.alu' }], payload['profiles']
  end

  def test_get_refuses_a_foreign_design_as_stale
    with_model_bound_to(DESIGN_A)
    @bridge.handle_get_design_opening(@dialog, JSON.generate({ 'requestId' => 1, 'designId' => DESIGN_B }))

    payload = last_script_payload
    assert_equal 'stale_binding', payload['status']
    assert_equal DESIGN_A, payload['designId']
    assert_empty @service.calls
  end

  def test_apply_sends_the_selection_with_the_token
    with_model_bound_to(DESIGN_A)
    apply_payload = {
      'requestId' => 3, 'designId' => DESIGN_A,
      'selection' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.alu' },
      'expectedWorkingVersion' => 'v-token'
    }
    @bridge.handle_apply_design_opening(@dialog, JSON.generate(apply_payload))

    expected_call = [:put_design_opening, DESIGN_A,
                     { 'system' => 'gola', 'profileId' => 'profile.gola-l.alu' }, 'v-token']
    assert_equal expected_call, @service.calls.last
    payload = last_script_payload
    assert_equal 'ok', payload['status']
    assert_equal '2026-10-08T12:00:00.000000Z', payload['state']['workingVersion']
  end

  def test_apply_surfaces_invalid_opening_configuration_with_reason
    with_model_bound_to(DESIGN_A)
    error = ::Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error.new(
      :invalid_configuration,
      'la configuración de apertura no es válida: el sistema no está disponible',
      status: 422, api_code: 'INVALID_OPENING_CONFIGURATION',
      details: { 'reason' => 'OPENING_SYSTEM_UNAVAILABLE' }
    )
    @service = FakeService.new(error: error)
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(@service))

    invalid_payload = {
      'requestId' => 4, 'designId' => DESIGN_A,
      'selection' => { 'system' => 'gola' },
      'expectedWorkingVersion' => 'v-token'
    }
    @bridge.handle_apply_design_opening(@dialog, JSON.generate(invalid_payload))

    payload = last_script_payload
    assert_equal 'invalid', payload['status']
    assert_equal 'OPENING_SYSTEM_UNAVAILABLE', payload['reason']
    assert payload['message'].include?('ficha') || payload['message'].include?('disponible'),
           'the server message must reach the card'
  end

  def test_apply_refuses_without_binding
    with_model_bound_to(nil)
    @bridge.handle_apply_design_opening(
      @dialog, JSON.generate({ 'requestId' => 5, 'designId' => DESIGN_A, 'selection' => { 'system' => 'handle' } })
    )
    payload = last_script_payload
    assert_equal 'unbound', payload['status']
    assert_empty @service.calls
  end
end
