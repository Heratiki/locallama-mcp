import { logger } from '../../../utils/logger.js';
import { openRouterModule } from '../../openrouter/index.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { 
  CodeTaskAnalysisOptions, 
  CodeComplexityResult, 
  DecomposedCodeTask, 
  CodeSubtask,
  IntegrationFactors,
  DomainFactors
} from '../types/codeTask.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../config/index.js';
import { COMPLEXITY_THRESHOLDS } from '../types/index.js';

// Prompts for code task analysis
const DECOMPOSE_TASK_PROMPT = `You are a code architecture expert helping to break down a complex coding task into smaller subtasks. 
Analyze the following coding task and decompose it into logical, modular subtasks.

Task: {task}

Consider:
1. Each subtask should be clear, focused, and achievable by a language model
2. Identify dependencies between subtasks
3. For each subtask, estimate complexity (0-1 scale) and token requirements
4. Group related functionality
5. Consider code structure (classes, functions, methods)

Analyze the task thoroughly and provide a structured decomposition in JSON format.`;

// Update COMPLEXITY_ANALYSIS_PROMPT to include more detailed integration analysis
const COMPLEXITY_ANALYSIS_PROMPT = `You are an expert in software development complexity analysis. 
Analyze the complexity of the following coding task:

Task: {task}

For this analysis:
1. Assess algorithmic complexity (simple loops vs complex algorithms)
2. Evaluate integration complexity considering:
   - Number of systems/components that need to interact
   - Data format transformations required
   - Communication protocols involved
   - State management complexity
   - Error handling across boundaries
3. Consider domain knowledge requirements
4. Evaluate technical requirements

For integration complexity specifically, consider:
- External system dependencies
- API integration points
- Data transformation requirements
- State synchronization needs
- Error handling complexity
- Transaction management
- Security requirements

Provide a detailed analysis with complexity scores (0-1 scale) for each factor, an overall complexity score, and a brief explanation.`;

/**
 * Service for analyzing and decomposing code tasks
 */
export const codeTaskAnalyzer = {
  /**
   * Decompose a complex code task into smaller, more manageable subtasks
   * 
   * @param task The code task to decompose
   * @param options Options for task decomposition
   * @returns A decomposed code task with subtasks
   */
  async decompose(
    task: string,
    options: CodeTaskAnalysisOptions = {}
  ): Promise<DecomposedCodeTask> {
    logger.debug('Decomposing code task:', task);
    
    const promptOptions = {
      maxSubtasks: options.maxSubtasks || 8,
      granularity: options.granularity || 'medium',
      includeTests: options.includeTests !== undefined ? options.includeTests : true,
      tokenBudgetPerSubtask: options.tokenBudgetPerSubtask || 1500,
    };
    
    try {
      // First, analyze the complexity to determine if decomposition is necessary
      const complexityResult = await this.analyzeComplexity(task);
      
      // For very simple tasks, we might not need decomposition
      if (complexityResult.overallComplexity < COMPLEXITY_THRESHOLDS.SIMPLE && 
          !options.maxSubtasks) {
        return {
          originalTask: task,
          subtasks: [{
            id: uuidv4(),
            description: task,
            complexity: complexityResult.overallComplexity,
            estimatedTokens: 1000, // Conservative estimate for simple tasks
            dependencies: [],
            codeType: 'other',
            recommendedModelSize: 'small'
          }],
          totalEstimatedTokens: 1000,
          dependencyMap: {},
          context: {
            complexityAnalysis: complexityResult
          }
        };
      }
      
      // For more complex tasks, use a model to decompose the task
      // Prefer free models for decomposition if they're capable enough
      let modelId = config.defaultLocalModel;
      try {
        const freeModels = await costMonitor.getFreeModels();
        if (freeModels.length > 0) {
          const suitableModels = freeModels.filter(model => 
            model.id.toLowerCase().includes('instruct') || 
            model.id.toLowerCase().includes('coder')
          );
          
          if (suitableModels.length > 0) {
            modelId = suitableModels[0].id;
            logger.debug(`Using free model ${modelId} for task decomposition`);
          }
        }
      } catch (error) {
        logger.debug('Error getting free models, falling back to default:', error);
      }
      
      // Format the prompt with the task
      const prompt = DECOMPOSE_TASK_PROMPT.replace('{task}', task);
      
      const decompositionResult = await openRouterModule.callOpenRouterApi(
        modelId,
        prompt,
        60000 // 60 seconds timeout
      );
      
      if (!decompositionResult.success || !decompositionResult.text) {
        logger.error('Failed to decompose task:', decompositionResult.error);
        throw new Error('Failed to decompose task');
      }
      
      // Parse the result, expecting a JSON structure
      const subtasksRaw = this.parseSubtasksFromResponse(decompositionResult.text);
      
      // Process and validate subtasks
      const subtasks: CodeSubtask[] = subtasksRaw.map(subtask => ({
        id: subtask.id || uuidv4(),
        description: subtask.description,
        complexity: Math.min(Math.max(subtask.complexity || 0.5, 0), 1), // Ensure within 0-1
        estimatedTokens: subtask.estimatedTokens || 
          Math.round(500 + (subtask.complexity || 0.5) * 1500), // Estimate based on complexity if not provided
        dependencies: subtask.dependencies || [],
        codeType: subtask.codeType || 'other',
        recommendedModelSize: this.determineRecommendedModelSize(subtask.complexity || 0.5)
      }));
      
      // Generate dependency map
      const dependencyMap: Record<string, string[]> = {};
      subtasks.forEach(subtask => {
        dependencyMap[subtask.id] = subtask.dependencies;
      });
      
      // Calculate total estimated tokens
      const totalEstimatedTokens = subtasks.reduce(
        (sum, subtask) => sum + subtask.estimatedTokens, 
        0
      );
      
      return {
        originalTask: task,
        subtasks,
        totalEstimatedTokens,
        dependencyMap,
        context: {
          complexityAnalysis: complexityResult
        }
      };
    } catch (error) {
      logger.error('Error during code task decomposition:', error);
      // Fallback to a simple decomposition
      return this.createFallbackDecomposition(task);
    }
  },
  
  /**
   * Analyze the complexity of a code task
   * 
   * @param task The code task to analyze
   * @returns A complexity analysis result
   */
  async analyzeComplexity(task: string): Promise<CodeComplexityResult> {
    logger.debug('Analyzing complexity of code task:', task);
    
    try {
      // Get detailed integration and domain factors
      const integrationFactors = await evaluateIntegrationFactors(task);
      const domainFactors = await evaluateDomainKnowledge(task);
      const technicalFactors = await evaluateTechnicalRequirements(task);
      
      const avgIntegrationComplexity = Object.values(integrationFactors)
        .reduce((sum, val) => sum + val, 0) / Object.keys(integrationFactors).length;
      
      const avgDomainComplexity = Object.values(domainFactors)
        .reduce((sum, val) => sum + val, 0) / Object.keys(domainFactors).length;
        
      const avgTechnicalComplexity = Object.values(technicalFactors)
        .reduce((sum, val) => sum + val, 0) / Object.keys(technicalFactors).length;
        
      const prompt = COMPLEXITY_ANALYSIS_PROMPT.replace('{task}', task);
      
      // Try to use a free model for complexity analysis
      let modelId = config.defaultLocalModel;
      try {
        const freeModels = await costMonitor.getFreeModels();
        if (freeModels.length > 0) {
          modelId = freeModels[0].id;
          logger.debug(`Using free model ${modelId} for complexity analysis`);
        }
      } catch (error) {
        logger.debug('Error getting free models, falling back to default:', error);
      }
      
      const result = await openRouterModule.callOpenRouterApi(
        modelId,
        prompt,
        30000 // 30 seconds timeout
      );

      if (!result.success || !result.text) {
        logger.error('Failed to analyze complexity:', result.error);
        throw new Error('Failed to analyze complexity');
      }

      const llmAnalysis = this.parseComplexityFromResponse(result.text);
      
      // Calculate overall domain knowledge score
      const domainKnowledgeScore = Math.max(
        llmAnalysis.factors.domainKnowledge,
        avgDomainComplexity
      );

      // Calculate overall technical requirements score
      const technicalRequirementsScore = Math.max(
        llmAnalysis.factors.technical,
        avgTechnicalComplexity
      );

      // Combine LLM analysis with pattern-based analysis
      return {
        ...llmAnalysis,
        factors: {
          ...llmAnalysis.factors,
          integration: Math.max(llmAnalysis.factors.integration, avgIntegrationComplexity),
          domainKnowledge: domainKnowledgeScore,
          technical: technicalRequirementsScore
        },
        metrics: {
          ...llmAnalysis.metrics,
          integrationFactors,
          domainFactors,
          technicalFactors,
          ...llmAnalysis.metrics?.criticalPath ? { criticalPath: llmAnalysis.metrics.criticalPath } : {}
        }
      };
    } catch (error) {
      logger.error('Error during code complexity analysis:', error);
      return {
        overallComplexity: 0.5,
        factors: {
          algorithmic: 0.5,
          integration: 0.5,
          domainKnowledge: 0.5,
          technical: 0.5
        },
        explanation: 'Failed to analyze complexity, using default medium complexity.'
      };
    }
  },
  
  /**
   * Parse subtasks from the model response
   * 
   * @param response The model's response text
   * @returns An array of parsed subtasks
   */
  parseSubtasksFromResponse(response: string): any[] {
    try {
      // Try to extract JSON object
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || 
                        response.match(/\{[\s\S]*?\}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        
        if (parsed.subtasks && Array.isArray(parsed.subtasks)) {
          return parsed.subtasks;
        } else if (Array.isArray(parsed)) {
          return parsed;
        } else {
          return [parsed]; // Treat as a single subtask
        }
      }
      
      // Fallback to heuristic parsing if JSON extraction fails
      const sections = response.split(/\n\s*\d+\.\s+/);
      return sections
        .filter(section => section.trim().length > 0)
        .map((section, index) => {
          const descriptionMatch = section.match(/(?:Title|Description|Task):\s*(.+?)(?:\n|$)/i);
          const complexityMatch = section.match(/Complexity:\s*(\d+(?:\.\d+)?)/i);
          const tokensMatch = section.match(/Tokens?:\s*(\d+)/i);
          const dependenciesMatch = section.match(/Dependencies?:\s*(.+?)(?:\n|$)/i);
          const typeMatch = section.match(/Type:\s*(\w+)/i);
          
          return {
            id: uuidv4(),
            description: descriptionMatch ? descriptionMatch[1].trim() : section.trim().split('\n')[0],
            complexity: complexityMatch ? parseFloat(complexityMatch[1]) : 0.5,
            estimatedTokens: tokensMatch ? parseInt(tokensMatch[1]) : 1000,
            dependencies: dependenciesMatch ? 
              dependenciesMatch[1].split(',').map(d => d.trim()) : [],
            codeType: typeMatch ? typeMatch[1].toLowerCase() : 'other'
          };
        });
    } catch (error) {
      logger.error('Error parsing subtasks from response:', error);
      // Return a basic subtask if parsing fails
      return [{
        id: uuidv4(),
        description: 'Complete the original task',
        complexity: 0.5,
        estimatedTokens: 1500,
        dependencies: [],
        codeType: 'other'
      }];
    }
  },
  
  /**
   * Parse complexity analysis from the model response
   * 
   * @param response The model's response text
   * @returns A complexity analysis result
   */
  parseComplexityFromResponse(response: string): CodeComplexityResult {
    try {
      // Try to extract JSON object first
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || 
                        response.match(/\{[\s\S]*?\}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonStr);
      }
      
      // Fall back to heuristic parsing
      const overallMatch = response.match(/overall(?:\s+complexity)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      const algorithmicMatch = response.match(/algorithmic(?:\s+complexity)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      const integrationMatch = response.match(/integration(?:\s+complexity)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      const domainMatch = response.match(/domain(?:\s+knowledge)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      const technicalMatch = response.match(/technical(?:\s+requirements)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      
      return {
        overallComplexity: overallMatch ? parseFloat(overallMatch[1]) : 0.5,
        factors: {
          algorithmic: algorithmicMatch ? parseFloat(algorithmicMatch[1]) : 0.5,
          integration: integrationMatch ? parseFloat(integrationMatch[1]) : 0.5,
          domainKnowledge: domainMatch ? parseFloat(domainMatch[1]) : 0.5,
          technical: technicalMatch ? parseFloat(technicalMatch[1]) : 0.5
        },
        explanation: response.replace(/^.*?(Explanation|Analysis):/i, '').trim()
      };
    } catch (error) {
      logger.error('Error parsing complexity from response:', error);
      return {
        overallComplexity: 0.5,
        factors: {
          algorithmic: 0.5,
          integration: 0.5,
          domainKnowledge: 0.5,
          technical: 0.5
        },
        explanation: 'Failed to parse complexity analysis.'
      };
    }
  },
  
  /**
   * Determine the recommended model size for a subtask based on its complexity
   * 
   * @param complexity The complexity score (0-1)
   * @returns The recommended model size
   */
  determineRecommendedModelSize(complexity: number): 'small' | 'medium' | 'large' | 'remote' {
    if (complexity <= 0.3) return 'small';
    if (complexity <= 0.6) return 'medium';
    if (complexity <= 0.8) return 'large';
    return 'remote';
  },
  
  /**
   * Create a fallback decomposition if the normal decomposition fails
   * 
   * @param task The original task
   * @returns A basic decomposition
   */
  createFallbackDecomposition(task: string): DecomposedCodeTask {
    // Create a simple decomposition based on task length
    const words = task.split(/\s+/).length;
    
    if (words <= 20) {
      // Very simple task, no need to decompose
      return {
        originalTask: task,
        subtasks: [{
          id: uuidv4(),
          description: task,
          complexity: 0.3,
          estimatedTokens: 800,
          dependencies: [],
          codeType: 'other',
          recommendedModelSize: 'small'
        }],
        totalEstimatedTokens: 800,
        dependencyMap: {}
      };
    } else {
      // Break into planning and implementation subtasks
      const planningId = uuidv4();
      const implementationId = uuidv4();
      
      return {
        originalTask: task,
        subtasks: [
          {
            id: planningId,
            description: `Plan the approach for: ${task}`,
            complexity: 0.4,
            estimatedTokens: 1000,
            dependencies: [],
            codeType: 'other',
            recommendedModelSize: 'medium'
          },
          {
            id: implementationId,
            description: `Implement the solution for: ${task}`,
            complexity: 0.6,
            estimatedTokens: 1500,
            dependencies: [planningId],
            codeType: 'other',
            recommendedModelSize: 'large'
          }
        ],
        totalEstimatedTokens: 2500,
        dependencyMap: {
          [planningId]: [],
          [implementationId]: [planningId]
        }
      };
    }
  }
};

/**
 * Evaluate integration complexity factors in more detail
 * @param taskDescription The task description
 * @returns Detailed integration complexity factors
 */
async function evaluateIntegrationFactors(taskDescription: string): Promise<IntegrationFactors> {
  const patterns = {
    systemInteractions: [
      /api|integrate|connect|communicate|sync|external|service/i,
      /database|storage|cache|queue/i,
      /protocol|http|rest|graphql|grpc/i
    ],
    dataTransformations: [
      /transform|convert|parse|format|serialize|deserialize/i,
      /json|xml|csv|binary|protobuf/i,
      /mapping|schema|model|interface/i
    ],
    stateManagement: [
      /state|status|lifecycle|transaction/i,
      /concurrent|parallel|async|sync/i,
      /manage|control|maintain|track/i
    ],
    errorHandling: [
      /error|exception|fault|failure/i,
      /handle|catch|try|recover/i,
      /fallback|retry|timeout/i
    ],
    security: [
      /security|auth|identity|permission/i,
      /encrypt|decrypt|token|key/i,
      /validate|verify|protect/i
    ]
  } as const;

  const scores: IntegrationFactors = {
    systemInteractions: 0,
    dataTransformations: 0,
    stateManagement: 0,
    errorHandling: 0,
    security: 0
  };

  // Evaluate each factor based on pattern matching
  for (const [factor, patternList] of Object.entries(patterns)) {
    const matches = patternList.reduce((count, pattern) => {
      return count + (pattern.test(taskDescription) ? 1 : 0);
    }, 0);
    scores[factor as keyof IntegrationFactors] = Math.min(matches / patternList.length, 1);
  }

  return scores;
}

/**
 * Evaluate domain knowledge requirements for a task
 * @param taskDescription The task description to evaluate
 * @returns Domain knowledge evaluation scores
 */
async function evaluateDomainKnowledge(taskDescription: string): Promise<DomainFactors> {
  const patterns = {
    domainSpecificity: [
      /business( logic| rules?| process)/i,
      /domain[- ]specific|industry[- ]standard/i,
      /regulatory|compliance|legal/i,
      /(financial|medical|legal) (terms?|concepts?|rules?)/i
    ],
    technicalDepth: [
      /\b(architect|design pattern|framework)\b/i,
      /\b(optimization|performance|scaling)\b/i,
      /\b(algorithm|data structure)\b/i,
      /\b(security|authentication|authorization)\b/i
    ],
    learningCurve: [
      /\b(complex|complicated|advanced)\b/i,
      /\b(prerequisite|requires? knowledge)\b/i,
      /\b(specialized|expert|proficiency)\b/i,
      /\b(deep|thorough) understanding\b/i
    ],
    contextDependency: [
      /\b(context|environment|setup)\b/i,
      /\b(dependent|dependency|requires)\b/i,
      /\b(configuration|settings?|parameters?)\b/i,
      /\b(integration|interact|communicate)\b/i
    ],
    standardsCompliance: [
      /\b(standard|specification|protocol)\b/i,
      /\b(RFC|ISO|IEEE|API)\b/i,
      /\b(convention|guideline|best practice)\b/i,
      /\b(compatibility|compliant|adherence)\b/i
    ]
  } as const;

  const scores: DomainFactors = {
    domainSpecificity: 0,
    technicalDepth: 0,
    learningCurve: 0,
    contextDependency: 0,
    standardsCompliance: 0
  };

  // Evaluate each factor based on pattern matching and weight
  for (const [factor, patternList] of Object.entries(patterns)) {
    const matches = patternList.reduce((count, pattern) => {
      return count + (pattern.test(taskDescription) ? 1 : 0);
    }, 0);
    scores[factor as keyof DomainFactors] = Math.min(matches / patternList.length, 1);
  }

  return scores;
}

/**
 * Evaluate technical requirements complexity for a task
 * @param taskDescription The task description to evaluate
 * @returns Technical requirements evaluation scores
 */
async function evaluateTechnicalRequirements(taskDescription: string): Promise<Record<string, number>> {
  // Define patterns to recognize different technical requirement aspects
  const patterns = {
    infrastructureNeeds: [
      /\b(infrastructure|servers?|cloud|deployment|hosting)\b/i,
      /\b(containerization|docker|kubernetes|k8s|orchestration)\b/i,
      /\b(scaling|load balancing|high availability|failover)\b/i,
      /\b(network|bandwidth|latency|throughput)\b/i
    ],
    performanceRequirements: [
      /\b(performance|speed|fast|optimize|efficient)\b/i,
      /\b(realtime|low latency|high throughput)\b/i,
      /\b(response time|processing time|computation time)\b/i,
      /\b(benchmark|metrics|SLA|service level)\b/i
    ],
    securityCompliance: [
      /\b(security|authentication|authorization)\b/i,
      /\b(encryption|hashing|secure connection|ssl|tls)\b/i,
      /\b(compliance|GDPR|HIPAA|PCI|SOC|ISO)\b/i,
      /\b(audit|logging|monitoring|tracking)\b/i
    ],
    compatibilityConstraints: [
      /\b(compatibility|interoperable|cross-platform)\b/i,
      /\b(browser|device|mobile|responsive)\b/i,
      /\b(backward compatible|legacy|support|version)\b/i,
      /\b(integration|interfaces|APIs|protocols)\b/i
    ],
    scalabilityRequirements: [
      /\b(scalability|scale|growth|volume)\b/i,
      /\b(horizontal scaling|vertical scaling|auto-scaling)\b/i,
      /\b(concurrent|simultaneous|parallel|users)\b/i,
      /\b(load|traffic|spike|peak|capacity)\b/i
    ],
    testingRequirements: [
      /\b(testing|test suite|test cases|test coverage)\b/i,
      /\b(unit test|integration test|system test|e2e test)\b/i,
      /\b(QA|quality assurance|validation|verification)\b/i,
      /\b(CI\/CD|continuous integration|continuous delivery|continuous deployment)\b/i
    ]
  };

  const scores: Record<string, number> = {
    infrastructureNeeds: 0,
    performanceRequirements: 0,
    securityCompliance: 0,
    compatibilityConstraints: 0,
    scalabilityRequirements: 0,
    testingRequirements: 0
  };

  // Evaluate each technical factor based on pattern matching
  for (const [factor, patternList] of Object.entries(patterns)) {
    const matches = patternList.reduce((count, pattern) => {
      return count + (pattern.test(taskDescription) ? 1 : 0);
    }, 0);
    scores[factor] = Math.min(matches / patternList.length, 1);
  }

  // Add a weighted complexity score based on the number of technical requirements detected
  const requirementsDetected = Object.values(scores).filter(score => score > 0).length;
  scores.overallTechnicalComplexity = Math.min(requirementsDetected / Object.keys(scores).length * 1.5, 1);

  return scores;
}