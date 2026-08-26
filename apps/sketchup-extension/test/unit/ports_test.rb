# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'

class PortsTest < Minitest::Test
  def test_default_auth_provider_fails_closed
    provider = Granete::SketchUpExtension::Auth::NullProvider.new

    refute provider.configured?
    assert_raises(Granete::SketchUpExtension::Auth::NotConfiguredError) do
      provider.authorization_header
    end
  end

  def test_default_transport_fails_closed
    adapter = Granete::SketchUpExtension::Transport::NullAdapter.new

    refute adapter.configured?
    assert_raises(Granete::SketchUpExtension::Transport::NotConfiguredError) do
      adapter.request({}, authorization_header: nil)
    end
  end

  def test_http_adapter_allows_local_http
    adapter = Granete::SketchUpExtension::Transport::HttpAdapter.new(base_url: 'http://localhost:8080')
    assert_equal 'http://localhost:8080/api', adapter.base_url

    adapter2 = Granete::SketchUpExtension::Transport::HttpAdapter.new(base_url: 'http://taller.local:8080')
    assert_equal 'http://taller.local:8080/api', adapter2.base_url
  end

  def test_http_adapter_enforces_https_for_remote_endpoints
    adapter = Granete::SketchUpExtension::Transport::HttpAdapter.new(base_url: 'http://api.granete.app')
    assert_equal 'https://api.granete.app/api', adapter.base_url

    adapter2 = Granete::SketchUpExtension::Transport::HttpAdapter.new(base_url: 'app.granete.io')
    assert_equal 'https://app.granete.io/api', adapter2.base_url
  end
end
