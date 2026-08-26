# frozen_string_literal: true

class Project
  def self.find_with_assignee(id)
    User.find_assignee_for_project(id)
  end

  def display_name
    name
  end
end
