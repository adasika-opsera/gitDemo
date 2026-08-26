import { getSortOptions } from '../filter/sort_options';
import { getWorkItem } from '../model/work_item';

export function getListSortOptions() {
  return getSortOptions();
}

export function hydrateListItem(id) {
  return getWorkItem(id);
}
