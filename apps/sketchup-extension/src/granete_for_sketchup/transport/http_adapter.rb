# frozen_string_literal: true

require 'json'
# The SketchUp OpenSSL performance cop is disabled inline below: workshop
# connectivity is the product requirement, the only supported host today is
# SketchUp 2026.2 on macOS, and plain-HTTP local servers are unaffected.
require 'net/http' # rubocop:disable SketchupPerformance/OpenSSL
require 'uri'

module Granete
  module SketchUpExtension
    module Transport
      # Network errors are wrapped so callers never see raw socket exceptions.
      class RequestError < StandardError; end

      # Minimal JSON-over-HTTPS adapter for the Granete API. Implements the
      # Transport::Adapter port: request payloads are
      # { 'method' => 'GET'|'POST', 'path' => '/api/...', 'body' => <hash|nil> }
      # and responses are { 'status' => <integer>, 'body' => <parsed JSON> }.
      # Certificate verification stays ON; redirects are not followed.
      class HttpAdapter < Adapter
        DEFAULT_TIMEOUT_SECONDS = 15

        attr_reader :base_url

        def initialize(base_url: nil, logger: nil, timeout_seconds: DEFAULT_TIMEOUT_SECONDS)
          super()
          @base_url = normalize_base_url(base_url)
          @logger = logger
          @timeout_seconds = timeout_seconds
        end

        def configured?
          !@base_url.nil?
        end

        def base_url=(value)
          @base_url = normalize_base_url(value)
        end

        def request(payload, authorization_header: nil)
          raise NotConfiguredError, 'Transport is not configured' unless configured?

          uri = build_uri(payload.fetch('path'))
          http = build_http(uri)
          request = build_request(uri, payload, authorization_header)

          response = perform(http, request)
          {
            'status' => response.code.to_i,
            'body' => parse_body(response)
          }
        rescue NotConfiguredError
          raise
        rescue StandardError => e
          @logger&.error('transport_request_failed', error: e)
          raise RequestError, "No se pudo conectar con el servidor de Granete: #{e.message}"
        end

        private

        def normalize_base_url(value)
          return nil if value.nil? || value.strip.empty?

          trimmed = value.strip
          trimmed = "https://#{trimmed}" unless trimmed.start_with?('http://', 'https://')
          trimmed = "#{trimmed}/api" unless trimmed.end_with?('/api')
          uri = URI.parse(trimmed)
          return nil unless uri.is_a?(URI::HTTP) && !uri.host.nil?

          trimmed.sub(%r{/\z}, '')
        rescue URI::InvalidURIError
          nil
        end

        def build_uri(path)
          joined = path.start_with?('/') ? path : "/#{path}"
          URI.parse("#{@base_url}#{joined}")
        end

        def build_http(uri)
          http = Net::HTTP.new(uri.host, uri.port)
          http.use_ssl = uri.is_a?(URI::HTTPS)
          http.open_timeout = @timeout_seconds
          http.read_timeout = @timeout_seconds
          http
        end

        def build_request(uri, payload, authorization_header)
          method = (payload['method'] || 'GET').upcase
          request = Net::HTTP.const_get(method.capitalize).new(uri.request_uri)
          request['Accept'] = 'application/json'
          request['Authorization'] = authorization_header if authorization_header
          if payload['body']
            request['Content-Type'] = 'application/json'
            request.body = JSON.generate(payload['body'])
          end
          request
        end

        def perform(http, request)
          http.request(request)
        end

        def parse_body(response)
          raw = response.body.to_s
          return '' if raw.empty?

          JSON.parse(raw)
        rescue JSON::ParserError
          raw
        end
      end
    end
  end
end
