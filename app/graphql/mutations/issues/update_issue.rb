# frozen_string_literal: true

module Mutations
  module Issues
    class UpdateIssue < BaseMutation
      graphql_name 'UpdateIssue'
      description 'Update an issue'
      authorize :read_issue, :update_issue

      argument :iid, GraphQL::Types::ID, required: true
      argument :title, GraphQL::Types::String, required: false

      field :issue, Types::IssueType, null: true

      def resolve(iid:, title: nil)
        { issue: { 'iid' => iid, 'title' => title } }
      end
    end
  end
end
