# frozen_string_literal: true

require_relative 'placement_preview_controller_test'

# Old signature form: ids + sizes + translation, NO basis.
PLACEMENT_GUARDS = Granete::SketchUpExtension::Connection::ProjectFurniture::PlacementGuards

module PlacementGuardsBasisDemo
  module_function

  def layout_signature_without_basis(layout)
    return nil unless layout.is_a?(Granete::SketchUpExtension::Library::NativeLayout)

    boards = layout.boards.map do |board|
      "#{board.component_instance_id}:" \
        "#{board.width_mm}x#{board.thickness_mm}x#{board.length_mm}" \
        "@#{board.translation.map { |v| v.round(3) }.join(',')}"
    end.sort
    [
      layout.furniture_definition_id,
      layout.dimensions_mm ? layout.dimensions_mm.join('x') : 'no-dims',
      boards.join(';'),
      layout.hardware.map(&:placement_id).sort.join(',')
    ].join('|')
  end
end

# R4 counterfactual proof, as a characterization test: the OLD signature
# (ids + sizes + translation, NO basis) is blind to a rotation-only
# change — the placement WRONGLY succeeds under it. The real guard is
# test_board_basis_rotation_with_same_ids_sizes_translation_fails_closed:
# if basis ever stops participating in the live fingerprint, THAT test
# fails while this counterfactual keeps documenting why it must not.
class PlacementPreviewBasisSignatureDemoTest < PlacementPreviewControllerTest
  def test_old_basis_less_signature_is_blind_to_rotation_only_change
    guards = Granete::SketchUpExtension::Connection::ProjectFurniture::PlacementGuards
    guards.singleton_class.alias_method :layout_signature_with_basis, :layout_signature
    guards.define_singleton_method(:layout_signature) do |layout|
      PlacementGuardsBasisDemo.layout_signature_without_basis(layout)
    end

    @catalog.basis_mutation = false
    begin_preview(FI_1)
    tool = active_tool
    @catalog.basis_mutation = true # rotation-only: identical ids/sizes/translation
    click(tool)
    result = bridge_scripts('onPlaceFurnitureResult').last
    assert_includes result, '"code":"placed"',
                    'the old form must be blind here — detection lives in basis participation'
  ensure
    guards.singleton_class.send(:alias_method, :layout_signature,
                                :layout_signature_with_basis)
  end
end
