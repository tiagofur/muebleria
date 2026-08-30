# frozen_string_literal: true

require 'json'

require_relative '../test_helper'

class OwnershipTest < Minitest::Test
  # Manufacturing-resolver vocabulary the plugin must never own. The
  # singular "part" is deliberately absent: since #476 it is the canonical
  # SELECTION kind of the authoring interaction contract
  # (kind = furniture|aggregate|part|hardware|unmanaged), not a BOM concept.
  # The plural "parts" and the resolved-parts family stay banned. `preflight`
  # is deliberately not banned: #477 makes its server-authored subset/link a
  # required wire response that Ruby validates but never computes.
  FORBIDDEN_RUNTIME_TERMS = %w[
    bom
    cutlist
    drilling
    joint
    kerf
    ladb
    nesting
    opencutlist
    parts
    postprocessing
    postprocessor
    release
    released
    releases
    releasing
    resolvedparts
    stale
    toolpath
  ].freeze
  FORBIDDEN_FIXTURE_KEYS = %w[
    bom
    drilling
    joints
    kerf
    machineProfile
    nesting
    parts
    postprocessor
    postprocessing
    productionRelease
    resolvedParts
    toolpath
  ].freeze
  ALLOWED_REQUIRES = %w[base64 digest extensions fileutils json net/http sketchup time uri].freeze
  # Matches require('x'), require "x", Kernel.require 'x', require_relative
  # 'x', gem 'x', and ::require 'x' — not just the plain single-line form.
  RUNTIME_DEPENDENCY_PATTERN = /
    ^\s*
    (?:::)?(?:Kernel\.)?
    (?:require(?:_relative)?|load|gem)
    \s*\(?\s*
    (?<quote>['"])(?<name>[^'"]+)\k<quote>
  /x

  def test_runtime_has_no_manufacturing_resolver_terms
    runtime_ruby_files.each do |path|
      source = File.read(path)
      FORBIDDEN_RUNTIME_TERMS.each do |term|
        pattern = /\b#{term}\b/i
        refute_match(pattern, source, "#{path} must not contain #{term}")
      end
    end
  end

  def test_runtime_requires_only_host_or_standard_library_code
    runtime_ruby_files.each do |path|
      requires = File.read(path).scan(RUNTIME_DEPENDENCY_PATTERN).map { |(_quote, name)| name }
      unexpected = requires.uniq - ALLOWED_REQUIRES
      assert_empty(unexpected, "Unexpected runtime dependency in #{path}")
    end
  end

  def test_fixture_is_explicitly_non_manufacturable_and_contains_only_intent
    fixture = JSON.parse(File.read(fixture_path))

    assert_equal true, fixture.fetch('nonManufacturable')
    assert_empty all_keys(fixture) & FORBIDDEN_FIXTURE_KEYS
  end

  private

  def all_keys(value)
    case value
    when Hash
      value.flat_map { |key, child| [key] + all_keys(child) }
    when Array
      value.flat_map { |child| all_keys(child) }
    else
      []
    end
  end

  def fixture_path
    File.join(PROJECT_ROOT, 'test', 'fixtures', 'non_manufacturable_metadata.json')
  end

  def runtime_ruby_files
    Dir.glob(File.join(PROJECT_ROOT, 'src', '**', '*.rb'))
  end
end
