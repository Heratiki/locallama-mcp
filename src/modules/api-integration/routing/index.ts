import { decisionEngine } from '../../decision-engine/index.js';
import { getJobTracker, JobStatus } from '../../decision-engine/services/jobTracker.js';
import { loadUserPreferences } from '../../user-preferences/index.js';
import { config } from '../../../config/index.js';
import { taskExecutor } from '../task-execution/index.js';
import { IRouter, RouteTaskParams, RouteTaskResult, CancelJobResult } from './types.js';
import { getProviderRegistry, providerCostClass, isProviderLocal } from '../../core/provider/index.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger.js';
import { costEstimator } from '../cost-estimation/index.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { getCodeSearchEngine } from '../../cost-monitor/codeSearchEngine.js';
import type { RetrivSearchResult } from '../retriv-integration/types.js';
import { codeTaskCoordinator } from '../../decision-engine/services/codeTaskCoordinator.js'; // Import coordinator
import { Model } from '../../../types/index.js'; // Import Model type

let jobTracker: Awaited<ReturnType<typeof getJobTracker>>;

export class Router implements IRouter {
  private providerLooksUnavailable(providerId: string): boolean {
    const registry = getProviderRegistry();
    return !registry.has(providerId) || !registry.isAvailable(providerId);
  }

  private async pickPreemptiveNonLocalFallback(
    params: RouteTaskParams,
  ): Promise<{ provider: 'paid'; model: string } | null> {
    const availableModels = await costMonitor.getAvailableModels();
    const totalTokens = params.contextLength + (params.expectedOutputLength || 0);
    const paidCandidate = availableModels.find(
      (model) =>
        !isProviderLocal(model.provider) &&
        (model.contextWindow === undefined || model.contextWindow >= totalTokens),
    );

    if (!paidCandidate) return null;

    return {
      provider: 'paid',
      model: paidCandidate.id,
    };
  }

  private modelIdMatches(target: string, candidate: string): boolean {
    if (target === candidate) return true;
    if (candidate.endsWith(`:${target}`)) return true;
    if (target.endsWith(`:${candidate}`)) return true;
    return false;
  }

  private async preserveLocalDecisionModelAssignments(
    decision: { provider: string; model: string },
    decomposedTask: { subtasks: Array<{ id: string; complexity: number }> },
    modelAssignments: Map<string, Model>,
    executionOrder: Array<{ id: string }>,
    routeTraceId: string,
  ): Promise<void> {
    if (decision.provider !== 'local') return;

    if (decomposedTask.subtasks.length === 0) return;

    const availableModels = await costMonitor.getAvailableModels();
    const preferredModel = availableModels.find(
      (model) => isProviderLocal(model.provider) && this.modelIdMatches(decision.model, model.id),
    );

    if (!preferredModel) {
      logger.warn(`[${routeTraceId}] unable to preserve local decision model for decomposed task`, {
        decisionModel: decision.model,
        assignedModelCount: modelAssignments.size,
      });
      return;
    }

    const targetSubtaskIds = new Set<string>();

    if (decomposedTask.subtasks.length === 1) {
      targetSubtaskIds.add(decomposedTask.subtasks[0].id);
    } else {
      const finalSubtaskId = executionOrder[executionOrder.length - 1]?.id;
      if (finalSubtaskId) targetSubtaskIds.add(finalSubtaskId);

      const mostComplexSubtask = decomposedTask.subtasks.reduce((max, subtask) => {
        if (!max || subtask.complexity > max.complexity) return subtask;
        return max;
      }, undefined as { id: string; complexity: number } | undefined);
      if (mostComplexSubtask) targetSubtaskIds.add(mostComplexSubtask.id);
    }

    const changedAssignments: Array<{ subtaskId: string; previousModel: string }> = [];
    for (const subtaskId of targetSubtaskIds) {
      const assignedModel = modelAssignments.get(subtaskId);
      if (assignedModel && this.modelIdMatches(decision.model, assignedModel.id)) {
        continue;
      }
      changedAssignments.push({
        subtaskId,
        previousModel: assignedModel?.id || 'unassigned',
      });
      modelAssignments.set(subtaskId, preferredModel);
    }

    if (changedAssignments.length === 0) {
      logger.debug(`[${routeTraceId}] local decision model already preserved for target subtasks`, {
        decisionModel: decision.model,
        targetSubtaskIds: Array.from(targetSubtaskIds),
      });
      return;
    }

    logger.info(`[${routeTraceId}] preserved local decision model assignments`, {
      decisionModel: decision.model,
      finalAssignedModel: preferredModel.id,
      targetSubtaskIds: Array.from(targetSubtaskIds),
      changedAssignments,
    });
  }

  private async resolveProviderIdForModel(modelId: string, fallbackProviderId: string): Promise<string> {
    const registry = getProviderRegistry();

    for (const provider of registry.list()) {
      try {
        if (await provider.supportsModel(modelId)) {
          return provider.id;
        }
      } catch (error) {
        logger.debug(`Provider ${provider.id} support check failed for ${modelId}:`, error);
      }
    }

    return fallbackProviderId === 'paid' ? 'openrouter' : fallbackProviderId;
  }

  private async executePaidDecisionDirectly(
    params: RouteTaskParams,
    decision: { provider: string; model: string; explanation?: string },
    costEstimate: Awaited<ReturnType<typeof costEstimator.estimateCost>>,
    retrivResults: RetrivSearchResult[],
  ): Promise<RouteTaskResult | null> {
    if (decision.provider !== 'paid') return null;
    if (!config.openRouterApiKey) return null;

    if (config.openRouterFreeOnly) {
      logger.warn(
        'Paid route_task decision reached, but OPENROUTER_FREE_ONLY is enabled. Continuing through normal fallback path.',
      );
      return null;
    }

    const selectedModelCostEstimate = await costEstimator.estimateCost({
      contextLength: params.contextLength,
      outputLength: params.expectedOutputLength || 0,
      model: decision.model,
    });

    if (selectedModelCostEstimate.paid.cost.total > config.costThreshold) {
      throw new Error(
        `Paid route_task estimate $${selectedModelCostEstimate.paid.cost.total.toFixed(6)} exceeds COST_THRESHOLD=$${config.costThreshold.toFixed(6)}.`,
      );
    }

    const providerId = await this.resolveProviderIdForModel(decision.model, decision.provider);
    const jobId = `route-${uuidv4()}`;
    const tracker = await getJobTracker();
    await tracker.createJob(jobId, params.task, decision.model);

    try {
      const resultCode = await taskExecutor.executeTask(decision.model, params.task, jobId);
      await tracker.completeJob(jobId, [resultCode]);

      return {
        model: decision.model,
        providerId,
        costClass: providerCostClass(providerId),
        provider: providerId,
        reason:
          `Paid routing decision preserved and executed directly with ${decision.model}. ` +
          (decision.explanation ? decision.explanation : ''),
        resultCode,
        estimatedCost: selectedModelCostEstimate.paid.cost.total,
        details: {
          costEstimate: selectedModelCostEstimate,
          retrivResults: retrivResults.length > 0 ? retrivResults : undefined,
        },
      };
    } catch (error) {
      await tracker.failJob(jobId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Route a coding task to either a local LLM, Free API LLM, or paid API LLM based on cost and complexity
   */
  async routeTask(params: RouteTaskParams): Promise<RouteTaskResult> {
    try {
      const routeTraceId = `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      logger.info(`Routing task with complexity ${params.complexity || 0.5}, context length ${params.contextLength}, priority ${params.priority || 'quality'}`);
      logger.debug(`[${routeTraceId}] route_task input summary`, {
        complexity: params.complexity || 0.5,
        contextLength: params.contextLength,
        expectedOutputLength: params.expectedOutputLength || 0,
        priority: params.priority || 'quality',
      });

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
          providerId: 'retriv',
          costClass: 'local',
          provider: 'local-cache',
          reason: `Found existing code solution in local database with score ${retrivResults[0]?.score?.toFixed(2) ?? 'N/A'}`,
          resultCode: resultCode,
          estimatedCost: 0,
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

      logger.debug(`[${routeTraceId}] decisionEngine.routeTask decision`, {
        provider: decision.provider,
        model: decision.model,
        confidence: decision.confidence,
        preemptive: decision.preemptive || false,
        scores: decision.scores,
      });

      const paidResult = await this.executePaidDecisionDirectly(
        params,
        decision,
        costEstimate,
        retrivResults,
      );

      if (paidResult) return paidResult;

      // --- Full Task Processing via Coordinator ---
      logger.info('Proceeding with full task processing (decomposition, execution, synthesis)');
      logger.debug(`[${routeTraceId}] full-task path may reselect models during decomposition`, {
        initialDecisionProvider: decision.provider,
        initialDecisionModel: decision.model,
      });

      // Process the task: decompose, assign models, determine order
      // THIS IS NOW THE *ONLY* PLACE DECOMPOSITION HAPPENS
      const processingResult = await codeTaskCoordinator.processCodeTask(
        params.task,
        { /* Add relevant options if needed, e.g., granularity */ }
      );

      const { decomposedTask, modelAssignments, executionOrder } = processingResult;

      await this.preserveLocalDecisionModelAssignments(
        { provider: decision.provider, model: decision.model },
        decomposedTask,
        modelAssignments,
        executionOrder,
        routeTraceId,
      );

      const assignmentSummary = executionOrder.map((subtask) => {
        const assignedModel = modelAssignments.get(subtask.id);
        return {
          subtaskId: subtask.id,
          complexity: Number(subtask.complexity.toFixed(3)),
          assignedModelId: assignedModel?.id || 'unassigned',
          assignedProviderId: assignedModel?.provider || 'unassigned',
        };
      });

      logger.debug(`[${routeTraceId}] decomposition + assignment summary`, {
        subtaskCount: decomposedTask.subtasks.length,
        assignmentSummary,
      });

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

      logger.debug(`[${routeTraceId}] final response model vs initial decision`, {
        initialDecisionProvider: decision.provider,
        initialDecisionModel: decision.model,
        finalResponseProvider: finalModelInfo.provider,
        finalResponseModel: finalModelInfo.id,
      });

      // Return the final synthesized result
      return {
        model: finalModelInfo.id,
        providerId: finalModelInfo.provider,
        costClass: providerCostClass(finalModelInfo.provider),
        provider: finalModelInfo.provider,
        reason: `Task decomposed into ${decomposedTask.subtasks.length} subtasks, executed, and synthesized.`,
        resultCode: finalCode,
        estimatedCost: processingResult.estimatedCost,
        details: {
          costEstimate: costEstimate,
          retrivResults: retrivResults.length > 0 ? retrivResults : undefined,
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
      
      // If local providers are currently unavailable, do not suggest local models.
      if (decision.provider === 'local') {
        const localProviderIds = getProviderRegistry().listByCostClass('local').map((provider) => provider.id);
        const hasLiveLocalProvider = localProviderIds.some((providerId) => !this.providerLooksUnavailable(providerId));

        if (!hasLiveLocalProvider) {
          const fallback = await this.pickPreemptiveNonLocalFallback(params);
          if (fallback) {
            decision.provider = fallback.provider;
            decision.model = fallback.model;
            decision.explanation =
              `${decision.explanation ?? ''} Local providers are unavailable; falling back to non-local preemptive suggestion.`.trim();
          } else {
            decision.provider = 'paid';
            decision.model = 'no_available_provider';
            decision.explanation =
              `${decision.explanation ?? ''} Local providers are unavailable and no non-local model is currently eligible.`.trim();
          }
        }
      }

      // Generate a reason if it doesn't exist in the decision object
      const routingReason = generateRoutingReason(decision);
      
      // Return a routing recommendation — actual execution happens via route_task
      return {
        model: decision.model,
        providerId: decision.provider,
        costClass: providerCostClass(decision.provider),
        provider: decision.provider,
        reason: `Preemptive routing selected ${decision.model} (${decision.provider}). Call route_task to execute. ${routingReason}`,
        resultCode: '',
        details: {}
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
