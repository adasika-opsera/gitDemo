# frozen_string_literal: true

module Gitlab
  module Graphql
    module Authz
      # Single switch for the gate. Anything other than report_only enforces,
      # so an unknown value fails closed. Rollback is setting this back to
      # report_only.
      module Mode
        ENV_KEY = 'GITLAB_GRAPHQL_AUTHZ_MODE'

        def self.current
          ENV[ENV_KEY].to_s == 'report_only' ? 'report_only' : 'enforce'
        end

        def self.enforce?
          current == 'enforce'
        end

        def self.report_only?
          current == 'report_only'
        end
      end
    end
  end
end
