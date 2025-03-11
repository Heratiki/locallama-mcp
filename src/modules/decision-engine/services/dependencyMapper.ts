import { logger } from '../../../utils/logger.js';
import { DecomposedCodeTask, CodeSubtask, CodeComplexityResult } from '../types/codeTask.js';

/**
 * Service for mapping dependencies between code subtasks
 */
export const dependencyMapper = {
  /**
   * Sort subtasks by execution order based on their dependencies
   * 
   * @param decomposedTask The decomposed code task with subtasks and dependencies
   * @returns A sorted list of subtasks in execution order
   */
  sortByExecutionOrder(decomposedTask: DecomposedCodeTask): CodeSubtask[] {
    const { subtasks, dependencyMap } = decomposedTask;
    
    // Map of subtask IDs to their subtask objects for easy lookup
    const subtaskMap = new Map<string, CodeSubtask>();
    subtasks.forEach(subtask => {
      subtaskMap.set(subtask.id, subtask);
    });
    
    // Keep track of visited and sorted subtasks
    const visited = new Set<string>();
    const temp = new Set<string>();
    const sorted: CodeSubtask[] = [];
    
    // Topological sort using depth-first search
    const visit = (subtaskId: string): void => {
      // If already in sorted result, skip
      if (visited.has(subtaskId)) return;
      
      // Check for cyclic dependencies
      if (temp.has(subtaskId)) {
        logger.warn(`Cyclic dependency detected involving subtask: ${subtaskId}`);
        return;
      }
      
      // Mark as being processed
      temp.add(subtaskId);
      
      // Process all dependencies first
      const dependencies = dependencyMap[subtaskId] || [];
      for (const depId of dependencies) {
        if (subtaskMap.has(depId)) {
          visit(depId);
        }
      }
      
      // Mark as processed and add to result
      temp.delete(subtaskId);
      visited.add(subtaskId);
      
      const subtask = subtaskMap.get(subtaskId);
      if (subtask) {
        sorted.push(subtask);
      }
    };
    
    // Visit all subtasks
    for (const subtask of subtasks) {
      if (!visited.has(subtask.id)) {
        visit(subtask.id);
      }
    }
    
    return sorted.reverse();
  },
  
  /**
   * Get optimized execution order with prioritization of critical path tasks
   * 
   * @param decomposedTask The decomposed code task
   * @returns An optimally ordered list of subtasks
   */
  getOptimizedExecutionOrder(decomposedTask: DecomposedCodeTask): CodeSubtask[] {
    // First, get the basic topological order
    const topologicalOrder = this.sortByExecutionOrder(decomposedTask);
    
    // Find the critical path
    const criticalPath = this.findCriticalPath(decomposedTask);
    const criticalPathIds = new Set(criticalPath.map(task => task.id));
    
    // Identify parallel execution groups
    const executionLevels = this.identifyParallelExecutionGroups(decomposedTask);
    
    // Prioritize tasks within each level based on:
    // 1. Critical path membership (highest priority)
    // 2. Number of dependent tasks (higher is prioritized)
    // 3. Complexity (higher is prioritized)
    const { subtasks, dependencyMap } = decomposedTask;
    
    // Calculate number of dependents for each task
    const dependentCounts = new Map<string, number>();
    for (const subtask of subtasks) {
      let count = 0;
      for (const s of subtasks) {
        if ((dependencyMap[s.id] || []).includes(subtask.id)) {
          count++;
        }
      }
      dependentCounts.set(subtask.id, count);
    }
    
    // Sort tasks within each level
    const optimizedOrder: CodeSubtask[] = [];
    for (const level of executionLevels) {
      // Sort tasks within the level
      const sortedLevel = [...level].sort((a, b) => {
        // Critical path tasks come first
        if (criticalPathIds.has(a.id) && !criticalPathIds.has(b.id)) return -1;
        if (!criticalPathIds.has(a.id) && criticalPathIds.has(b.id)) return 1;
        
        // Then by number of dependent tasks
        const aDeps = dependentCounts.get(a.id) || 0;
        const bDeps = dependentCounts.get(b.id) || 0;
        if (aDeps !== bDeps) return bDeps - aDeps;
        
        // Then by complexity
        return b.complexity - a.complexity;
      });
      
      optimizedOrder.push(...sortedLevel);
    }
    
    return optimizedOrder;
  },
  
  /**
   * Identify groups of tasks that can be executed in parallel
   * 
   * @param decomposedTask The decomposed code task
   * @returns Array of execution levels, where tasks in each level can be executed in parallel
   */
  identifyParallelExecutionGroups(decomposedTask: DecomposedCodeTask): CodeSubtask[][] {
    const { subtasks, dependencyMap } = decomposedTask;
    
    // Create a map for easy lookup
    const subtaskMap = new Map<string, CodeSubtask>();
    subtasks.forEach(subtask => {
      subtaskMap.set(subtask.id, subtask);
    });
    
    // Calculate "in-degree" (number of dependencies) for each subtask
    const inDegree = new Map<string, number>();
    for (const subtask of subtasks) {
      inDegree.set(subtask.id, dependencyMap[subtask.id]?.length || 0);
    }
    
    // Group tasks by execution level
    const levels: CodeSubtask[][] = [];
    let remainingTasks = new Set(subtasks.map(s => s.id));
    
    // Continue until all tasks are assigned to levels
    while (remainingTasks.size > 0) {
      // Find all tasks with no remaining dependencies
      const currentLevel: CodeSubtask[] = [];
      for (const taskId of remainingTasks) {
        if ((inDegree.get(taskId) || 0) === 0) {
          const task = subtaskMap.get(taskId);
          if (task) {
            currentLevel.push(task);
          }
        }
      }
      
      // If we couldn't find any tasks without dependencies but tasks remain,
      // there must be a cycle - break it
      if (currentLevel.length === 0 && remainingTasks.size > 0) {
        logger.warn('Potential cycle detected in dependency graph');
        // Take the first remaining task and force it into the level
        const taskId = Array.from(remainingTasks)[0];
        const task = subtaskMap.get(taskId);
        if (task) {
          currentLevel.push(task);
        }
      }
      
      // Remove tasks in current level from remaining tasks
      currentLevel.forEach(task => {
        remainingTasks.delete(task.id);
      });
      
      // Decrease in-degree for each task that depends on the tasks in current level
      currentLevel.forEach(task => {
        // Find all tasks that have this task as a dependency
        for (const s of subtasks) {
          if ((dependencyMap[s.id] || []).includes(task.id)) {
            inDegree.set(s.id, (inDegree.get(s.id) || 0) - 1);
          }
        }
      });
      
      // Add the current level to our levels array
      if (currentLevel.length > 0) {
        levels.push(currentLevel);
      }
    }
    
    return levels;
  },
  
  /**
   * Check for and resolve circular dependencies
   * 
   * @param decomposedTask The decomposed code task
   * @returns An updated decomposed task with resolved dependencies
   */
  resolveCircularDependencies(decomposedTask: DecomposedCodeTask): DecomposedCodeTask {
    const { subtasks, dependencyMap } = decomposedTask;
    const updatedDependencyMap = { ...dependencyMap };
    
    // Detect and resolve circular dependencies
    const visited = new Set<string>();
    const path: string[] = [];
    const circularDependencies: string[][] = [];
    
    // DFS to detect cycles
    const detectCycle = (current: string, path: string[] = []): boolean => {
      if (path.includes(current)) {
        // Cycle detected, extract the cycle
        const cycleStart = path.indexOf(current);
        circularDependencies.push(path.slice(cycleStart).concat(current));
        return true;
      }
      
      if (visited.has(current)) return false;
      
      visited.add(current);
      path.push(current);
      
      for (const dependency of updatedDependencyMap[current] || []) {
        if (detectCycle(dependency, [...path])) {
          return true;
        }
      }
      
      path.pop();
      return false;
    };
    
    // Check each subtask for cycles
    for (const subtask of subtasks) {
      if (!visited.has(subtask.id)) {
        detectCycle(subtask.id, []);
      }
    }
    
    // Resolve circular dependencies by removing the weakest link
    for (const cycle of circularDependencies) {
      logger.warn(`Resolving circular dependency: ${cycle.join(' -> ')}`);
      
      // Find the "weakest" link (lowest complexity or least dependencies)
      let weakestLink = cycle[0];
      let minDependencies = (updatedDependencyMap[cycle[0]] || []).length;
      
      for (let i = 1; i < cycle.length - 1; i++) {
        const deps = (updatedDependencyMap[cycle[i]] || []).length;
        if (deps < minDependencies) {
          minDependencies = deps;
          weakestLink = cycle[i];
        }
      }
      
      // Remove the dependency that creates the cycle
      const sourceIdx = cycle.indexOf(weakestLink);
      const targetIdx = (sourceIdx + 1) % cycle.length;
      const target = cycle[targetIdx];
      
      updatedDependencyMap[weakestLink] = (updatedDependencyMap[weakestLink] || [])
        .filter(dep => dep !== target);
      
      logger.debug(`Removed dependency from ${weakestLink} to ${target}`);
    }
    
    // Update subtasks to reflect the changes in dependencies
    const updatedSubtasks = subtasks.map(subtask => ({
      ...subtask,
      dependencies: updatedDependencyMap[subtask.id] || []
    }));
    
    return {
      ...decomposedTask,
      subtasks: updatedSubtasks,
      dependencyMap: updatedDependencyMap
    };
  },
  
  /**
   * Generate a visual representation of dependencies
   * 
   * @param decomposedTask The decomposed code task
   * @returns A string with a visual representation of dependencies
   */
  visualizeDependencies(decomposedTask: DecomposedCodeTask): string {
    const { subtasks, dependencyMap } = decomposedTask;
    
    // Create a map for easy lookup
    const subtaskMap = new Map<string, CodeSubtask>();
    subtasks.forEach(subtask => {
      subtaskMap.set(subtask.id, subtask);
    });
    
    // Sort subtasks by execution order
    const orderedSubtasks = this.sortByExecutionOrder(decomposedTask);
    
    // Build visualization
    let visualization = '# Code Task Dependencies\n\n';
    visualization += `Original Task: ${decomposedTask.originalTask}\n\n`;
    visualization += '## Execution Order\n\n';
    
    orderedSubtasks.forEach((subtask, index) => {
      visualization += `${index + 1}. ${subtask.description} (ID: ${subtask.id.slice(0, 8)}..., Complexity: ${subtask.complexity})\n`;
    });
    
    visualization += '\n## Dependency Graph\n\n```\n';
    
    // Create a simple ASCII dependency graph
    orderedSubtasks.forEach((subtask, index) => {
      const id = subtask.id;
      const shortId = id.slice(0, 8);
      const deps = dependencyMap[id] || [];
      
      visualization += `[${shortId}] ${subtask.description.slice(0, 40)}${subtask.description.length > 40 ? '...' : ''}\n`;
      
      if (deps.length > 0) {
        deps.forEach(depId => {
          const depSubtask = subtaskMap.get(depId);
          if (depSubtask) {
            const shortDepId = depId.slice(0, 8);
            visualization += `  ├── depends on [${shortDepId}] ${depSubtask.description.slice(0, 30)}${depSubtask.description.length > 30 ? '...' : ''}\n`;
          }
        });
      } else {
        visualization += '  └── (no dependencies)\n';
      }
      
      visualization += '\n';
    });
    
    visualization += '```\n';
    
    // Add visualization of parallel execution groups
    const executionLevels = this.identifyParallelExecutionGroups(decomposedTask);
    visualization += '\n## Parallel Execution Groups\n\n';
    
    executionLevels.forEach((level, index) => {
      visualization += `### Level ${index + 1}\n\n`;
      visualization += 'Tasks that can be executed in parallel:\n\n';
      
      level.forEach(task => {
        visualization += `- ${task.description.slice(0, 60)}${task.description.length > 60 ? '...' : ''}\n`;
      });
      
      visualization += '\n';
    });
    
    // Add critical path visualization
    const criticalPath = this.findCriticalPath(decomposedTask);
    visualization += '\n## Critical Path\n\n';
    visualization += 'Tasks on the critical path (bottlenecks):\n\n';
    
    criticalPath.forEach((task, index) => {
      visualization += `${index + 1}. ${task.description} (Complexity: ${task.complexity})\n`;
    });
    
    return visualization;
  },
  
  /**
   * Calculate the critical path and detailed metrics
   * 
   * @param decomposedTask The decomposed code task
   * @returns An object containing critical path and detailed analysis
   */
  analyzeTaskPath(decomposedTask: DecomposedCodeTask): {
    criticalPath: CodeSubtask[];
    metrics: Required<NonNullable<CodeComplexityResult['metrics']>>['criticalPath'];
  } {
    const criticalPath = this.findCriticalPath(decomposedTask);
    const { subtasks, dependencyMap } = decomposedTask;
    
    // Calculate total duration and find bottlenecks
    const duration = criticalPath.reduce((sum, task) => sum + task.estimatedTokens, 0);
    
    // Analyze potential bottlenecks
    const bottlenecks = criticalPath.map(task => {
      // Calculate impact based on:
      // 1. Number of dependent tasks
      // 2. Complexity score
      // 3. Position in critical path
      const dependentTasks = subtasks.filter(s => 
        (dependencyMap[s.id] || []).includes(task.id)
      ).length;
      const positionImpact = criticalPath.indexOf(task) / criticalPath.length;
      const impact = (
        (task.complexity * 0.4) +
        (dependentTasks / subtasks.length * 0.4) +
        (positionImpact * 0.2)
      );
      return {
        id: task.id,
        description: task.description,
        impact
      };
    }).filter(b => b.impact > 0.5); // Only include significant bottlenecks
    
    // Calculate parallelization potential
    const independentPaths = this.findIndependentPaths(decomposedTask);
    const maxParallelPaths = independentPaths.length;
    const totalTasks = subtasks.length;
    const parallelizationScore = Math.min(
      maxParallelPaths / Math.ceil(Math.sqrt(totalTasks)),
      1
    );
    
    return {
      criticalPath,
      metrics: {
        duration,
        bottlenecks,
        parallelizationScore
      }
    };
  },
  
  /**
   * Find independent paths that can be executed in parallel
   * 
   * @param decomposedTask The decomposed code task
   * @returns Array of independent task paths
   */
  findIndependentPaths(decomposedTask: DecomposedCodeTask): CodeSubtask[][] {
    const { subtasks, dependencyMap } = decomposedTask;
    const paths: CodeSubtask[][] = [];
    const visited = new Set<string>();
    
    // Helper function to check if two tasks are independent
    const areIndependent = (task1: CodeSubtask, task2: CodeSubtask): boolean => {
      const deps1 = new Set(dependencyMap[task1.id] || []);
      const deps2 = new Set(dependencyMap[task2.id] || []);
      return !deps1.has(task2.id) && !deps2.has(task1.id);
    };
    
    // Find paths of independent tasks
    for (const startTask of subtasks) {
      if (visited.has(startTask.id)) continue;
      const currentPath: CodeSubtask[] = [startTask];
      visited.add(startTask.id);
      
      // Try to extend the path with independent tasks
      for (const task of subtasks) {
        if (visited.has(task.id)) continue;
        
        // Check if task is independent from all tasks in current path
        const isIndependentFromPath = currentPath.every(
          pathTask => areIndependent(task, pathTask)
        );
        
        if (isIndependentFromPath) {
          currentPath.push(task);
          visited.add(task.id);
        }
      }
      
      if (currentPath.length > 0) {
        paths.push(currentPath);
      }
    }
    
    return paths;
  },
  
  /**
   * Calculate the critical path of subtasks based on their dependencies and estimated token counts
   * 
   * @param decomposedTask The decomposed code task
   * @returns An array of subtasks representing the critical path
   */
  findCriticalPath(decomposedTask: DecomposedCodeTask): CodeSubtask[] {
    const { subtasks, dependencyMap } = decomposedTask;
    
    // Create a map for easy lookup
    const subtaskMap = new Map<string, CodeSubtask>();
    subtasks.forEach(subtask => {
      subtaskMap.set(subtask.id, subtask);
    });
    
    // Calculate earliest start and finish times
    const earliestStart = new Map<string, number>();
    const earliestFinish = new Map<string, number>();
    const latestStart = new Map<string, number>();
    const latestFinish = new Map<string, number>();
    const slack = new Map<string, number>();
    
    // Sort subtasks topologically
    const orderedSubtasks = this.sortByExecutionOrder(decomposedTask);
    
    // Forward pass - calculate earliest start and finish
    orderedSubtasks.forEach(subtask => {
      const id = subtask.id;
      const deps = dependencyMap[id] || [];
      let maxDependencyFinish = 0;
      
      // Find the maximum finish time of all dependencies
      for (const depId of deps) {
        const depFinish = earliestFinish.get(depId) || 0;
        maxDependencyFinish = Math.max(maxDependencyFinish, depFinish);
      }
      
      const start = maxDependencyFinish;
      const finish = start + subtask.estimatedTokens;
      
      earliestStart.set(id, start);
      earliestFinish.set(id, finish);
    });
    
    // Find the project completion time
    const projectDuration = Math.max(...subtasks.map(s => earliestFinish.get(s.id) || 0));
    
    // Backward pass - calculate latest start and finish
    [...orderedSubtasks].reverse().forEach(subtask => {
      const id = subtask.id;
      let minLatestStart = projectDuration;
      
      // Find tasks that depend on this one
      for (const s of subtasks) {
        if ((dependencyMap[s.id] || []).includes(id)) {
          const sLatestStart = latestStart.get(s.id) || projectDuration;
          minLatestStart = Math.min(minLatestStart, sLatestStart);
        }
      }
      
      const finish = subtasks.some(s => (dependencyMap[s.id] || []).includes(id)) ? 
                        minLatestStart : projectDuration;
      const start = finish - subtask.estimatedTokens;
      
      latestFinish.set(id, finish);
      latestStart.set(id, start);
      
      // Calculate slack
      slack.set(id, (latestStart.get(id) || 0) - (earliestStart.get(id) || 0));
    });
    
    // Tasks with zero slack are on the critical path
    const criticalPath = subtasks.filter(subtask => (slack.get(subtask.id) || 0) === 0)
      .sort((a, b) => (earliestStart.get(a.id) || 0) - (earliestStart.get(b.id) || 0));
    
    return criticalPath;
  },
  
  /**
   * Suggest optimizations to reduce critical path length or improve parallelism
   * 
   * @param decomposedTask The decomposed code task
   * @returns Optimization suggestions
   */
  suggestOptimizations(decomposedTask: DecomposedCodeTask): { 
    suggestions: Array<{ description: string; impact: string; priority: 'high' | 'medium' | 'low' }>;
    optimizedStructure?: DecomposedCodeTask;
  } {
    const { criticalPath, metrics } = this.analyzeTaskPath(decomposedTask);
    const suggestions: Array<{ description: string; impact: string; priority: 'high' | 'medium' | 'low' }> = [];
    
    // Check if critical path is too long
    if (criticalPath.length > 3 && metrics.parallelizationScore < 0.6) {
      suggestions.push({
        description: "Break down longer tasks in the critical path into smaller parallel subtasks.",
        impact: "Could reduce total execution time by up to 30%.",
        priority: "high"
      });
    }
    
    // Check for bottlenecks
    if (metrics.bottlenecks.length > 0) {
      const topBottleneck = metrics.bottlenecks[0];
      suggestions.push({
        description: `Consider optimizing the bottleneck task: ${topBottleneck.description}`,
        impact: "Could improve overall performance by focusing resources on this task.",
        priority: "high"
      });
    }
    
    // Check for low parallelization
    if (metrics.parallelizationScore < 0.4) {
      suggestions.push({
        description: "Restructure dependencies to increase potential for parallel execution.",
        impact: "Could enable more efficient resource allocation and reduce total time.",
        priority: "medium"
      });
    }
    
    // Check for sequential chains that could be merged
    const executionLevels = this.identifyParallelExecutionGroups(decomposedTask);
    if (executionLevels.length > 5) {
      suggestions.push({
        description: "Consider merging some sequential tasks to reduce coordination overhead.",
        impact: "May improve efficiency by reducing context switching.",
        priority: "low"
      });
    }
    
    // If there are too few tasks overall, suggest more decomposition
    if (decomposedTask.subtasks.length < 3) {
      suggestions.push({
        description: "The task might benefit from further decomposition into subtasks.",
        impact: "More granular tasks can improve parallelization and resource allocation.",
        priority: "low"
      });
    }
    
    return { suggestions };
  }
};