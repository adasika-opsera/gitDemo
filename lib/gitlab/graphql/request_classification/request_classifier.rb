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

        private

        def analysis
          strong_memoize(:@analysis) { classify }
        end

        def classify
          documents = operation_documents
          if documents.any? { |document| document[:over_limit] && !document[:allowlisted] }
            log_failure(documents, 'query exceeds MAX_QUERY_SIZE')
            return failed_closed
          end

          mutating = false
          documents.each do |document|
            parsed = parse_document(document[:query])
            if parsed.nil?
              log_failure(documents, 'query failed to parse')
              return failed_closed
            end

            mutating = true if mutating_document?(parsed, document[:operation_name], document[:query])
          end

          { mutating: mutating, parse_failed: false }
        end

        def failed_closed
          { mutating: true, parse_failed: true }
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

        def mutating_document?(document, operation_name, query)
          operations = document.definitions.select { |definition| definition.is_a?(GraphQL::Language::Nodes::OperationDefinition) }
          return true if operations.empty?

          selected = if operation_name.nil? || operation_name.to_s.empty?
                       operations
                     else
                       match = operations.select { |operation| operation.name == operation_name }
                       return true if match.empty?

                       match
                     end

          selected.any? { |operation| mutation_operation?(operation, query) }
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
