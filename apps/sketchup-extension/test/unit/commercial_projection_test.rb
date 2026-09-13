# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/connection/commercial_projection'

class CommercialProjectionTest < Minitest::Test
  CP = Granete::SketchUpExtension::Connection::CommercialProjection
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'

  class Auth
    def configured? = true
    def authorization_header = 'Bearer device-token'
  end

  class Transport
    attr_reader :payload

    def initialize(response)
      @response = response
    end

    def request(payload)
      @payload = payload
      @response
    end
  end

  def projection
    {
      'schema' => 'granete.commercial-projection.v1', 'status' => 'current',
      'projectId' => PROJECT_ID, 'designId' => DESIGN_ID,
      'workingVersion' => 'working-4',
      'workingFingerprint' => "sha256-#{'a' * 64}",
      'catalogFingerprint' => "sha256-#{'b' * 64}",
      'projectionFingerprint' => "sha256-#{'c' * 64}",
      'pricingAuthority' => 'calc-project-breakdown',
      'calculatedAt' => '2026-09-13T12:00:00Z', 'currency' => 'MXN', 'itemCount' => 1,
      'amounts' => { 'materialsCost' => nil, 'edgeTotal' => nil, 'hardwareTotal' => nil,
                     'directCost' => 0.0, 'laborModular' => 0.0, 'laborFixedCost' => 0.0,
                     'marginFactor' => 1.0, 'saleTotal' => 0.0 },
      'costsWithheld' => false, 'saleAmountsWithheld' => false,
      'reference' => nil, 'acceptedReference' => nil, 'latestPublishedReference' => nil,
      'comparison' => nil, 'issues' => []
    }
  end

  def test_service_uses_exact_bound_path_and_device_authorization
    transport = Transport.new('status' => 200, 'body' => projection)
    result = CP::Service.new(transport: transport, auth_provider: Auth.new).fetch(PROJECT_ID, DESIGN_ID)

    assert_equal 0.0, result.dig('amounts', 'saleTotal')
    assert_equal 'GET', transport.payload['method']
    assert_equal "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/commercial-projection", transport.payload['path']
    assert_equal 'Bearer device-token', transport.payload.dig('headers', 'Authorization')
  end

  def test_contract_rejects_missing_amount_instead_of_inventing_zero
    body = projection
    body['amounts']['saleTotal'] = nil
    parsed = CP::Contract.parse!(body)
    assert_nil parsed.dig('amounts', 'saleTotal')
  end

  def test_contract_rejects_omitted_required_amount
    body = projection
    body['amounts'].delete('saleTotal')

    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_rejects_omitted_nullable_top_level_field
    body = projection
    body.delete('comparison')

    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_fails_closed_on_unknown_schema
    body = projection.merge('schema' => 'granete.commercial-projection.v2')
    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_fails_closed_on_invalid_reference_and_comparison
    body = projection
    body['reference'] = {
      'quoteRevisionId' => PROJECT_ID, 'revisionNumber' => 1, 'status' => 'accepted',
      'currency' => 'MXN', 'saleTotal' => 100.0
    }
    body['comparison'] = { 'absoluteDelta' => Float::INFINITY, 'percentageDelta' => nil }

    assert_raises(ArgumentError) { CP::Contract.parse!(body) }
  end

  def test_contract_accepts_generated_published_reference_status
    body = projection
    body['reference'] = {
      'quoteRevisionId' => PROJECT_ID, 'revisionNumber' => 1, 'status' => 'published',
      'currency' => 'MXN', 'saleTotal' => 100.0
    }

    assert_equal 'published', CP::Contract.parse!(body).dig('reference', 'status')
  end

  def test_contract_preserves_legacy_reference_with_unknown_currency
    body = projection
    body['reference'] = {
      'quoteRevisionId' => PROJECT_ID, 'revisionNumber' => 1, 'status' => 'published',
      'currency' => nil, 'saleTotal' => nil
    }

    assert_nil CP::Contract.parse!(body).dig('reference', 'currency')
  end
end
