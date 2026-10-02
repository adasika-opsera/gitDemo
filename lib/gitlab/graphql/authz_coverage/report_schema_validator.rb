# frozen_string_literal: true

require 'json'
require 'json_schemer'
require 'gitlab/graphql/authz_coverage/errors'

module Gitlab
  module Graphql
    module AuthzCoverage
      class ReportSchemaValidator
        def initialize(schema_path:)
          @schema = JSON.parse(File.read(schema_path))
          @schemer = JSONSchemer.schema(@schema)
        end

        def validate!(report)
          raise SchemaValidationError, 'authz coverage report must be a JSON object' unless report.is_a?(Hash)

          errors = @schemer.validate(report).to_a
          return report if errors.empty?

          messages = errors.map do |error|
            pointer = error['data_pointer']
            detail = error['error'] || error['type']
            "#{pointer.nil? || pointer.empty? ? '(root)' : pointer}: #{detail}"
          end

          raise SchemaValidationError, "authz coverage report failed schema validation:\n#{messages.join("\n")}"
        end
      end
    end
  end
end
