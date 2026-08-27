# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'

# #414 — authoritative local part transform contract, Ruby parsing side.
#
# The golden consumed here (contracts/sketchupLayoutTransform.contract.json)
# is generated from the Go resolver's own output (engine golden test), so
# these tests exercise the exact wire shape the server serves.
class LayoutContractTest < Minitest::Test
  GOLDEN_PATH = File.expand_path('../../../../contracts/sketchupLayoutTransform.contract.json', __dir__)
  CONTRACT = 'granete.local-basis.v1'

  def golden_layout
    JSON.parse(File.read(GOLDEN_PATH))
  end

  def board(slot_id, overrides = {})
    raw = golden_layout['components'].find { |c| c['slotId'] == slot_id }
    raise "missing #{slot_id} in golden" unless raw

    raw.merge(overrides)
  end

  def with_contract(components)
    golden_layout.merge('components' => components)
  end

  def test_parses_the_server_golden_layout
    layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(golden_layout)

    assert_equal CONTRACT, layout.transform_contract
    assert_equal 6, layout.boards.length

    left = layout.boards.find { |b| b.slot_id == 'lateral_izquierdo' }
    assert_equal [0.0, 560.0, 0.0], left.translation
    assert_equal [0.0, -1.0, 0.0], left.basis['x']
    assert_equal [1.0, 0.0, 0.0], left.basis['y']
    assert_equal [0.0, 0.0, 1.0], left.basis['z']
    assert_equal 560, left.width_mm
    assert_equal 18, left.thickness_mm
    assert_equal 684, left.length_mm

    door = layout.boards.find { |b| b.slot_id == 'puerta' }
    assert_equal [1.0, 0.0, 0.0], door.basis['x']
    assert_equal [0.0, 1.0, 0.0], door.basis['y']
    assert_equal [0.0, 0.0, 1.0], door.basis['z']
    assert_equal [2.0, 560.0, 2.0], door.translation

    assert_equal 'st-comp-side-copy-0', layout.find_board('st-comp-side-copy-0').component_instance_id
  end

  def test_missing_transform_contract_fails_safe
    body = golden_layout.except('transformContract')

    error = assert_raises(Granete::SketchUpExtension::Library::LayoutContract::ContractError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
    end
    assert_includes error.message, 'no soportado'
    assert_includes error.message, 'nil'
  end

  def test_unknown_transform_contract_fails_safe
    body = golden_layout.merge('transformContract' => 'granete.local-basis.v2')

    error = assert_raises(Granete::SketchUpExtension::Library::LayoutContract::ContractError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
    end
    assert_includes error.message, 'granete.local-basis.v2'
    assert_includes error.message, CONTRACT
  end

  def test_board_without_local_transform_fails_safe
    body = with_contract([board('puerta').except('localTransform')])

    assert_raises(Granete::SketchUpExtension::Library::LayoutContract::ContractError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
    end
  end

  def test_malformed_basis_fails_safe
    [
      { 'x' => [0, -1], 'y' => [1, 0, 0], 'z' => [0, 0, 1] },          # wrong arity
      { 'x' => 'nope', 'y' => [1, 0, 0], 'z' => [0, 0, 1] },           # non-numeric
      { 'x' => [0, -1, Float::NAN], 'y' => [1, 0, 0], 'z' => [0, 0, 1] }, # non-finite
      { 'x' => [0, -2, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] },       # non-unit
      { 'x' => [1, 0, 0], 'y' => [1, 1, 0], 'z' => [0, 0, 1] },        # non-orthogonal
      { 'x' => [0, 1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] },        # left-handed mirror
      nil # basis missing
    ].each do |basis|
      raw = board('lateral_izquierdo')
      raw['localTransform'] = raw['localTransform'].merge('basis' => basis)
      body = with_contract([raw])

      assert_raises(Granete::SketchUpExtension::Library::LayoutContract::ContractError,
                    "basis #{basis.inspect} must fail safely") do
        Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
      end
    end
  end

  def test_non_positive_local_dimensions_fail_safe
    body = with_contract([board('puerta', 'thicknessMm' => 0)])

    assert_raises(Granete::SketchUpExtension::Library::LayoutContract::ContractError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
    end
  end

  # NEGATIVE PROOF (#414): slotId, name and the AABB cannot recover a
  # board's orientation. The Go resolver emits two custom boards that share
  # all of them and differ only in basis; the same ambiguity is asserted
  # here against the parser contract, plus slotId having no influence on
  # the parsed transform.
  def test_slot_and_aabb_cannot_recover_orientation
    flat = {
      'componentInstanceId' => 'st-comp-flat-copy-0', 'slotId' => 'custom', 'name' => 'Panel',
      'kind' => 'board', 'transform' => { 'translationMm' => [0, 0, 0] },
      'dimensionsMm' => [400, 400, 18], 'lengthMm' => 400, 'widthMm' => 400, 'thicknessMm' => 18,
      'localTransform' => {
        'translationMm' => [400, 0, 0],
        'basis' => { 'x' => [-1, 0, 0], 'y' => [0, 0, 1], 'z' => [0, 1, 0] }
      }
    }
    turned = flat.merge(
      'componentInstanceId' => 'st-comp-turned-copy-0',
      'localTransform' => {
        'translationMm' => [0, 0, 0],
        'basis' => { 'x' => [0, 1, 0], 'y' => [0, 0, 1], 'z' => [1, 0, 0] }
      }
    )

    # Identical misleading inputs…
    assert_equal flat['slotId'], turned['slotId']
    assert_equal flat['name'], turned['name']
    assert_equal flat['transform'], turned['transform']
    assert_equal flat['dimensionsMm'], turned['dimensionsMm']

    layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(with_contract([flat, turned]))
    parsed_flat = layout.find_board('st-comp-flat-copy-0')
    parsed_turned = layout.find_board('st-comp-turned-copy-0')

    # …still need different orientations: only localTransform tells them apart.
    refute_equal parsed_flat.basis['x'], parsed_turned.basis['x']
    refute_equal parsed_flat.translation, parsed_turned.translation

    # Renaming the slot never changes the parsed orientation: the parser has
    # no slot→rotation knowledge to accidentally use.
    renamed = flat.merge('slotId' => 'lateral_izquierdo')
    solo = Granete::SketchUpExtension::Library::LayoutContract.parse!(with_contract([renamed]))
    assert_equal parsed_flat.basis, solo.boards.first.basis
    assert_equal parsed_flat.translation, solo.boards.first.translation
  end

  # The AABB fields are convenience passthrough: a body without them still
  # parses — orientation must not depend on AABB presence or shape.
  def test_aabb_fields_are_optional_passthrough
    raw = board('puerta').except('transform', 'dimensionsMm')
    layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(with_contract([raw]))

    door = layout.boards.first
    assert_nil door.aabb_min
    assert_nil door.aabb_size
    assert_equal [1.0, 0.0, 0.0], door.basis['x']
  end

  # Provider integration: resolved_native_layout parses the fetched body and
  # fails loudly on unknown contracts — never a local guess.
  class FakeTransport
    def initialize(response)
      @response = response
    end

    def configured?
      true
    end

    def request(_payload, authorization_header: nil)
      @authorization_header = authorization_header
      @response
    end
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test-session-token'
    end
  end

  def test_provider_resolved_native_layout_parses_the_contract
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new({ 'status' => 200, 'body' => golden_layout }),
      auth_provider: FakeAuth.new
    )

    layout = provider.resolved_native_layout('mod-1')

    assert_equal CONTRACT, layout.transform_contract
    assert_equal 6, layout.boards.length
  end

  def test_provider_resolved_native_layout_fails_safe_on_legacy_bodies
    legacy = golden_layout.except('transformContract')
    legacy['components'].each { |c| c.reject! { |k, _v| k == 'localTransform' } }
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new({ 'status' => 200, 'body' => legacy }),
      auth_provider: FakeAuth.new
    )

    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      provider.resolved_native_layout('mod-1')
    end
  end

  def test_static_providers_do_not_resolve_native_layouts
    assert_nil Granete::SketchUpExtension::Library::StaticCatalogProvider.new.resolved_native_layout('x', {})
  end
end
