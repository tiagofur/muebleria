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
require_relative '../../src/granete_for_sketchup/connection/panel_state'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

# Namespaced shorthands for readability.
MB = Granete::SketchUpExtension::Connection::ModelBinding
PF = Granete::SketchUpExtension::Connection::ProjectFurniture
MS = Granete::SketchUpExtension::Metadata::Store
FBUILDER = Granete::SketchUpExtension::Model::FurnitureBuilder

# #389 / DT-5 — Project Furniture panel + Place EXISTING FurnitureInstance.
# These tests pin the authority rules of the slice:
#   * identity: Place stamps the server furnitureInstanceId verbatim, never
#     mints/derives a new identity, and no business-object creation request
#     is ever issued (negative proof A);
#   * pending/placed derives per furnitureInstanceId from the working copy
#     (qty > 1 stays individually traceable — proofs B/C);
#   * already-placed focuses instead of duplicating (proof D);
#   * cross-project/cross-org units cannot be placed (proofs E/F);
#   * the working-copy update merges — other items survive (proof G);
#   * backend failure rolls the local insertion back — no false success
#     (proof H);
#   * identity survives a fresh store read, like save/reopen (proof I).
class ProjectFurnitureTest < Minitest::Test
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  PROJECT_B_ID = '41000000-0000-0000-0000-000000000002'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  REVISION_R2 = '53000000-0000-0000-0000-000000000002'
  DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'
  DEFINITION_ID_2 = '50000000-0000-0000-0000-0000000000d2'

  FI_1 = '51000000-0000-0000-0000-0000000000f1'
  FI_2 = '51000000-0000-0000-0000-0000000000f2'
  FI_3 = '51000000-0000-0000-0000-0000000000f3'
  FI_FOREIGN = '51000000-0000-0000-0000-0000000000ff'

  # Model with attribute dictionaries so the REAL binding store and metadata
  # store both work — proving persistence semantics, not stubbed ones.
  class PlacerModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  # Models an OPEN nested editing context: active_entities points at another
  # component's entities (where a naive insert would nest the furniture).
  class NestedEditModel < PlacerModel
    def initialize
      super
      @nested_entities = SketchupStub::EntitiesStub.new
    end

    def active_entities
      @nested_entities
    end
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

  # Router-style transport fake: exact [method, path] responses plus a full
  # request journal for the negative proofs.
  class FakeTransport
    attr_reader :requests

    def initialize
      @requests = []
      @routes = {}
    end

    def configure?
      true
    end

    def respond(method, path, status, body)
      @routes[[method.to_s.upcase, path]] = { 'status' => status, 'body' => body }
    end

    def request(payload, authorization_header: nil)
      _ = authorization_header
      method = payload['method'].to_s.upcase
      path = payload['path']
      @requests << { 'method' => method, 'path' => path, 'body' => payload['body'], 'headers' => payload['headers'] }
      route = @routes[[method, path]]
      return route if route

      raise Granete::SketchUpExtension::Transport::RequestError,
            "no route for #{method} #{path}"
    end

    def requests_for(method, path_pattern)
      @requests.select do |request|
        request['method'] == method && request['path'].match?(path_pattern)
      end
    end
  end

  class FakeCatalog
    attr_reader :definitions

    def initialize
      @definitions = [
        {
          'furniture_definition_id' => DEFINITION_ID,
          'code' => 'BASE-600', 'name' => 'Gabinete Base 600', 'category' => 'kitchen_base',
          'version' => '1.0.0',
          'parameters' => [
            { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => 600, 'unit' => 'mm' },
            { 'name' => 'heightMm', 'label' => 'Alto', 'type' => 'number', 'defaultValue' => 720, 'unit' => 'mm' },
            { 'name' => 'depthMm', 'label' => 'Fondo', 'type' => 'number', 'defaultValue' => 560, 'unit' => 'mm' },
            { 'name' => 'shelfCount', 'label' => 'Entrepaños', 'type' => 'number', 'defaultValue' => 1 }
          ]
        }
      ]
    end

    def all_definitions
      @definitions
    end

    def find_definition(definition_id)
      @definitions.find { |d| d['furniture_definition_id'] == definition_id }
    end

    def resolved_native_layout(_definition_id, _parameters = {}, _choices = {})
      nil # local development catalog: documented generic authoring path
    end
  end

  # Moves the placed root to a FINAL user-chosen transform before confirm:
  # 1 m along +X and 90° about Z (mm/deg at the contract level).
  def finalize_position!(_model, fi_id, translation_mm = [1000, 0, 0])
    root = PF::ManagedFurniture.locate(@model, MS.new(@model), fi_id)['entity']
    root.transformation = Geom::Transformation.axes(
      Geom::Point3d.new(translation_mm[0] / 25.4, translation_mm[1] / 25.4,
                        (translation_mm[2] || 0) / 25.4),
      Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(-1, 0, 0), Geom::Vector3d.new(0, 0, 1)
    )
    root
  end

  def setup
    @model = PlacerModel.new
    @transport = FakeTransport.new
    @catalog = FakeCatalog.new
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    stub_project_furniture(list_body)
    stub_working_copy(working_copy_body([]))

    @placer = build_placer
  end

  def test_place_existing_stamps_server_identity_and_never_creates_business_objects
    result = @placer.place(FI_1)

    assert result['ok'], "place failed: #{result.inspect}"
    # Honest intermediate: inserted, awaiting the user's final position.
    assert_equal 'pending_position', result['code']
    assert_equal FI_1, result['instanceId']
    # No working-copy write before the position is confirmed.
    assert_empty @transport.requests_for('PUT', %r{/working-copy}),
                 'the sync must wait for the final chosen transform'

    confirmed = @placer.confirm_placement(FI_1)
    assert confirmed['ok'], confirmed.inspect
    assert_equal 'placed', confirmed['code']

    # Negative proof A: the only backend calls are reads + the working-copy
    # PUT. No POST to furniture-instances ever happens.
    assert_empty @transport.requests_for('POST', %r{/furniture-instances}),
                 'place existing must never issue furniture-instance creation'
    assert_equal 1, @transport.requests_for('PUT', %r{/working-copy}).length

    # Local identity is the server identity, verbatim — no local `inst-` ref.
    placed = top_level_furniture(@model).first
    metadata = MS.new(@model).read(placed)
    assert_equal FI_1, metadata.dig('identity', 'furnitureInstanceId')
    assert_equal FI_1, metadata.dig('identity', 'instanceRef'),
                 'instanceRef must alias the server identity, not a second id'
    assert_equal PROJECT_ID, metadata.dig('identity', 'projectId')
    assert_equal DESIGN_ID, metadata.dig('identity', 'designId')
    assert_equal DEFINITION_ID, metadata.dig('intent', 'furnitureDefinitionId')
  end

  def test_confirm_writes_working_item_with_final_transform
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200,
                       [instance_body(FI_1, 'quote', display_dims: [650, 720, 560])])
    stub_working_copy(working_copy_body([]))

    result = @placer.place(FI_1)
    assert result['ok'], result.inspect

    # The user FINALIZES the position: 1 m along +X, 90° about Z.
    finalize_position!(@model, FI_1, [1000, 0, 0])
    confirmed = @placer.confirm_placement(FI_1)
    assert confirmed['ok'], confirmed.inspect
    assert_equal 'placed', confirmed['code']

    put = @transport.requests_for('PUT', %r{/working-copy}).first
    item = put['body']['items'].first
    assert_equal FI_1, item['furniture_instance_id']
    assert_equal DEFINITION_ID, item['furniture_definition_id']
    # Quoted dimensions (server display) drove the rendered parameters, and
    # the working item carries exactly that persisted intent.
    assert_equal({ 'widthMm' => 650, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 },
                 item['parameters'])
    # The FINAL chosen transform reaches the working copy (mm/deg canonical).
    assert_equal 1000.0, item['transform']['translation_mm'][0]
    assert_in_delta 0.0, item['transform']['translation_mm'][1], 0.001
    assert_in_delta 90.0, item['transform']['rotation_deg'][2], 0.001
    # Technical locator is separate from business identity.
    locator = item['technical_client_locator']
    assert_equal 'sketchup_persistent_id', locator['kind']
    refute_equal FI_1, locator['value']
  end

  def test_place_preserves_other_working_items
    # Proof G: working copy already holds FI-2; placing FI-1 must not drop it.
    stub_working_copy(working_copy_body([
                                          { 'furniture_instance_id' => FI_2,
                                            'furniture_definition_id' => DEFINITION_ID,
                                            'parameters' => { 'widthMm' => 600 },
                                            'material_choices' => {},
                                            'transform' => { 'translation_mm' => [100.0, 0.0, 0.0],
                                                             'rotation_deg' => [0.0, 0.0, 0.0] } }
                                        ]))
    result = @placer.place(FI_1)
    assert result['ok'], result.inspect
    confirmed = @placer.confirm_placement(FI_1)
    assert confirmed['ok'], confirmed.inspect

    put = @transport.requests_for('PUT', %r{/working-copy}).first
    ids = put['body']['items'].map { |item| item['furniture_instance_id'] }
    assert_equal [FI_2, FI_1].sort, ids.sort, 'other working items must survive the merge'
  end

  def test_already_placed_focuses_existing_without_duplicates
    @placer.place(FI_1)
    assert @placer.confirm_placement(FI_1)['ok']

    # The server now holds the confirmed item (GET is the truth).
    stub_working_copy(working_copy_body([
                                          { 'furniture_instance_id' => FI_1,
                                            'parameters' => {}, 'material_choices' => {} }
                                        ]))
    roots_before = top_level_furniture(@model).length
    puts_before = @transport.requests_for('PUT', %r{/working-copy}).length
    result = @placer.place(FI_1)

    # Proof D: no duplicate root, no duplicate working item, honest success.
    assert result['ok'], result.inspect
    assert_equal 'already_placed', result['code']
    assert_equal roots_before, top_level_furniture(@model).length
    assert_equal puts_before, @transport.requests_for('PUT', %r{/working-copy}).length,
                 'second place must not rewrite the working copy again'
  end

  def test_identity_is_by_id_not_by_definition_or_dimensions
    # Proof B: three IDENTICAL units (same definition, same dims) stay three
    # distinct identities; placing FI-1 stamps only FI-1.
    result = @placer.place(FI_1)
    assert result['ok'], result.inspect

    placed = top_level_furniture(@model)
    assert_equal 1, placed.length
    metadata = MS.new(@model).read(placed.first)
    assert_equal FI_1, metadata.dig('identity', 'furnitureInstanceId')
    refute_equal FI_2, metadata.dig('identity', 'furnitureInstanceId')
  end

  def test_cross_project_unit_cannot_be_placed
    # Proof E: the authoritative list of project A does not contain a unit of
    # project B — placing it fails and nothing is inserted locally.
    result = @placer.place(FI_FOREIGN)

    refute result['ok']
    assert_equal 'not_found', result['code']
    assert_empty top_level_furniture(@model)
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_cross_project_payload_is_never_trusted_from_the_client
    # A foreign unit id is absent from the server list even when a local
    # payload tries to reference it directly: identity scope is server-side.
    foreign = @placer.place(FI_FOREIGN)
    refute foreign['ok']

    own = @placer.place(FI_1)
    assert own['ok']
    assert_equal FI_1, MS.new(@model).read(top_level_furniture(@model).first)
                         .dig('identity', 'furnitureInstanceId')
  end

  def test_cross_org_denial_fails_loud_without_local_insertion
    # Proof F: a 403 from the server (foreign org) must not place anything.
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 403,
                       { 'error' => { 'code' => 'forbidden', 'message' => 'sin permiso' } })

    result = @placer.place(FI_1)

    refute result['ok']
    assert_empty top_level_furniture(@model)
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_backend_failure_at_confirm_rolls_back_local_placement
    # Proof H: the working-copy PUT fails at confirm → the placed component
    # is erased and the failure is loud (no false local success).
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 409,
                       { 'error' => { 'code' => 'conflict', 'message' => 'El diseño no está activo' } })

    assert @placer.place(FI_1)['ok'], 'place itself does not touch the working copy'
    finalize_position!(@model, FI_1)
    result = @placer.confirm_placement(FI_1)

    refute result['ok']
    assert_equal 'sync_failed', result['code']
    assert_empty top_level_furniture(@model), 'failed sync must roll the local placement back'
    # The rollback purges the scoped generated part definitions (ADR-0004
    # purge scope); business identity never derived from them anyway.
    assert_empty(@model.definitions.select { |d| d.name.start_with?('Granete · Parte ·') })
  end

  def test_stale_base_fails_loud_without_any_write
    # §15: binding base R1 vs authoritative R2 → stale_base, nothing written
    # locally or remotely.
    stub_binding_validation(base: REVISION_R2)

    result = @placer.place(FI_1)

    refute result['ok']
    assert_equal 'stale_base', result['code']
    assert_empty top_level_furniture(@model)
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_unbound_model_cannot_place
    placer = build_placer(model: PlacerModel.new) # fresh model without binding

    result = placer.place(FI_1)

    refute result['ok']
    assert_equal 'unbound', result['code']
    assert_empty @transport.requests
  end

  def test_terminal_unit_cannot_be_placed
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200,
                       [instance_body(FI_1, 'quote', lifecycle: 'removed')])

    result = @placer.place(FI_1)

    refute result['ok']
    assert_equal 'terminal', result['code']
    assert_empty top_level_furniture(@model)
  end

  def test_cancel_reverts_local_insertion_without_working_copy_write
    assert @placer.place(FI_1)['ok']
    finalize_position!(@model, FI_1)

    result = @placer.cancel_placement(FI_1)

    assert result['ok'], result.inspect
    assert_equal 'cancelled', result['code']
    assert_empty top_level_furniture(@model), 'cancel must revert the local insertion'
    assert_empty @transport.requests_for('PUT', %r{/working-copy}),
                 'cancel must never write the working copy'
    # Cancel is idempotent when nothing remains.
    assert @placer.cancel_placement(FI_1)['ok']
  end

  def test_retry_place_while_pending_resumes_confirmation_without_duplicates
    assert @placer.place(FI_1)['ok']
    finalize_position!(@model, FI_1)

    result = @placer.place(FI_1)

    # Honest resume: the local root exists but was never synced — no second
    # root, no PUT, the user just confirms.
    assert result['ok'], result.inspect
    assert_equal 'pending_confirmation', result['code']
    assert_equal 1, top_level_furniture(@model).length

    assert @placer.confirm_placement(FI_1)['ok']
    put = @transport.requests_for('PUT', %r{/working-copy}).first
    ids = put['body']['items'].map { |item| item['furniture_instance_id'] }
    assert_equal [FI_1], ids, 'a retried placement syncs exactly one item'
  end

  def test_confirm_preserves_existing_authoritative_authoring_state
    # Gap 3 proof: the working copy ALREADY holds FI-001 with authoritative
    # authoring state; a fresh local placement (e.g. after reopen) may only
    # replace transform + technical locator.
    assert @placer.place(FI_1)['ok']
    stub_working_copy(working_copy_body([
                                          { 'furniture_instance_id' => FI_1,
                                            'furniture_definition_id' => DEFINITION_ID,
                                            'definition_version' => 7,
                                            'parameters' => { 'widthMm' => 888, 'shelfCount' => 2 },
                                            'material_choices' => { 'BODY' => 'mat-1', 'FRONT' => 'mat-2' },
                                            'transform' => { 'translation_mm' => [1.0, 2.0, 3.0],
                                                             'rotation_deg' => [0.0, 0.0, 0.0] },
                                            'room_id' => '60000000-0000-0000-0000-0000000000r1',
                                            'technical_client_locator' => { 'kind' => 'sketchup_persistent_id',
                                                                            'value' => 'old-locator' } }
                                        ]))
    finalize_position!(@model, FI_1, [1000, 0, 0])

    result = @placer.confirm_placement(FI_1)
    assert result['ok'], result.inspect

    put = @transport.requests_for('PUT', %r{/working-copy}).first
    items = put['body']['items']
    assert_equal 1, items.length, 'merge must not duplicate the working item'
    item = items.first
    # Authoritative authoring state preserved verbatim.
    assert_equal 7, item['definition_version']
    assert_equal({ 'widthMm' => 888, 'shelfCount' => 2 }, item['parameters'])
    assert_equal({ 'BODY' => 'mat-1', 'FRONT' => 'mat-2' }, item['material_choices'])
    assert_equal '60000000-0000-0000-0000-0000000000r1', item['room_id']
    # Placement-owned fields updated to the FINAL host values.
    assert_equal 1000.0, item['transform']['translation_mm'][0]
    refute_equal 'old-locator', item['technical_client_locator']['value']
  end

  def test_confirm_stamps_definition_version_for_new_working_copy_item
    # Gap 1 proof: FurnitureDefinition version = 7 -> Place existing FI -> Confirm
    # WorkingCopy item has furniture_definition_id = expected and definition_version = 7.
    @catalog.definitions.first['definition_version'] = 7
    stub_working_copy(working_copy_body([]))

    assert @placer.place(FI_1)['ok']
    result = @placer.confirm_placement(FI_1)
    assert result['ok'], result.inspect

    put = @transport.requests_for('PUT', %r{/working-copy}).first
    items = put['body']['items']
    assert_equal 1, items.length
    item = items.first
    assert_equal DEFINITION_ID, item['furniture_definition_id']
    assert_equal 7, item['definition_version']
  end

  def test_confirm_revalidates_terminal_instance_and_rolls_back_without_write
    # Gap 2 negative proof: unit becomes terminal before confirm -> FAIL LOUD,
    # roll back local placement, NO WorkingCopy write.
    assert @placer.place(FI_1)['ok']
    assert_equal 1, top_level_furniture(@model).length

    # Simulate FI-001 cancelled / deleted on the server before confirm.
    stub_project_furniture([instance_body(FI_1, 'quote', lifecycle: 'cancelled')])

    result = @placer.confirm_placement(FI_1)
    refute result['ok']
    assert_equal 'terminal', result['code']
    assert_empty top_level_furniture(@model), 'unconfirmed local placement must be rolled back'
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_confirm_revalidates_missing_instance_and_rolls_back_without_write
    # Gap 2 negative proof: unit removed from project entirely before confirm.
    assert @placer.place(FI_1)['ok']
    assert_equal 1, top_level_furniture(@model).length

    # Simulate FI-001 removed from server project instances before confirm.
    stub_project_furniture([])

    result = @placer.confirm_placement(FI_1)
    refute result['ok']
    assert_equal 'not_found', result['code']
    assert_empty top_level_furniture(@model), 'unconfirmed local placement must be rolled back'
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_confirm_without_local_root_fails_without_write
    result = @placer.confirm_placement(FI_1)

    refute result['ok']
    assert_equal 'not_placed', result['code']
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_stale_base_blocks_confirm_too
    assert @placer.place(FI_1)['ok']
    stub_binding_validation(base: REVISION_R2)

    result = @placer.confirm_placement(FI_1)

    refute result['ok']
    assert_equal 'stale_base', result['code']
    # Pre-PUT guard: nothing synced; the positioned root is KEPT so the user
    # can remediate the base and confirm again.
    assert_equal 1, top_level_furniture(@model).length
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_duplicate_local_roots_block_confirmation
    first = FBUILDER.new(metadata_store: MS.new(@model))
                    .place_existing_furniture(
                      @model, furniture_instance_id: FI_1,
                              definition: @catalog.find_definition(DEFINITION_ID),
                              parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
                    )
    assert first['success'], first.inspect
    duplicate = first['entity']
    @model.entities.add_instance(duplicate.definition, Geom::Transformation.new)
    MS.new(@model).write(@model.entities.instances.last, MS.new(@model).read(duplicate))

    assert_equal 'duplicate_detected', @placer.confirm_placement(FI_1)['code']
    assert_equal 'duplicate_detected', @placer.cancel_placement(FI_1)['code']
    assert_empty @transport.requests_for('PUT', %r{/working-copy})
  end

  def test_nested_editing_context_cannot_create_an_untraceable_root
    # Gap 2 proof: the user is INSIDE another component's editing context;
    # the FurnitureInstance root must still land TOP-LEVEL.
    nested_model = NestedEditModel.new
    write_binding(nested_model)
    placer = build_placer(model: nested_model)

    result = placer.place(FI_1)

    assert result['ok'], result.inspect
    assert_equal 'pending_position', result['code']
    roots = PF::ManagedFurniture.locate(nested_model, MS.new(nested_model), FI_1)
    assert roots['entity'], 'ManagedFurniture must find the root after nested-context placement'
    assert_equal 1, roots['duplicates']
    assert_includes nested_model.entities.instances, roots['entity'],
                    'the root must live in the model root entities'
    refute nested_model.active_entities.instances.include?(roots['entity']),
           'the root must NOT be nested inside the open editing context'

    # Retry resumes; confirm completes with the final transform.
    assert_equal 'pending_confirmation', placer.place(FI_1)['code']
    root = PF::ManagedFurniture.locate(nested_model, MS.new(nested_model), FI_1)['entity']
    root.transformation = Geom::Transformation.translation(Geom::Vector3d.new(500.0 / 25.4, 0, 0))
    assert placer.confirm_placement(FI_1)['ok']
    put = @transport.requests_for('PUT', %r{/working-copy}).first
    assert_equal 500.0, put['body']['items'].first['transform']['translation_mm'][0]
  end

  def test_duplicate_local_roots_block_placement_instead_of_minting_identity
    # §20: two roots sharing one furnitureInstanceId is #391's invalid steady
    # state — never place a third copy, never create a new identity.
    first = FBUILDER.new(metadata_store: MS.new(@model))
                    .place_existing_furniture(
                      @model, furniture_instance_id: FI_1,
                              definition: @catalog.find_definition(DEFINITION_ID),
                              parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
                    )
    assert first['success'], first.inspect
    duplicate = first['entity']
    @model.active_entities.add_instance(duplicate.definition, Geom::Transformation.new)
    # The copied root still carries FI_1's identity (copy/paste behavior).
    MS.new(@model).write(@model.active_entities.instances.last,
                         MS.new(@model).read(duplicate))

    result = @placer.place(FI_1)

    refute result['ok']
    assert_equal 'duplicate_detected', result['code']
  end

  def test_identity_survives_fresh_store_read_like_reopen
    # Proof I: a NEW store instance over the same model (what save/close/
    # reopen produces) still resolves the unit identity.
    @placer.place(FI_1)

    reopened_store = MS.new(@model)
    located = PF::ManagedFurniture.locate(@model, reopened_store, FI_1)
    assert located['entity'], 'placed unit must be locatable after reopen'
    assert_equal 1, located['duplicates']
  end

  def test_panel_derives_pending_placed_per_unit
    # Proof C: qty = 3 renders three individually traceable rows.
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200,
                       [instance_body(FI_1, 'quote'), instance_body(FI_2, 'quote'),
                        instance_body(FI_3, 'quote', display_name: 'Torre horno',
                                                     definition_id: DEFINITION_ID_2)])
    stub_working_copy(working_copy_body([
                                          { 'furniture_instance_id' => FI_3,
                                            'parameters' => {}, 'material_choices' => {} }
                                        ]))

    panel = @placer.panel

    assert_equal 'connected', panel['state']
    assert_equal 3, panel['items'].length
    assert_equal 2, panel['pending']
    assert_equal 1, panel['placed']

    by_id = panel['items'].to_h { |row| [row['id'], row] }
    assert by_id[FI_1]['unitIndex'] == 1 && by_id[FI_1]['unitTotal'] == 2
    assert by_id[FI_2]['unitIndex'] == 2 && by_id[FI_2]['unitTotal'] == 2
    assert by_id[FI_3]['placed']
    assert_equal 'Gabinete Base 600', by_id[FI_1]['name']
    assert_equal 'Torre horno', by_id[FI_3]['name']
  end

  def test_panel_distinct_error_states
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 401,
                       { 'error' => { 'code' => 'unauthorized' } })
    assert_equal 'unauthenticated', @placer.panel['state']

    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 403,
                       { 'error' => { 'code' => 'forbidden' } })
    assert_equal 'unauthorized', @placer.panel['state']

    unbound_placer = build_placer(model: PlacerModel.new)
    assert_equal 'unbound', unbound_placer.panel['state']
  end

  def test_contract_parsers_fail_closed
    assert_raises(PF::Contract::ContractError) do
      PF::Contract.parse_instances!([{ 'id' => 'not-a-uuid' }])
    end
    assert_raises(PF::Contract::ContractError) do
      PF::Contract.parse_instances!([{ 'id' => FI_1, 'lifecycle_status' => 'weird',
                                       'origin' => 'quote', 'project_id' => PROJECT_ID }])
    end
    assert_raises(PF::Contract::ContractError) do
      PF::Contract::WorkingCopyContract.parse_working_copy!({ 'items' => 'nope' })
    end
    assert_raises(PF::Contract::ContractError) do
      PF::Contract::WorkingCopyContract.parse_working_copy!(
        { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
          'items' => [{ 'furniture_instance_id' => 'bad' }] }
      )
    end
  end

  def test_transform_contract_conversions
    identity = PF::TransformContract.from_host(Geom::Transformation.new)
    assert_equal({ 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] }, identity)

    # mm ⇄ inches roundtrip: 1 m on X.
    translated = Geom::Transformation.translation(Geom::Vector3d.new(1000 / 25.4, 0, 0))
    contract = PF::TransformContract.from_host(translated)
    assert_in_delta 1000.0, contract['translation_mm'][0], 0.001

    rebuilt = PF::TransformContract.to_host(contract)
    assert_in_delta (1000 / 25.4), rebuilt.origin.x, 1e-6

    # 90° about Z: X axis → world Y.
    ninety = Geom::Transformation.axes(
      Geom::Point3d.new(0, 0, 0),
      Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(-1, 0, 0), Geom::Vector3d.new(0, 0, 1)
    )
    rotated = PF::TransformContract.from_host(ninety)
    assert_in_delta 90.0, rotated['rotation_deg'][2], 1e-3
    assert_in_delta 0.0, rotated['rotation_deg'][0], 1e-3

    roundtrip = PF::TransformContract.to_host(rotated)
    assert_in_delta 0.0, roundtrip.xaxis.x, 1e-6
    assert_in_delta 1.0, roundtrip.xaxis.y, 1e-6
  end

  # #390 / DT-6 tests: design-first flow from catalog creating backend FurnitureInstance first.
  def test_service_create_furniture_instance_posts_with_idempotency_key_and_returns_instance
    service = PF::Service.new(transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       instance_body(FI_1, 'design'))

    instance = service.create_furniture_instance(
      PROJECT_ID,
      definition_id: DEFINITION_ID,
      idempotency_key: 'idem-key-42'
    )

    assert_equal FI_1, instance.id
    assert_equal 'design', instance.origin
    post_req = @transport.requests.find do |r|
      r['method'] == 'POST' && r['path'] == "/projects/#{PROJECT_ID}/furniture-instances"
    end
    refute_nil post_req
    assert_equal({ 'furniture_definition_id' => DEFINITION_ID }, post_req['body'])
    assert_equal 'idem-key-42', post_req['headers']['Idempotency-Key']
  end

  def test_create_and_place_flow_creates_backend_instance_first_and_places_top_level
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       instance_body(FI_1, 'design'))

    result = @placer.create_and_place(
      definition_id: DEFINITION_ID,
      parameters: { 'widthMm' => 800, 'shelfCount' => 2 },
      material_choices: { 'carcase' => 'mat-white' },
      idempotency_key: 'idem-create-1'
    )

    assert result['ok'], "expected ok, got #{result}"
    assert_equal 'pending_position', result['code']
    assert_equal FI_1, result['instanceId']

    # Server instance was created via POST with idempotency key
    post_req = @transport.requests.find do |r|
      r['method'] == 'POST' && r['path'] == "/projects/#{PROJECT_ID}/furniture-instances"
    end
    refute_nil post_req
    assert_equal 'idem-create-1', post_req['headers']['Idempotency-Key']

    # Local placement stamped THAT SAME backend ID
    furniture = top_level_furniture(@model)
    assert_equal 1, furniture.length
    root = furniture.first
    metadata = MS.new(@model).read(root)
    assert_equal FI_1, metadata['identity']['furnitureInstanceId']
    assert_equal 800, metadata['intent']['parameters']['widthMm']
    assert_equal 2, metadata['intent']['parameters']['shelfCount']
    assert_equal({ 'carcase' => 'mat-white' }, metadata['intent']['materialChoices'])
  end

  def test_create_and_place_backend_failure_aborts_loudly_without_local_entity
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 400,
                       { 'error' => { 'message' => 'catálogo inválido' } })

    result = @placer.create_and_place(
      definition_id: DEFINITION_ID,
      parameters: {},
      idempotency_key: 'idem-fail'
    )

    refute result['ok']
    assert_equal 'service_error', result['code']
    assert_includes result['reason'], 'catálogo inválido'
    assert_empty top_level_furniture(@model)
  end

  def test_create_and_place_local_failure_keeps_backend_id_in_project_and_fails_loud
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       instance_body(FI_1, 'design'))

    failing_builder = Object.new
    def failing_builder.place_existing_furniture(*_args, **_kwargs)
      { 'success' => false, 'error' => 'simulated local mesh error' }
    end

    placer = PF::Placer.new(
      model_provider: -> { @model },
      binding_store_factory: -> { MB::Store.new(@model) },
      model_binding_service: MB::Service.new(
        transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      service: PF::Service.new(
        transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      metadata_store_factory: ->(_m) { MS.new(@model) },
      catalog_provider: @catalog,
      furniture_builder_factory: ->(_m) { failing_builder },
      logger: NullLogger.new
    )

    result = placer.create_and_place(
      definition_id: DEFINITION_ID,
      idempotency_key: 'idem-local-fail'
    )

    refute result['ok']
    assert_equal 'created_pending', result['code']
    assert_equal FI_1, result['instanceId']
    assert_includes result['reason'], 'simulated local mesh error'
    # Critical invariant: NO DELETE or rollback request sent to backend
    delete_reqs = @transport.requests.select { |r| r['method'] == 'DELETE' }
    assert_empty delete_reqs
  end

  def test_cancel_placement_after_create_cleans_local_root_and_keeps_instance_in_project
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       instance_body(FI_1, 'design'))

    result = @placer.create_and_place(
      definition_id: DEFINITION_ID,
      idempotency_key: 'idem-cancel-1'
    )
    assert result['ok']
    assert_equal 1, top_level_furniture(@model).length

    cancel_res = @placer.cancel_placement(FI_1)
    assert cancel_res['ok']
    assert_equal 'cancelled', cancel_res['code']
    assert_empty top_level_furniture(@model)

    # Invariant: backend instance remains untouched (no DELETE)
    delete_reqs = @transport.requests.select { |r| r['method'] == 'DELETE' }
    assert_empty delete_reqs
  end

  def test_confirm_placement_after_create_merges_working_copy_with_parameters_and_materials
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       instance_body(FI_1, 'design'))
    stub_project_furniture([instance_body(FI_1, 'design')])
    stub_working_copy(working_copy_body([]))

    create_res = @placer.create_and_place(
      definition_id: DEFINITION_ID,
      parameters: { 'widthMm' => 900, 'shelfCount' => 3 },
      material_choices: { 'doors' => 'mat-oak' },
      idempotency_key: 'idem-confirm-1'
    )
    assert create_res['ok']

    confirm_res = @placer.confirm_placement(FI_1)
    assert confirm_res['ok']
    assert_equal 'placed', confirm_res['code']

    put_req = @transport.requests.find { |r| r['method'] == 'PUT' && r['path'] == "/designs/#{DESIGN_ID}/working-copy" }
    refute_nil put_req
    items = put_req['body']['items']
    assert_equal 1, items.length
    item = items.first
    assert_equal FI_1, item['furniture_instance_id']
    assert_equal 900, item['parameters']['widthMm']
    assert_equal 3, item['parameters']['shelfCount']
    assert_equal({ 'doors' => 'mat-oak' }, item['material_choices'])
  end

  def test_create_and_place_retry_uses_same_key_and_returns_same_instance
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       instance_body(FI_1, 'design'))

    res1 = @placer.create_and_place(
      definition_id: DEFINITION_ID,
      idempotency_key: 'idem-stable-key-1'
    )
    assert res1['ok']
    assert_equal FI_1, res1['instanceId']

    post_reqs = @transport.requests.select do |r|
      r['method'] == 'POST' && r['path'] == "/projects/#{PROJECT_ID}/furniture-instances"
    end
    assert_equal 1, post_reqs.length
    assert_equal 'idem-stable-key-1', post_reqs.first['headers']['Idempotency-Key']

    # Retry of the same logical intent with the same key
    res2 = @placer.create_and_place(
      definition_id: DEFINITION_ID,
      idempotency_key: 'idem-stable-key-1'
    )
    assert res2['ok']
    assert_equal FI_1, res2['instanceId']
    assert_equal 1, top_level_furniture(@model).length
  end

  def test_create_and_place_local_failure_returns_created_pending_without_deleting_identity
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       instance_body(FI_1, 'design'))

    failing_builder = Object.new
    def failing_builder.place_existing_furniture(*_args, **_kwargs)
      { 'success' => false, 'error' => 'simulated mesh generation error' }
    end

    placer = PF::Placer.new(
      model_provider: -> { @model },
      binding_store_factory: -> { MB::Store.new(@model) },
      model_binding_service: MB::Service.new(
        transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      service: PF::Service.new(
        transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      metadata_store_factory: ->(_m) { MS.new(@model) },
      catalog_provider: @catalog,
      furniture_builder_factory: ->(_m) { failing_builder },
      logger: NullLogger.new
    )

    result = placer.create_and_place(
      definition_id: DEFINITION_ID,
      parameters: { 'widthMm' => 650 },
      material_choices: { 'carcase' => 'Oak' },
      idempotency_key: 'idem-fail-1'
    )

    refute result['ok']
    assert_equal 'created_pending', result['code']
    assert_equal FI_1, result['instanceId']
    assert_includes result['reason'], 'falló su inserción local'
    assert_empty top_level_furniture(@model)
    assert_empty @transport.requests_for('DELETE', %r{/furniture-instances})
  end

  def test_recovery_placement_reuses_selected_parameters_and_materials
    write_binding(@model)
    stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/furniture-instances", 201,
                       instance_body(FI_1, 'design'))
    stub_project_furniture([instance_body(FI_1, 'design')])
    stub_working_copy(working_copy_body([]))

    call_count = 0
    builder = FBUILDER.new(metadata_store: MS.new(@model))
    flaky_builder = Object.new
    flaky_builder.define_singleton_method(:place_existing_furniture) do |model, **kwargs|
      call_count += 1
      if call_count == 1
        { 'success' => false, 'error' => 'first attempt failed' }
      else
        builder.place_existing_furniture(model, **kwargs)
      end
    end

    placer = PF::Placer.new(
      model_provider: -> { @model },
      binding_store_factory: -> { MB::Store.new(@model) },
      model_binding_service: MB::Service.new(
        transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      service: PF::Service.new(
        transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      metadata_store_factory: ->(_m) { MS.new(@model) },
      catalog_provider: @catalog,
      furniture_builder_factory: ->(_m) { flaky_builder },
      logger: NullLogger.new
    )

    res1 = placer.create_and_place(
      definition_id: DEFINITION_ID,
      parameters: { 'widthMm' => 650, 'shelfCount' => 3 },
      material_choices: { 'carcase' => 'Oak' },
      idempotency_key: 'idem-rec-1'
    )
    refute res1['ok']
    assert_equal 'created_pending', res1['code']

    res2 = placer.place(FI_1)
    assert res2['ok']
    assert_equal 'pending_position', res2['code']

    entity = top_level_furniture(@model).first
    metadata = MS.new(@model).read(entity)
    assert_equal 650, metadata['intent']['parameters']['widthMm'], 'width must be 650, not default'
    assert_equal 3, metadata['intent']['parameters']['shelfCount']
    assert_equal({ 'carcase' => 'Oak' }, metadata['intent']['materialChoices'])

    confirm_res = placer.confirm_placement(FI_1)
    assert confirm_res['ok']

    put_req = @transport.requests_for('PUT', %r{/working-copy}).first
    refute_nil put_req
    item = put_req['body']['items'].first
    assert_equal FI_1, item['furniture_instance_id']
    assert_equal 650, item['parameters']['widthMm']
    assert_equal 3, item['parameters']['shelfCount']
    assert_equal({ 'carcase' => 'Oak' }, item['material_choices'])
    assert_nil placer.intent_store.fetch(FI_1)
  end

  private

  def build_placer(model: @model, transport: @transport)
    PF::Placer.new(
      model_provider: -> { model },
      binding_store_factory: -> { MB::Store.new(model) },
      model_binding_service: MB::Service.new(
        transport: transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      service: PF::Service.new(
        transport: transport, auth_provider: FakeAuth.new, logger: NullLogger.new
      ),
      metadata_store_factory: ->(_m) { MS.new(model) },
      catalog_provider: @catalog,
      furniture_builder_factory: lambda { |m|
        FBUILDER.new(metadata_store: MS.new(m))
      },
      logger: NullLogger.new
    )
  end

  def write_binding(model, base: REVISION_R1)
    MB::Store.new(model).write!(
      MB::Binding.new(
        project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: base
      )
    )
  end

  def stub_binding_validation(base:)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate", 200,
                       {
                         'state' => 'valid',
                         'schema_version' => 1,
                         'organization' => { 'id' => '10000000-0000-0000-0000-00000000000a',
                                             'name' => 'Carpintería García' },
                         'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina García' },
                         'design' => { 'id' => DESIGN_ID, 'name' => 'Cocina principal', 'status' => 'active' },
                         'working_copy' => { 'base_revision_id' => base, 'base_revision_number' => 1 },
                         'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
                       })
  end

  def stub_project_furniture(body)
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200, body)
  end

  def stub_working_copy(body)
    @transport.respond(:get, "/designs/#{DESIGN_ID}/working-copy", 200, body)
    @transport.respond(:put, "/designs/#{DESIGN_ID}/working-copy", 200,
                       { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                         'base_revision_id' => REVISION_R1, 'items' => [] })
  end

  def working_copy_body(items)
    { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
      'base_revision_id' => REVISION_R1, 'source_type' => 'manual',
      'updated_at' => '2026-09-03T00:00:00Z', 'items' => items }
  end

  def instance_body(id, origin, lifecycle: 'active', display_name: nil, display_dims: nil,
                    definition_id: DEFINITION_ID)
    entry = {
      'id' => id, 'project_id' => PROJECT_ID, 'furniture_definition_id' => definition_id,
      'origin' => origin, 'lifecycle_status' => lifecycle, 'version' => 1,
      'created_at' => '2026-09-01T00:00:00Z', 'updated_at' => '2026-09-01T00:00:00Z'
    }
    display = {}
    display['name'] = display_name if display_name
    display['dimensions_mm'] = if display_dims
                                 { 'width' => display_dims[0], 'height' => display_dims[1],
                                   'depth' => display_dims[2] }
                               else
                                 { 'width' => 600, 'height' => 720, 'depth' => 560 }
                               end
    entry['display'] = display
    entry
  end

  def list_body
    [instance_body(FI_1, 'quote'), instance_body(FI_2, 'quote'), instance_body(FI_3, 'quote')]
  end

  def top_level_furniture(model)
    store = MS.new(model)
    model.entities.instances.select do |entity|
      metadata = store.read(entity)
      metadata.is_a?(Hash) && metadata['kind'] == 'furnitureInstance'
    end
  end

  # Silent logger: placement logs go through SafeLogger elsewhere.
  class NullLogger
    def info(_event, _context = {}); end

    def warn(_event, _context = {}); end

    def error(_event, _context = {}); end
  end
end
