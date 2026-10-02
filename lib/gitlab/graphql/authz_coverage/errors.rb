# frozen_string_literal: true

module Gitlab
  module Graphql
    module AuthzCoverage
      class Error < StandardError; end
      class MissingSchemaDumpError < Error; end
      class SchemaDumpMismatchError < Error; end
      class TraversalError < Error; end
      class SchemaValidationError < Error; end
    end
  end
end
