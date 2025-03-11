import { Task } from '../types/codeTask.js';

class TaskExecutor {
  private taskQueue: Task[] = [];
  private activeTasks: Set<Task> = new Set();
  private maxConcurrentTasks: number;

  constructor(maxConcurrentTasks: number) {
    this.maxConcurrentTasks = maxConcurrentTasks;
  }

  public addTask(task: Task): void {
    this.taskQueue.push(task);
    this.executeTasks();
  }

  private executeTasks(): void {
    while (this.activeTasks.size < this.maxConcurrentTasks && this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (task) {
        this.activeTasks.add(task);
        this.executeTask(task);
      }
    }
  }

  private async executeTask(task: Task): Promise<void> {
    try {
      await task.run();
    } finally {
      this.activeTasks.delete(task);
      this.executeTasks();
    }
  }
}

export default TaskExecutor;
