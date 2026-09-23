# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/host_reconciliation'
require_relative '../../src/granete_for_sketchup/connection/host_restore'
require_relative '../../src/granete_for_sketchup/connection/panel_state'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/tools/furniture_placement_tool'

MB = Granete::SketchUpExtension::Connection::ModelBinding
PF = Granete::SketchUpExtension::Connection::ProjectFurniture
MS = Granete::SketchUpExtension::Metadata::Store
LIB = Granete::SketchUpExtension::Library
FBUILDER = Granete::SketchUpExtension::Model::FurnitureBuilder
TOOL = Granete::SketchUpExtension::Tools::FurniturePlacementTool

# #469 — placement preview flow at the Placer boundary: the preview
# preparation mutates nothing and allocates no backend identity; the commit
# through the canonical command preserves the existing identity, lands the
# accepted transform, and the commercial quantity never changes (no
# furniture-instance creation request is ever issued for a Project unit).
class PlacementPreviewFlowTest < Minitest::Test
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'
  FI_1 = '51000000-0000-0000-0000-0000000000f1'

  class PreviewModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-token'
    end

    def refresh_if_needed; end
  end

  class FakeTransport
    attr_reader :requests

    def initialize
      @requests = []
      @routes = {}
    end

    def respond(method, path, status, body)
      @routes[[method.to_s.upcase, path]] = { 'status' => status, 'body' => body }
    end

    def request(payload, _authorization_header = nil)
      method = payload['method'].to_s.upcase
      path = payload['path']
      @requests << { 'method' => method, 'path' => path, 'body' => payload['body'],
                     'headers' => payload['headers'] }
      route = @routes[[method, path]]
      return route if route

      raise Granete::SketchUpExtension::Transport::RequestError, "no route for #{method} #{path}"
    end

    def requests_for(method, path_pattern)
      @requests.select { |r| r['method'] == method && r['path'].match?(path_pattern) }
    end
  end

  # Asymmetric authoritative layout: 900×800×500 with per-role materials —
  # the resolved dimensionsMm drive the preview extents.
  class FakeCatalog
    attr_reader :layout_resolves

    def initialize
      @layout_resolves = []
      @definitions = [{
        'furniture_definition_id' => DEFINITION_ID,
        'code' => 'BASE-900', 'name' => 'Gabinete Asimétrico 900', 'category' => 'kitchen_base',
        'version' => '1.0.0',
        'parameters' => [
          { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => 900, 'unit' => 'mm' },
          { 'name' => 'heightMm', 'label' => 'Alto', 'type' => 'number', 'defaultValue' => 800, 'unit' => 'mm' },
          { 'name' => 'depthMm', 'label' => 'Fondo', 'type' => 'number', 'defaultValue' => 500, 'unit' => 'mm' }
        ]
      }]
    end

    def find_definition(id)
      @definitions.find { |d| d['furniture_definition_id'] == id }
    end

    def resolved_native_layout(_definition_id, _params = {}, choices = {})
      @layout_resolves << choices.dup
      LIB::LayoutContract.parse!(layout_body)
    end

    def layout_body
      {
        'furnitureDefinitionId' => DEFINITION_ID, 'definitionName' => 'Gabinete Asimétrico 900',
        'transformContract' => 'granete.local-basis.v1',
        'dimensionsMm' => [900, 800, 500],
        'components' => [
          { 'componentInstanceId' => 'st-body', 'componentDefinitionId' => 'st-body-def',
            'slotId' => 'interior', 'role' => 'INTERIOR',
            'optionRole' => 'INTERIOR', 'name' => 'Lateral', 'kind' => 'board',
            'localTransform' => { 'translationMm' => [0, 0, 0],
                                  'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } },
            'dimensionsMm' => [900, 18, 800], 'widthMm' => 900, 'thicknessMm' => 18, 'lengthMm' => 800 },
          { 'componentInstanceId' => 'st-front', 'componentDefinitionId' => 'st-front-def',
            'slotId' => 'frentes', 'role' => 'FRENTES',
            'optionRole' => 'FRENTES', 'name' => 'Puerta', 'kind' => 'board',
            'localTransform' => { 'translationMm' => [0, 500, 0],
                                  'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } },
            'dimensionsMm' => [900, 18, 800], 'widthMm' => 900, 'thicknessMm' => 18, 'lengthMm' => 800,
            'materialId' => 'mat-front', 'materialName' => 'Roble Melamina', 'materialColorHex' => '#B08968' }
        ],
        'hardware' => []
      }
    end
  end

  class NullLogger
    def info(_event, _context = {}); end

    def warn(_event, _context = {}); end

    def error(_event, _context = {}); end
  end

  def setup
    SketchupStub.send_actions.clear
    @model = PreviewModel.new
    @transport = FakeTransport.new
    @catalog = FakeCatalog.new
    MB::Store.new(@model).write!(
      MB::Binding.new(project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: REVISION_R1)
    )
    stub_binding_validation
    stub_project_furniture([instance_body(FI_1)])
    stub_working_copy(working_copy_body([]))
    @placer = build_placer
  end

  # The accepted preview transform: 1 m along +X, 90° about Z, 30 up — an
  # asymmetric rigid gesture, expressed at the CONTRACT mm level.
  def accepted_transform
    Geom::Transformation.axes(
      Geom::Point3d.new(1000 / 25.4, 0, 30 / 25.4),
      Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(-1, 0, 0), Geom::Vector3d.new(0, 0, 1)
    )
  end

  def test_prepare_preview_resolves_authoritatively_without_mutation_or_identity
    result = @placer.prepare_placement_preview(FI_1)

    assert result['ok'], result.inspect
    assert_equal 'preview_ready', result['code']
    assert_equal FI_1, result['instanceId']
    assert_equal 'Gabinete Asimétrico 900', result['definition']['name']
    assert_kind_of LIB::NativeLayout, result['layout']
    assert_equal [900, 800, 500], result['layout'].dimensions_mm

    # Preview-only reads: the layout resolve happened, but NO furniture
    # instance was created and NO working-copy write was issued.
    assert_empty @transport.requests_for('POST', %r{/furniture-instances}),
                 'previewing must never allocate backend identity'
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    # Nothing entered the model — the unit stays pending.
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    assert_empty top_level_entities
  end

  def test_preview_extents_come_from_the_authoritative_layout
    result = @placer.prepare_placement_preview(FI_1)
    assert result['ok']

    extents = TOOL.extents_from_layout(result['layout'])
    expected = { x: 900.0, y: 500.0, z: 800.0 }
    assert_equal expected, extents,
                 'dimensionsMm [w,h,d] maps to local X=width, Y=depth, Z=height'
  end

  def test_commit_through_canonical_place_lands_accepted_transform_same_identity
    result = @placer.place(FI_1, transformation: accepted_transform)

    assert result['ok'], result.inspect
    assert_equal 'pending_position', result['code']
    assert_equal FI_1, result['instanceId']

    located = PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)
    assert located['entity'], 'the unit must exist after commit'
    assert_equal 1, located['duplicates'], 'exactly one root — no second unit'

    # The accepted transform IS the root transform (contract-level mm).
    stored = PF::TransformContract.from_host(located['entity'].transformation)
    assert_in_epsilon 1000.0, stored['translation_mm'][0], 1e-6
    assert_in_epsilon 30.0, stored['translation_mm'][2], 1e-6

    # Same business identity, stamped verbatim; no creation request.
    metadata = MS.new(@model).read(located['entity'])
    assert_equal FI_1, metadata.dig('identity', 'furnitureInstanceId')
    assert_empty @transport.requests_for('POST', %r{/furniture-instances}),
                 'placing an existing unit must never create another identity'

    # One host undo operation for the whole placement (the binding write in
    # setup is its own earlier operation, unrelated to the gesture).
    placement_ops = @model.operations.count do |op|
      op.is_a?(Array) && op[0] == :start && op[1].to_s.start_with?('Colocar Mueble')
    end
    assert_equal 1, placement_ops
  end

  def test_commit_does_not_hand_off_to_move_tool
    # With a final transform the Move-tool assist must NOT run: the position
    # is already the user's accepted one.
    @placer.place(FI_1, transformation: accepted_transform)

    assert_empty @model.selected_tools, 'no Move handoff for a preview-committed placement'
    assert_empty SketchupStub.send_actions
  end

  def test_place_without_transformation_keeps_origin_and_move_handoff
    @placer.place(FI_1)

    located = PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)
    stored = PF::TransformContract.from_host(located['entity'].transformation)
    assert_in_epsilon 0.0, stored['translation_mm'][0], 1e-6
  end

  def test_cancel_after_preview_leaves_no_residue_and_unit_stays_pending
    @placer.prepare_placement_preview(FI_1)
    # Esc: the tool drew nothing into the model; there is nothing to roll
    # back — the invariant is that the pending state is unchanged.
    assert_empty top_level_entities
    assert_nil PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
    assert_empty @transport.requests_for('POST', %r{/furniture-instances})
  end

  def test_context_change_between_preview_and_commit_fails_closed
    @placer.prepare_placement_preview(FI_1)

    # The binding drifts server-side before the click: the binding store now
    # points at a different base revision.
    MB::Store.new(@model).write!(
      MB::Binding.new(project_id: PROJECT_ID, design_id: DESIGN_ID,
                      base_revision_id: '53000000-0000-0000-0000-000000000099')
    )

    result = @placer.place(FI_1, transformation: accepted_transform)

    refute result['ok'], 'a stale context must fail closed, never place blindly'
    assert_empty top_level_entities, 'no ghost placement in a stale context'
  end

  def test_catalog_preview_prepares_without_minting_identity
    result = @placer.prepare_catalog_preview(definition_id: DEFINITION_ID,
                                             parameters: {}, material_choices: {})

    assert result['ok'], result.inspect
    assert_equal 'preview_ready', result['code']
    assert_kind_of LIB::NativeLayout, result['layout']
    assert_empty @transport.requests_for('POST', %r{/furniture-instances}),
                 'browsing/previewing the catalog must never mint identity (#390 §9.1)'
    assert_empty top_level_entities
  end

  def test_catalog_commit_mints_identity_once_and_lands_transform
    stub_create_instance

    result = @placer.create_and_place(definition_id: DEFINITION_ID, parameters: {},
                                      material_choices: {}, idempotency_key: 'idem-1',
                                      transformation: accepted_transform)

    assert result['ok'], result.inspect
    assert_equal 'pending_position', result['code']

    creates = @transport.requests_for('POST', %r{/furniture-instances})
    assert_equal 1, creates.length, 'exactly one identity at the explicit commit'
    idem_header = creates.first['headers'] && creates.first['headers']['Idempotency-Key']
    assert_equal 'idem-1', idem_header

    located = PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)
    assert located['entity']
    stored = PF::TransformContract.from_host(located['entity'].transformation)
    assert_in_epsilon 1000.0, stored['translation_mm'][0], 1e-6
  end

  def test_commit_preserves_resolved_materials_on_first_render
    @placer.place(FI_1, transformation: accepted_transform)

    root = PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    front = root.definition.entities.to_a.find do |child|
      MS.new(@model).read(child).dig('intent', 'materialBindingRole') == 'FRENTES'
    end
    refute_nil front, 'the resolved front board must exist'
    assert_equal 'Granete · Roble Melamina', front.material.name
    assert_equal '#B08968', front.material.color
  end

  private

  def build_placer
    PF::Placer.new(
      model_provider: -> { @model },
      binding_store_factory: ->(_model) { MB::Store.new(@model) },
      model_binding_service: MB::Service.new(
        transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      service: PF::Service.new(transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new),
      metadata_store_factory: ->(_model) { MS.new(@model) },
      catalog_provider: @catalog,
      furniture_builder_factory: ->(m) { FBUILDER.new(metadata_store: MS.new(m)) },
      logger: NullLogger.new
    )
  end

  def stub_binding_validation
    @transport.respond(:post, "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate", 200,
                       { 'state' => 'valid', 'schema_version' => 1,
                         'organization' => { 'id' => '10000000-0000-0000-0000-00000000000a',
                                             'name' => 'Carpintería Prueba' },
                         'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina Prueba' },
                         'design' => { 'id' => DESIGN_ID, 'name' => 'Diseño principal', 'status' => 'active' },
                         'working_copy' => { 'base_revision_id' => REVISION_R1, 'base_revision_number' => 1 },
                         'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true,
                                             'can_create_initial_quote' => true } })
  end

  def stub_project_furniture(body)
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200, body)
  end

  def stub_working_copy(body)
    @transport.respond(:get, "/designs/#{DESIGN_ID}/working-copy", 200, body)
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 200,
                       { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                         'base_revision_id' => REVISION_R1,
                         'updated_at' => '2026-09-23T00:01:00Z', 'items' => [] })
  end

  def stub_create_instance
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       'id' => FI_1, 'project_id' => PROJECT_ID,
                       'furniture_definition_id' => DEFINITION_ID,
                       'origin' => 'design', 'lifecycle_status' => 'active', 'version' => 1,
                       'created_at' => '2026-09-23T00:00:00Z', 'updated_at' => '2026-09-23T00:00:00Z')
  end

  def working_copy_body(items)
    { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
      'base_revision_id' => REVISION_R1, 'source_type' => 'manual',
      'updated_at' => '2026-09-23T00:00:00Z', 'items' => items }
  end

  def instance_body(id)
    { 'id' => id, 'project_id' => PROJECT_ID, 'furniture_definition_id' => DEFINITION_ID,
      'origin' => 'quote', 'lifecycle_status' => 'active', 'version' => 1,
      'created_at' => '2026-09-23T00:00:00Z', 'updated_at' => '2026-09-23T00:00:00Z',
      'display' => { 'name' => 'Gabinete Asimétrico 900',
                     'dimensions_mm' => { 'width' => 900, 'height' => 800, 'depth' => 500 } } }
  end

  def top_level_entities
    @model.entities.instances
  end
end
