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

  def test_cache_filename_avoids_collisions_for_different_urls_with_same_basename
    name1 = @cache.cache_filename('http://cdn.com/materials/1/texture.jpg')
    name2 = @cache.cache_filename('http://cdn.com/materials/2/texture.jpg')

    refute_equal name1, name2
    assert name1.end_with?('-texture.jpg')
    assert name2.end_with?('-texture.jpg')
  end

  def test_cache_filename_rejects_unallowed_extensions
    assert_nil @cache.cache_filename('http://cdn.com/file.exe')
    assert_nil @cache.cache_filename('http://cdn.com/script.sh')
    assert_nil @cache.cache_filename('http://cdn.com/no_extension')
    refute_nil @cache.cache_filename('http://cdn.com/photo.png')
    refute_nil @cache.cache_filename('http://cdn.com/photo.webp')
  end

  def test_resolve_texture_returns_cached_file_if_present
    url = '/api/media/sample.jpg'
    filename = @cache.cache_filename(url)
    target = File.join(@tmp_dir, filename)
    File.binwrite(target, 'fake-jpeg-data')

    resolved = @cache.resolve_texture(url)
    assert_equal target, resolved
    assert File.file?(resolved)
  end

  def test_resolve_texture_returns_existing_disk_file
    target = File.join(@tmp_dir, 'direct.jpg')
    File.binwrite(target, 'disk-data')

    assert_equal target, @cache.resolve_texture(target)
  end
end
