# frozen_string_literal: true

class ParentMutation < BaseMutation
  authorize :update_issue

  def resolve
    {}
  end
end

class ChildMutation < ParentMutation
  def resolve
    {}
  end
end
