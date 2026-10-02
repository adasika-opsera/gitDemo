# frozen_string_literal: true

module Mutations
  module Ee
    module AuditEvents
      class ExportAuditEvents < BaseMutation
        graphql_name 'ExportAuditEvents'
        description 'EE-only audit export'
        ee_only!
        authorize :admin_audit_events

        field :exported, GraphQL::Types::Boolean, null: true

        def resolve
          { exported: true }
        end
      end
    end
  end
end
