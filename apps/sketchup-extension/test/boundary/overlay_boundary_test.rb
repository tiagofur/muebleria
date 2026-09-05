# frozen_string_literal: true

require_relative '../test_helper'

# #470 negative boundary proofs: the overlay is read-only inspection and can
# never become a second manufacturing authority. Static source invariants
# complement the behavioral tests (overlay_*_test.rb).
class OverlayBoundaryTest < Minitest::Test
  OVERLAY_DIR = File.join(PROJECT_ROOT, 'src', 'granete_for_sketchup', 'overlay').freeze

  # Host mutation surfaces the overlay must never touch: turning inspection
  # ON/OFF must leave the productive model byte/semantically unchanged.
  FORBIDDEN_OVERLAY_CALLS = /
    start_operation|commit_operation|abort_operation|
    erase_entities|add_face|pushpull|add_instance|
    \.write\(|MetadataWriter|definition\.entities\.add
  /x

  # Scanning vocabulary: overlay geometry may never flow back into
  # manufacturing truth (#470 §41) — no extraction/inference functions may
  # even exist.
  FORBIDDEN_SCANNING_PATTERNS = /
    machining_from|holes_from|from_faces|from_geometry|from_entity|
    infer_hole|scan_face|extract_.*machining|detect_.*hole
  /x

  def test_overlay_sources_never_mutate_the_host_model
    each_overlay_source do |path, source|
      refute_match(FORBIDDEN_OVERLAY_CALLS, source,
                   "#{path}: the overlay must never mutate the productive model")
    end
  end

  def test_overlay_sources_have_no_scanning_or_inference_surface
    each_overlay_source do |path, source|
      refute_match(FORBIDDEN_SCANNING_PATTERNS, source,
                   "#{path}: overlay geometry may never re-enter manufacturing truth")
    end
  end

  def test_overlay_feature_sources_come_only_from_the_resolve_contract
    source = File.read(File.join(OVERLAY_DIR, 'manufacturing_feature_view.rb'))
    assert_includes source, 'from_operations'
    refute_match(/AuthoringMachiningOperation\.new/, source.sub('Factory', ''),
                 'the view factory only consumes parsed contract operations')
  end

  private

  def each_overlay_source
    Dir.glob(File.join(OVERLAY_DIR, '*.rb')).each do |path|
      yield path, File.read(path)
    end
  end
end
