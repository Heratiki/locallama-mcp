import { decisionEngine } from '../../decision-engine/index.js';
import { jobTracker } from '../../decision-engine/services/jobTracker.js';
import { loadUserPreferences } from '../../user-preferences/index.js';
import { executeTask } from '../task-execution/index.js';
import { IRouter } from '../types.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger.js';
import { costEstimator } from '../cost-estimation/index.js';

export class Router implements IRouter {
  preemptiveRouting: boolean = false;

  async routeTask(args: { task: string; contextLength: number; expectedOutputLength: number; complexity: number; priority: 'speed' | 'cost' | 'quality'; }): Promise<any> {
    try {
      const userPreferences = await loadUserPreferences();
      const executionMode = userPreferences.executionMode || 'Fully automated selection';
      const costEstimate = await costEstimator.estimateCost(args.contextLength, args.expectedOutputLength);
      const costThreshold = userPreferences.costConfirmationThreshold || config.costThreshold;
      const allowsPaidAPIs = executionMode !== 'Local model only' && executionMode !== 'Free API only' && executionMode !== 'Local and Free API';
      if (costEstimate > costThreshold && allowsPaidAPIs) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'cost_confirmation',
                estimated_cost: costEstimate,
                message: 'Estimated cost exceeds threshold. Do you want to continue?',
                options: ['Yes', 'No'],
                job_id: null
              }, null, 2),
            },
          ],
        };
      }
      let taskAnalysis = null;
      let hasSubtasks = false;
      const allowsAnyAPI = executionMode !== 'Local model only';
      if (allowsAnyAPI) {
        try {
          taskAnalysis = await decisionEngine.analyzeCodeTask(args.task);
          hasSubtasks = taskAnalysis && taskAnalysis.executionOrder && taskAnalysis.executionOrder.length > 0;
          logger.info(`Task analysis complete. Found ${hasSubtasks ? taskAnalysis.executionOrder.length : 0} subtasks.`);
        } catch (error) {
          logger.warn('Error analyzing task:', error);
        }
      }
      let retrivResults: any[] = [];
      if (!hasSubtasks && userPreferences.prioritizeRetrivSearch) {
        try {
          const codeSearchEngine = await getCodeSearchEngine();
          retrivResults = await codeSearchEngine.search(args.task, 5);
          logger.info(`Found ${retrivResults.length} results in Retriv for task: ${args.task}`);
        } catch (error) {
          logger.warn('Error searching Retriv:', error);
        }
      }
      if (retrivResults.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                message: 'Found existing code solution in Retriv',
                results: retrivResults,
                source: 'retriv'
              }, null, 2),
            },
          ],
        };
      }
      const decision = await decisionEngine.routeTask({
        task: args.task,
        contextLength: args.contextLength,
        expectedOutputLength: args.expectedOutputLength,
        complexity: args.complexity,
        priority: args.priority,
      });
      const jobId = uuidv4();
      jobTracker.createJob(jobId, args.task, decision.model);
      jobTracker.updateJobProgress(jobId, 0);
      (async () => {
        try {
          const result = await executeTask(decision.model, args.task, jobId);
          logger.info(`Task execution completed successfully for job ${jobId}`);
        } catch (error) {
          logger.error(`Task execution failed for job ${jobId}:`, error);
        }
      })();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...decision,
              job_id: jobId,
              status: 'In Progress',
              progress: '0%',
              message: 'Task has been routed and execution started. Use job_id to track progress.'
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Error routing task:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error routing task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  async preemptiveRouteTask(args: { task: string; contextLength: number; expectedOutputLength: number; complexity: number; priority: 'speed' | 'cost' | 'quality'; }): Promise<any> {
    try {
      const decision = await decisionEngine.preemptiveRouting({
        task: args.task,
        contextLength: args.contextLength,
        expectedOutputLength: args.expectedOutputLength,
        complexity: args.complexity,
        priority: args.priority,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(decision, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Error in preemptive routing:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error in preemptive routing: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
}

const router = new Router();

export { router };
export const routeTask = router.routeTask.bind(router);
export const preemptiveRouteTask = router.preemptiveRouteTask.bind(router);
