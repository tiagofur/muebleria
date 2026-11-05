# frozen_string_literal: true

require 'test_helper'
require 'json'
require 'granete_for_sketchup/library/catalog_provider'
require 'granete_for_sketchup/library/authoring_resolve_contract'

# Paridad de la whitelist Ruby contra el enum cerrado del contrato de
# authoring resolve (#1501 review B2). El schema JSON de contracts/ es la
# única fuente: la lista TS se aserte contra él en domain, y esta prueba
# clava la Ruby — el drift que hizo que el plugin dijera "Issue de resolve
# sin código estable conocido" en vez del diagnóstico real no puede volver.
class AuthoringIssueCodesParityTest < Minitest::Test
  SCHEMA_PATH = File.expand_path('../../../../contracts/sketchupAuthoringResolve.schema.json', __dir__)

  def test_issue_codes_set_equal_schema_enum
    schema = JSON.parse(File.read(SCHEMA_PATH))
    enum = schema.fetch('$defs').fetch('issue').fetch('properties').fetch('code').fetch('enum').sort
    ruby = Granete::SketchUpExtension::Library::AuthoringIssueParsing::ISSUE_CODES.map(&:to_s).sort

    assert_equal enum, ruby, 'ISSUE_CODES debe ser set-igual al enum del schema (solo-Ruby: '\
                              "#{(ruby - enum).inspect}; solo-schema: #{(enum - ruby).inspect})"
  end

  def test_whitelist_tokens_are_pure_upper_snake
    Granete::SketchUpExtension::Library::AuthoringIssueParsing::ISSUE_CODES.each do |code|
      assert_match(/\A[A-Z][A-Z0-9_]*\z/, code.to_s,
                   "la whitelist %w[] debe contener solo códigos (token basura: #{code.inspect} — " \
                   'los comentarios van FUERA del arreglo)')
    end
  end

  def test_member_host_codes_registered
    %w[MEMBER_HOST_PLACEMENT_MISSING MEMBER_HOST_PROFILE_REQUIRED
       MEMBER_HOST_BASIS_UNSUPPORTED].each do |code|
      assert Inclusion.issued?(Granete::SketchUpExtension::Library::AuthoringIssueParsing::ISSUE_CODES, code),
             "falta el código #{code} en la whitelist Ruby"
    end
  end

  # Módulo mínimo para el helper de pertenencia sin depender de detalles internos.
  module Inclusion
    def self.issued?(list, code)
      list.map(&:to_s).include?(code)
    end
  end
end
