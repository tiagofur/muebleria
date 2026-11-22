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

  # #1599: the dev-mode header rides on every request while the mode is ON,
  # and never otherwise (a provider failure fails closed: no header).
  def test_http_adapter_announces_library_dev_mode_only_while_on
    adapter = Granete::SketchUpExtension::Transport::HttpAdapter.new(base_url: 'http://localhost:8080')
    uri = URI.parse('http://localhost:8080/api/projects:bootstrap-design')
    payload = { 'method' => 'POST', 'path' => '/projects:bootstrap-design', 'body' => { 'a' => 1 } }

    assert_nil adapter.send(:build_request, uri, payload, 'Bearer x')['X-Granete-Library-Mode']

    mode = 'draft'
    adapter.library_mode_provider = -> { mode }
    assert_equal 'draft', adapter.send(:build_request, uri, payload, 'Bearer x')['X-Granete-Library-Mode']
    get = { 'method' => 'GET', 'path' => '/designs/x/working-copy' }
    assert_equal 'draft', adapter.send(:build_request, uri, get, 'Bearer x')['X-Granete-Library-Mode']

    mode = nil
    assert_nil adapter.send(:build_request, uri, payload, 'Bearer x')['X-Granete-Library-Mode']

    adapter.library_mode_provider = -> { raise 'store unreadable' }
    assert_nil adapter.send(:build_request, uri, payload, 'Bearer x')['X-Granete-Library-Mode']
  end
end
