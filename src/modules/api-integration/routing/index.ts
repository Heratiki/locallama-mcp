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

      const costThreshold = userPreferences.costConfirmationThreshold || config.costThreshold || 0.1;

      // Check if the execution mode allows paid APIs
      const allowsPaidAPIs = executionMode !== 'Local model only' &&
        executionMode !== 'Free API only' &&
        executionMode !== 'Local and Free API';

      if (costEstimate.paid.cost.total > costThreshold && allowsPaidAPIs) {
        // Return a response that requires user confirmation
        return {
          model: costEstimate.paid.model,
          provider: costEstimate.paid.provider,
          reason: 'Cost exceeds threshold, confirmation required',
          estimatedCost: costEstimate.paid.cost.total,
          requiresConfirmation: true,
          details: {
            costEstimate: costEstimate
          }
        };
      }

      // Task breakdown analysis
      let taskAnalysis = null;
      let hasSubtasks = false;

      // Check if the execution mode allows any API (free or paid)
      const allowsAnyAPI = executionMode !== 'Local model only';

      if (allowsAnyAPI) {
        try {
          const analysisResult = await decisionEngine.analyzeCodeTask(params.task);
          taskAnalysis = analysisResult;
          hasSubtasks = Boolean(analysisResult?.executionOrder?.length);
          logger.info(`Task analysis complete. Found ${hasSubtasks ? analysisResult.executionOrder.length : 0} subtasks.`);
        } catch (error) {
          logger.warn('Error analyzing task:', error);
          // Continue with normal processing if task analysis fails
        }
      }

      // Retriv search
      let retrivResults: RetrivSearchResult[] = [];
      if (!hasSubtasks && userPreferences.prioritizeRetrivSearch) {
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

      if (retrivResults.length > 0) {
        // Use existing code from Retriv
        return {
          model: 'retriv',
          provider: 'local',
          reason: 'Found existing code solution in local database',
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

      // Job creation and progress tracking
      const jobId = uuidv4();
      try {
        jobTracker = await getJobTracker();
        try {
          await jobTracker.createJob(jobId, params.task, decision.model);
          await jobTracker.updateJobProgress(jobId, 0);
        } catch (createJobError) {
          logger.error('Error creating/updating job:', createJobError);
        }
      } catch (getJobTrackerError) {
        logger.error('Error initializing jobTracker:', getJobTrackerError);
      }

      // Execute task asynchronously
      void (async () => {
        try {
          await taskExecutor.executeTask(decision.model, params.task, jobId);
          logger.info(`Task execution completed successfully for job ${jobId}`);
        } catch (error) {
          logger.error(`Task execution failed for job ${jobId}:`, error);
          // Job failure is already handled in executeTask
        }
      })();

      // Generate a reason if it doesn't exist in the decision object
      const routingReason = generateRoutingReason(decision);

      // Return the routing result with job ID for tracking
      return {
        model: decision.model,
        provider: decision.provider,
        reason: routingReason,
        jobId: jobId,
        estimatedCost: costEstimate.paid.cost.total,
        estimatedTime: calculateEstimatedTime(decision),
        details: {
          status: JobStatus.IN_PROGRESS,
          progress: 0,
          taskAnalysis: taskAnalysis ? taskAnalysis.decomposedTask : undefined
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
      
      return {
        model: decision.model,
        provider: decision.provider,
        reason: routingReason,
        estimatedTime: calculateEstimatedTime(decision),
        details: {
          isPreemptive: true
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
