# frozen_string_literal: true

module Types
  class QueryType < BaseObject
    graphql_name 'Query'

    field :echo, GraphQL::Types::String, null: true, public: true,
      public_reason: 'Public probe that returns no project data.',
      description: 'Public probe field'
  end
end
