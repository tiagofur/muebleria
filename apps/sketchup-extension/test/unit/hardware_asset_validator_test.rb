# frozen_string_literal: true

require 'tempfile'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/identity'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_validator'

class HardwareAssetValidatorTest < Minitest::Test
  class FakeDownloader
    attr_accessor :canned_path

    def initialize(canned_path = nil)
      @canned_path = canned_path
      @calls = []
    end

    def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
      @calls << { asset_id: asset_id, revision_id: revision_id, sha256: sha256,
                  expected_bytes: expected_bytes, org_id: org_id }
      @canned_path
    end
  end

  class FakeTransport
    attr_reader :requests

    def initialize(status = 201)
      @status = status
      @requests = []
    end

    def request(payload, authorization_header: nil)
      @requests << { payload: payload, auth: authorization_header }
      { 'status' => @status, 'body' => { 'status' => 'recorded' } }
    end
  end

  class FakeAuthProvider
    def authorization_header
      'Bearer test-jwt-token'
    end
  end

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @downloader = FakeDownloader.new
    @transport = FakeTransport.new
    @auth_provider = FakeAuthProvider.new
    @validator = Granete::SketchUpExtension::Assets::HardwareAssetValidator.new(
      downloader: @downloader,
      transport: @transport,
      auth_provider: @auth_provider
    )
  end

  def test_validate_revision_fails_when_download_returns_nil
    res = @validator.validate_revision(
      asset_id: 'asset-1', revision_id: 'rev-1',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      model: @model
    )

    assert_equal 'failed', res['status']
    assert_equal 'sketchup-validator-v1', res['tool']
    assert_equal 'sha256-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', res['sha256']
    assert_equal 1, @transport.requests.length
    assert_equal 'failed', @transport.requests.first[:payload]['body']['result']
  end

  def test_validate_revision_fails_when_loaded_component_has_no_geometry
    file = Tempfile.new(['test_asset', '.skp'])
    file.write('skp binary stub')
    file.close
    @downloader.canned_path = file.path

    res = @validator.validate_revision(
      asset_id: 'asset-1', revision_id: 'rev-1',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      model: @model
    )

    assert_equal 'failed', res['status']
    assert_includes res['details']['diagnostic'], 'no contiene geometría'
    assert_equal 'failed', @transport.requests.first[:payload]['body']['result']
  ensure
    file&.unlink
  end

  def test_validate_revision_fails_when_bounds_is_empty
    file = Tempfile.new(['test_asset', '.skp'])
    file.write('skp binary stub')
    file.close
    @downloader.canned_path = file.path

    # Pre-add definition so definitions.load finds it with entities but empty bounds
    def_name = File.basename(file.path, '.*')
    comp_def = @model.definitions.add(def_name)
    comp_def.entities.add_face([Geom::Point3d.new(0, 0, 0), Geom::Point3d.new(1, 0, 0), Geom::Point3d.new(0, 1, 0)])
    comp_def.bounds = Geom::BoundingBox.new(0.0, 0.0, 0.0)

    res = @validator.validate_revision(
      asset_id: 'asset-1', revision_id: 'rev-1',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      model: @model
    )

    assert_equal 'failed', res['status']
    assert_includes res['details']['diagnostic'], 'bounding box'
  ensure
    file&.unlink
  end

  def test_validate_revision_passes_and_posts_evidence_when_valid
    file = Tempfile.new(['test_asset', '.skp'])
    file.write('skp binary stub')
    file.close
    @downloader.canned_path = file.path

    def_name = File.basename(file.path, '.*')
    comp_def = @model.definitions.add(def_name)
    comp_def.entities.add_face([Geom::Point3d.new(0, 0, 0), Geom::Point3d.new(1, 0, 0), Geom::Point3d.new(0, 1, 0)])
    comp_def.bounds = Geom::BoundingBox.new(10.0, 5.0, 2.0)

    res = @validator.validate_revision(
      asset_id: 'asset-1', revision_id: 'rev-1',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      model: @model
    )

    assert_equal 'passed', res['status']
    assert_equal 'sketchup-validator-v1', res['tool']
    assert_equal 1, res['details']['faces_count']
    assert_in_delta 254.0, res['details']['bounds']['width_mm'], 0.1
    assert_equal 1, @transport.requests.length

    req = @transport.requests.first
    assert_equal '/hardware-assets/asset-1/revisions/rev-1:validate', req[:payload]['path']
    assert_equal 'Bearer test-jwt-token', req[:auth]
    assert_equal 'passed', req[:payload]['body']['result']

    # Evidence details contain host info and measuredBoundsMm
    details = req[:payload]['body']['details']
    assert_equal 'SketchUp', details['host']['application']
    assert_equal '24.0.145-stub', details['host']['version']
    assert_equal @validator.send(:detect_os), details['host']['os']
    assert_equal Granete::SketchUpExtension::EXTENSION_VERSION, details['validatorVersion']
    refute_nil details['measuredBoundsMm']
    assert_in_delta 254.0, details['measuredBoundsMm']['widthMm'], 0.1
    assert_in_delta 127.0, details['measuredBoundsMm']['heightMm'], 0.1
    assert_in_delta 50.8, details['measuredBoundsMm']['depthMm'], 0.1

    # Definition was cleaned up from definitions list
    assert_nil @model.definitions[def_name]
  ensure
    file&.unlink
  end

  def test_detect_os_maps_sketchup_platform_correctly
    singleton = class << ::Sketchup; self; end
    singleton.send(:define_method, :platform) { :platform_osx }
    assert_equal 'macOS', @validator.send(:detect_os)

    singleton.send(:remove_method, :platform)
    singleton.send(:define_method, :platform) { :platform_win }
    assert_equal 'Windows', @validator.send(:detect_os)
  ensure
    singleton.send(:remove_method, :platform) if singleton&.method_defined?(:platform)
  end
end
