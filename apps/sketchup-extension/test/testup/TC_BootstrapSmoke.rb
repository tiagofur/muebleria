# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# Host smoke for the INSTALLED Granete for SketchUp extension. This suite must
# never load the repository checkout: the product under test is the installed
# RBZ. Every test fails closed unless the extension is already installed,
# enabled and loaded at the expected version from the Plugins directory.
module Granete
  module SketchUpExtension
    class TC_BootstrapSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      EXPECTED_VERSION = '0.1.0'
      EXPECTED_LOADER = 'granete_for_sketchup.rb'
      FIXTURE_PATH = File.join(
        File.expand_path('../..', __dir__),
        'test',
        'fixtures',
        'non_manufacturable_metadata.json'
      ).freeze
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
      end

      def test_installed_extension_is_registered_enabled_and_current
        extension = self.class.installed_extension

        refute_nil extension
        assert extension.loaded?
        assert_equal EXPECTED_VERSION, extension.version
        assert_equal EXPECTED_VERSION, Granete::SketchUpExtension::EXTENSION_VERSION
      end

      def test_host_floor_and_runtime_are_available
        assert_operator Sketchup.version.to_i, :>=, 24
        assert_equal %w[3 2], RUBY_VERSION.split('.').first(2)
        assert_operator UI::HtmlDialog::CEF_VERSION, :>=, 112
        assert_operator Gem::Version.new(Minitest::VERSION), :>=, Gem::Version.new('5.15.0')
        assert_operator Gem::Version.new(Minitest::VERSION), :<, Gem::Version.new('6.0.0')
        assert_same Runtime.start, Runtime.start
      end

      def test_host_observer_is_registered_while_extension_runs
        Runtime.start

        observer = Runtime.host_observer
        refute_nil observer
        assert_equal EXPECTED_NAME, observer.extension_name

        observer.onUnloadExtension(EXPECTED_NAME)
        assert_nil Runtime.host_observer
      end

      def test_default_ports_fail_closed
        application = Application.new(logger: quiet_logger)

        refute application.auth_provider.configured?
        refute application.transport.configured?
        assert_raises(Auth::NotConfiguredError) { application.auth_provider.authorization_header }
        assert_raises(Transport::NotConfiguredError) do
          application.transport.request({}, authorization_header: 'Bearer fixture')
        end
      end

      def test_local_dialog_can_open_close_and_open_again
        application = Application.new(logger: quiet_logger)

        first = application.open_dialog
        assert_instance_of UI::HtmlDialog, first
        application.close_dialog
        second = application.open_dialog
        assert_instance_of UI::HtmlDialog, second
        application.close_dialog
      end

      def test_non_manufacturable_metadata_round_trips_in_model
        model = Sketchup.active_model
        entity = create_fixture_group(model)
        fixture = JSON.parse(File.read(FIXTURE_PATH))
        store = Metadata::Store.new(model)

        assert_equal fixture, store.write(entity, fixture)
        assert_equal fixture, store.read(entity)
      ensure
        remove_fixture_group(model, entity)
      end

      def test_logging_redacts_sensitive_values
        sink = StringIO.new
        logger = SafeLogger.new(sink: sink)
        logger.error(
          'smoke_failure',
          customer_name: 'Fixture Client',
          error: RuntimeError.new('Bearer fixture.token at /Users/private/model.skp')
        )

        refute_includes sink.string, 'Fixture Client'
        refute_includes sink.string, 'fixture.token'
        refute_includes sink.string, '/Users/private'
      end

      private

      def fail_closed_unless_installed_extension_is_loaded
        extension = self.class.installed_extension
        flunk 'Install the Granete for SketchUp RBZ before running the host smoke' unless extension
        unless extension.loaded?
          flunk 'Enable the installed extension and restart SketchUp before the host smoke'
        end
        return if extension.version == EXPECTED_VERSION

        flunk "Installed version #{extension.version} does not match expected #{EXPECTED_VERSION}"
      end

      def fail_closed_if_loaded_from_checkout
        support_file = Sketchup.find_support_file(EXPECTED_LOADER)
        if support_file.nil?
          flunk "#{EXPECTED_LOADER} is not installed in the SketchUp Plugins directory"
        end
        return unless File.expand_path(support_file).start_with?(REPOSITORY_ROOT + File::SEPARATOR)

        flunk 'Host smoke must test the installed RBZ, not the repository checkout'
      end

      def create_fixture_group(model)
        model.start_operation('Granete Smoke Setup', true)
        group = model.active_entities.add_group
        model.commit_operation
        group
      rescue StandardError
        model.abort_operation
        raise
      end

      def remove_fixture_group(model, entity)
        return if model.nil? || entity.nil? || !entity.valid?

        model.start_operation('Granete Smoke Cleanup', true)
        entity.erase!
        model.commit_operation
      rescue StandardError
        model.abort_operation
        raise
      end

      def quiet_logger
        SafeLogger.new(sink: StringIO.new)
      end
    end
  end
end
