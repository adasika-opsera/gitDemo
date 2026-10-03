# frozen_string_literal: true

require 'gitlab/strong_memoize'

module Gitlab
  module Graphql
    module Authz
      # Per-request ability check. Declarations stay on AuthorizeResource;
      # this only answers whether the current user holds them for a subject.
      # Decisions are memoized on the instance, so they die with the request.
      class Ability
        include Gitlab::StrongMemoize

        class << self
          def resolution_count
            @resolution_count ||= 0
          end

          def note_resolution!
            @resolution_count = resolution_count + 1
          end

          def reset_resolution_count!
            @resolution_count = 0
          end
        end

        def initialize(user:)
          @user = user
        end

        def allowed?(ability, subject)
          policy_for(subject).include?(ability.to_s)
        end

        private

        def policy_for(subject)
          strong_memoize(:"@policy_#{memo_key(subject)}") do
            self.class.note_resolution!
            Array(raw_abilities(subject)).map(&:to_s)
          end
        end

        def raw_abilities(subject)
          return [] if @user.nil?
          return @user.abilities_for(subject) if @user.respond_to?(:abilities_for)

          @user.respond_to?(:abilities) ? @user.abilities : []
        end

        def memo_key(subject)
          subject.to_s.gsub(/[^a-zA-Z0-9_]/, '_')
        end
      end
    end
  end
end
