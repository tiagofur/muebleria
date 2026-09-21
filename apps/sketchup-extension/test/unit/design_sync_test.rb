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
require_relative '../../src/granete_for_sketchup/connection/design_sync'
require_relative '../../src/granete_for_sketchup/connection/host_reconciliation'
require_relative '../../src/granete_for_sketchup/connection/host_restore'
require_relative '../../src/granete_for_sketchup/connection/panel_state'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

DSYNC = Granete::SketchUpExtension::Connection::DesignSync

# #810 — the explicit "Sincronizar diseño" operation. Golden sequence
# (issue Definition of Done) plus the frontier proofs:
#   * the new state is server WorkingCopy + dirty local intent, never a
#     full overwrite from reconstructed local state (rule A);
#   * delete is a conscious Design intent: the Project keeps the
#     FurnitureInstance, the panel re-derives it as pending and re-placing
#     reuses the identity (rule B, no FI-003);
#   * parameter edits marked authoring-dirty reach the working copy without
#     publishing (rule C);
#   * a lost-response retry converges when the server already equals the
#     intention, and a diverged state surfaces conflict without overwriting
#     (rule E).
class DesignSyncTest < Minitest::Test
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'
  FI_1 = '51000000-0000-0000-0000-0000000000f1'
  FI_2 = '51000000-0000-0000-0000-0000000000f2'
  FI_3 = '51000000-0000-0000-0000-0000000000f3'

  WC_VERSION_V1 = '2026-09-03T00:00:00Z'
  WC_VERSION_V2 = '2026-09-03T00:02:00Z'

  class SyncModel < SketchupStub::ModelStub
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

  # Router-style transport with the server-side semantics #810 needs: the
  # accepted PUT mints a NEW workingVersion token, echoes the accepted state
  # into the GET route, and can inject one typed conflict (lost response /
  # diverged writer) for the retry proofs.
  class SyncTransport
    attr_reader :requests

    def initialize
      @requests = []
      @routes = {}
      @next_put_failure = nil
    end

    def configure?
      true
    end

    def respond(method, path, status, body)
      @routes[[method.to_s.upcase, path]] = { 'status' => status, 'body' => body }
    end

    def fail_next_put_with(status, code, message, then_get: nil)
      @next_put_failure = { 'status' => status, 'body' => { 'code' => code, 'message' => message } }
      @after_failure_get = then_get
    end

    def working_copy_route
      @routes[['GET', "/designs/#{DESIGN_ID}/working-copy"]]
    end

    def request(payload, authorization_header: nil)
      _ = authorization_header
      method = payload['method'].to_s.upcase
      path = payload['path']
      @requests << { 'method' => method, 'path' => path, 'body' => payload['body'],
                     'headers' => payload['headers'] || {} }

      if method == 'PUT' && path == "/designs/#{DESIGN_ID}/working-copy"
        if @next_put_failure
          failure = @next_put_failure
          @next_put_failure = nil
          # The rejected write actually committed server-side (lost
          # response): the authoritative GET serves the accepted state from
          # now on.
          if @after_failure_get
            @routes[['GET', path]] = { 'status' => 200, 'body' => @after_failure_get }
            @after_failure_get = nil
          end
          return failure
        end
        body = (payload['body'] || {}).dup
        body['project_id'] ||= PROJECT_ID
        body['design_id'] ||= DESIGN_ID
        body['base_revision_id'] ||= REVISION_R1
        body['source_type'] ||= 'sketchup'
        body['items'] ||= []
        body['updated_at'] = WC_VERSION_V2
        @routes[['GET', path]] = { 'status' => 200, 'body' => body }
        return { 'status' => 200, 'body' => body }
      end

      route = @routes[[method, path]]
      return route if route

      raise Granete::SketchUpExtension::Transport::RequestError, "no route for #{method} #{path}"
    end

    def requests_for(method, path_pattern)
      @requests.select { |request| request['method'] == method.to_s.upcase && request['path'].match?(path_pattern) }
    end

    def working_copy_puts
      requests_for('PUT', %r{/designs/#{DESIGN_ID}/working-copy})
    end
  end

  class MiniCatalog
    def all_definitions
      [definition]
    end

    def find_definition(definition_id)
      definition_id == DEFINITION_ID ? definition : nil
    end

    def resolved_native_layout(_definition_id, _parameters = {}, _choices = {})
      nil
    end

    def definition
      { 'furniture_definition_id' => DEFINITION_ID, 'code' => 'BASE-600',
        'name' => 'Gabinete Base 600', 'category' => 'kitchen_base', 'version' => '1.0.0',
        'parameters' => [
          { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => 600, 'unit' => 'mm' },
          { 'name' => 'heightMm', 'label' => 'Alto', 'type' => 'number', 'defaultValue' => 720, 'unit' => 'mm' },
          { 'name' => 'depthMm', 'label' => 'Fondo', 'type' => 'number', 'defaultValue' => 560, 'unit' => 'mm' },
          { 'name' => 'shelfCount', 'label' => 'Entrepaños', 'type' => 'number', 'defaultValue' => 1 }
        ] }
    end
  end

  class NullLogger
    def info(_event, _context = {}); end

    def warn(_event, _context = {}); end

    def error(_event, _context = {}); end
  end

  def setup
    @model = SyncModel.new
    @transport = SyncTransport.new
    write_binding
    stub_binding_validation
    stub_project_furniture
    stub_working_copy([])
    @service = PF::Service.new(transport: @transport, auth_provider: FakeAuth.new, logger: NullLogger.new)
    @synchronizer = DSYNC::Synchronizer.new(
      model_provider: -> { @model },
      binding_store_factory: ->(model) { MB::Store.new(model) },
      model_binding_service: MB::Service.new(transport: @transport, auth_provider: FakeAuth.new,
                                             logger: NullLogger.new),
      service: @service,
      metadata_store_factory: ->(_model) { MS.new(@model) },
      logger: NullLogger.new
    )
    @placer = build_placer
  end

  # ------------------------------------------------------------------
  # R2 — explicit empty authoring values (#810 review round 2)
  # ------------------------------------------------------------------

  def test_dirty_sync_clears_material_choices_explicitly
    entity = place_local_root(FI_1, parameters: { 'widthMm' => 600 }) # persisted intent carries materialChoices: {}
    stub_working_copy([working_item(FI_1, {}, entity).merge(
      'material_choices' => { 'FRONT' => 'material-a' }
    )])
    edit_authoring!(FI_1, 'widthMm' => 600) # marks dirty; intent keeps the EMPTY choices

    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect
    assert_equal [FI_1], result['changes']['updated']

    item = @transport.working_copy_puts.first['body']['items'].first
    assert_equal({}, item['material_choices'],
                 'a present-but-empty materialChoices is an explicit clear, not a preserve')
    assert_nil item['material_choices']['FRONT'], 'material-a must be gone'
  end

  def test_absent_material_choices_key_preserves_server_choices
    place_local_root(FI_1, parameters: { 'widthMm' => 600 }, material_choices: nil) # intent omits the key
    entity = PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    stub_working_copy([working_item(FI_1, {}, entity).merge(
      'material_choices' => { 'FRONT' => 'material-a' }
    )])
    edit_authoring!(FI_1, 'widthMm' => 750) # dirty on parameters; STILL no choices key

    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect

    item = @transport.working_copy_puts.first['body']['items'].first
    assert_equal({ 'FRONT' => 'material-a' }, item['material_choices'],
                 'an absent key is no authoring statement: the server value survives verbatim')
  end

  # The canonical persisted authoring intent always carries the COMPLETE
  # normalized parameter set (definition defaults + edits), so an explicit
  # {} parameters intent is only reachable through a future canonical
  # "reset overrides" form. The merger rule is proven regardless: present
  # {} replaces; absent preserves.
  def test_present_empty_parameters_replace_at_the_merger_level
    entity = place_local_root(FI_1, parameters: { 'widthMm' => 600 })
    store = MS.new(@model)
    metadata = store.read(entity)
    metadata['intent']['parameters'] = {}
    metadata['authoringDirty'] = true
    store.write(entity, metadata)
    stub_working_copy([working_item(FI_1, 'widthMm' => 750)])

    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect

    item = @transport.working_copy_puts.first['body']['items'].first
    assert_equal({}, item['parameters'],
                 'present-but-empty parameters replace the server values at the merger level')
  end

  # Regression guard for the absent half of the parameters rule. The
  # update is driven by the transform (locator mismatch) so the assertion
  # isolates the parameters field: the intent carries NO authoring keys, so
  # the server values must travel verbatim.
  def test_absent_parameters_key_preserves_server_values
    entity = place_local_root(FI_1, material_choices: nil)
    store = MS.new(@model)
    metadata = store.read(entity)
    metadata['intent'].delete('parameters')
    metadata['authoringDirty'] = true
    store.write(entity, metadata)
    stub_working_copy([working_item(FI_1, { 'widthMm' => 750 })])

    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect
    assert_equal [FI_1], result['changes']['updated']

    item = @transport.working_copy_puts.first['body']['items'].first
    assert_equal 750, item.dig('parameters', 'widthMm'),
                 'an absent parameters key must preserve the server values'
  end

  # ------------------------------------------------------------------
  # R3 — the explicit clear must be reachable through the REAL authoring
  # path: FurnitureBuilder#update_furniture → MetadataWriter → DesignSync →
  # WorkingCopy. No manual metadata preparation.
  # ------------------------------------------------------------------

  def test_real_authoring_path_clears_material_choices_end_to_end
    entity = place_local_root(FI_1, parameters: { 'widthMm' => 600 },
                                    material_choices: { 'FRONT' => 'material-a' })
    stub_working_copy([working_item(FI_1, {}, entity).merge(
      'material_choices' => { 'FRONT' => 'material-a' }
    )])

    # The user's real clear action: the authoring command re-resolves and
    # applies with material_choices = {} (an explicit empty statement).
    builder = FBUILDER.new(metadata_store: MS.new(@model))
    resolved = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [], []
    )
    outcome = builder.update_furniture(@model, entity, MiniCatalog.new.definition,
                                       { 'widthMm' => 600 },
                                       resolved_layout: resolved,
                                       material_choices: FBUILDER::CLEAR_MATERIAL_CHOICES)
    assert outcome['success'], "real authoring clear failed: #{outcome['error']}"

    # Persisted metadata carries the explicit empty statement and stays
    # dirty until the backend confirms the working copy.
    edited = PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    metadata = MS.new(@model).read(edited)
    assert_equal({}, metadata.dig('intent', 'materialChoices'),
                 'the real path must persist the explicit empty choices')
    assert metadata['authoringDirty'], 'a local clear must stay dirty until confirmed'

    # Synchronize Design: the working copy clears and the flag drops.
    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect
    assert_equal [FI_1], result['changes']['updated']

    item = @transport.working_copy_puts.first['body']['items'].first
    assert_equal({}, item['material_choices'])
    assert_nil item['material_choices']['FRONT'], 'material-a must be gone'

    refute MS.new(@model).read(
      PF::ManagedFurniture.locate(@model, MS.new(@model), FI_1)['entity']
    )['authoringDirty'], 'confirmed sync clears the dirty flag'
  end

  # ------------------------------------------------------------------
  # Golden sequence (#810 Definition of Done)
  # ------------------------------------------------------------------

  def test_golden_sequence_place_sync_edit_move_delete_sync_redelete_reuse_identity
    place_local_root(FI_1, parameters: { 'widthMm' => 600 })
    place_local_root(FI_2, parameters: { 'widthMm' => 600 })

    # 1) place both → sync: the working copy receives both ids with the
    #    persisted placement intent, through the canonical token.
    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect
    assert_equal 'synchronized', result['code']
    assert_equal [FI_1, FI_2], result['changes']['added'].sort
    put = @transport.working_copy_puts.first
    assert_equal WC_VERSION_V1, put['body']['expected_working_version']
    assert_equal [FI_1, FI_2].sort, put['body']['items'].map { |item| item['furniture_instance_id'] }.sort

    # 2) modify FI-001 width (authoring edit), move it, delete FI-002.
    edit_authoring!(FI_1, 'widthMm' => 750)
    move_root!(FI_1, [1000, 0, 0])
    delete_root!(FI_2)

    # 3) sync: update + remove intent, preserving everything not dirty.
    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect
    assert_equal [FI_1], result['changes']['updated']
    assert_equal [FI_2], result['changes']['removed']

    put = @transport.working_copy_puts.last
    items = put['body']['items']
    assert_equal 1, items.length, 'FI-002 must leave the working copy'
    assert_equal FI_1, items.first['furniture_instance_id']
    assert_equal 750, items.first.dig('parameters', 'widthMm'),
                 'rule C: the edit reaches the working copy without publishing'
    assert_equal 1000.0, items.first.dig('transform', 'translation_mm', 0)
    assert_equal WC_VERSION_V2, put['body']['expected_working_version'],
                 'the second write carries the accepted V2 token'

    # The Project keeps BOTH identities: the panel re-derives FI-002 as
    # pending (unplaced) and re-placing reuses it — never FI-003.
    panel = @placer.panel
    row2 = panel['items'].find { |row| row['id'] == FI_2 }
    assert_equal 'unplaced', row2['reconciliationState']
    assert panel['items'].none? { |row| row['id'] == FI_3 }, 'no third identity may appear'

    assert @placer.place(FI_2)['ok']
    finalize_position!(FI_2)
    confirmed = @placer.confirm_placement(FI_2)
    assert confirmed['ok'], confirmed.inspect
    assert_equal 'placed', confirmed['code']

    identity = read_identity(FI_2)
    assert_equal FI_2, identity['furnitureInstanceId'], 're-placing reuses FI-002'

    final = @placer.panel
    row2 = final['items'].find { |row| row['id'] == FI_2 }
    assert_equal 'present_synced', row2['reconciliationState']

    # Save/close/reopen: the persisted metadata still carries the identity.
    reopen_identity = read_identity(FI_2)
    assert_equal FI_2, reopen_identity['furnitureInstanceId']

    # Zero business-identity creation requests across the whole sequence.
    created = @transport.requests_for('POST', %r{/furniture-instances})
    assert_empty(created.reject { |request| request['path'] =~ /:duplicate/ })
    every_id = @transport.working_copy_puts.flat_map do |request|
      request['body']['items'].map do |item|
        item['furniture_instance_id']
      end
    end
    assert_equal [], every_id - [FI_1, FI_2]
  end

  # Rule A: unmodified items travel verbatim; only the dirty entity's
  # authoring fields change, and working items with no local root are the
  # conscious remove intent.
  def test_sync_builds_from_server_state_plus_dirty_intent_only
    untouched = place_local_root(FI_1, parameters: { 'widthMm' => 600 })
    stub_working_copy([
                        working_item(FI_1, {}, untouched),
                        working_item(FI_2, 'widthMm' => 600),
                        working_item(FI_3, 'widthMm' => 600)
                      ])
    place_local_root(FI_2, parameters: { 'widthMm' => 600 })
    edit_authoring!(FI_2, 'widthMm' => 750) # dirty edit
    # FI_3 has no local root: remove intent.

    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect
    assert_equal [FI_2], result['changes']['updated']
    assert_equal [FI_3], result['changes']['removed']
    assert_empty result['changes']['added']

    items = @transport.working_copy_puts.first['body']['items']
    fi1 = items.find { |item| item['furniture_instance_id'] == FI_1 }
    fi2 = items.find { |item| item['furniture_instance_id'] == FI_2 }
    assert_equal 600, fi1.dig('parameters', 'widthMm'), 'non-dirty item keeps server authoring verbatim'
    assert_equal 720, fi1.dig('parameters', 'heightMm'), 'server-only fields survive'
    assert_equal 750, fi2.dig('parameters', 'widthMm')
    assert(items.none? { |item| item['furniture_instance_id'] == FI_3 })
  end

  # Rule E, convergence half: the server already committed the intention but
  # the response was lost — the retry converges instead of overwriting.
  def test_retry_after_lost_response_converges
    stub_working_copy([working_item(FI_1, 'widthMm' => 600)])
    place_local_root(FI_1, parameters: { 'widthMm' => 600 })
    edit_authoring!(FI_1, 'widthMm' => 750)

    # The server committed EXACTLY the intention this client would send (the
    # response was lost): the client's last read still shows W1, the PUT
    # comes back as the typed conflict, and the authoritative re-read (after
    # the PUT) proves the convergence.
    working = @service.get_working_copy(DESIGN_ID)
    local = PF::ManagedFurniture.index(@model, MS.new(@model))
    intended = DSYNC::IntentBuilder.build(working: working, local: local)
    accepted_state = { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                       'base_revision_id' => REVISION_R1, 'source_type' => 'sketchup',
                       'updated_at' => WC_VERSION_V2,
                       'items' => intended[:items].map(&:to_contract_h) }
    @transport.fail_next_put_with(409, 'VERSION_CONFLICT', 'El borrador de trabajo cambió',
                                  then_get: accepted_state)

    result = @synchronizer.synchronize_design
    assert result['ok'], result.inspect
    assert_equal 'synchronized', result['code']
    assert result['converged'], 'the retry must converge, not rewrite'
    assert_equal 1, @transport.working_copy_puts.length, 'the diverged retry must not send a second PUT'

    # The confirmed convergence clears the authoring-dirty flag.
    metadata = read_metadata(FI_1)
    refute metadata['authoringDirty']
  end

  # Rule E, conflict half: the server advanced to a DIFFERENT state — the
  # stale intention is surfaced as conflict and never overwrites W-newer.
  def test_diverged_conflict_surfaces_without_overwriting
    stub_working_copy([working_item(FI_1, 'widthMm' => 600)])
    place_local_root(FI_1, parameters: { 'widthMm' => 600 })
    edit_authoring!(FI_1, 'widthMm' => 750)

    # Another writer advanced the server to a DIFFERENT state between this
    # client's read (W1, width 600) and its PUT: the typed conflict comes
    # back and the authoritative re-read shows width 999 — divergence, never
    # an overwrite.
    @transport.fail_next_put_with(409, 'VERSION_CONFLICT', 'El borrador de trabajo cambió',
                                  then_get: { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                                              'base_revision_id' => REVISION_R1, 'source_type' => 'sketchup',
                                              'updated_at' => WC_VERSION_V2,
                                              'items' => [working_item(FI_1, 'widthMm' => 999)] })

    result = @synchronizer.synchronize_design
    refute result['ok']
    assert_equal 'conflict', result['code']
    assert_equal 1, @transport.working_copy_puts.length, 'a conflict must not produce another write'

    # The dirty flag survives: the edit still owes the working copy.
    assert read_metadata(FI_1)['authoringDirty']
  end

  def test_missing_precondition_is_surfaced_not_swallowed
    stub_working_copy([working_item(FI_1, 'widthMm' => 600)])
    place_local_root(FI_1, parameters: { 'widthMm' => 600 })
    edit_authoring!(FI_1, 'widthMm' => 750)

    @transport.fail_next_put_with(428, 'PRECONDITION_REQUIRED',
                                  'expected_working_version es obligatorio')

    result = @synchronizer.synchronize_design
    refute result['ok']
    assert_equal 'precondition_required', result['code']
    assert read_metadata(FI_1)['authoringDirty'], 'the local edit is never reported as synchronized'
  end

  def test_duplicate_roots_block_the_sync_without_writes
    stub_working_copy([working_item(FI_1, 'widthMm' => 600)])
    place_local_root(FI_1, parameters: { 'widthMm' => 600 })
    place_local_root(FI_1, parameters: { 'widthMm' => 600 })

    result = @synchronizer.synchronize_design
    refute result['ok']
    assert_equal 'duplicate_detected', result['code']
    assert_empty @transport.working_copy_puts
  end

  def test_already_synchronized_state_writes_nothing_and_reports_clean
    stub_working_copy([])
    place_local_root(FI_1, parameters: { 'widthMm' => 600 })
    @synchronizer.synchronize_design # first sync lands the add

    result = @synchronizer.synchronize_design
    assert result['ok']
    assert_equal 'synchronized', result['code']
    assert @transport.working_copy_puts.one?
  end

  def test_unreadable_local_metadata_blocks_the_sync_without_writes
    stub_working_copy([])
    # A furnitureInstance entity whose identity is unreadable/missing fails
    # closed instead of silently reading as a remove intent.
    definition = @model.definitions.add('Broken root')
    entity = @model.entities.add_instance(definition, Geom::Transformation.new)
    MS.new(@model).write(entity, {
                           'namespace' => 'com.granete.sketchup_extension', 'metadataVersion' => 1,
                           'kind' => 'furnitureInstance',
                           'identity' => { 'instanceRef' => 'local-only' },
                           'intent' => { 'furnitureDefinitionId' => DEFINITION_ID,
                                         'parameters' => {}, 'materialChoices' => {} }
                         })

    result = @synchronizer.synchronize_design
    refute result['ok']
    assert_equal 'invalid_local_metadata', result['code']
    assert_empty @transport.working_copy_puts
  end

  def test_unbound_model_fails_without_network
    unbound = SyncModel.new
    synchronizer = DSYNC::Synchronizer.new(
      model_provider: -> { unbound },
      binding_store_factory: ->(model) { MB::Store.new(model) },
      model_binding_service: MB::Service.new(transport: @transport, auth_provider: FakeAuth.new,
                                             logger: NullLogger.new),
      service: @service,
      metadata_store_factory: ->(_model) { MS.new(unbound) },
      logger: NullLogger.new
    )
    result = synchronizer.synchronize_design
    refute result['ok']
    assert_equal 'unbound', result['code']
    assert_empty @transport.requests
  end

  private

  def write_binding(model = @model, base: REVISION_R1)
    MB::Store.new(model).write!(
      MB::Binding.new(project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: base)
    )
  end

  def stub_binding_validation(base: REVISION_R1)
    @transport.respond(:post, "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate", 200,
                       {
                         'state' => 'valid',
                         'schema_version' => 1,
                         'organization' => { 'id' => '10000000-0000-0000-0000-00000000000a',
                                             'name' => 'Carpintería García' },
                         'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina García' },
                         'design' => { 'id' => DESIGN_ID, 'name' => 'Cocina principal', 'status' => 'active' },
                         'working_copy' => { 'base_revision_id' => base, 'base_revision_number' => 1 },
                         'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true,
                                             'can_create_initial_quote' => true }
                       })
  end

  def stub_project_furniture
    @transport.respond(:get, "/projects/#{PROJECT_ID}/furniture-instances", 200,
                       [instance_body(FI_1), instance_body(FI_2)])
  end

  def stub_working_copy(items)
    @transport.respond(:get, "/designs/#{DESIGN_ID}/working-copy", 200,
                       { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                         'base_revision_id' => REVISION_R1, 'source_type' => 'sketchup',
                         'updated_at' => WC_VERSION_V1, 'items' => items })
  end

  def instance_body(id)
    {
      'id' => id, 'project_id' => PROJECT_ID, 'furniture_definition_id' => DEFINITION_ID,
      'origin' => 'quote', 'lifecycle_status' => 'active', 'version' => 1,
      'created_at' => '2026-09-01T00:00:00Z', 'updated_at' => '2026-09-01T00:00:00Z',
      'display' => { 'dimensions_mm' => { 'width' => 600, 'height' => 720, 'depth' => 560 } }
    }
  end

  def working_item(fi_id, parameters = {}, entity = nil)
    item = {
      'furniture_instance_id' => fi_id,
      'furniture_definition_id' => DEFINITION_ID,
      'parameters' => { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 }.merge(parameters),
      'material_choices' => {},
      'transform' => { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] },
      'technical_client_locator' => { 'kind' => 'sketchup_persistent_id', 'value' => 'old-root' }
    }
    if entity
      item['technical_client_locator'] = { 'kind' => 'sketchup_persistent_id',
                                           'value' => entity.persistent_id.to_s }
    end
    item
  end

  # material_choices: nil models the persisted intent WITHOUT the
  # materialChoices key (no authoring statement at all).
  def place_local_root(fi_id, parameters: {}, material_choices: {})
    definition = @model.definitions.add("Managed #{fi_id}")
    entity = @model.entities.add_instance(definition, Geom::Transformation.new)
    intent = { 'furnitureDefinitionId' => DEFINITION_ID,
               'parameters' => { 'widthMm' => 600, 'heightMm' => 720,
                                 'depthMm' => 560, 'shelfCount' => 1 }.merge(parameters) }
    intent['materialChoices'] = material_choices if material_choices.is_a?(Hash)
    MS.new(@model).write(entity, {
                           'namespace' => 'com.granete.sketchup_extension', 'metadataVersion' => 1,
                           'kind' => 'furnitureInstance',
                           'identity' => { 'instanceRef' => fi_id, 'furnitureInstanceId' => fi_id,
                                           'projectId' => PROJECT_ID, 'designId' => DESIGN_ID },
                           'intent' => intent
                         })
    entity
  end

  # Simulates the persisted result of a local authoring mutation (#810 rule
  # C): complete normalized parameters plus the authoring-dirty flag.
  def edit_authoring!(fi_id, parameters)
    entity = PF::ManagedFurniture.locate(@model, MS.new(@model), fi_id)['entity']
    store = MS.new(@model)
    metadata = store.read(entity)
    metadata['intent']['parameters'] = metadata['intent']['parameters'].merge(parameters)
    metadata['authoringDirty'] = true
    store.write(entity, metadata)
    entity
  end

  def move_root!(fi_id, translation_mm)
    root = PF::ManagedFurniture.locate(@model, MS.new(@model), fi_id)['entity']
    root.transformation = Geom::Transformation.axes(
      Geom::Point3d.new(translation_mm[0] / 25.4, translation_mm[1] / 25.4,
                        (translation_mm[2] || 0) / 25.4),
      Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(-1, 0, 0), Geom::Vector3d.new(0, 0, 1)
    )
    root
  end

  def finalize_position!(fi_id)
    move_root!(fi_id, [1000, 0, 0])
  end

  def delete_root!(fi_id)
    entity = PF::ManagedFurniture.locate(@model, MS.new(@model), fi_id)['entity']
    @model.entities.erase_entities([entity])
  end

  def read_metadata(fi_id)
    entity = PF::ManagedFurniture.locate(@model, MS.new(@model), fi_id)['entity']
    MS.new(@model).read(entity)
  end

  def read_identity(fi_id)
    read_metadata(fi_id)['identity']
  end

  def build_placer
    PF::Placer.new(
      model_provider: -> { @model },
      binding_store_factory: ->(model) { MB::Store.new(model) },
      model_binding_service: MB::Service.new(transport: @transport, auth_provider: FakeAuth.new,
                                             logger: NullLogger.new),
      service: @service,
      metadata_store_factory: ->(_model) { MS.new(@model) },
      catalog_provider: MiniCatalog.new,
      furniture_builder_factory: ->(model) { FBUILDER.new(metadata_store: MS.new(model)) },
      logger: NullLogger.new
    )
  end
end
