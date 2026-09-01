# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/assets/media_authorizer'

# #460 SEC-3 — the SketchUp extension exchanges its session credential for
# short-lived, resource-scoped signed media URLs. These tests pin the
# collector grammar, batching, absolute-URL construction and fail-soft
# behavior.
class MediaAuthorizerTest < Minitest::Test
  FILE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'
  FILE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'

  class FakeTransport
    attr_reader :requests

    def initialize(responses)
      @responses = responses.dup
      @requests = []
    end

    def configured?
      true
    end

    def base_url
      'http://taller.local:8080/api'
    end

    def request(payload, authorization_header: nil)
      @requests << { 'payload' => payload, 'authorization_header' => authorization_header }
      response = @responses.shift
      response.nil? ? { 'status' => 500, 'body' => {} } : response
    end
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer session-token'
    end
  end

  def authorizer(transport)
    Granete::SketchUpExtension::Assets::MediaAuthorizer.new(
      transport: transport, auth_provider: FakeAuth.new,
      logger: Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    )
  end

  def grant_response(*filenames)
    { 'status' => 200, 'body' => {
      'grants' => filenames.map do |filename|
        { 'filename' => filename, 'url' => "/api/media/#{filename}?grant=signed",
          'expiresAt' => '2026-09-01T12:03:00Z' }
      end
    } }
  end

  def test_collects_deduplicated_canonical_media_filenames_from_nested_payloads
    transport = FakeTransport.new([])
    collected = authorizer(transport).collect_media_filenames(
      'definitions' => [
        { 'imageUrl' => "/api/media/#{FILE_A}?ignored=1" },
        { 'previewUrl' => "http://other.example.com/api/media/#{FILE_B}" }
      ],
      'materials' => [{ 'texture' => "/api/media/#{FILE_A}" }],
      'noise' => '/api/media/not-canonical.png'
    )

    assert_equal [FILE_A, FILE_B], collected
  end

  def test_media_payload_maps_filenames_to_absolute_signed_urls
    transport = FakeTransport.new([grant_response(FILE_A)])
    payload = authorizer(transport).media_payload_for('definitions' => [
      { 'imageUrl' => "/api/media/#{FILE_A}" }
    ])

    assert_equal(
      { 'baseUrl' => 'http://taller.local:8080',
        'urls' => { FILE_A => "http://taller.local:8080/api/media/#{FILE_A}?grant=signed" } },
      payload
    )
    assert_equal 'Bearer session-token', transport.requests.first['authorization_header']
  end

  def test_batches_more_than_one_hundred_files
    files = (1..101).map { |i| "#{format('%032x', i)[-32..]}.png" }
    transport = FakeTransport.new([grant_response(*files.first(100)), grant_response(files.last)])
    payload = authorizer(transport).media_payload_for('definitions' => files.map { |f| { 'imageUrl' => "/api/media/#{f}" } })

    assert_equal 2, transport.requests.length
    assert_equal 100, transport.requests.first['payload']['body']['resources'].length
    assert_equal 101, payload['urls'].length
  end

  def test_returns_nil_when_nothing_could_be_authorized
    transport = FakeTransport.new([{ 'status' => 401, 'body' => {} }])
    assert_nil authorizer(transport).media_payload_for('definitions' => [
      { 'imageUrl' => "/api/media/#{FILE_A}" }
    ])
  end

  def test_returns_nil_without_media_references_or_configuration
    transport = FakeTransport.new([])
    assert_nil authorizer(transport).media_payload_for('definitions' => [{ 'name' => 'x' }])
    assert_empty transport.requests

    unconfigured = Granete::SketchUpExtension::Assets::MediaAuthorizer.new(
      transport: nil, auth_provider: nil
    )
    assert_nil unconfigured.media_payload_for('definitions' => [{ 'imageUrl' => "/api/media/#{FILE_A}" }])
  end

  def test_refresh_url_rejects_non_canonical_filenames
    transport = FakeTransport.new([grant_response(FILE_A)])
    authorizer = authorizer(transport)

    assert_nil authorizer.refresh_url('../escape.png')
    assert_nil authorizer.refresh_url('not-canonical.png')
    assert_empty transport.requests

    refresh = authorizer.refresh_url(FILE_A)
    assert_equal({ 'filename' => FILE_A,
                   'url' => "http://taller.local:8080/api/media/#{FILE_A}?grant=signed" }, refresh)
  end
end
