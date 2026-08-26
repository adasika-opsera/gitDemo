import { getWorkItem } from '../../work_items/model/work_item';
import { getSortOptions } from '../../work_items/filter/sort_options';

export function formatWorkItemLabel(id) {
  const item = getWorkItem(id);
  return item.title;
}

export function formatSortLabel() {
  return getSortOptions().join(', ');
}
