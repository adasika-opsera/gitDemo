# frozen_string_literal: true

module Types
  class MutationType < BaseObject
    graphql_name 'Mutation'

    field :create_issue, mutation: Mutations::Issues::CreateIssue
    field :update_issue, mutation: Mutations::Issues::UpdateIssue
    field :destroy_issue, mutation: Mutations::Issues::DestroyIssue
    field :close_issue, mutation: Mutations::Issues::CloseIssue, deprecation_reason: 'Use updateIssue'
    field :export_audit_events, mutation: Mutations::Ee::AuditEvents::ExportAuditEvents
  end
end
