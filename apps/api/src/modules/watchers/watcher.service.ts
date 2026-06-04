import { WatcherRepository } from './watcher.repository.js';
import type { TaskWatcher } from '@projectflow/types';

export class WatcherService {
  constructor(private repo: WatcherRepository = new WatcherRepository()) {}
  list(taskId: string): Promise<TaskWatcher[]> { return this.repo.list(taskId); }
  add(taskId: string, userId: string): Promise<TaskWatcher | null> { return this.repo.add(taskId, userId); }
  remove(taskId: string, userId: string): Promise<void> { return this.repo.remove(taskId, userId); }
}

export const watcherService = new WatcherService();
