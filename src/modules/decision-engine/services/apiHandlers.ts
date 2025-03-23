import { jobTracker } from './jobTracker.js';
// import { taskRouter } from './taskRouter.js'; // TODO: Check and make sure this module is still used elsewhere in the codebase.
import { decisionEngine } from '../index.js';
import { logger } from '../../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { costMonitor } from '../../cost-monitor/index.js';
import { ModelPerformanceData } from '../../../types/index.js';

interface IndexStatus {
  inProgress: boolean;
  filesIndexed: number;
  totalFiles: number;
  currentFile?: string;
  progress: number;
  lastUpdate: number;
  error?: string;
}

export const apiHandlers = {
  getSpeedLabel(avgResponseTime?: number): string {
    if (!avgResponseTime) return 'Unknown';
    if (avgResponseTime < 2000) return 'Fast';
    if (avgResponseTime < 5000) return 'Medium';
    return 'Slow';
  },

  async routeTask(params: {
    task: string;
    files_affected?: string[];
    context_length: number;
    expected_output_length: number;
    complexity: number;
    priority: 'cost' | 'speed' | 'quality';
    preemptive?: boolean;
  }) {
    const jobId = `job_${uuidv4()}`;

    // Create job first
    jobTracker.createJob(jobId, params.task);

    try {
      // Get initial routing decision
      const decision = await decisionEngine.routeTask({
        task: params.task,
        contextLength: params.context_length,
        expectedOutputLength: params.expected_output_length,
        complexity: params.complexity,
        priority: params.priority
      });

      // Update job with selected model
      const job = jobTracker.getJob(jobId);
      if (job) {
        job.model = decision.model;
        jobTracker.updateJobProgress(jobId, 0, 180000); // Initial 3-minute estimate
      }

      return {
        job_id: jobId,
        status: 'Queued',
        eta: '3 minutes'
      };
    } catch (error) {
      logger.error('Error routing task:', error);
      throw error;
    }
  },

  getRealtimeIndexStatus(): Promise<IndexStatus> {
    try {
      // Provide workspace root to createCodeSearchEngine
      const status = costMonitor.createCodeSearchEngine('./').getIndexStatus();
      return Promise.resolve({
        inProgress: status.indexing,
        filesIndexed: status.filesIndexed,
        totalFiles: status.totalFiles,
        currentFile: status.currentFile,
        progress: Math.round((status.filesIndexed / Math.max(1, status.totalFiles)) * 100),
        lastUpdate: status.lastUpdate,
        error: status.error
      });
    } catch (error) {
      logger.error('Error getting index status:', error);
      return Promise.resolve({
        inProgress: false,
        filesIndexed: 0,
        totalFiles: 0,
        progress: 0,
        lastUpdate: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  async getCostEstimate(params: {
    context_length: number;
    expected_output_length: number;
    complexity: number;
  }) {
    try {
      const estimate = await costMonitor.estimateCost({
        contextLength: params.context_length,
        outputLength: params.expected_output_length
      });
      
      // Store hasFreeModels result to get a boolean value
            const hasFreeModels = await costMonitor.hasFreeModels();
            
            return {
              local_model: '$0 (Free)',
              openrouter_free: hasFreeModels ? '$0 (Limited)' : 'Not Available',
              openrouter_paid: `$${estimate.paid.cost.total.toFixed(2)}`
            };
    } catch (error) {
      logger.error('Error getting cost estimate:', error);
      throw error;
    }
  },

  getActiveJobs() {
    try {
      const jobs = jobTracker.getActiveJobs();
      return {
        jobs: jobs.map(job => ({
          id: job.id,
          task: job.task,
          status: job.status,
          progress: job.progress,
          estimated_time_remaining: job.estimated_time_remaining,
          model: job.model
        }))
      };
    } catch (error) {
      logger.error('Error getting active jobs:', error);
      throw error;
    }
  },

  getJobProgress(jobId: string) {
    try {
      const job = jobTracker.getJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      return {
        jobId: job.id,
        task: job.task,
        status: job.status,
        progress: job.progress,
        estimated_time_remaining: job.estimated_time_remaining,
        model: job.model
      };
    } catch (error) {
      logger.error('Error getting job progress:', error);
      throw error;
    }
  },

  cancelJob(jobId: string) {
    try {
      jobTracker.cancelJob(jobId);
      return {
        jobId,
        status: 'Cancelled'
      };
    } catch (error) {
      logger.error('Error cancelling job:', error);
      throw error;
    }
  },

  async getFreeModels() {
    try {
      const freeModels = await costMonitor.getFreeModels();
      const modelsDb = costMonitor.getModelPerformanceData();

      return {
        models: freeModels.map(model => {
          const perfData = modelsDb[model.id] as ModelPerformanceData;
          return {
            name: model.id,
            accuracy: perfData ? `${Math.round(perfData.qualityScore * 100)}%` : 'Unknown',
            speed: this.getSpeedLabel(perfData?.avgResponseTime)
          };
        })
      };
    } catch (error) {
      logger.error('Error getting free models:', error);
      throw error;
    }
  },

  async benchmarkTask(params: {
    task: string;
    context_length: number;
    expected_output_length: number;
    complexity: number;
  }) {
    try {
      const localEstimate = await costMonitor.estimateLocalPerformance(params);
      const openrouterEstimate = await costMonitor.estimateOpenRouterPerformance(params);
      const freeEstimate = await costMonitor.estimateFreeModelPerformance(params);
      
      // Calculate values without awaiting non-promises
      const localResponseTimeSec = Math.round(localEstimate.avgResponseTime / 1000);
      const localAccuracyPercent = Math.round(localEstimate.qualityScore * 100);
      
      let freeResponseTimeSec = 0;
      let freeAccuracyPercent = 0;
      
      if (freeEstimate) {
        freeResponseTimeSec = Math.round(freeEstimate.avgResponseTime / 1000);
        freeAccuracyPercent = Math.round(freeEstimate.qualityScore * 100);
      }
      
      const paidResponseTimeSec = Math.round(openrouterEstimate.avgResponseTime / 1000);
      const paidAccuracyPercent = Math.round(openrouterEstimate.qualityScore * 100);
      
      return {
        local: {
          speed: `${localResponseTimeSec} sec`,
          cost: '$0',
          accuracy: `${localAccuracyPercent}%`
        },
        openrouter_free: freeEstimate ? {
          speed: `${freeResponseTimeSec} sec`,
          cost: '$0',
          accuracy: `${freeAccuracyPercent}%`
        } : null,
        openrouter_paid: {
          speed: `${paidResponseTimeSec} sec`,
          cost: `$${openrouterEstimate.cost.toFixed(2)}`,
          accuracy: `${paidAccuracyPercent}%`
        }
      };
    } catch (error) {
      logger.error('Error benchmarking task:', error);
      throw error;
    }
  },

  async optimizeAndRouteTask(params: {
    task: string;
    files_affected?: string[];
    context_length: number;
    expected_output_length: number;
    complexity: number;
    priority: 'cost' | 'speed' | 'quality';
  }) {
    const jobId = `job_${uuidv4()}`;
    jobTracker.createJob(jobId, params.task);

    try {
      // First check Retriv index for similar tasks
      const similarTasks = costMonitor.findSimilarCode(
        params.task,
        'coding_task',
        undefined,
        3
      );

      // If we found similar tasks with high similarity, use them to optimize
      if (similarTasks.length > 0 && similarTasks[0].similarity > 0.85) {
        logger.info(`Found similar task with ${similarTasks[0].similarity.toFixed(2)} similarity score`);

        // Update job progress
        jobTracker.updateJobProgress(jobId, 25, 120000);

        // Use the similar task to optimize the current one
        const optimizedTask = costMonitor.optimizeCodeTask(
          params.task,
          similarTasks[0].code,
          16384 // Assuming 16k context window
        );

        // Route the optimized task
        const decision = await decisionEngine.routeTask({
          task: params.task,
          contextLength: optimizedTask.contextOptimization.optimizedTokens,
          expectedOutputLength: params.expected_output_length,
          complexity: params.complexity,
          priority: params.priority
        });

        // Update job with model selection
        const job = jobTracker.getJob(jobId);
        if (job) {
          job.model = decision.model;
          jobTracker.updateJobProgress(jobId, 50, 90000);
        }

        return {
          job_id: jobId,
          status: 'Optimized',
          optimization: {
            token_savings: optimizedTask.contextOptimization.tokenSavings,
            savings_percentage: optimizedTask.contextOptimization.savingsPercentage
          },
          similar_tasks_found: similarTasks.length,
          eta: '1.5 minutes'
        };
      }

      // If no good matches found, proceed with normal routing
      logger.debug('No highly similar tasks found, proceeding with normal routing');

      const decision = await decisionEngine.routeTask({
        task: params.task,
        contextLength: params.context_length,
        expectedOutputLength: params.expected_output_length,
        complexity: params.complexity,
        priority: params.priority
      });

      // Update job with selected model
      const job = jobTracker.getJob(jobId);
      if (job) {
        job.model = decision.model;
        jobTracker.updateJobProgress(jobId, 0, 180000);
      }

      return {
        job_id: jobId,
        status: 'Queued',
        eta: '3 minutes'
      };
    } catch (error) {
      logger.error('Error optimizing and routing task:', error);
      jobTracker.failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
};