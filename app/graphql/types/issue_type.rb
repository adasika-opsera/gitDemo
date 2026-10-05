# frozen_string_literal: true

module Types
  class IssueType < BaseObject
    graphql_name 'Issue'
    description 'Representative issue object used to inventory field authorization'

    field :iid, GraphQL::Types::ID, null: false, authorize: :read_issue, description: 'Issue identifier'
    field :title, GraphQL::Types::String, null: true, public: true,
      public_reason: 'Issue titles are visible without an ability check.',
      description: 'Public issue title'
    # No field-level check exists. read_issue is the ability already required
    # to read the parent issue, so that is the declaration.
    field :confidential_note, GraphQL::Types::String, null: true, authorize: :read_issue,
      description: 'Non-public note on the issue'
    field :webhook_secret_token, GraphQL::Types::String, null: true, description: 'Credential-shaped field excluded from the inventory'
  end
end
