# frozen_string_literal: true

require 'tmpdir'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_downloader'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/library/layout_contract'

class AssetLoaderTest < Minitest::Test
  class FakeDownloader
    attr_reader :download_calls

    def initialize(canned_path = nil)
      @canned_path = canned_path
      @download_calls = []
    end

    def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
      @download_calls << {
        asset_id: asset_id, revision_id: revision_id, sha256: sha256,
        expected_bytes: expected_bytes, org_id: org_id
      }
      @canned_path
    end
  end

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @target_group = @model.active_entities.add_group
    @tmp_dir = Dir.mktmpdir('asset_loader_test')
    @cache = Granete::SketchUpExtension::Assets::HardwareAssetCache.new(cache_dir: @tmp_dir)
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
  end

  def test_asset_resolver_returns_nil_for_missing_asset
    resolver = Granete::SketchUpExtension::Assets::AssetResolver.new
    assert_nil resolver.resolve_skp_path('non_existent_asset_xyz')
  end

  def test_asset_loader_returns_nil_for_unresolvable_asset
    loader = Granete::SketchUpExtension::Assets::AssetLoader.new
    result = loader.load_asset_instance(@model, 'missing_asset', @target_group)
    refute result
  end

  def test_prefetch_calls_downloader_and_caches_asset
    dummy_file = File.join(@tmp_dir, 'sample.skp')
    File.binwrite(dummy_file, 'SKP DATA')

    downloader = FakeDownloader.new(dummy_file)
    loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: downloader,
      cache: @cache
    )

    placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-1',
      asset_id: 'ast-handle',
      asset_revision_id: 'rev-handle-1',
      sha256: 'sha256-abc123',
      expected_bytes: 8
    )

    loader.prefetch_hardware_assets([placement])

    assert_equal 1, downloader.download_calls.length
    call = downloader.download_calls.first
    assert_equal 'ast-handle', call[:asset_id]
    assert_equal 'rev-handle-1', call[:revision_id]
    assert_empty loader.diagnostics
  end

  def test_prefetch_records_diagnostic_when_download_fails
    downloader = FakeDownloader.new(nil)
    loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: downloader,
      cache: @cache
    )

    placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-err',
      hardware_id: 'hw-pull',
      asset_id: 'ast-missing',
      asset_revision_id: 'rev-missing-1'
    )

    loader.prefetch_hardware_assets([placement])

    assert_equal 1, loader.diagnostics.length
    diag = loader.diagnostics.first
    assert_equal 'hardware_asset_missing', diag['code']
    assert_equal 'ast-missing', diag['assetId']
    assert_equal 'rev-missing-1', diag['assetRevisionId']
  end

  def test_load_asset_instance_with_basis_mounts_with_axes_transform
    dummy_file = File.join(@tmp_dir, 'handle_rigid.skp')
    File.binwrite(dummy_file, 'SKP DATA')

    downloader = FakeDownloader.new(dummy_file)
    loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: downloader,
      cache: @cache
    )

    basis = {
      'x' => [1.0, 0.0, 0.0],
      'y' => [0.0, 0.0, 1.0],
      'z' => [0.0, -1.0, 0.0]
    }
    pos_mm = [254.0, 508.0, 762.0] # 10, 20, 30 inches

    instance = loader.load_asset_instance(
      @model, 'ast-handle', @target_group, pos_mm,
      basis: basis,
      revision_id: 'rev-handle-1'
    )

    refute_nil instance
    # In sketchup stub, transformation origin is in inches
    transform = instance.transformation
    assert_in_delta 10.0, transform.origin.x, 0.001
    assert_in_delta 20.0, transform.origin.y, 0.001
    assert_in_delta 30.0, transform.origin.z, 0.001

    # Check axes
    assert_equal [1.0, 0.0, 0.0], transform.xaxis.to_a
    assert_equal [0.0, 0.0, 1.0], transform.yaxis.to_a
    assert_equal [0.0, -1.0, 0.0], transform.zaxis.to_a
  end
end
