# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'testup/testcase'

# Host smoke for the #499 Slice 3 pairing receive: the INSTALLED extension
# must converge a pairing exchange payload into the SAME canonical
# com.granete.project dictionary the manual flow writes, with the exact
# pinned base (never the newer authoritative working base), and the raw
# pairing code must never enter the model. The backend exchange/confirm
# HTTP halves stay covered by the connector unit tests; this suite proves
# the SketchUp host persistence half with the real dictionary API.
module Granete
  module SketchUpExtension
    class TC_PairingConnectSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      REVISION_R1 = '53000000-0000-0000-0000-000000000001'
      REVISION_R2 = '53000000-0000-0000-0000-000000000002'
      GRANT_ID = '88000000-0000-0000-0000-000000000001'
      PAIRING_CODE = 'ABCD234EFGH5'

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

      # The dictionary contract of the pairing path: the exchange's frozen
      # pin is what gets persisted; a drifted working copy (R2) never
      # overwrites it inside the pairing write itself.
      def test_pairing_exchange_writes_exact_pin_into_canonical_dictionary
        store = binding_store
        assert_nil store.read, 'a fresh model starts unbound'

        # The connector's exchange half is HTTP; the host contract under
        # test is the canonical write with the exact grant pin. This drives
        # the same write path the connector uses after a successful
        # exchange (write_bound with the frozen pin).
        exchange = fake_exchange_payload
        written = Granete::SketchUpExtension::Connection::ModelBinding::Binding.new(
          project_id: exchange['project']['id'],
          design_id: exchange['design']['id'],
          base_revision_id: exchange['pinned_base_revision_id'],
          schema_version: Granete::SketchUpExtension::Connection::ModelBinding::SCHEMA_VERSION
        )
        assert store.write!(written)

        stored = store.read
        assert_equal PROJECT_ID, stored.project_id
        assert_equal DESIGN_ID, stored.design_id
        # The exact pinned R1 — NOT the newer R2 working base.
        assert_equal REVISION_R1, stored.base_revision_id

        raw = model.get_attribute('com.granete.project', 'granete.project-binding.v1')
        payload = JSON.parse(raw)
        assert_equal %w[baseRevisionId designId projectId schemaVersion], payload.keys.sort
        # The pairing code never enters the model envelope.
        refute raw.include?(PAIRING_CODE)
        refute raw.include?(GRANT_ID)
      end

      # The readback confirmation gate: what the connector compares after
      # every pairing write must match the exact dictionary content.
      def test_readback_reflects_the_exact_dictionary_identity
        store = binding_store
        exchange = fake_exchange_payload
        written = Granete::SketchUpExtension::Connection::ModelBinding::Binding.new(
          project_id: exchange['project']['id'],
          design_id: exchange['design']['id'],
          base_revision_id: exchange['pinned_base_revision_id'],
          schema_version: Granete::SketchUpExtension::Connection::ModelBinding::SCHEMA_VERSION
        )
        store.write!(written)

        readback = store.read
        assert_equal written.project_id, readback.project_id
        assert_equal written.design_id, readback.design_id
        assert_equal written.base_revision_id.to_s, readback.base_revision_id.to_s
      end

      # An explicit null pin is not a request to adopt the latest working
      # base. The working-copy response may separately carry R2, but this
      # canonical binding must preserve the grant's exact null value.
      def test_pairing_exchange_preserves_an_explicit_null_pin
        store = binding_store
        exchange = fake_exchange_payload.merge('pinned_base_revision_id' => nil)
        written = Granete::SketchUpExtension::Connection::ModelBinding::Binding.new(
          project_id: exchange['project']['id'],
          design_id: exchange['design']['id'],
          base_revision_id: exchange['pinned_base_revision_id'],
          schema_version: Granete::SketchUpExtension::Connection::ModelBinding::SCHEMA_VERSION
        )
        store.write!(written)

        assert_nil store.read.base_revision_id
        payload = JSON.parse(model.get_attribute('com.granete.project', 'granete.project-binding.v1'))
        assert_nil payload['baseRevisionId']
        assert_equal REVISION_R2, exchange['working_copy']['base_revision_id']
      end

      # The code normalization the dialog input relies on: separators and
      # casing never decide match success on the host side either.
      def test_code_normalization_matches_backend_semantics
        service = Granete::SketchUpExtension::Connection::ModelBinding::Service
        assert_equal PAIRING_CODE, service.normalize_pairing_code(' abcd-234e fgh5 ')
        assert_equal '', service.normalize_pairing_code('···')
      end

      private

      def model
        Sketchup.active_model
      end

      def binding_store
        Granete::SketchUpExtension::Connection::ModelBinding::Store.new(model)
      end

      # Wire shape of POST /design-pairing-grants:exchange (200) — kept in
      # sync with the connector's Contract.pairing_exchange! parser, which
      # the unit suite validates against this exact structure.
      def fake_exchange_payload
        {
          'grant_id' => GRANT_ID,
          'action' => 'open_design',
          'pinned_base_revision_id' => REVISION_R1,
          'state' => 'valid',
          'schema_version' => 1,
          'organization' => { 'id' => '60000000-0000-0000-0000-000000000001', 'name' => 'Carpintería García' },
          'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina García' },
          'design' => { 'id' => DESIGN_ID, 'name' => 'Cocina Principal', 'status' => 'active' },
          'working_copy' => { 'base_revision_id' => REVISION_R2, 'base_revision_number' => 2,
                              'updated_at' => '2026-09-03T12:00:00Z' },
          'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
        }
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
