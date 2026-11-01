# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/ui/bridges/hardware_mount_bridge'

# #1448 — the «Preparación de herrajes 3D» list bridge: the ONLY reachable
# trigger of the mount-frame preparation flow. The pinned catalog contract
# carries no visual asset fields, so the bridge asks the server for
# /catalog/hardware and forwards only rows with an asset binding, fail-closed
# on every non-server path (unauthenticated, error, non-200 → empty list).
class HardwareAssetsBridgeTest < Minitest::Test
  class FakeDialog
    attr_reader :scripts

    def initialize
      @scripts = []
    end

    def execute_script(script)
      @scripts << script
    end

    def last_payload
      json = @scripts.last[/setHardwareAssets\((.*)\)\z/m, 1]
      JSON.parse(json)
    end
  end

  class FakeTransport
    attr_reader :requests

    def initialize(configured:, response: nil, raise_error: nil)
      @configured = configured
      @response = response
      @raise_error = raise_error
      @requests = []
    end

    def configured?
      @configured
    end

    def request(payload, authorization_header: nil)
      @requests << payload.merge('auth' => authorization_header)
      raise @raise_error if @raise_error

      @response
    end
  end

  class FakeSession
    def initialize(transport:, configured: true)
      @transport = transport
      @configured = configured
      @refreshed = false
    end

    attr_reader :transport

    def configured?
      @configured
    end

    def refresh_if_needed
      @refreshed = true
    end

    def refreshed?
      @refreshed
    end

    def authorization_header
      'Bearer test-token'
    end
  end

  class FakeLogger
    attr_reader :errors

    def initialize
      @errors = []
    end

    def error(msg, **_data)
      @errors << msg
    end
  end

  def harness(transport, session: nil, configured: true)
    session ||= FakeSession.new(transport: transport, configured: configured)
    Class.new do
      include Granete::SketchUpExtension::UserInterface::HardwareMountBridge

      def initialize(session, logger)
        @session = session
        @logger = logger
      end

      def execute_bridge(dialog, method, payload)
        dialog.execute_script("window.GraneteDialog && window.GraneteDialog.#{method}(#{JSON.generate(payload)})")
      end
    end.new(session, FakeLogger.new)
  end

  def server_ok(body)
    { 'status' => 200, 'headers' => {}, 'body' => body }
  end

  def test_lists_only_hardware_with_asset_binding
    dialog = FakeDialog.new
    transport = FakeTransport.new(
      configured: true,
      response: server_ok([
                            { 'id' => 'h1', 'code' => '49402645-FIJ-I', 'name' => 'Guía fija' },
                            { 'id' => 'h2', 'code' => '49402645-FIJ-D', 'name' => 'Guía fija der',
                              'visual_asset' => { 'assetId' => 'a-2', 'assetRevisionId' => 'r-2' } },
                            { 'id' => 'h3', 'code' => 'SIN-ASSET', 'name' => 'Sin asset',
                              'visual_asset' => nil }
                          ])
    )
    harness(transport).handle_list_hardware_assets(dialog)

    payload = dialog.last_payload
    assert_equal 'server', payload['source']
    assert_equal 1, payload['hardware'].length
    row = payload['hardware'].first
    assert_equal 'h2', row['id']
    assert_equal 'a-2', row['assetId']
    assert_equal 'r-2', row['assetRevisionId']
    first_request = transport.requests.first
    assert_equal '/catalog/hardware', first_request['path']
    assert first_request['auth'].start_with?('Bearer ')
  end

  def test_requests_with_authorization_and_refreshes_session
    dialog = FakeDialog.new
    transport = FakeTransport.new(configured: true, response: server_ok([]))
    session = FakeSession.new(transport: transport)
    harness(transport, session: session).handle_list_hardware_assets(dialog)
    # refresh happens through the session wrapper (auth provider contract)
    assert session.refreshed?
    assert_equal '/catalog/hardware', transport.requests.first['path']
  end

  def test_unconfigured_transport_answers_empty_fail_closed
    dialog = FakeDialog.new
    transport = FakeTransport.new(configured: false)
    harness(transport).handle_list_hardware_assets(dialog)

    payload = dialog.last_payload
    assert_equal 'unauthenticated', payload['source']
    assert_empty payload['hardware']
  end

  def test_transport_error_answers_empty_and_logs
    dialog = FakeDialog.new
    transport = FakeTransport.new(configured: true, raise_error: StandardError.new('boom'))
    bridge = harness(transport)
    bridge.handle_list_hardware_assets(dialog)

    payload = dialog.last_payload
    assert_equal 'error', payload['source']
    assert_empty payload['hardware']
    assert_includes bridge.instance_variable_get(:@logger).errors, 'hardware_assets_list_failed'
  end

  def test_non_200_answers_empty
    dialog = FakeDialog.new
    transport = FakeTransport.new(configured: true, response: { 'status' => 401, 'headers' => {}, 'body' => nil })
    harness(transport).handle_list_hardware_assets(dialog)

    payload = dialog.last_payload
    assert_equal 'server', payload['source']
    assert_empty payload['hardware']
  end
end
