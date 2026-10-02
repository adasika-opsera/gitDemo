# frozen_string_literal: true

module Mutations
  module Issues
    class CloseIssue < BaseMutation
      graphql_name 'CloseIssue'
      description 'Deprecated close mutation that remains in the schema'
      authorize :update_issue

      argument :iid, GraphQL::Types::ID, required: true

      field :issue, Types::IssueType, null: true

      def resolve(iid:)
        { issue: { 'iid' => iid } }
      end
    end
  end
end
