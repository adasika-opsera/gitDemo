# frozen_string_literal: true

class GitlabSchema < GraphQL::Schema
  query Types::QueryType
  mutation Types::MutationType
end
