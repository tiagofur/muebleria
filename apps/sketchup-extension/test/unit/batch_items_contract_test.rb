# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/host/batch_items_contract'

# #471 hardening: the batch payload is validated BEFORE any command is
# built or resolved. A duplicate semantic identity (A, A, B) is an
# explicit rejection — never a silent dedup that would hide user error
# behind an apparently smaller batch.
class BatchItemsContractTest < Minitest::Test
  CONTRACT = Granete::SketchUpExtension::Host::BatchItemsContract

  def test_valid_items_pass
    items = [
      { 'instanceId' => 'inst-a', 'definitionId' => 'def-1' },
      { 'instanceId' => 'inst-b', 'definitionId' => 'def-1' }
    ]
    assert_nil CONTRACT.validate(items)
  end

  def test_duplicate_identity_is_rejected_explicitly
    items = [
      { 'instanceId' => 'inst-a', 'definitionId' => 'def-1' },
      { 'instanceId' => 'inst-a', 'definitionId' => 'def-2' },
      { 'instanceId' => 'inst-b', 'definitionId' => 'def-1' }
    ]
    reason = CONTRACT.validate(items)
    assert_equal 'el lote contiene la misma identidad más de una vez', reason
  end

  def test_server_id_and_ref_are_separate_namespaces
    items = [
      { 'instanceId' => 'shared-value', 'furnitureInstanceId' => 'fi-1', 'definitionId' => 'def-1' },
      { 'instanceId' => 'shared-value', 'furnitureInstanceRef' => 'shared-value', 'definitionId' => 'def-1' }
    ]
    assert_nil CONTRACT.validate(items), 'id and ref namespaces never alias'
  end

  def test_non_array_empty_missing_identity_and_missing_definition_reject_with_reasons
    assert_includes CONTRACT.validate(nil), 'lista'
    assert_includes CONTRACT.validate([]), 'vacío'
    assert_includes CONTRACT.validate([{ 'definitionId' => 'def-1' }]), 'identidad de mueble'
    assert_includes CONTRACT.validate([{ 'instanceId' => '  ', 'definitionId' => 'def-1' }]), 'identidad de mueble'
    assert_includes CONTRACT.validate([{ 'instanceId' => 'inst-a' }]), 'definitionId'
    assert_includes CONTRACT.validate(['nope']), 'objeto'
  end
end
