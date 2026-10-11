# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/ui/bridges/design_opening_bridge'
require_relative '../../src/granete_for_sketchup/ui/bridges/design_opening_geometry_bridge'
require_relative '../../src/granete_for_sketchup/ui/bridges/design_opening_channel_bridge'
require_relative '../../src/granete_for_sketchup/host/mutation_outcome'
require_relative '../../src/granete_for_sketchup/host/mutation_command'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'

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

    attr_accessor :conflict_first_pass

    def initialize(opening: nil, capabilities: nil, profiles: nil, error: nil, working_copy: nil,
                   applied_state: nil, conflict_first_pass: false)
      @opening = opening
      @capabilities = capabilities
      @profiles = profiles
      @error = error
      @working_copy = working_copy
      @applied_state = applied_state
      @conflict_first_pass = conflict_first_pass
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
      if @conflict_first_pass
        @conflict_first_pass = false
        raise ::Granete::SketchUpExtension::Connection::ProjectFurniture::Service::Error.new(
          :conflict, 'el diseño cambió en el servidor', status: 409
        )
      end
      raise @error if @error

      @applied_state || { 'opening' => selection, 'resolution' => nil, 'dimsKnown' => false,
                          'workingVersion' => '2026-10-08T12:00:00.000000Z' }
    end

    def get_working_copy(_design_id)
      @calls << [:get_working_copy]
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
    @bridge.extend(Granete::SketchUpExtension::UserInterface::DesignOpeningGeometryBridge)
    @bridge.extend(Granete::SketchUpExtension::UserInterface::DesignOpeningChannelBridge)
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

  # #1264 — a valid apply converges the placed geometry through ONE
  # coordinated batch: the resolve is pinned to the designId (the opening
  # constrains the fronts), the rebuild is server-born (authoring_dirty
  # false, no working-copy write) and the card receives the honest outcome.
  class FakeMetadataStore
    def initialize(metadata)
      @metadata = metadata
    end

    def read(entity)
      @metadata[entity]
    end
  end

  class FakeEntitiesModel
    attr_reader :entities

    def initialize(entities, binding_json = nil)
      @entities = entities
      @binding_json = binding_json
    end

    def get_attribute(_dictionary, _key)
      @binding_json
    end
  end

  class FakeConvergeCatalogProvider
    attr_reader :layout_resolves, :definition_lookups

    def initialize(definition, layout)
      @definition = definition
      @layout = layout
      @layout_resolves = []
      @definition_lookups = []
    end

    def find_definition(id)
      @definition_lookups << id
      @definition
    end

    def resolved_native_layout(definition_id, parameters, choices, design_id = nil)
      @layout_resolves << { definition_id: definition_id, parameters: parameters,
                            choices: choices, design_id: design_id }
      @layout
    end
  end

  class FakeConvergeCoordinator
    attr_reader :batches

    def initialize(outcome, apply: false)
      @outcome = outcome
      @apply = apply
      @batches = []
    end

    def execute_batch(commands)
      @batches << commands
      if @apply
        commands.each do |command|
          result = command.resolve_intent({ message_id: 'm', idempotency_key: 'k' })
          command.apply_accepted_state(result, nil)
        end
      end
      @outcome
    end
  end

  class FakeConvergeBuilder
    attr_reader :updates

    def initialize
      @updates = []
    end

    def update_furniture(_model, root, definition, parameters, resolved_layout: nil, material_choices: nil,
                         transaction: true, authoring_dirty: true, **_rest)
      @updates << { root: root, definition: definition, parameters: parameters,
                    resolved_layout: resolved_layout, material_choices: material_choices,
                    transaction: transaction, authoring_dirty: authoring_dirty }
      { 'success' => true, 'instance_id' => 'inst-1' }
    end
  end

  def test_apply_converges_geometry_through_one_design_pinned_batch
    working_item = Struct.new(:furniture_instance_id, :furniture_definition_id, :parameters,
                              :material_choices).new('fi-1264', 'mod-1264', {}, {})
    applied_state = { 'opening' => { 'system' => 'gola' },
                      'resolution' => { 'state' => 'resolved', 'fronts' => [] },
                      'dimsKnown' => true,
                      'workingVersion' => '2026-10-10T12:00:00.000000Z' }
    service = FakeService.new(applied_state: applied_state, working_copy: Struct.new(:items).new([working_item]))
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(service))

    root = Object.new
    layout = Object.new
    definition = { 'furniture_definition_id' => 'mod-1264', 'name' => 'Gabinete Gola' }
    metadata = { root => {
      'identity' => { 'instanceRef' => 'inst-abc', 'furnitureInstanceId' => 'fi-1264' },
      'intent' => { 'parameters' => { 'widthMm' => 600 }, 'materialChoices' => { 'FRENTE' => 'mat-1' } }
    } }
    provider = FakeConvergeCatalogProvider.new(definition, layout)
    coordinator = FakeConvergeCoordinator.new(
      Granete::SketchUpExtension::Host::MutationOutcome.new(outcome: 'committed')
    )
    builder = FakeConvergeBuilder.new
    @bridge.instance_variable_set(:@catalog_provider, provider)
    @bridge.instance_variable_set(:@metadata_store_factory, ->(_model) { FakeMetadataStore.new(metadata) })
    @bridge.define_singleton_method(:mutation_coordinator) { coordinator }
    @bridge.define_singleton_method(:furniture_builder_for) { |_model| builder }
    binding_json = JSON.generate({ 'projectId' => PROJECT, 'designId' => DESIGN_A,
                                   'baseRevisionId' => nil, 'schemaVersion' => 1 })
    @bridge.define_singleton_method(:active_model) { FakeEntitiesModel.new([root], binding_json) }

    @bridge.handle_apply_design_opening(
      @dialog,
      JSON.generate({ 'requestId' => 42, 'designId' => DESIGN_A,
                      'selection' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.alu' },
                      'expectedWorkingVersion' => 'v1' })
    )

    answer = last_script_payload
    assert_equal 'ok', answer['status']
    assert_equal({ 'status' => 'converged', 'units' => 1 }, answer['geometry'])

    # The ONE command resolved design-pinned and applied server-born.
    assert_equal 1, coordinator.batches.length
    command = coordinator.batches.first.first
    assert_equal 'update_furniture', command.name
    assert_equal 'fi-1264', command.semantic_target['furnitureInstanceId']
    assert_equal 'inst-abc', command.semantic_target['furnitureInstanceRef']
    assert command.context_still_valid?

    result = command.resolve_intent({ message_id: 'm1', idempotency_key: 'k1' })
    assert_equal [{ definition_id: 'mod-1264', parameters: { 'widthMm' => 600 },
                    choices: { 'FRENTE' => 'mat-1' }, design_id: DESIGN_A }],
                 provider.layout_resolves
    command.apply_accepted_state(result, nil)
    assert_equal 1, builder.updates.length
    update = builder.updates.first
    assert_equal layout, update[:resolved_layout]
    assert_equal false, update[:authoring_dirty]
    assert_equal false, update[:transaction]
  end

  # Without dimensions there is nothing to converge: the answer stays honest
  # and no model machinery runs.
  def test_apply_reports_skipped_geometry_without_dims
    with_model_bound_to(DESIGN_A)
    @bridge.handle_apply_design_opening(
      @dialog,
      JSON.generate({ 'requestId' => 43, 'designId' => DESIGN_A,
                      'selection' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.alu' } })
    )
    answer = last_script_payload
    assert_equal 'ok', answer['status']
    assert_equal({ 'status' => 'skipped' }, answer['geometry'])
    refute service.calls.include?([:get_working_copy])
  end

  # A convergence failure never rolls back the persisted selection — the
  # intent stays ok with the honest geometry outcome.
  def test_apply_keeps_ok_when_geometry_convergence_fails
    working_item = Struct.new(:furniture_instance_id, :furniture_definition_id, :parameters,
                              :material_choices).new('fi-1264', 'mod-1264', {}, {})
    applied_state = { 'opening' => { 'system' => 'gola' },
                      'resolution' => { 'state' => 'resolved' }, 'dimsKnown' => true }
    service = FakeService.new(applied_state: applied_state, working_copy: Struct.new(:items).new([working_item]))
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(service))
    @bridge.instance_variable_set(:@catalog_provider, nil)

    with_model_bound_to(DESIGN_A)
    @bridge.handle_apply_design_opening(
      @dialog,
      JSON.generate({ 'requestId' => 44, 'designId' => DESIGN_A,
                      'selection' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.alu' } })
    )
    answer = last_script_payload
    assert_equal 'ok', answer['status']
    assert_equal 'skipped', answer['geometry']['status']
  end

  # #969d auto-advance: a background auto-sync bump retries once with the
  # fresh token so the user's Apply succeeds on the first click.
  def test_apply_auto_advances_token_on_conflict_and_converges
    working_item = Struct.new(:furniture_instance_id, :furniture_definition_id, :parameters,
                              :material_choices).new('fi-1264', 'mod-1264', {}, {})
    fresh_wc = Struct.new(:items, :updated_at).new([working_item], 'fresh-token-v2')
    applied_state = { 'opening' => { 'system' => 'gola' },
                      'resolution' => { 'state' => 'resolved', 'fronts' => [] },
                      'dimsKnown' => true,
                      'workingVersion' => 'fresh-token-v2' }
    service = FakeService.new(applied_state: applied_state, working_copy: fresh_wc, conflict_first_pass: true)

    root = Object.new
    layout = Object.new
    definition = { 'furniture_definition_id' => 'mod-1264', 'name' => 'Gabinete Gola' }
    metadata = { root => {
      'identity' => { 'instanceRef' => 'inst-abc', 'furnitureInstanceId' => 'fi-1264' },
      'intent' => { 'parameters' => { 'widthMm' => 600 }, 'materialChoices' => { 'FRENTE' => 'mat-1' } }
    } }
    provider = FakeConvergeCatalogProvider.new(definition, layout)
    coordinator = FakeConvergeCoordinator.new(
      Granete::SketchUpExtension::Host::MutationOutcome.new(outcome: 'committed')
    )
    builder = FakeConvergeBuilder.new
    @bridge.instance_variable_set(:@catalog_provider, provider)
    @bridge.instance_variable_set(:@metadata_store_factory, ->(_model) { FakeMetadataStore.new(metadata) })
    @bridge.define_singleton_method(:mutation_coordinator) { coordinator }
    @bridge.define_singleton_method(:furniture_builder_for) { |_model| builder }
    binding_json = JSON.generate({ 'projectId' => PROJECT, 'designId' => DESIGN_A,
                                   'baseRevisionId' => nil, 'schemaVersion' => 1 })
    @bridge.define_singleton_method(:active_model) { FakeEntitiesModel.new([root], binding_json) }
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(service))

    @bridge.handle_apply_design_opening(
      @dialog,
      JSON.generate({ 'requestId' => 50, 'designId' => DESIGN_A,
                      'selection' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.alu' },
                      'expectedWorkingVersion' => 'stale-v1' })
    )

    answer = last_script_payload
    assert_equal 'ok', answer['status']
    assert_equal({ 'status' => 'converged', 'units' => 1 }, answer['geometry'])
    # First attempt sent stale-v1, second attempt auto-advanced to fresh-token-v2
    puts_calls = service.calls.select { |c| c.first == :put_design_opening }
    assert_equal 2, puts_calls.length
    assert_equal 'stale-v1', puts_calls[0][3]
    assert_equal 'fresh-token-v2', puts_calls[1][3]
  end

  # #1272 — a working item written by the pre-fix intent store carries a
  # NULL definition; the placed root's OWN persisted intent is the fallback
  # the convergence resolves with (never a name/order guess).
  def test_apply_converges_with_definition_fallback_from_root_intent
    working_item = Struct.new(:furniture_instance_id, :furniture_definition_id, :parameters,
                              :material_choices).new('fi-1272', nil, {}, {})
    applied_state = { 'opening' => { 'system' => 'gola' },
                      'resolution' => { 'state' => 'resolved', 'fronts' => [] },
                      'dimsKnown' => true,
                      'workingVersion' => '2026-10-11T12:00:00.000000Z' }
    service = FakeService.new(applied_state: applied_state,
                              working_copy: Struct.new(:items).new([working_item]))
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(service))

    root = Object.new
    layout = Object.new
    definition = { 'furniture_definition_id' => 'mod-1272', 'name' => 'Gabinete Gola' }
    metadata = { root => {
      'identity' => { 'instanceRef' => 'inst-1272', 'furnitureInstanceId' => 'fi-1272' },
      'intent' => { 'furnitureDefinitionId' => 'mod-1272', 'parameters' => {}, 'materialChoices' => {} }
    } }
    provider = FakeConvergeCatalogProvider.new(definition, layout)
    coordinator = FakeConvergeCoordinator.new(
      Granete::SketchUpExtension::Host::MutationOutcome.new(outcome: 'committed')
    )
    builder = FakeConvergeBuilder.new
    @bridge.instance_variable_set(:@catalog_provider, provider)
    @bridge.instance_variable_set(:@metadata_store_factory, ->(_model) { FakeMetadataStore.new(metadata) })
    @bridge.define_singleton_method(:mutation_coordinator) { coordinator }
    @bridge.define_singleton_method(:furniture_builder_for) { |_model| builder }
    binding_json = JSON.generate({ 'projectId' => PROJECT, 'designId' => DESIGN_A,
                                   'baseRevisionId' => nil, 'schemaVersion' => 1 })
    @bridge.define_singleton_method(:active_model) { FakeEntitiesModel.new([root], binding_json) }

    @bridge.handle_apply_design_opening(
      @dialog,
      JSON.generate({ 'requestId' => 51, 'designId' => DESIGN_A,
                      'selection' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.8006' } })
    )

    answer = last_script_payload
    assert_equal 'ok', answer['status']
    assert_equal({ 'status' => 'converged', 'units' => 1 }, answer['geometry'])
    assert_includes provider.definition_lookups, 'mod-1272'
  end

  # #1272 — a placed, identified mueble whose definition the local catalog
  # cannot resolve reports the TRUE blocker; it never says "no colocado"
  # again for a mueble that IS placed.
  def test_apply_reports_missing_definition_honestly
    working_item = Struct.new(:furniture_instance_id, :furniture_definition_id, :parameters,
                              :material_choices).new('fi-1272', 'mod-desconocido', {}, {})
    applied_state = { 'opening' => { 'system' => 'gola' },
                      'resolution' => { 'state' => 'resolved', 'fronts' => [] },
                      'dimsKnown' => true,
                      'workingVersion' => '2026-10-11T12:00:00.000000Z' }
    service = FakeService.new(applied_state: applied_state,
                              working_copy: Struct.new(:items).new([working_item]))
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(service))

    root = Object.new
    metadata = { root => {
      'identity' => { 'instanceRef' => 'inst-1272', 'furnitureInstanceId' => 'fi-1272' },
      'intent' => { 'parameters' => {}, 'materialChoices' => {} }
    } }
    provider = FakeConvergeCatalogProvider.new(nil, Object.new)
    @bridge.instance_variable_set(:@catalog_provider, provider)
    @bridge.instance_variable_set(:@metadata_store_factory, ->(_model) { FakeMetadataStore.new(metadata) })
    binding_json = JSON.generate({ 'projectId' => PROJECT, 'designId' => DESIGN_A,
                                   'baseRevisionId' => nil, 'schemaVersion' => 1 })
    @bridge.define_singleton_method(:active_model) { FakeEntitiesModel.new([root], binding_json) }

    @bridge.handle_apply_design_opening(
      @dialog,
      JSON.generate({ 'requestId' => 52, 'designId' => DESIGN_A,
                      'selection' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.8006' } })
    )

    answer = last_script_payload
    assert_equal 'ok', answer['status']
    geometry = answer['geometry']
    assert_equal 'unchanged', geometry['status']
    assert_equal 'la definición del mueble no está en el catálogo local (1)', geometry['reason']
  end

  # #1272 — the gola channel placeholder spec comes ONLY from server data
  # (profile geometry + resolved front grips); anything less is nil, never
  # an invented block.
  def test_channel_spec_derives_from_server_profile_and_front
    service = FakeService.new(
      profiles: [{ 'id' => 'profile.gola-l.8006', 'code' => 'GOLA-L-8006',
                   'profile_height_mm' => 27, 'profile_depth_mm' => 56 }]
    )
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(service))
    state = {
      'opening' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.8006' },
      'resolution' => { 'state' => 'resolved',
                        'fronts' => [{ 'widthMm' => 400, 'heightMm' => 680,
                                       'grips' => [{ 'boundary' => 'top', 'consumedMm' => 40 }] }] }
    }
    assert_equal({ 'profileId' => 'profile.gola-l.8006', 'profileCode' => 'GOLA-L-8006',
                   'heightMm' => 27, 'depthMm' => 56, 'boundary' => 'top' },
                 @bridge.design_opening_channel_spec(state))

    bottom = { 'opening' => state['opening'],
               'resolution' => { 'fronts' => [{ 'grips' => [{ 'boundary' => 'bottom' }] }] } }
    assert_equal 'bottom', @bridge.design_opening_channel_spec(bottom)['boundary']

    # Non-gola systems and profiles without declared geometry draw nothing.
    assert_nil @bridge.design_opening_channel_spec(
      'opening' => { 'system' => 'jaladera' }, 'resolution' => { 'fronts' => [] }
    )
    geometryless = FakeService.new(profiles: [{ 'id' => 'p1', 'code' => 'X' }])
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(geometryless))
    assert_nil @bridge.design_opening_channel_spec(state)
  end

  # #1272 — pure geometry of the placeholder block: door width on X, flush
  # front face with the profile depth inwards, anchored to the envelope's
  # grip boundary edge.
  def test_channel_box_math_top_front_at_max
    spec = { 'heightMm' => 27, 'depthMm' => 56, 'boundary' => 'top' }
    box = @bridge.design_opening_channel_box_mm(
      [0.0, 556.0, 40.0], [400.0, 574.0, 720.0], [0.0, 0.0, 0.0], [400.0, 590.0, 720.0], spec
    )
    assert_equal [0.0, 400.0], [box['min_mm'][0], box['max_mm'][0]]
    assert_equal [518.0, 574.0], [box['min_mm'][1], box['max_mm'][1]]
    assert_equal [693.0, 720.0], [box['min_mm'][2], box['max_mm'][2]]
  end

  def test_channel_box_math_bottom_front_at_min
    spec = { 'heightMm' => 27, 'depthMm' => 56, 'boundary' => 'bottom' }
    box = @bridge.design_opening_channel_box_mm(
      [0.0, 16.0, 0.0], [400.0, 34.0, 680.0], [0.0, 0.0, 0.0], [400.0, 590.0, 720.0], spec
    )
    assert_equal [16.0, 72.0], [box['min_mm'][1], box['max_mm'][1]]
    assert_equal [0.0, 27.0], [box['min_mm'][2], box['max_mm'][2]]
  end

  # The placeholder drawing is auxiliary: a root without a door actor skips
  # honestly and the converged answer carries the reason.
  def test_apply_reports_channel_skip_without_door
    working_item = Struct.new(:furniture_instance_id, :furniture_definition_id, :parameters,
                              :material_choices).new('fi-1272', 'mod-1272', {}, {})
    applied_state = { 'opening' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.8006' },
                      'resolution' => { 'state' => 'resolved',
                                        'fronts' => [{ 'widthMm' => 400, 'heightMm' => 680,
                                                       'grips' => [{ 'boundary' => 'top', 'consumedMm' => 40 }] }] },
                      'dimsKnown' => true,
                      'workingVersion' => '2026-10-11T12:00:00.000000Z' }
    service = FakeService.new(applied_state: applied_state,
                              working_copy: Struct.new(:items).new([working_item]),
                              profiles: [{ 'id' => 'profile.gola-l.8006', 'code' => 'GOLA-L-8006',
                                           'profile_height_mm' => 27, 'profile_depth_mm' => 56 }])
    @bridge.instance_variable_set(:@project_furniture_placer, FakePlacer.new(service))

    root = Object.new
    layout = Object.new
    definition = { 'furniture_definition_id' => 'mod-1272', 'name' => 'Gabinete Gola' }
    metadata = { root => {
      'identity' => { 'instanceRef' => 'inst-1272', 'furnitureInstanceId' => 'fi-1272' },
      'intent' => { 'furnitureDefinitionId' => 'mod-1272', 'parameters' => {}, 'materialChoices' => {} }
    } }
    provider = FakeConvergeCatalogProvider.new(definition, layout)
    coordinator = FakeConvergeCoordinator.new(
      Granete::SketchUpExtension::Host::MutationOutcome.new(outcome: 'committed'), apply: true
    )
    builder = FakeConvergeBuilder.new
    @bridge.instance_variable_set(:@catalog_provider, provider)
    @bridge.instance_variable_set(:@metadata_store_factory, ->(_model) { FakeMetadataStore.new(metadata) })
    @bridge.define_singleton_method(:mutation_coordinator) { coordinator }
    @bridge.define_singleton_method(:furniture_builder_for) { |_model| builder }
    binding_json = JSON.generate({ 'projectId' => PROJECT, 'designId' => DESIGN_A,
                                   'baseRevisionId' => nil, 'schemaVersion' => 1 })
    @bridge.define_singleton_method(:active_model) { FakeEntitiesModel.new([root], binding_json) }

    @bridge.handle_apply_design_opening(
      @dialog,
      JSON.generate({ 'requestId' => 53, 'designId' => DESIGN_A,
                      'selection' => { 'system' => 'gola', 'profileId' => 'profile.gola-l.8006' } })
    )

    answer = last_script_payload
    assert_equal({ 'status' => 'converged', 'units' => 1,
                   'channel' => { 'status' => 'skipped', 'reason' => 'sin puerta en el mueble' } },
                 answer['geometry'])
  end
end
