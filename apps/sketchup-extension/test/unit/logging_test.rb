# frozen_string_literal: true

require 'json'
require 'stringio'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'

class LoggingTest < Minitest::Test
  def test_redacts_tokens_private_paths_and_customer_data
    sink = StringIO.new
    logger = Granete::SketchUpExtension::SafeLogger.new(sink: sink)
    customer = 'Cliente Privado SA'
    error = RuntimeError.new(
      "Bearer secret.token/value failed at /Users/private/Clientes/#{customer}/project.skp"
    )

    logger.error('request_failed', customer_name: customer, email: 'owner@example.test',
                                   error: error)
    output = sink.string

    refute_includes output, 'secret.token/value'
    refute_includes output, '/Users/private'
    refute_includes output, customer
    refute_includes output, 'owner@example.test'
    assert_includes output, '[REDACTED]'
    assert_includes output, '[PRIVATE_PATH]'
    assert_equal 'request_failed', JSON.parse(output).fetch('event')

    windows_error = RuntimeError.new('Failed at C:\\Users\\private\\Clients\\fixture.skp')
    windows_output = JSON.generate(Granete::SketchUpExtension::LogRedactor.call(windows_error))

    refute_includes windows_output, 'C:\\Users\\private'
    assert_includes windows_output, '[PRIVATE_PATH]'
  end

  def test_redacts_posix_volumes_windows_drives_and_unc_shares_including_spaces
    leaks = [
      'Failed at /Volumes/Private Client/model.skp',
      'Failed at D:\\Projects\\Private Client\\model.skp',
      'Failed at \\\\server\\Private Client\\model.skp'
    ]

    leaks.each do |message|
      output = JSON.generate(
        Granete::SketchUpExtension::LogRedactor.call(RuntimeError.new(message))
      )

      refute_includes output, 'Private Client'
      refute_includes output, 'model.skp'
      assert_includes output, '[PRIVATE_PATH]', "expected path redaction for: #{message}"
    end
  end

  def test_does_not_shred_unrelated_text_when_a_sensitive_value_is_short
    output = JSON.generate(
      Granete::SketchUpExtension::LogRedactor.call(
        level: 'error',
        event: 'safe_status',
        context: { customer_name: 'a', note: 'safe status and catalog' }
      )
    )

    # The sensitive key still redacts its own value unconditionally…
    refute_includes JSON.parse(output).fetch('context').fetch('customer_name'), 'a'
    # …but a one-character value must not be substituted across other strings.
    assert_includes output, 'safe status and catalog'
  end

  def test_redacts_urls_that_carry_authorization_material
    output = JSON.generate(
      Granete::SketchUpExtension::LogRedactor.call(
        'GET https://user:secret@example.test/v1 failed'
      )
    )
    refute_includes output, 'user:secret'
    refute_includes output, 'example.test/v1'

    query = JSON.generate(
      Granete::SketchUpExtension::LogRedactor.call(
        'GET https://example.test/v1?token=abc123&x=1 failed'
      )
    )
    refute_includes query, 'abc123'
    assert_includes query, 'example.test/v1'
  end

  # #460 SEC-3: signed media grant URLs carry a (short-lived) credential in
  # the query string; the raw grant must never survive the redaction boundary.
  def test_redacts_media_grant_query_credentials
    grant = 'eyJhbGciOiJIUzI1NiJ9.payload.signature'
    output = JSON.generate(
      Granete::SketchUpExtension::LogRedactor.call(
        "GET https://taller.local/api/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png?grant=#{grant} failed"
      )
    )
    refute_includes output, grant
    assert_includes output, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'
  end

  def test_leaves_relative_words_and_plain_urls_alone
    message = 'safe status and catalog see https://example.test/docs'
    output = JSON.generate(Granete::SketchUpExtension::LogRedactor.call(message))

    assert_includes output, 'safe status and catalog'
    assert_includes output, 'https://example.test/docs'
    refute_includes output, '[PRIVATE_PATH]'
  end

  def test_substituted_values_match_literally_not_as_patterns
    output = JSON.generate(
      Granete::SketchUpExtension::LogRedactor.call(
        level: 'error',
        event: 'request_failed',
        context: { customer_name: 'x.y client', note: 'kept xzy and x.y client' }
      )
    )

    refute_includes output, 'x.y client'
    assert_includes output, 'kept xzy'
  end
end
