# frozen_string_literal: true

class OpenMutation < BaseMutation
  authorize :anonymous

  def resolve
    {}
  end
end
