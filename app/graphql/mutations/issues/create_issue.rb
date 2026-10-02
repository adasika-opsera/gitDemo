# frozen_string_literal: true

module Mutations
  module Issues
    class CreateIssue < BaseMutation
      graphql_name 'CreateIssue'
      description 'Create an issue'
      authorize :create_issue

      argument :title, GraphQL::Types::String, required: true

      field :issue, Types::IssueType, null: true

      def resolve(title:)
        { issue: { 'title' => title } }
      end
    end
  end
end
