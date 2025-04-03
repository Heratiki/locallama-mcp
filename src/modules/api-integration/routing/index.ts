import { decisionEngine } from '../../decision-engine/index.js';
import { getJobTracker, JobStatus } from '../../decision-engine/services/jobTracker.js';
import { loadUserPreferences } from '../../user-preferences/index.js';
import { config } from '../../../config/index.js';
import { taskExecutor } from '../task-execution/index.js';
import { IRouter, RouteTaskParams, RouteTaskResult, CancelJobResult } from './types.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger.js';
import { costEstimator } from '../cost-estimation/index.js';
import { getCodeSearchEngine } from '../../cost-monitor/codeSearchEngine.js';
import type { RetrivSearchResult } from '../retriv-integration/types.js';
import { codeTaskCoordinator } from '../../decision-engine/services/codeTaskCoordinator.js'; // Import coordinator
import { Model } from '../../../types/index.js'; // Import Model type

let jobTracker: Awaited<ReturnType<typeof getJobTracker>>;

export class Router implements IRouter {
  /**
   * Route a coding task to either a local LLM, Free API LLM, or paid API LLM based on cost and complexity
   */
  async routeTask(params: RouteTaskParams): Promise<RouteTaskResult> {
    try {
      logger.info(`Routing task with complexity ${params.complexity || 0.5}, context length ${params.contextLength}, priority ${params.priority || 'quality'}`);

      // Load user preferences
      const userPreferences = await loadUserPreferences();
      const executionMode = userPreferences.executionMode || 'Fully automated selection';

      // Cost estimation
      const costEstimate = await costEstimator.estimateCost({
        contextLength: params.contextLength,
        outputLength: params.expectedOutputLength || 0,
        model: undefined
      });

      // Retriv search - Keep this logic, but maybe adjust condition if needed
      let retrivResults: RetrivSearchResult[] = [];
      // We don't know if there are subtasks *yet*, so adjust Retriv logic if it depends on that
      if (userPreferences.prioritizeRetrivSearch) { // Simplified condition for now
        try {
          const codeSearchEngine = await getCodeSearchEngine();
          const searchResults = await codeSearchEngine.search(params.task, 5);
          retrivResults = searchResults as RetrivSearchResult[];
          logger.info(`Found ${retrivResults.length} results in Retriv for task: ${params.task}`);
        } catch (error) {
          logger.warn('Error searching Retriv:', error);
          // Continue with normal processing if Retriv search fails
        }
      }

      if (retrivResults.length > 0 && retrivResults[0].score > 0.8) { // Check score threshold
        // Use existing code from Retriv if confidence is high
        const resultCode = retrivResults[0]?.content ?? '// Retriv found a match, but content was empty.';
        logger.info(`High confidence Retriv match found (score: ${retrivResults[0].score}). Returning cached result.`);
        return {
          model: 'retriv',
          provider: 'local-cache', // Changed provider to reflect source
          reason: `Found existing code solution in local database with score ${retrivResults[0]?.score?.toFixed(2) ?? 'N/A'}`,
          resultCode: resultCode, // Add missing resultCode
          estimatedCost: 0, // Cost is 0 for cached result
          details: {
            retrivResults
          }
        };
      }

      // Decision Engine routing
      const decision = await decisionEngine.routeTask({
        task: params.task,
        contextLength: params.contextLength,
        expectedOutputLength: params.expectedOutputLength || 0,
        complexity: params.complexity || 0.5,
        priority: params.priority || 'quality',
      });

      // --- Full Task Processing via Coordinator ---
      logger.info('Proceeding with full task processing (decomposition, execution, synthesis)');

      // Process the task: decompose, assign models, determine order
      // THIS IS NOW THE *ONLY* PLACE DECOMPOSITION HAPPENS
      const processingResult = await codeTaskCoordinator.processCodeTask(
        params.task,
        { /* Add relevant options if needed, e.g., granularity */ }
      );

      const { decomposedTask, modelAssignments, executionOrder } = processingResult;

      // Execute all subtasks sequentially or in parallel based on dependencies
      const subtaskResults = await codeTaskCoordinator.executeAllSubtasks(
        decomposedTask,
        modelAssignments
      );

      // Synthesize the final result from subtask results
      const finalCode = await codeTaskCoordinator.synthesizeFinalResult(
        decomposedTask,
        subtaskResults
      );

      // Determine the primary model/provider used (e.g., for the synthesis step)
      const finalModelInfo = modelAssignments.get(executionOrder[executionOrder.length - 1]?.id) || { id: 'unknown', provider: 'unknown' };

      // Return the final synthesized result
      return {
        model: finalModelInfo.id,
        provider: finalModelInfo.provider,
        reason: `Task decomposed into ${decomposedTask.subtasks.length} subtasks, executed, and synthesized.`,
        resultCode: finalCode,
        estimatedCost: processingResult.estimatedCost, // Get cost from processing result
        details: {
          costEstimate: costEstimate, // Keep original estimate for reference
          retrivResults: retrivResults.length > 0 ? retrivResults : undefined, // Include if search was done
          taskAnalysis: decomposedTask
        }
      };
    } catch (error) {
      logger.error('Error routing task:', error);
      throw error;
    }
  }

  /**
   * Quickly route a coding task without making API calls (faster but less accurate)
   */
  async preemptiveRouting(params: RouteTaskParams): Promise<RouteTaskResult> {
    try {
      logger.info(`Performing preemptive routing for task with complexity ${params.complexity || 0.5}`);
      
      // Use preemptive routing for faster decision
      const decision = await decisionEngine.preemptiveRouting({
        task: params.task,
        contextLength: params.contextLength,
        expectedOutputLength: params.expectedOutputLength || 0,
        complexity: params.complexity || 0.5,
        priority: params.priority || 'quality',
      });
      
      // Generate a reason if it doesn't exist in the decision object
      const routingReason = generateRoutingReason(decision);
      
      // Return a placeholder result indicating the preemptive choice
      // The actual execution must now happen via the main routeTask
      return {
        model: decision.model,
        provider: decision.provider,
        reason: `Preemptive routing suggested ${decision.model}. Full execution required via route_task. Reason: ${routingReason}`,
        resultCode: `// Preemptive routing selected ${decision.model}. Full execution needed via route_task.`, // Placeholder result
        // estimatedCost: undefined, // Preemptive doesn't calculate cost
        details: {
          // TODO: Implement elsewhere - costEstimate: undefined, // No cost estimate done
          // TODO: Implement retriv in a way that leverages it's semantic search to reduce code generation - retrivResults: undefined, // No retriv search done
          // TODO: Implement elsewhere - taskAnalysis: undefined // No analysis done
        }
      };
    } catch (error) {
      logger.error('Error in preemptive routing:', error);
      throw error;
    }
  }
  
  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<CancelJobResult> {
    try {
      // Initialize jobTracker here as it's not initialized globally in this scope anymore
      jobTracker = await getJobTracker();
      // Get the job
      let job;
      try {
        job = jobTracker.getJob(jobId);
      } catch (getJobError) {
        logger.error('Error getting job:', getJobError);
        return {
          success: false,
          status: 'Error' as const,
          message: `Error getting job: ${getJobError instanceof Error ? getJobError.message : String(getJobError)}`,
          jobId
        };
      }
      if (!job) {
        return {
          success: false,
          status: 'Not Found' as const,
          message: `Job with ID ${jobId} not found`,
          jobId
        };
      }

      // Check if the job can be cancelled
      let jobStatus;
      try {
        jobStatus = job.status;
      } catch (jobStatusError) {
        logger.error('Error getting job status:', jobStatusError);
        return {
          success: false,
          status: 'Error' as const,
          message: `Error getting job status: ${jobStatusError instanceof Error ? jobStatusError.message : String(jobStatusError)}`,
          jobId
        };
      }
      if ([JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.FAILED].includes(jobStatus)) {
        return {
          success: false,
          status: jobStatus,
          message: `Job with ID ${jobId} is already ${jobStatus.toLowerCase()}`,
          jobId
        };
      }

      // Cancel the job
      try {
        await jobTracker.cancelJob(jobId);
      } catch (cancelJobError) {
        logger.error('Error cancelling job:', cancelJobError);
        return {
          success: false,
          status: 'Error' as const,
          message: `Error cancelling job: ${cancelJobError instanceof Error ? cancelJobError.message : String(cancelJobError)}`,
          jobId
        };
      }

      return {
        success: true,
        status: JobStatus.CANCELLED,
        message: `Job with ID ${jobId} has been cancelled`,
        jobId
      };
    } catch (error) {
      logger.error('Error cancelling job:', error);
      return {
        success: false,
        status: 'Error' as const,
        message: `Error cancelling job: ${error instanceof Error ? error.message : String(error)}`,
        jobId
      };
    }
  }
}

/**
 * Helper function to generate a reason for routing decisions
 */
function generateRoutingReason(decision: { model: string; reason?: string }): string {
  // Check if the decision already has a reason property
  if (decision.reason) {
    return decision.reason;
  }
  
  // Generate a reason based on available information
  if (decision.model.includes('gpt-4')) {
    return 'Selected high-capability model based on task complexity';
  } else if (decision.model.includes('gpt-3.5')) {
    return 'Selected balanced model for cost-effectiveness';
  } else if (decision.model.startsWith('lm-studio:')) {
    return 'Selected local model to minimize costs';
  } else if (decision.model.startsWith('openrouter:')) {
    return 'Selected API model for optimal quality';
  } else {
    return 'Selected based on current routing policy';
  }
}

/**
 * Helper function to calculate estimated completion time
 */
function calculateEstimatedTime(decision: { model: string; estimatedTime?: number }): number {
  // Check if the decision already has an estimatedTime property
  if (decision.estimatedTime) {
    return decision.estimatedTime;
  }
  
  // Estimate based on model type
  if (decision.model.includes('gpt-4')) {
    return 30000; // 30 seconds
  } else if (decision.model.includes('gpt-3.5')) {
    return 15000; // 15 seconds
  } else if (decision.model.startsWith('ollama:')) {
    return 60000; // 60 seconds for local models
  } else {
    return 20000; // 20 seconds default
  }
}

// Create singleton instance
const router = new Router();

// Export the singleton instance
export { router };

// Export individual methods for backward compatibility
export const routeTask = router.routeTask.bind(router);
export const preemptiveRouteTask = router.preemptiveRouting.bind(router);
export const cancelJob = router.cancelJob.bind(router);
