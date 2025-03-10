export interface IToolDefinitionProvider {
  getTools(): Promise<any[]>;
}

export interface ITaskExecutor {
  executeTask(model: string, task: string, jobId: string): Promise<string>;
}

export interface IRetrivIntegration {
  isPythonAvailable(): boolean;
  isPythonModuleInstalled(moduleName: string): boolean;
  generateRequirementsTxt(): string;
  initializeRetriv(args: any): Promise<any>;
}

export interface IOpenRouterIntegration {
  isOpenRouterConfigured(): boolean;
  getFreeModels(): Promise<any>;
  clearTrackingData(): Promise<void>;
  updatePromptingStrategy(model: string, config: any, successRate: number, qualityScore: number): Promise<void>;
}

export interface ICostEstimator {
  estimateCost(args: { contextLength: number; outputLength: number; model?: string }): Promise<any>;
}

export interface IJobManager {
  createJob(jobId: string, task: string, model: string): void;
  updateJobProgress(jobId: string, progress: number, timeout?: number): void;
  completeJob(jobId: string): void;
  failJob(jobId: string, message: string): void;
  cancelJob(jobId: string): void;
  getJob(jobId: string): any;
}

export interface IRouter {
  routeTask(args: { task: string; contextLength: number; expectedOutputLength: number; complexity: number; priority: string }): Promise<any>;
  preemptiveRouting(args: { task: string; contextLength: number; expectedOutputLength: number; complexity: number; priority: string }): Promise<any>;
}