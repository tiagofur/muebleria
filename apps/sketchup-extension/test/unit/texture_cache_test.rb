# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'

class TextureCacheTest < Minitest::Test
  class TransportStub
    attr_accessor :base_url, :configured

    def initialize(base_url = 'http://localhost:8080/api')
      @base_url = base_url
      @configured = true
    end

    def configured?
      @configured
    end
  end

  class AuthStub
    attr_accessor :token

    def initialize(token = 'test-token')
      @token = token
    end

    def configured?
      !@token.nil?
    end

    def authorization_header
      "Bearer #{@token}"
    end
  end

  def setup
    @tmp_dir = Dir.mktmpdir('texture_cache_test')
    @transport = TransportStub.new
    @auth = AuthStub.new
    @cache = Granete::SketchUpExtension::Assets::TextureCache.new(
      cache_dir: @tmp_dir,
      transport: @transport,
      auth_provider: @auth
    )
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
  end

  def test_resolve_texture_returns_nil_on_blank
    assert_nil @cache.resolve_texture(nil)
    assert_nil @cache.resolve_texture('')
    assert_nil @cache.resolve_texture('   ')
  end

  def test_resolve_texture_returns_cached_file_if_present
    target = File.join(@tmp_dir, 'sample.jpg')
    File.binwrite(target, 'fake-jpeg-data')

    resolved = @cache.resolve_texture('/api/media/sample.jpg')
    assert_equal target, resolved
    assert File.file?(resolved)
  end
end
