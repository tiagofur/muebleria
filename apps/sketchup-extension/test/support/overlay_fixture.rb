# frozen_string_literal: true

require 'json'
require_relative 'host_runtime'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

# Shared #470 / SU-VIS-1 overlay fixture: builds the canonical inspection
# world from the REAL golden resolve contract (scenario 17 — manual hinge on
# the left side + shelf relationship machining + DRILLING_CONFLICT) and a
# host model whose managed hierarchy/metadata mirror that resolve, so unit
# tests exercise overlays against authentic contract data — never a local
# re-derivation.
module OverlayFixture
  SCENARIO_ID = '17-hardware-drilling-conflict'
  FURNITURE_INSTANCE_ID = 'inst-overlay-1'
  DEFINITION_ID = '22222222-2222-2222-2222-222222222222'

  GOLDEN_PATH = File.expand_path('../../../../contracts/sketchupAuthoringResolve.contract.json',
                                 __dir__).freeze

  DEFINITION = {
    'furniture_definition_id' => DEFINITION_ID,
    'name' => 'Gabinete Authoring 600',
    'parameters' => [
      { 'name' => 'widthMm', 'defaultValue' => 600 },
      { 'name' => 'heightMm', 'defaultValue' => 720 },
      { 'name' => 'depthMm', 'defaultValue' => 560 },
      { 'name' => 'shelfCount', 'defaultValue' => 1 }
    ]
  }.freeze

  PARAMETERS = { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 }.freeze

  module_function

  def golden
    @golden ||= JSON.parse(File.read(GOLDEN_PATH))
  end

  def scenario_body
    scenario = golden['scenarios'].find { |entry| entry['id'] == SCENARIO_ID }
    raise "missing scenario #{SCENARIO_ID}" unless scenario

    JSON.parse(JSON.generate(scenario['response']))
  end

  # Correlation-rewritten response body parsed through the REAL contract.
  def accepted_result(message_id: 'msg-overlay-test', idempotency_key: 'idemp-overlay-test')
    body = scenario_body
    body['responseMessageId'] = "resolve-#{message_id}"
    body['inReplyToMessageId'] = message_id
    body['idempotencyKey'] = idempotency_key
    Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
      body, expected_request: { 'messageId' => message_id, 'idempotencyKey' => idempotency_key }
    )
  end

  def native_layout
    Granete::SketchUpExtension::Library::LayoutContract.parse!(
      JSON.parse(JSON.generate(scenario_body['resolved']['layout']))
    )
  end

  # Host model with the managed furniture rendered from the scenario layout
  # (native ComponentInstances + Granete metadata). Caller owns
  # SketchupStub.reset!.
  def build_model
    model = Sketchup.active_model
    store = Granete::SketchUpExtension::Metadata::Store.new(model)
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: store)
    result = builder.place_existing_furniture(
      model,
      furniture_instance_id: FURNITURE_INSTANCE_ID,
      definition: DEFINITION,
      parameters: PARAMETERS,
      resolved_layout: native_layout
    )
    raise "fixture placement failed: #{result['error']}" unless result['entity']

    model
  end

  def furniture_root(model)
    # rubocop:disable SketchupSuggestions/ModelEntities
    model.entities.find do |entity|
      entity.respond_to?(:definition) &&
        Granete::SketchUpExtension::Metadata::Store.new(model).read(entity)&.dig('identity', 'instanceRef') == FURNITURE_INSTANCE_ID
    end
    # rubocop:enable SketchupSuggestions/ModelEntities
  end

  # Catalog provider double for the InspectionResolver: serves the scenario
  # definition/layout and answers authoring resolves by parsing the golden
  # response with the correlation of the incoming request. Captures every
  # request for shape assertions.
  class FakeCatalogProvider
    attr_reader :requests, :resolved_layout_calls

    def initialize(extra_hardware: [])
      @requests = []
      @resolved_layout_calls = 0
      @extra_hardware = extra_hardware
    end

    def find_definition(definition_id)
      DEFINITION if definition_id == DEFINITION_ID
    end

    def resolved_native_layout(_definition_id, _parameters = {}, _choices = {})
      @resolved_layout_calls += 1
      layout = OverlayFixture.native_layout
      unless @extra_hardware.empty?
        layout.hardware.concat(@extra_hardware.map { |entry| build_placement(entry) })
      end
      layout
    end

    def catalog_revision
      'rev-overlay-test'
    end

    def resolve_authoring(request_payload)
      @requests << request_payload
      OverlayFixture.accepted_result(
        message_id: request_payload['messageId'],
        idempotency_key: request_payload['idempotencyKey']
      )
    end

    private

    def build_placement(entry)
      Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
        placement_id: entry['placementId'],
        placement_kind: entry['placementKind'],
        hardware_id: entry['hardwareId'],
        host_component_instance_id: entry['hostComponentInstanceId'],
        anchor_face: entry['anchorFace'],
        offset_mm: entry['offsetMm']
      )
    end
  end
end
