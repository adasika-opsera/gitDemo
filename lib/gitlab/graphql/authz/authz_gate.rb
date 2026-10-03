# frozen_string_literal: true

require 'gitlab/strong_memoize'
require 'gitlab/graphql/authz/ability'
require 'gitlab/graphql/authz/declaration_lookup'
require 'gitlab/graphql/authz/mode'
require 'gitlab/graphql/request_classification/request_classifier'

module Gitlab
  module Graphql
    module Authz
      # Per-operation authorization on the GraphQL execute path.
      # Report-only logs the decision and leaves the response alone.
      # Enforce denies undeclared operations and fails closed on internal errors.
      class AuthzGate
        include Gitlab::StrongMemoize

        Decision = Struct.new(:name, :abilities, :outcome, :reason, :mode, :status_code, keyword_init: true) do
          def denied?
            outcome == 'deny'
          end

          def allowed?
            !denied?
          end
        end

        Result = Struct.new(:entries, :multiplex, :parse_failed, keyword_init: true) do
          def halt_request?
            return false if multiplex && !parse_failed

            parse_failed || entries.any?(&:denied?)
          end

          def http_status
            return 403 if parse_failed

            entries.find(&:denied?)&.status_code || 403
          end
        end

        class << self
          def decision_log
            @decision_log ||= []
          end

          def reset_decision_log!
            @decision_log = []
          end
        end

        def initialize(classifier:, current_user:, subjects: {})
          @classifier = classifier
          @current_user = current_user
          @subjects = stringify_subjects(subjects)
          @ability = Ability.new(user: current_user)
          @declarations = DeclarationLookup.new
        end

        def call
          strong_memoize(:@result) do
            evaluate
          rescue StandardError
            failed_closed('internal_error')
          end
        end

        private

        def evaluate
          if @classifier.parse_failed?
            return failed_closed('parse_failed', @classifier.failed_operation)
          end

          entries = @classifier.operations.map { |operation| decide_operation(operation) }
          Result.new(entries: entries, multiplex: @classifier.multiplex?, parse_failed: false)
        end

        def decide_operation(operation)
          decision = if operation[:introspection]
                       allow(operation, [], 'introspection')
                     elsif operation[:unresolved] || operation[:selections].empty? || operation[:selections].any? { |selection| selection[:unsupported] }
                       deny(operation, [], 'unresolved_operation', denial_status)
                     else
                       combine(operation[:selections].map { |selection| decide_selection(operation, selection) })
                     end
          log(decision)
          decision
        rescue StandardError
          decision = deny(operation, [], 'internal_error', 403)
          log(decision)
          decision
        end

        def decide_selection(operation, selection)
          declaration = @declarations.for_selection(operation[:operation_type], selection[:name])
          case declaration[:kind]
          when :introspection, :public
            allow(operation, [], declaration[:kind].to_s)
          when :undeclared
            deny(operation, [], 'undeclared', denial_status)
          else
            decide_declared(operation, selection, declaration)
          end
        end

        def decide_declared(operation, selection, declaration)
          state, subject = resolve_subject(declaration, selection[:arguments])
          if state == :missing
            return deny(operation, declaration[:abilities], 'unresolvable_subject', denial_status)
          end
          return deny(operation, declaration[:abilities], 'unauthenticated', 401) if @current_user.nil?

          if declaration[:abilities].all? { |ability| @ability.allowed?(ability, subject) }
            allow(operation, declaration[:abilities], 'declared')
          else
            deny(operation, declaration[:abilities], 'forbidden', 403)
          end
        end

        def resolve_subject(declaration, arguments)
          return [:ok, :global] unless declaration[:expects_subject]

          iid = arguments['iid']
          return [:missing, nil] if iid.nil? || iid.to_s.empty?

          found = @subjects[iid.to_s]
          return [:missing, nil] if found.nil?

          [:ok, found]
        end

        def combine(decisions)
          denied = decisions.select(&:denied?)
          return decisions.first if denied.empty?

          denied.max_by { |decision| decision.status_code.to_i }
        end

        def allow(operation, abilities, reason)
          Decision.new(
            name: label(operation),
            abilities: abilities,
            outcome: 'allow',
            reason: reason,
            mode: Mode.current,
            status_code: 200
          )
        end

        def deny(operation, abilities, reason, status_code)
          Decision.new(
            name: label(operation),
            abilities: abilities,
            outcome: 'deny',
            reason: reason,
            mode: Mode.current,
            status_code: status_code
          )
        end

        def failed_closed(reason, operation_name = nil)
          decision = Decision.new(
            name: operation_name.to_s.slice(0, RequestClassification::RequestClassifier::OPERATION_NAME_LIMIT),
            abilities: [],
            outcome: 'deny',
            reason: reason,
            mode: Mode.current,
            status_code: 403
          )
          log(decision)
          Result.new(entries: [decision], multiplex: false, parse_failed: true)
        end

        def denial_status
          @current_user.nil? ? 401 : 403
        end

        def label(operation)
          source = operation[:name].to_s
          source = operation[:selections].map { |selection| selection[:name] }.compact.first.to_s if source.empty?
          source.slice(0, RequestClassification::RequestClassifier::OPERATION_NAME_LIMIT)
        end

        def log(decision)
          self.class.decision_log << {
            'event' => 'graphql_authz_decision',
            'operation' => decision.name.to_s,
            'abilities' => decision.abilities,
            'outcome' => decision.outcome,
            'mode' => decision.mode,
            'reason' => decision.reason
          }
        end

        def stringify_subjects(subjects)
          return {} unless subjects.is_a?(Hash)

          subjects.each_with_object({}) do |(key, value), acc|
            acc[key.to_s] = value
          end
        end
      end
    end
  end
end
