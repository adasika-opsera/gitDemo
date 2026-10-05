# frozen_string_literal: true

class DeclaredMutation < BaseMutation
  authorize :create_issue

  def resolve
    {}
  end
end
