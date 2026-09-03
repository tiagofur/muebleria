# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'testup/testcase'

# Host smoke for the #388 model ↔ Project/Design binding: the INSTALLED
# extension must persist the versioned binding envelope in the Granete-owned
# model dictionary so it survives save/close/reopen and file copies — proving
# the binding travels with the .skp and never depends on filename, path or
# model GUID. Like TC_SelectionContextSmoke, this suite tests the installed
# RBZ only; business identity stays backend-validated (connector unit tests)
# while this suite proves the host persistence half.
module Granete
  module SketchUpExtension
    class TC_ModelBindingSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      REVISION_R1 = '53000000-0000-0000-0000-000000000001'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
      end

      def teardown
        Sketchup.file_new
      end

      def test_binding_roundtrip_and_dictionary_shape
        store = binding_store
        assert_nil store.read, 'a fresh model starts unbound'

        assert store.write!(sample_binding)
        stored = store.read
        refute_nil stored
        assert_equal PROJECT_ID, stored.project_id
        assert_equal DESIGN_ID, stored.design_id
        assert_equal REVISION_R1, stored.base_revision_id

        # The stored payload is the versioned envelope with exactly the
        # canonical fields — no GUID, path or filename ever enters it.
        raw = model.get_attribute('com.granete.project', 'granete.project-binding.v1')
        payload = JSON.parse(raw)
        assert_equal %w[baseRevisionId designId projectId schemaVersion], payload.keys.sort
        assert_equal 1, payload['schemaVersion']
      end

      def test_binding_survives_save_close_and_reopen
        Dir.mktmpdir('granete-binding') do |dir|
          path = File.join(dir, 'cocina-garcia.skp')
          binding_store.write!(sample_binding)
          assert model.save(path), 'the host must save the model'

          Sketchup.file_new
          assert Sketchup.open_file(path), 'the host must reopen the saved model'

          stored = binding_store.read
          refute_nil stored, 'binding must survive save/close/reopen'
          assert_equal DESIGN_ID, stored.design_id
          assert_equal REVISION_R1, stored.base_revision_id
        end
      end

      def test_binding_never_depends_on_filename_or_path
        Dir.mktmpdir('granete-binding') do |dir|
          original = File.join(dir, 'cocina-garcia.skp')
          renamed = File.join(dir, 'obra-distinta-renameada.skp')
          binding_store.write!(sample_binding)
          assert model.save(original)

          # A copy under a different name/path keeps the exact binding:
          # business context follows the model, not the file identity.
          FileUtils.cp(original, renamed)
          Sketchup.file_new
          assert Sketchup.open_file(renamed)

          stored = binding_store.read
          refute_nil stored, 'a renamed/copied .skp keeps its binding'
          assert_equal PROJECT_ID, stored.project_id
          assert_equal DESIGN_ID, stored.design_id
        end
      end

      def test_corrupt_binding_metadata_fails_closed_as_invalid
        model.set_attribute('com.granete.project', 'granete.project-binding.v1', '{corrupt')
        store = binding_store
        assert_nil store.read
        refute_nil store.last_error, 'corruption must surface, never pass as a binding'
      end

      private

      def model
        Sketchup.active_model
      end

      def binding_store
        Granete::SketchUpExtension::Connection::ModelBinding::Store.new(model)
      end

      def sample_binding
        Granete::SketchUpExtension::Connection::ModelBinding::Binding.new(
          project_id: PROJECT_ID,
          design_id: DESIGN_ID,
          base_revision_id: REVISION_R1,
          schema_version: 1
        )
      end

      def fail_closed_unless_installed_extension_is_loaded
        extension = self.class.installed_extension
        flunk 'Install the Granete for SketchUp RBZ before running the host smoke' unless extension
        flunk 'Enable the installed extension and restart SketchUp before the host smoke' unless extension.loaded?
      end

      def fail_closed_if_loaded_from_checkout
        runtime_path = Granete::SketchUpExtension::Runtime.method(:start).source_location&.first
        flunk 'Installed Granete runtime is not loaded' if runtime_path.nil?

        expanded = File.expand_path(runtime_path)
        unless expanded.include?("#{File::SEPARATOR}Plugins#{File::SEPARATOR}")
          flunk "Granete runtime loaded outside the Plugins folder: #{expanded}"
        end
        return unless expanded.start_with?(REPOSITORY_ROOT + File::SEPARATOR)

        flunk 'Host smoke must test the installed RBZ, not the repository checkout'
      end
    end
  end
end
