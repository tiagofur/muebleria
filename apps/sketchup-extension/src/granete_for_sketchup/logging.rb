# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module LogRedactor
      REDACTED = '[REDACTED]'
      PRIVATE_PATH = '[PRIVATE_PATH]'
      # Free-text substitution of collected values below this length shreds
      # unrelated messages (a customer named "a" redacting every "a"). Sensitive
      # keys still redact their own value unconditionally regardless of length.
      MIN_SUBSTITUTABLE_LENGTH = 4
      SENSITIVE_KEY = /
        (?:authorization|token|secret|password|customer|client_(?:name|data)|
        email|phone|address|payload|path)
      /ix
      BEARER_TOKEN = %r{\bBearer\s+[A-Za-z0-9._~+/=-]+}i
      EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
      # Whole URLs that embed userinfo, before path rules can split them.
      URL_WITH_CREDENTIALS = %r{\b[a-z][a-z0-9+.-]*://[^\s/'"@]+@[^\s"']+}i
      # Credentials carried in query strings, e.g. ?token=abc&api_key=xyz.
      # `grant` covers #460 SEC-3 signed media URLs: the raw grant is a
      # (short-lived) credential and must never reach the logs.
      QUERY_CREDENTIALS = /
        ([?&](?:access_?token|api_?key|token|grant|secret|password)=)[^\s&'"]+
      /ix
      # Absolute POSIX paths (/Volumes/…, /Users/…), Windows drive roots
      # (D:\Projects\…), and UNC shares (\\server\share\…) — including spaces
      # inside the path, up to the next token without a path separator.
      ABSOLUTE_PATH = %r{
        (?<boundary>\A|\s)
        (?<path>
          (?:/[^\s/\\][^\s]*|[A-Za-z]:\\[^\s]*|\\\\[^\s]*)
          (?:\s+[^\s]*[/\\][^\s]*)*
        )
      }x

      module_function

      def call(value)
        sensitive_values = collect_sensitive_values(value)
        sanitize(value, sensitive_values)
      end

      def collect_sensitive_values(value, key = nil, result = [])
        return collect_sensitive_string(value, result) if sensitive_key?(key)

        case value
        when Hash
          value.each { |child_key, child| collect_sensitive_values(child, child_key.to_s, result) }
        when Array
          value.each { |child| collect_sensitive_values(child, nil, result) }
        end
        result
      end

      def collect_sensitive_string(value, result)
        substitutable = value.is_a?(String) && value.length >= MIN_SUBSTITUTABLE_LENGTH
        result << value if substitutable
        result
      end

      def sanitize(value, sensitive_values, key = nil)
        return REDACTED if sensitive_key?(key)

        sanitize_value(value, sensitive_values)
      end

      def sanitize_value(value, sensitive_values)
        case value
        when Hash
          value.to_h do |child_key, child|
            [child_key, sanitize(child, sensitive_values, child_key.to_s)]
          end
        when Array
          value.map { |child| sanitize(child, sensitive_values) }
        when Exception
          { error_class: value.class.name,
            message: sanitize_string(value.message, sensitive_values) }
        when String
          sanitize_string(value, sensitive_values)
        else
          value
        end
      end

      def sanitize_string(value, sensitive_values)
        sanitized = value.gsub(BEARER_TOKEN, "Bearer #{REDACTED}")
        sanitized = sanitized.gsub(URL_WITH_CREDENTIALS, REDACTED)
        sanitized = sanitized.gsub(QUERY_CREDENTIALS, "\\1#{REDACTED}")
        sanitized = sanitized.gsub(ABSOLUTE_PATH, "\\k<boundary>#{PRIVATE_PATH}")
        sanitized = sanitized.gsub(EMAIL, REDACTED)
        sensitive_values.reduce(sanitized) do |current, sensitive|
          current.gsub(sensitive, REDACTED)
        end
      end

      def sensitive_key?(key)
        !key.nil? && SENSITIVE_KEY.match?(key)
      end
    end

    class SafeLogger
      def initialize(sink: $stdout)
        @sink = sink
      end

      def info(event, context = {})
        write('info', event, context)
      end

      def error(event, context = {})
        write('error', event, context)
      end

      private

      def write(level, event, context)
        payload = LogRedactor.call(level: level, event: event, context: context)
        emit("#{JSON.generate(payload)}\n")
      end

      # Sketchup::Console declares #puts private and TestUp swaps $stdout
      # around each test, so identity checks are unreliable: write when the
      # sink supports it, fall back to Kernel#puts (C-level, reaches the
      # console through the current $stdout) otherwise.
      def emit(line)
        @sink.write(line)
      rescue NoMethodError, IOError
        Kernel.puts(line)
      end
    end
  end
end
