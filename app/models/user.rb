# frozen_string_literal: true

class User
  def self.find_assignee_for_project(project_id)
    ProjectService.lookup_assignee(project_id)
  end

  def full_name
    "#{first_name} #{last_name}"
  end
end
