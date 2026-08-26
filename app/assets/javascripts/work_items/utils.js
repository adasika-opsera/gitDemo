import { getFilterTokens } from './filter/filter_tokens';
import { buildFilterQuery } from './filter/query_builder';
import { getAssignee } from './model/assignee';

export function getWorkItemFilterTokens() {
  return getFilterTokens();
}

export function getWorkItemFilterQuery() {
  return buildFilterQuery(getFilterTokens());
}

export function getWorkItemAssignee(id) {
  return getAssignee(id);
}
