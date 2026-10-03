# frozen_string_literal: true

require 'graphql'
require 'gitlab/strong_memoize'

module Gitlab
  module Graphql
    module RequestClassification
      # Answers the two questions GraphqlController used to scatter across
      # skip_before_action lambdas: is this request mutating, and is the caller
      # session-authenticated?
      class RequestClassifier
        include Gitlab::StrongMemoize

        # Matches the historical operation-name label limit used in request logs.
        OPERATION_NAME_LIMIT = 64
        MAX_QUERY_SIZE = 10_000

        # Exact documents that may exceed MAX_QUERY_SIZE and are still classified
        # from their AST. The cached introspection document is intentionally padded
        # past the limit so the allowlist branch is observable.
        CACHED_INTROSPECTION = "query CachedIntrospection { __typename }\n# #{'x' * 10_000}\n"
        EXTENDED_ALLOWLIST = [CACHED_INTROSPECTION].freeze

        def self.failure_log
          @failure_log ||= []
        end

        def self.reset_failure_log!
          @failure_log = []
        end

        def initialize(params:, current_user:, sessionless:)
          @params = stringify_params(params)
          @current_user = current_user
          @sessionless_flag = sessionless == true
        end

        def mutating?
          analysis.fetch(:mutating)
        end

        def session_authenticated?
          return true if analysis.fetch(:parse_failed)

          !@current_user.nil? && !@sessionless_flag
        end

        def sessionless?
          return false if analysis.fetch(:parse_failed)

          @sessionless_flag
        end

        # Original lambda: current_user.nil? || sessionless_user? || !any_mutating_query?
        def skip_csrf?
          !session_authenticated? || !mutating?
        end

        def skip_two_factor?
          sessionless?
        end

        # Parsed operation list for AuthzGate. One entry per selected operation,
        # including every document in a multiplex _json batch.
        def operations
          analysis.fetch(:operations)
        end

        def parse_failed?
          analysis.fetch(:parse_failed)
        end

        def multiplex?
          @params['_json'].is_a?(Array)
        end

        def failed_operation
          analysis[:failed_operation].to_s
        end

        private

        def analysis
          strong_memoize(:@analysis) { classify }
        end

        def classify
          documents = operation_documents
          if documents.any? { |document| document[:over_limit] && !document[:allowlisted] }
            log_failure(documents, 'query exceeds MAX_QUERY_SIZE')
            return failed_closed(documents)
          end

          operations = []
          documents.each do |document|
            parsed = parse_document(document[:query])
            if parsed.nil?
              log_failure(documents, 'query failed to parse')
              return failed_closed(documents)
            end

            operations.concat(extract_operations(parsed, document[:operation_name], document[:query]))
          end

          { mutating: operations.any? { |operation| operation[:mutating] }, parse_failed: false, operations: operations }
        end

        def failed_closed(documents)
          name = documents.map { |document| document[:operation_name] }.compact.first
          { mutating: true, parse_failed: true, operations: [], failed_operation: name.to_s }
        end

        def extract_operations(document, operation_name, query)
          definitions = document.definitions.select { |definition| definition.is_a?(GraphQL::Language::Nodes::OperationDefinition) }
          if definitions.empty?
            return [unresolved_operation(operation_name)]
          end

          selected = if operation_name.nil? || operation_name.to_s.empty?
                       definitions
                     else
                       match = definitions.select { |operation| operation.name == operation_name }
                       return [unresolved_operation(operation_name)] if match.empty?

                       match
                     end

          selected.map { |operation| operation_entry(operation, query) }
        end

        def unresolved_operation(operation_name)
          {
            name: operation_name.to_s,
            operation_type: 'query',
            introspection: false,
            unresolved: true,
            selections: [],
            mutating: true
          }
        end

        def operation_entry(operation, query)
          {
            name: operation.name.to_s,
            operation_type: operation.operation_type,
            introspection: introspection?(operation, query),
            unresolved: false,
            selections: selections_for(operation),
            mutating: mutation_operation?(operation, query)
          }
        end

        def selections_for(operation)
          operation.selections.map do |selection|
            if selection.is_a?(GraphQL::Language::Nodes::Field)
              { name: selection.name.to_s, arguments: literal_arguments(selection), unsupported: false }
            else
              { name: nil, arguments: {}, unsupported: true }
            end
          end
        end

        def literal_arguments(selection)
          return {} unless selection.respond_to?(:arguments)

          selection.arguments.each_with_object({}) do |argument, acc|
            acc[argument.name.to_s] = literal_value(argument.value)
          end
        end

        def literal_value(value)
          case value
          when String, Integer, Float, TrueClass, FalseClass
            value.to_s
          when GraphQL::Language::Nodes::Enum
            value.name.to_s
          when NilClass, GraphQL::Language::Nodes::NullValue, GraphQL::Language::Nodes::VariableIdentifier
            nil
          else
            return nil unless value.respond_to?(:value)

            literal_value(value.value)
          end
        end

        def operation_documents
          batch = @params['_json']
          if batch
            unless batch.is_a?(Array)
              return [{ query: '', operation_name: nil, over_limit: true, allowlisted: false }]
            end

            return batch.map { |entry| document_from(entry) }
          end

          [document_from(@params)]
        end

        def document_from(entry)
          entry = stringify_params(entry)
          query = entry['query'].to_s
          {
            query: query,
            operation_name: entry['operationName'] || entry['operation_name'],
            over_limit: query.bytesize > MAX_QUERY_SIZE,
            allowlisted: EXTENDED_ALLOWLIST.include?(query)
          }
        end

        def parse_document(query)
          return nil if query.strip.empty?

          GraphQL.parse(query)
        rescue GraphQL::ParseError
          nil
        end

        def mutation_operation?(operation, query)
          return false if introspection?(operation, query)

          operation.operation_type == 'mutation'
        end

        def introspection?(operation, query)
          return false unless operation.operation_type == 'query'
          return true if operation.name == 'IntrospectionQuery'
          return true if query == CACHED_INTROSPECTION

          selections = operation.selections
          return false if selections.empty?

          selections.all? { |selection| selection.respond_to?(:name) && selection.name.to_s.start_with?('__') }
        end

        def log_failure(documents, reason)
          name = documents.map { |document| document[:operation_name] }.compact.first || 'unknown'
          self.class.failure_log << {
            'event' => 'graphql_request_classification_failed',
            'operation' => name.to_s.slice(0, OPERATION_NAME_LIMIT),
            'reason' => reason
          }
        end

        def stringify_params(value)
          return {} if value.nil?
          return value.transform_keys(&:to_s) if value.is_a?(Hash)

          {}
        end
      end
    end
  end
end
