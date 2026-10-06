# frozen_string_literal: true

require 'json'
require 'tmpdir'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/library/release_api_client'
require_relative '../../src/granete_for_sketchup/library/consumer_pin'
require_relative '../../src/granete_for_sketchup/library/library_store'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/authoring_resolve_contract'

# #1102 LIB-AUTH Slice D: the consumer release pin — production adapter for
# the synchronizer port, boot refresh semantics and the resolve payload
# injection in RemoteCatalogProvider.
class LibraryReleasePinTest < Minitest::Test
  RAW_MANIFEST = '{"schemaVersion":1,"effectiveReleaseId":"rel-1"}'
  ORG = '11111111-1111-1111-1111-111111111111'
  RELEASE = '22222222-2222-2222-2222-222222222222'

  # Serves the canned RAW body for request_raw and records every path; the
  # parsed-JSON request is refused so raw/parse boundaries stay explicit.
  class RawTransport
    attr_reader :paths

    def initialize(raw_status:, raw_body:)
      @raw_status = raw_status
      @raw_body = raw_body
      @paths = []
    end

    def configured?
      true
    end

    def request_raw(payload, **)
      @paths << payload['path']
      { 'status' => @raw_status, 'body' => @raw_body }
    end

    def request(*_args, **)
      raise 'raw transport must not serve parsed requests'
    end
  end

  class ParsedTransport
    def initialize(status:, body:)
      @status = status
      @body = body
    end

    def configured?
      true
    end

    def request(*_args, **)
      { 'status' => @status, 'body' => @body }
    end
  end

  class NullAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test'
    end

    def refresh_if_needed; end

    def current_organization_id; end
  end

  class OrgAuth < NullAuth
    def initialize(org)
      super()
      @org = org
    end

    def current_organization_id
      @org
    end
  end

  class RecordingSynchronizer
    attr_reader :calls

    def initialize
      @calls = []
    end

    def sync_release(release_id:, org_id:, expected_manifest_hash:, **)
      @calls << { release_id: release_id, org_id: org_id, hash: expected_manifest_hash }
      { status: :synced, release_id: release_id, downloaded_count: 3 }
    end
  end

  class NeverSynchronizer
    def sync_release(**_kwargs)
      raise 'must not sync'
    end
  end

  # Records the FULL wire payload {method, path, body} of one POST and then
  # answers a minimal structured rejection (the pin injection happens before
  # the transport call — the response body is irrelevant to these tests).
  class CapturingTransport
    attr_reader :last_payload

    def initialize
      @last_payload = nil
    end

    def configured?
      true
    end

    def request(payload, **)
      @last_payload = payload
      {
        'status' => 422,
        'body' => {
          'schemaId' => 'granete.sketchup-authoring-resolve.v1',
          'schemaName' => 'granete.sketchup-authoring-resolve',
          'schemaVersion' => '1.0',
          'status' => 'rejected',
          'messageId' => 'resolve-m1',
          'inReplyToMessageId' => 'm1'
        }
      }
    end
  end

  def temp_store
    Granete::SketchUpExtension::Library::LibraryStore.new(
      store_dir: File.join(Dir.mktmpdir, 'LibraryStore')
    )
  end

  def test_fetch_manifest_returns_exact_raw_body
    transport = RawTransport.new(raw_status: 200, raw_body: RAW_MANIFEST)
    client = Granete::SketchUpExtension::Library::ReleaseApiClient.new(
      transport: transport, auth_provider: OrgAuth.new(ORG)
    )

    assert_equal RAW_MANIFEST, client.fetch_manifest(RELEASE)
    assert_equal "/manufacturing-libraries/standard/releases/#{RELEASE}/manifest", transport.paths.last
  end

  def test_fetch_blob_is_nil_on_failure
    transport = RawTransport.new(raw_status: 404, raw_body: 'nope')
    client = Granete::SketchUpExtension::Library::ReleaseApiClient.new(
      transport: transport, auth_provider: OrgAuth.new(ORG)
    )

    assert_nil client.fetch_blob(RELEASE, 'res-1', 'sha256:abc')
    assert_nil client.fetch_manifest(RELEASE)
  end

  def test_fetch_current_release_parses_the_summary
    client = Granete::SketchUpExtension::Library::ReleaseApiClient.new(
      transport: ParsedTransport.new(
        status: 200, body: { 'effectiveReleaseId' => RELEASE, 'manifestHash' => 'sha256:x' }
      ),
      auth_provider: OrgAuth.new(ORG)
    )
    current = client.fetch_current_release

    assert_equal RELEASE, current['effectiveReleaseId']
  end

  class FakeReleaseApi
    attr_reader :current_calls

    def initialize(current)
      @current = current
      @current_calls = 0
    end

    def configured?
      true
    end

    def fetch_current_release
      @current_calls += 1
      @current
    end
  end

  def test_consumer_pin_stays_when_pointer_already_current
    store = temp_store
    store.write_manifest(RELEASE, RAW_MANIFEST)
    store.set_current_release(ORG, RELEASE)
    api = FakeReleaseApi.new({ 'effectiveReleaseId' => RELEASE, 'manifestHash' => 'sha256:x' })
    synchronizer = RecordingSynchronizer.new
    pin = Granete::SketchUpExtension::Library::ConsumerPin.new(
      store: store, api_client: api, synchronizer: synchronizer, auth_provider: OrgAuth.new(ORG)
    )

    assert_equal :current, pin.refresh!
    assert_empty synchronizer.calls
  end

  def test_consumer_pin_syncs_when_server_moves_to_a_new_release
    store = temp_store
    api = FakeReleaseApi.new({ 'effectiveReleaseId' => RELEASE, 'manifestHash' => 'sha256:new' })
    synchronizer = RecordingSynchronizer.new
    pin = Granete::SketchUpExtension::Library::ConsumerPin.new(
      store: store, api_client: api, synchronizer: synchronizer, auth_provider: OrgAuth.new(ORG)
    )

    result = pin.refresh!

    assert_equal :synced, result[:status]
    assert_equal RELEASE, synchronizer.calls.last[:release_id]
    assert_equal 'sha256:new', synchronizer.calls.last[:hash]
  end

  def test_consumer_pin_reports_unavailable_without_a_current_release
    api = FakeReleaseApi.new(nil)
    pin = Granete::SketchUpExtension::Library::ConsumerPin.new(
      store: temp_store, api_client: api, synchronizer: NeverSynchronizer.new,
      auth_provider: OrgAuth.new(ORG)
    )

    assert_equal :unavailable, pin.refresh!
  end

  def test_consumer_pin_without_org_is_a_no_op
    api = FakeReleaseApi.new({ 'effectiveReleaseId' => RELEASE })
    pin = Granete::SketchUpExtension::Library::ConsumerPin.new(
      store: temp_store, api_client: api, synchronizer: NeverSynchronizer.new,
      auth_provider: NullAuth.new
    )

    assert_equal :no_org, pin.refresh!
  end

  def build_pinned_provider(pin_provider)
    transport = CapturingTransport.new
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: transport, auth_provider: OrgAuth.new(ORG)
    )
    provider.library_pin_provider = pin_provider
    [provider, transport]
  end

  def resolve_once(provider, transport)
    payload = Granete::SketchUpExtension::Library::AuthoringResolveRequest.build_request(
      message_id: 'm1', idempotency_key: 'k1', furniture: { 'furnitureDefinitionId' => 'def-1' }
    )
    begin
      provider.resolve_authoring(payload)
    rescue StandardError
      # El cuerpo de rechazo mínimo no llega a parsear; sólo importa el
      # payload capturado tras la inyección del pin.
    end
    transport.last_payload
  end

  def test_provider_pins_the_authoring_resolve_payload
    provider, transport = build_pinned_provider(-> { [ORG, RELEASE] })

    payload = resolve_once(provider, transport)

    assert_equal RELEASE, payload['body']['furniture']['libraryReleaseId']
  end

  def test_provider_without_pin_leaves_payload_untouched
    provider, transport = build_pinned_provider(nil)

    payload = resolve_once(provider, transport)

    assert_nil payload['body']['furniture']['libraryReleaseId']
  end
end
