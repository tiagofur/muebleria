# frozen_string_literal: true

require 'digest'
require 'tmpdir'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'

class HardwareAssetCacheTest < Minitest::Test
  def setup
    @tmp_dir = Dir.mktmpdir('hw_cache_test')
    @cache = Granete::SketchUpExtension::Assets::HardwareAssetCache.new(cache_dir: @tmp_dir)
    @dummy_data = "SKP MODEL BINARY DATA #{rand(1000)}"
    @dummy_sha = Digest::SHA256.hexdigest(@dummy_data)
    @dummy_size = @dummy_data.bytesize
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
  end

  def test_path_for_structures_hierarchy_properly
    path = @cache.path_for(
      asset_id: 'ast-pull-1',
      revision_id: 'rev-1',
      sha256: "sha256-#{@dummy_sha}",
      org_id: 'org-test'
    )
    expected_suffix = File.join('org-test', 'ast-pull-1', 'rev-1', "#{@dummy_sha}.skp")
    assert path.end_with?(expected_suffix)
  end

  def test_path_for_refuses_blank_or_traversal_org
    assert_nil @cache.path_for(asset_id: 'ast-pull-1', revision_id: 'rev-1', sha256: @dummy_sha, org_id: nil)
    assert_nil @cache.path_for(asset_id: 'ast-pull-1', revision_id: 'rev-1', sha256: @dummy_sha, org_id: '')
    assert_nil @cache.path_for(asset_id: 'ast-pull-1', revision_id: 'rev-1', sha256: @dummy_sha, org_id: '  ')
    assert_nil @cache.path_for(asset_id: 'ast-pull-1', revision_id: 'rev-1', sha256: @dummy_sha, org_id: '../evil')
    assert_nil @cache.path_for(asset_id: 'ast-pull-1', revision_id: 'rev-1', sha256: @dummy_sha, org_id: 'org/nested')
  end

  def test_path_for_refuses_traversal_in_asset_or_revision
    assert_nil @cache.path_for(asset_id: '../ast', revision_id: 'rev-1', org_id: 'org-test')
    assert_nil @cache.path_for(asset_id: 'ast-1', revision_id: '../../rev', org_id: 'org-test')
    assert_nil @cache.path_for(asset_id: 'ast-1', revision_id: 'rev/1', org_id: 'org-test')
  end

  def test_put_and_get_valid_asset
    saved_path = @cache.put(
      asset_id: 'ast-pull-1',
      revision_id: 'rev-1',
      data: @dummy_data,
      sha256: @dummy_sha,
      expected_bytes: @dummy_size,
      org_id: 'org-1'
    )
    refute_nil saved_path
    assert File.file?(saved_path)

    hit = @cache.get(
      asset_id: 'ast-pull-1',
      revision_id: 'rev-1',
      sha256: "sha256-#{@dummy_sha}",
      expected_bytes: @dummy_size,
      org_id: 'org-1'
    )
    assert_equal saved_path, hit
  end

  def test_get_rejects_and_removes_corrupt_size
    saved_path = @cache.put(
      asset_id: 'ast-pull-1',
      revision_id: 'rev-1',
      data: @dummy_data,
      org_id: 'org-1'
    )
    assert File.file?(saved_path)

    hit = @cache.get(
      asset_id: 'ast-pull-1',
      revision_id: 'rev-1',
      expected_bytes: @dummy_size + 10,
      org_id: 'org-1'
    )
    assert_nil hit
    refute File.file?(saved_path)
  end

  def test_get_rejects_and_removes_corrupt_sha256
    saved_path = @cache.put(
      asset_id: 'ast-pull-1',
      revision_id: 'rev-1',
      data: @dummy_data,
      sha256: @dummy_sha,
      expected_bytes: @dummy_size,
      org_id: 'org-1'
    )
    assert File.file?(saved_path)

    # Simulate bit rot or disk corruption
    File.binwrite(saved_path, 'corrupted file content')

    hit = @cache.get(
      asset_id: 'ast-pull-1',
      revision_id: 'rev-1',
      sha256: @dummy_sha,
      expected_bytes: @dummy_size,
      org_id: 'org-1'
    )
    assert_nil hit
    refute File.file?(saved_path)
  end

  def test_clear_revision_removes_directory
    saved_path = @cache.put(
      asset_id: 'ast-pull-1',
      revision_id: 'rev-1',
      data: @dummy_data,
      org_id: 'org-1'
    )
    assert File.file?(saved_path)

    @cache.clear_revision(asset_id: 'ast-pull-1', revision_id: 'rev-1', org_id: 'org-1')
    refute File.file?(saved_path)
  end
end
