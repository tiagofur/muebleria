# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'

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
end
