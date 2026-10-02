# frozen_string_literal: true

module Gitlab
  module Graphql
    module Authorize
      # Class-level ability declaration used by mutations.
      # Mirrors the GitLab AuthorizeResource DSL: `authorize :read_issue, :update_issue`.
      module AuthorizeResource
        def self.included(klass)
          klass.extend(ClassMethods)
        end

        module ClassMethods
          def authorize(*abilities)
            self.required_abilities = abilities.flatten.compact.map(&:to_s)
          end

          def required_abilities
            @required_abilities || []
          end

          def required_abilities=(abilities)
            @required_abilities = abilities
          end

          def ee_only!
            @ee_only = true
          end

          def ee_only?
            @ee_only == true
          end
        end
      end
    end
  end
end
