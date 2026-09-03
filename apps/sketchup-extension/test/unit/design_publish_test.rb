# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'tmpdir'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/identity'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/transport/multipart_body'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/managed_furniture'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'
require_relative '../../src/granete_for_sketchup/connection/duplicate_resolver'
require_relative '../../src/granete_for_sketchup/connection/design_publish'

# #392 / DT-8 — Publish immutable DesignRevision with manifest + 3D
# artifacts: managed-only manifest, staged prepare/upload/finalize sequence,
# SHA-256 verification, precheck reuse (#391) and binding base advance.
class DesignPublishTest < Minitest::Test
  MB = Granete::SketchUpExtension::Connection::ModelBinding
  DP = Granete::SketchUpExtension::Connection::DesignPublish
  PF = Granete::SketchUpExtension::Connection::ProjectFurniture
  MS = Granete::SketchUpExtension::Metadata::Store
  DR = Granete::SketchUpExtension::Connection::DuplicateResolver

  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  PROJECT_B_ID = '41000000-0000-0000-0000-000000000002'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  REVISION_R1 = '53000000-0000-0000-0000-000000000001'
  REVISION_R2 = '53000000-0000-0000-0000-000000000002'
  SESSION_ID = '54000000-0000-0000-0000-000000000001'
  DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'

  FI_1 = '51000000-0000-0000-0000-0000000000f1'
  FI_2 = '51000000-0000-0000-0000-0000000000f2'

  class TestModel < SketchupStub::ModelStub
    include SketchupStub::AttributeContainer
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-token'
    end
  end

  # Transport fake with both JSON routing AND multipart upload capture.
  class FakeTransport
    attr_reader :requests, :uploads

    def initialize
      @requests = []
      @uploads = []
      @routes = {}
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

      raise Granete::SketchUpExtension::Transport::RequestError, "no route for #{method} #{path}"
    end

    def upload(payload, file_path:, content_type:, authorization_header: nil)
      _ = authorization_header
      record = { 'path' => payload['path'], 'file' => file_path, 'content_type' => content_type,
                 'size' => File.size(file_path) }
      # The manifest bytes are snapshotted because the publish temp dir is
      # cleaned up as soon as the sequence ends.
      record['manifest'] = JSON.parse(File.read(file_path)) if content_type == 'application/json'
      @uploads << record
      route = @routes[['POST', payload['path']]]
      raise Granete::SketchUpExtension::Transport::RequestError, "no route for upload #{payload['path']}" unless route

      digest = Digest::SHA256.file(file_path)
      # A route-provided sha256 models a server answer; absence means the
      # fake echoes the authoritative hash of the received bytes.
      sha = route['body']['sha256'] || "sha256-#{digest.hexdigest}"
      body = route['body'].merge('sha256' => sha, 'size_bytes' => File.size(file_path))
      { 'status' => route['status'], 'body' => body }
    end

    def requests_for(method, path_pattern)
      @requests.select { |r| r['method'] == method && r['path'].match?(path_pattern) }
    end
  end

  # ProjectFurniture service double for the #391 precheck + working copy sync.
  class FakeWorkingCopyService
    attr_accessor :working_copy, :update_calls

    def initialize(working_copy:)
      @working_copy = working_copy
      @update_calls = []
      @instances = {}
    end

    def register_instance(instance)
      @instances[instance.id] = instance
    end

    def list_project_furniture(project_id)
      @instances.values.select { |i| i.project_id == project_id }
    end

    def get_working_copy(_design_id)
      @working_copy
    end

    def update_working_copy(design_id, items:, base_revision_id: nil, source_type: nil)
      @update_calls << { 'design_id' => design_id, 'items' => items, 'base' => base_revision_id,
                         'source_type' => source_type }
      @working_copy = PF::Contract::WorkingCopy.new(
        design_id: design_id, base_revision_id: base_revision_id, items: items
      )
    end
  end

  def setup
    @model = TestModel.new
    SketchupStub.active_model = @model

    binding = MB::Binding.new(project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: REVISION_R1)
    MB::Store.new(@model).write!(binding)

    @metadata_store = MS.new(@model)
    @transport = FakeTransport.new
    @service = DP::Service.new(transport: @transport, auth_provider: FakeAuth.new)

    @wc_service = FakeWorkingCopyService.new(
      working_copy: PF::Contract::WorkingCopy.new(design_id: DESIGN_ID, base_revision_id: REVISION_R1, items: [])
    )
    [FI_1, FI_2].each do |fi_id|
      @wc_service.register_instance(
        PF::Contract::Instance.new(id: fi_id, project_id: PROJECT_ID,
                                   furniture_definition_id: DEFINITION_ID,
                                   origin: 'design', lifecycle_status: 'active')
      )
    end

    @base_advancer = base_advancer_double(REVISION_R2)

    @resolver = DR.new(
      model_provider: -> { @model },
      binding_store_factory: -> { MB::Store.new(@model) },
      model_binding_service: nil,
      service: @wc_service,
      metadata_store_factory: ->(m) { MS.new(m) },
      logger: Granete::SketchUpExtension::SafeLogger.new
    )

    @publisher = DP::Publisher.new(
      model_provider: -> { @model },
      binding_store_factory: -> { MB::Store.new(@model) },
      duplicate_resolver: @resolver,
      service: @service,
      working_copy_service: @wc_service,
      base_advancer: @base_advancer,
      metadata_store_factory: ->(m) { MS.new(m) },
      logger: Granete::SketchUpExtension::SafeLogger.new
    )
  end

  def teardown
    SketchupStub.active_model = nil
  end

  def base_advancer_double(revision_id)
    advancer = Object.new
    advancer.define_singleton_method(:calls) { @calls ||= 0 }
    advancer.define_singleton_method(:call) do
      @calls = (@calls || 0) + 1
      { 'ok' => true, 'status' => { 'state' => 'connected', 'authoritativeBaseRevisionId' => revision_id.to_s } }
    end
    advancer
  end

  def create_managed_instance(furniture_instance_id:, project_id: PROJECT_ID, design_id: DESIGN_ID)
    definition = @model.definitions.add("Gabinete #{furniture_instance_id}")
    instance = @model.entities.add_instance(definition, Geom::Transformation.new)
    metadata = {
      'namespace' => 'com.granete.sketchup_extension',
      'metadataVersion' => 1,
      'kind' => 'furnitureInstance',
      'identity' => {
        'instanceRef' => furniture_instance_id,
        'furnitureInstanceId' => furniture_instance_id,
        'projectId' => project_id,
        'designId' => design_id
      },
      'intent' => { 'parameters' => {}, 'materialChoices' => {} }
    }
    @metadata_store.write(instance, metadata)
    instance
  end

  # Unmanaged decoration (a raw group): no Granete identity metadata at all.
  def create_unmanaged_group
    @model.entities.add_group
  end

  def stub_publish_routes(session_id: SESSION_ID, revision_id: REVISION_R2, revision_number: 2)
    @transport.respond(:post, "/designs/#{DESIGN_ID}/publish:prepare", 201, {
                         'id' => session_id, 'design_id' => DESIGN_ID, 'status' => 'prepared',
                         'base_revision_id' => REVISION_R1, 'expires_at' => '2026-09-04T00:00:00Z',
                         'required_artifacts' => %w[model manifest preview]
                       })
    %w[model manifest preview].each do |kind|
      @transport.respond(:post, "/designs/#{DESIGN_ID}/publish/#{session_id}/artifacts/#{kind}", 201,
                         { 'kind' => kind, 'size_bytes' => 1,
                           'content_type' => 'application/octet-stream' })
    end
    @transport.respond(:post, "/designs/#{DESIGN_ID}/publish/#{session_id}:finalize", 201, {
                         'id' => revision_id, 'design_id' => DESIGN_ID, 'revision_number' => revision_number,
                         'parent_revision_id' => REVISION_R1, 'source_type' => 'sketchup', 'status' => 'published',
                         'artifacts' => [
                           { 'kind' => 'model', 'sha256' => "sha256-#{'ab' * 32}", 'size_bytes' => 10,
                             'content_type' => 'application/octet-stream' },
                           { 'kind' => 'manifest', 'sha256' => "sha256-#{'cd' * 32}", 'size_bytes' => 4,
                             'content_type' => 'application/json' },
                           { 'kind' => 'preview', 'sha256' => "sha256-#{'ef' * 32}", 'size_bytes' => 6,
                             'content_type' => 'image/png' }
                         ]
                       })
  end

  def seed_working_items(*fi_ids)
    fi_ids.each do |fi_id|
      @wc_service.working_copy.items << PF::Contract::WorkingItem.new(
        furniture_instance_id: fi_id,
        parameters: { 'widthMm' => 600 }, material_choices: {},
        transform: { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] }
      )
    end
  end

  # ---- ManifestBuilder: managed-only semantic export ----

  def test_manifest_contains_only_managed_furniture
    create_managed_instance(furniture_instance_id: FI_1)
    create_managed_instance(furniture_instance_id: FI_2)
    create_unmanaged_group # pared decorativa
    create_unmanaged_group # planta
    create_unmanaged_group # mesa auxiliar decorativa

    binding = MB::Store.new(@model).read
    manifest = DP::ManifestBuilder.build(@model, binding, @metadata_store,
                                         sketchup_version: '24.0.145', plugin_version: '0.1.0')

    assert_equal 1, manifest['schemaVersion']
    assert_equal PROJECT_ID, manifest['projectId']
    assert_equal DESIGN_ID, manifest['designId']
    assert_equal REVISION_R1, manifest['baseRevisionId']
    assert_equal 'sketchup', manifest['source']['client']
    assert_equal '24.0.145', manifest['source']['sketchupVersion']
    assert_equal '0.1.0', manifest['source']['pluginVersion']

    ids = manifest['items'].map { |item| item['furnitureInstanceId'] }
    assert_equal [FI_1, FI_2].sort, ids.sort
    # Unmanaged architecture/decoration NEVER enters the manifest (proof B).
    assert_equal 2, manifest['items'].length
  end

  def test_manifest_excludes_foreign_project_identity
    create_managed_instance(furniture_instance_id: FI_1)
    create_managed_instance(furniture_instance_id: FI_2, project_id: PROJECT_B_ID)

    binding = MB::Store.new(@model).read
    manifest = DP::ManifestBuilder.build(@model, binding, @metadata_store,
                                         sketchup_version: '24.0.145', plugin_version: '0.1.0')
    ids = manifest['items'].map { |item| item['furnitureInstanceId'] }
    assert_equal [FI_1], ids
  end

  # ---- Publisher: sequence and negative proofs ----

  def test_publish_happy_path_sequence_and_binding_advance
    create_managed_instance(furniture_instance_id: FI_1)
    create_managed_instance(furniture_instance_id: FI_2)
    seed_working_items(FI_1, FI_2)
    stub_publish_routes

    progress = []
    result = @publisher.publish(on_progress: ->(step) { progress << step })

    assert result['ok'], "publish failed: #{result}"
    assert_equal REVISION_R2, result['baseRevisionId']
    assert_equal 2, result['revisionNumber']
    assert_equal 3, result['artifacts'].length

    # Sequence: prepare (JSON) → 3 uploads (multipart) → finalize (JSON).
    # The working-copy sync goes through the injected service, not transport.
    paths = @transport.requests.map { |r| r['path'] }
    assert_equal ["/designs/#{DESIGN_ID}/publish:prepare",
                  "/designs/#{DESIGN_ID}/publish/#{SESSION_ID}:finalize"], paths
    upload_paths = @transport.uploads.map { |u| u['path'] }
    assert_equal [
      "/designs/#{DESIGN_ID}/publish/#{SESSION_ID}/artifacts/model",
      "/designs/#{DESIGN_ID}/publish/#{SESSION_ID}/artifacts/manifest",
      "/designs/#{DESIGN_ID}/publish/#{SESSION_ID}/artifacts/preview"
    ], upload_paths

    assert_equal %w[validating syncing exporting uploading publishing], progress

    # The binding base advanced from the server-authoritative answer.
    assert_equal 1, @base_advancer.calls

    # The working copy sync PUT carried the authoritative base.
    sync = @wc_service.update_calls.first
    assert_equal REVISION_R1, sync['base']
    assert_equal 'sketchup', sync['source_type']
    assert_equal 2, sync['items'].length
  end

  def test_publish_uploads_real_exported_artifacts_with_verified_hashes
    create_managed_instance(furniture_instance_id: FI_1)
    seed_working_items(FI_1)
    stub_publish_routes

    result = @publisher.publish
    assert result['ok'], result.inspect

    uploads = @transport.uploads
    assert_equal 3, uploads.length
    uploads.each do |upload|
      assert_operator upload['size'], :>, 0, "#{upload['path']} must be a real non-empty file"
    end
    model_upload = uploads.find { |u| u['path'].end_with?('/artifacts/model') }
    assert_equal 'application/octet-stream', model_upload['content_type']
    manifest_upload = uploads.find { |u| u['path'].end_with?('/artifacts/manifest') }
    assert_equal 'application/json', manifest_upload['content_type']
    preview_upload = uploads.find { |u| u['path'].end_with?('/artifacts/preview') }
    assert_equal 'image/png', preview_upload['content_type']

    # The manifest artifact mirrors the prepared manifest exactly.
    prepare_body = @transport.requests.find { |r| r['path'].end_with?('publish:prepare') }['body']
    assert_equal prepare_body['manifest'], manifest_upload['manifest']
  end

  def test_publish_prepares_with_deterministic_idempotency_key
    create_managed_instance(furniture_instance_id: FI_1)
    seed_working_items(FI_1)
    stub_publish_routes

    assert @publisher.publish['ok']
    prepare = @transport.requests.find { |r| r['path'].end_with?('publish:prepare') }
    key = prepare['headers']['Idempotency-Key']
    assert_match(/\Apub:#{DESIGN_ID}:#{REVISION_R1}:[0-9a-f]{32}\z/, key)

    finalize = @transport.requests.find { |r| r['path'].end_with?(':finalize') }
    assert_equal "pubfin:#{SESSION_ID}", finalize['headers']['Idempotency-Key']
  end

  def test_publish_aborts_before_any_http_when_precheck_fails
    duplicate_a = create_managed_instance(furniture_instance_id: FI_1)
    create_managed_instance(furniture_instance_id: FI_1)
    seed_working_items(FI_1)
    stub_publish_routes
    _ = duplicate_a

    result = @publisher.publish

    refute result['ok']
    assert_equal 'duplicate_furniture_identity', result['code']
    # Precheck invalid → NO upload, NO prepare, NO finalize.
    assert_empty @transport.requests
    assert_empty @transport.uploads
    assert_equal 0, @base_advancer.calls
  end

  def test_publish_fails_loud_when_server_hash_mismatches
    create_managed_instance(furniture_instance_id: FI_1)
    seed_working_items(FI_1)
    stub_publish_routes
    # Corrupt the server-side hash answer for the model artifact.
    @transport.respond(:post, "/designs/#{DESIGN_ID}/publish/#{SESSION_ID}/artifacts/model", 201,
                       { 'kind' => 'model', 'sha256' => "sha256-#{'ff' * 32}", 'size_bytes' => 1,
                         'content_type' => 'application/octet-stream' })

    result = @publisher.publish

    refute result['ok']
    assert_equal 'hash_mismatch', result['code']
    # No finalize after an integrity failure.
    assert_empty @transport.requests_for('POST', /:finalize/)
    assert_equal 0, @base_advancer.calls
  end

  def test_publish_maps_conflict_to_stale_base_and_never_advances
    create_managed_instance(furniture_instance_id: FI_1)
    seed_working_items(FI_1)
    stub_publish_routes
    @transport.respond(:post, "/designs/#{DESIGN_ID}/publish:prepare", 409,
                       { 'error' => { 'code' => 'CONFLICT', 'message' => 'client base revision is stale' } })

    result = @publisher.publish

    refute result['ok']
    assert_equal 'stale_base', result['code']
    assert_match(/base/, result['reason'])
    assert_equal 0, @base_advancer.calls
  end

  def test_publish_without_binding_fails_closed
    blank = TestModel.new
    publisher = DP::Publisher.new(
      model_provider: -> { blank },
      binding_store_factory: -> { MB::Store.new(blank) },
      duplicate_resolver: @resolver,
      service: @service,
      working_copy_service: @wc_service,
      base_advancer: @base_advancer,
      metadata_store_factory: ->(m) { MS.new(m) }
    )

    result = publisher.publish
    refute result['ok']
    assert_equal 'unbound', result['code']
    assert_empty @transport.requests
  end

  def test_publish_failure_at_finalize_keeps_binding_base
    create_managed_instance(furniture_instance_id: FI_1)
    seed_working_items(FI_1)
    stub_publish_routes
    @transport.respond(:post, "/designs/#{DESIGN_ID}/publish/#{SESSION_ID}:finalize", 409,
                       { 'error' => { 'code' => 'CONFLICT', 'message' => 'working copy base revision is stale' } })

    result = @publisher.publish

    refute result['ok']
    assert_equal 'stale_base', result['code']
    assert_equal 0, @base_advancer.calls
  end

  def test_publish_success_requires_authoritative_base_match
    create_managed_instance(furniture_instance_id: FI_1)
    seed_working_items(FI_1)
    stub_publish_routes
    # The advancer answers with a DIFFERENT authoritative revision: the
    # publish result must not report success against a mismatched base.
    publisher = DP::Publisher.new(
      model_provider: -> { @model },
      binding_store_factory: -> { MB::Store.new(@model) },
      duplicate_resolver: @resolver,
      service: @service,
      working_copy_service: @wc_service,
      base_advancer: base_advancer_double('00000000-0000-0000-0000-000000000099'),
      metadata_store_factory: ->(m) { MS.new(m) }
    )

    result = publisher.publish

    refute result['ok']
    assert_equal 'base_advance_failed', result['code']
  end

  # ---- Contract parsers ----

  def test_contract_rejects_unknown_session_status
    body = { 'id' => SESSION_ID, 'design_id' => DESIGN_ID, 'status' => 'weird',
             'expires_at' => 'x', 'required_artifacts' => %w[model] }
    assert_raises(ArgumentError) { DP::Contract.parse_session!(body) }
  end

  def test_contract_rejects_bad_sha
    body = { 'kind' => 'model', 'sha256' => 'not-a-hash', 'size_bytes' => 5, 'content_type' => 'a/b' }
    assert_raises(ArgumentError) { DP::Contract.parse_artifact!(body) }
  end

  def test_contract_rejects_unpublished_revision
    body = { 'id' => REVISION_R2, 'design_id' => DESIGN_ID, 'revision_number' => 2,
             'source_type' => 'sketchup', 'status' => 'draft' }
    assert_raises(ArgumentError) { DP::Contract.parse_revision!(body) }
  end

  # ---- Manifest parity with the shared contract fixture ----

  def test_manifest_contract_fixture_parity
    fixture_path = File.expand_path('../../../../contracts/sketchupPublishManifest.contract.json', __dir__)
    fixture = JSON.parse(File.read(fixture_path))
    fixture['scenarios'].each do |scenario|
      # Unknown-field rejection is the Go decoder's DisallowUnknownFields rule;
      # the Ruby builder parity covers the semantic constraints both share.
      next if scenario['id'] == '05-invalid-unknown-field'

      ids = scenario['manifest']['items'].to_a.map { |i| i['furnitureInstanceId'] }
      valid_shape = scenario['valid']
      duplicate = ids.uniq.length != ids.length
      uuid_ok = ids.all? { |id| id.is_a?(String) && id.match?(DP::UUID_PATTERN) }
      client_ok = scenario['manifest']['source']['client'] == 'sketchup'
      plugin_ok = scenario['manifest']['source']['pluginVersion'].to_s.length.between?(1, 64)
      sketchup_ok = scenario['manifest']['source']['sketchupVersion'].to_s.length.between?(1, 64)
      schema_ok = scenario['manifest']['schemaVersion'] == 1
      parsed_ok = schema_ok && client_ok && plugin_ok && sketchup_ok && !duplicate && uuid_ok
      assert_equal valid_shape, parsed_ok, "scenario #{scenario['id']} parity"
    end
  end

  # ---- MultipartBody streaming ----

  def test_multipart_body_streams_exact_content
    Dir.mktmpdir do |dir|
      path = File.join(dir, 'blob.bin')
      payload = (0..5000).map { |i| (i % 251).chr }.join
      File.binwrite(path, payload)

      File.open(path, 'rb') do |file|
        body = Granete::SketchUpExtension::Transport::MultipartBody.new(
          boundary: 'bnd', field: 'file', filename: 'blob.bin',
          content_type: 'application/octet-stream', file: file
        )
        expected = "--bnd\r\nContent-Disposition: form-data; name=\"file\"; filename=\"blob.bin\"\r\n" \
                   "Content-Type: application/octet-stream\r\n\r\n#{payload}\r\n--bnd--\r\n"
        assert_equal expected.bytesize, body.content_length

        streamed = +''
        streamed << body.read(1024) while streamed.bytesize < body.content_length
        assert_equal expected, streamed
      end
    end
  end

  # ---- ArtifactExporter: View#write_image host compatibility ----

  def test_artifact_exporter_uses_active_view_write_image_and_never_model_write_image
    refute @model.respond_to?(:write_image), 'Model must not expose write_image'
    assert @model.respond_to?(:active_view), 'Model must expose active_view'
    assert @model.active_view.respond_to?(:write_image), 'Active view must expose write_image'

    manifest = { 'schemaVersion' => 1, 'items' => [] }
    DP.with_temp_dir('test-export') do |dir|
      artifacts = DP::ArtifactExporter.export(@model, manifest, dir)
      assert_equal %w[manifest model preview].sort, artifacts.keys.sort

      skp_path = artifacts['model']['path']
      preview_path = artifacts['preview']['path']
      manifest_path = artifacts['manifest']['path']

      assert File.exist?(skp_path) && File.size?(skp_path)
      assert File.exist?(preview_path) && File.size?(preview_path)
      assert File.exist?(manifest_path) && File.size?(manifest_path)

      assert_includes @model.active_view.images_written, preview_path
    end
  end

  def test_artifact_exporter_fails_closed_when_no_active_view
    @model.active_view = nil
    manifest = { 'schemaVersion' => 1, 'items' => [] }
    DP.with_temp_dir('test-export') do |dir|
      err = assert_raises(RuntimeError) do
        DP::ArtifactExporter.export(@model, manifest, dir)
      end
      assert_match(/vista activa/, err.message)
    end
  end

  def test_progress_steps_constant_matches_publisher_contract
    assert_equal %w[validating syncing exporting uploading publishing], DP::PROGRESS_STEPS
  end
end
