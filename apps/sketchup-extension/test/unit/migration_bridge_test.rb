# frozen_string_literal: true

require 'stringio'
require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'
require_relative '../../src/granete_for_sketchup/ui/migration_review_controller'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'
require_relative '../../src/granete_for_sketchup/migration/scanner'
require_relative '../../src/granete_for_sketchup/migration/migrator'
require_relative '../support/legacy_model_builder'

# #416 — MigrationBridge wiring inside DialogController: the auto-offer on
# model open must appear only when the scan finds legacy furniture, never
# re-open while visible, stay quiet after a successful migration, and the
# migrate callback must return a JSON-safe report (plain hashes with reason —
# a ScannedEntity struct crossing the HtmlDialog bridge serializes as an
# opaque "#<struct …>" string and the UI loses the per-item reason).
class MigrationBridgeTest < Minitest::Test
  GOLDEN_PATH = File.expand_path('../../../../contracts/sketchupLayoutTransform.contract.json', __dir__)

  class StatusProvider
    def call
      { heading: 'Conectado', message: 'Listo', state: 'configured' }
    end
  end

  # Spy review surface: records offers and captures the migrate callback.
  class SpyReviewController
    attr_reader :offers
    attr_accessor :open

    def initialize
      @offers = []
      @open = false
    end

    def open?
      @open
    end

    def show_review(scan_result:, on_migrate: nil)
      @offers << { scan: scan_result, on_migrate: on_migrate }
      @open = true
      self
    end
  end

  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @review = SpyReviewController.new
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      migration_review_controller: @review
    )
    @definition = { 'furniture_definition_id' => 'kitchen-base-standard', 'name' => 'Bajo' }
  end

  def add_legacy(instance_ref)
    Granete::SketchUpExtension::LegacyModelBuilder.add_legacy_furniture(
      @model, @store, definition: @definition, instance_ref: instance_ref, parameters: {}
    )
  end

  def test_rebind_offers_review_only_when_legacy_furniture_is_present
    add_legacy('inst-bridge-1')

    @controller.rebind_model(@model)

    assert_equal 1, @review.offers.length
    scan = @review.offers.first[:scan]
    assert scan.any_legacy?
    assert_equal 1, scan.counts['ready']
  end

  def test_rebind_stays_quiet_on_models_without_legacy_entities
    @controller.rebind_model(@model)

    assert_empty @review.offers
  end

  def test_rebind_does_not_offer_while_the_review_is_already_open
    add_legacy('inst-bridge-2')
    @review.open = true

    @controller.rebind_model(@model)

    assert_empty @review.offers
  end

  def test_menu_entry_always_opens_the_review
    @controller.handle_migration_review

    assert_equal 1, @review.offers.length
    refute @review.offers.first[:scan].any_legacy?
  end

  # Regression (review round 1): every requiresReview entry crossing the
  # bridge must be a plain JSON-safe hash carrying its reason — the UI
  # renders missing identity from these fields (#397 hand-off).
  def test_migrate_callback_returns_json_safe_report_with_reasons
    add_legacy('inst-bridge-3')
    @controller.handle_migration_review
    on_migrate = @review.offers.last[:on_migrate]
    refute_nil on_migrate

    report = on_migrate.call

    # The static catalog provider cannot resolve layouts: the item is
    # honestly demoted with a reason, never a fake success.
    refute report['success']
    assert_equal 1, report['remainingLegacyCount']
    entry = report['requiresReview'].first
    assert_instance_of Hash, entry
    assert_equal 'resolve-unavailable', entry['reason']
    assert_equal 'inst-bridge-3', entry['instanceRef']

    json = JSON.generate(report)
    refute_includes json, '#<struct'
    refute_includes json, 'Sketchup::Group'
  end

  # AC8 at the bridge level: once the batch migrated (resolvable provider),
  # a fresh offer cycle finds nothing legacy and stays quiet. The offer runs
  # directly because rebind_model early-returns on the same model instance.
  def test_offer_stays_quiet_after_a_successful_migration
    layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(
      JSON.parse(File.read(GOLDEN_PATH))
    )
    provider = ResolvableCatalog.new(layout)
    controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      catalog_provider: provider,
      migration_review_controller: @review
    )

    add_legacy('inst-bridge-4')
    controller.handle_migration_review
    report = @review.offers.last[:on_migrate].call
    assert report['success'], report.inspect

    controller.send(:offer_migration_if_legacy, @model)
    assert_empty @review.offers.drop(1)
    refute Granete::SketchUpExtension::Migration::Scanner.new(metadata_store: @store)
                                                         .scan(@model).any_legacy?
  end

  # Minimal resolvable provider: find_definition + the golden #414 layout.
  class ResolvableCatalog
    def initialize(layout)
      @layout = layout
    end

    def find_definition(definition_id)
      { 'furniture_definition_id' => definition_id, 'name' => 'Bajo', 'revisionId' => 'rev-1' }
    end

    def resolved_native_layout(_definition_id, _parameters = {}, _choices = {})
      @layout
    end
  end
end
