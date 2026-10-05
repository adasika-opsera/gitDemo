# frozen_string_literal: true

module RuboCop
  module Cop
    module Graphql
      # Requires every mutation class to declare an ability with `authorize`.
      class AuthorizeMutation < Base
        MSG = 'Mutation `%<class_name>s` lacks an authorize declaration. ' \
              'Add `authorize :ability_name` in the class body.'

        class << self
          def registry
            @registry ||= {}
          end

          def reset_registry!
            @registry = {}
          end
        end

        def on_class(node)
          name = class_name(node)
          declared = declaration?(node)
          remember(name, declared)
          return unless mutation_class?(node, name)
          return if declared

          add_offense(node, message: format(MSG, class_name: name))
        end

        private

        def declaration?(node)
          own_authorize?(node) || inherited_authorize?(node)
        end

        def own_authorize?(node)
          body = node.body
          return false if body.nil?

          statements(body).any? { |statement| authorize_call?(statement) }
        end

        def inherited_authorize?(node)
          parent_name = const_name(node.parent_class)
          return false if parent_name.nil? || base_mutation?(parent_name)

          parent_node = class_index[parent_name]
          if parent_node
            return own_authorize?(parent_node) || inherited_authorize?(parent_node)
          end

          self.class.registry[parent_name] == true
        end

        def mutation_class?(node, name)
          return false if name.nil? || base_mutation?(name)

          parent_name = const_name(node.parent_class)
          return false if parent_name.nil?

          parent_name.end_with?('Mutation')
        end

        def authorize_call?(statement)
          statement.send_type? && statement.method?(:authorize) && statement.receiver.nil?
        end

        def statements(body)
          body.begin_type? ? body.children : [body]
        end

        def remember(name, declared)
          self.class.registry[name] = declared unless name.nil?
        end

        def class_index
          return @class_index if @class_index

          ast = processed_source.ast
          @class_index = if ast.nil?
                           {}
                         else
                           index_classes(ast)
                         end
        end

        def index_classes(ast)
          ast.each_node(:class).each_with_object({}) do |class_node, acc|
            name = class_name(class_node)
            acc[name] = class_node if name
          end
        end

        def class_name(node)
          const_name(node.identifier)
        end

        def const_name(node)
          return if node.nil? || !node.const_type?

          node.source
        end

        def base_mutation?(name)
          name == 'BaseMutation' || name.end_with?('::BaseMutation')
        end
      end
    end
  end
end
