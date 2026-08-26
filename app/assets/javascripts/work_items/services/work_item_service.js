import { getWorkItem } from '../model/work_item';

export function fetchWorkItem(id) {
  return getWorkItem(id);
}
