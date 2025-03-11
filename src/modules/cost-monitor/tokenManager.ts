import { logger } from '../../utils/logger.js';
import { Tiktoken, getEncoding, TiktokenEncoding } from 'js-tiktoken';
import { v4 as uuidv4 } from 'uuid';
import { CodeSubtask } from '../decision-engine/types/codeTask.js';

/**
 * Interface for scored code sections during optimization
 */
interface ScoredSection {
  content: string;
  complexity: number;
  relevance: number;
}

/**
 * Code task context data for token optimization
 */
export interface CodeTaskContext {
  language: string;
  imports: string[];
  symbols: string[];
  dependencies: Record<string, string>;
  tokensPerSection: Record<string, number>;
}

/**
 * Token usage tracking class
 * Inspired by the Minions implementation but adapted for TypeScript
 */
export class TokenUsage {
  completionTokens: number;
  promptTokens: number;
  cachedPromptTokens: number;
  seenPromptTokens: number;
  codeComponentTokens?: Record<string, number>; // New: Track tokens by code component

  constructor() {
    this.completionTokens = 0;
    this.promptTokens = 0;
    this.cachedPromptTokens = 0;
    this.seenPromptTokens = 0;
    this.codeComponentTokens = {};
  }

  /**
   * Calculate new prompt tokens that weren't seen before
   */
  get newPromptTokens(): number {
    if (this.seenPromptTokens === undefined || this.seenPromptTokens === null) {
      return this.promptTokens;
    }
    return this.promptTokens - this.seenPromptTokens;
  }

  /**
   * Calculate total tokens used
   */
  get totalTokens(): number {
    return this.completionTokens + this.promptTokens;
  }

  /**
   * Add another usage to this one
   * 
   * @param other The other usage to add
   * @returns A new TokenUsage with combined counts
   */
  add(other: TokenUsage): TokenUsage {
    const result = new TokenUsage();
    result.completionTokens = this.completionTokens + other.completionTokens;
    result.promptTokens = this.promptTokens + other.promptTokens;
    result.cachedPromptTokens = this.cachedPromptTokens + other.cachedPromptTokens;
    result.seenPromptTokens = this.seenPromptTokens + other.seenPromptTokens;

    // Merge code component tokens
    result.codeComponentTokens = { ...this.codeComponentTokens };

    if (other.codeComponentTokens) {
      Object.entries(other.codeComponentTokens).forEach(([component, tokens]) => {
        result.codeComponentTokens![component] = (result.codeComponentTokens![component] || 0) + tokens;
      });
    }

    return result;
  }

  /**
   * Record token usage for a specific code component
   * 
   * @param component Component name (function, class, etc.)
   * @param tokens Token count
   */
  recordComponentTokens(component: string, tokens: number): void {
    if (!this.codeComponentTokens) {
      this.codeComponentTokens = {};
    }
    this.codeComponentTokens[component] = (this.codeComponentTokens[component] || 0) + tokens;
  }

  /**
   * Convert to a plain object for serialization
   */
  toObject(): Record<string, any> {
    return {
      completionTokens: this.completionTokens,
      promptTokens: this.promptTokens,
      totalTokens: this.totalTokens,
      cachedPromptTokens: this.cachedPromptTokens,
      seenPromptTokens: this.seenPromptTokens,
      newPromptTokens: this.newPromptTokens,
      codeComponentTokens: this.codeComponentTokens,
    };
  }
}

/**
 * Token Manager Service
 * Handles token counting and caching for code tasks
 */
export const tokenManager: {
  encoderCache: Map<string, Tiktoken>;
  promptCache: Map<string, number[]>;
  config: {
    maxTokensPerSubtask: number;
    defaultContextWindow: number;
    completionTokenBuffer: number;
    chunkOverlap: number;
  };
  getEncoder(model: string): Tiktoken;
  countTokens(text: string, model?: string): number;
  countTokensInMessages(messages: Array<{ role: string; content: string; name?: string }>, model?: string): number;
  calculateUsage(prompt: string, completion: string, model?: string): TokenUsage;
  calculateCodeUsage(code: string, componentName: string, model?: string): TokenUsage;
  generateCacheKey(prompt: string): string;
  clearCache(): void;
  splitCodeTaskByTokens(taskDescription: string, codeContext: CodeTaskContext, maxContextWindow?: number, model?: string): CodeSubtask[];
  identifyCodeSections(code: string): Array<{ content: string; complexity: number }>;
  estimateComplexity(code: string): number;
  inferCodeType(code: string): CodeSubtask['codeType'];
  optimizeCodeContext(context: string, taskDescription: string, maxTokens?: number, model?: string): string;
  calculateRelevance(section: string, taskDescription: string): number;
  summarizeSection(section: string): string;
} = {
  // Cache of encoders to avoid recreating them
  encoderCache: new Map<string, Tiktoken>(),

  // Cache of encoded prompts to track seen tokens
  promptCache: new Map<string, number[]>(),

  // Configuration for token management
  config: {
    // Maximum tokens per code subtask (by default)
    maxTokensPerSubtask: 2048,

    // Maximum context window size (default for GPT-4)
    defaultContextWindow: 8192,

    // Token buffer for completions (reserved space)
    completionTokenBuffer: 1024,

    // Overlap between context chunks (for coherence)
    chunkOverlap: 100,
  },

  /**
   * Get a token encoder for a specific model
   * 
   * @param model The model to get an encoder for
   * @returns The token encoder
   */
  getEncoder(model: string): Tiktoken {
    if (this.encoderCache.has(model)) {
      return this.encoderCache.get(model)!;
    }

    try {
      // Create a new encoder
      const encoding = getEncoding(model as TiktokenEncoding);
      this.encoderCache.set(model, encoding);
      return encoding;
    } catch (error) {
      // Fallback to cl100k_base for unknown models
      logger.warn(`Unknown model for tokenization: ${model}, falling back to cl100k_base`);
      const encoding = getEncoding('cl100k_base');
      this.encoderCache.set(model, encoding);
      return encoding;
    }
  },

  /**
   * Count tokens in a string
   * 
   * @param text Text to count tokens in
   * @param model Model to use for tokenization
   * @returns Number of tokens
   */
  countTokens(text: string, model: string = 'cl100k_base'): number {
    const encoder = this.getEncoder(model);
    return encoder.encode(text).length;
  },

  /**
   * Count tokens in a chat message format
   * Adapted from OpenAI cookbook for token counting
   * 
   * @param messages Array of chat messages
   * @param model Model to use for tokenization
   * @returns Number of tokens
   */
  countTokensInMessages(
    messages: Array<{ role: string; content: string; name?: string }>,
    model: string = 'gpt-3.5-turbo'
  ): number {
    const encoder = this.getEncoder(model);

    // Constants for token calculation (based on OpenAI's implementation)
    const tokensPerMessage = 3;
    const tokensPerName = 1;

    let numTokens = 0;

    for (const message of messages) {
      numTokens += tokensPerMessage;

      for (const [key, value] of Object.entries(message)) {
        const tokenLength = encoder.encode(value).length;
        numTokens += tokenLength;

        if (key === 'name') {
          numTokens += tokensPerName;
        }
      }
    }

    // Add reply priming tokens
    numTokens += 3; // every reply is primed with <|start|>assistant<|message|>

    return numTokens;
  },

  /**
   * Calculate token usage with caching awareness
   * 
   * @param prompt Input prompt
   * @param completion Generated completion
   * @param model Model used
   * @returns Token usage statistics
   */
  calculateUsage(prompt: string, completion: string, model: string = 'cl100k_base'): TokenUsage {
    const encoder = this.getEncoder(model);
    const usage = new TokenUsage();

    // Encode the prompt and completion
    const promptTokens = encoder.encode(prompt);
    const completionTokens = encoder.encode(completion);

    usage.promptTokens = promptTokens.length;
    usage.completionTokens = completionTokens.length;

    // Check cache for this prompt
    const promptKey = this.generateCacheKey(prompt);

    if (this.promptCache.has(promptKey)) {
      // We've seen this prompt before
      const cachedTokens = this.promptCache.get(promptKey)!;
      usage.seenPromptTokens = cachedTokens.length;

      // Count how many tokens are shared with the cache
      const tokenSet = new Set(cachedTokens);
      let cachedCount = 0;

      for (const token of promptTokens) {
        if (tokenSet.has(token)) {
          cachedCount++;
        }
      }

      usage.cachedPromptTokens = cachedCount;
    } else {
      // First time seeing this prompt, cache it
      this.promptCache.set(promptKey, promptTokens);
      usage.seenPromptTokens = 0;
      usage.cachedPromptTokens = 0;
    }

    return usage;
  },

  /**
   * Calculate token usage for a code component specifically
   * 
   * @param code Code snippet
   * @param componentName Name of the component (function, class, etc.)
   * @param model Model used
   * @returns Token usage with component tracking
   */
  calculateCodeUsage(code: string, componentName: string, model: string = 'cl100k_base'): TokenUsage {
    const usage = this.calculateUsage(code, "", model);
    usage.recordComponentTokens(componentName, usage.promptTokens);
    return usage;
  },

  /**
   * Generate a cache key for a prompt
   * 
   * @param prompt The prompt text
   * @returns A cache key
   */
  generateCacheKey(prompt: string): string {
    // Simple hash for prompt caching
    // In a production system, use a better hashing algorithm
    return prompt
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .slice(0, 100); // Use prefix for quick matching
  },

  /**
   * Clear the token cache
   */
  clearCache(): void {
    this.promptCache.clear();
  },

  /**
   * Split a code task into subtasks based on token limits
   * Implements token-aware task splitting for code generation
   * 
   * @param taskDescription Full task description
   * @param codeContext Code context information
   * @param maxContextWindow Maximum context window size for the model
   * @param model Model to use for tokenization
   * @returns Array of code subtasks
   */
  splitCodeTaskByTokens(
    this: typeof tokenManager,
    taskDescription: string,
    codeContext: CodeTaskContext,
    maxContextWindow: number = this.config.defaultContextWindow,
    model: string = 'cl100k_base'
  ): CodeSubtask[] {
    const availableTokens = maxContextWindow - this.config.completionTokenBuffer;
    const encoder = this.getEncoder(model);
    const taskTokens = encoder.encode(taskDescription).length;

    if (taskTokens <= availableTokens) {
      return [{
        id: uuidv4(),
        description: taskDescription,
        complexity: 0.5,
        dependencies: [],
        codeType: 'other' as const,
        estimatedTokens: taskTokens,
        recommendedModelSize: 'medium'
      }];
    }

    const subtasks: CodeSubtask[] = [];
    const sections = this.identifyCodeSections(taskDescription);
    let currentSubtask = "";
    let currentTokens = 0;
    let currentComplexity = 0;
    let sectionCount = 0;

    for (const section of sections) {
      const sectionTokens = encoder.encode(section.content).length;
      if (currentTokens + sectionTokens > this.config.maxTokensPerSubtask && currentSubtask !== "") {
        subtasks.push({
          id: uuidv4(),
          description: currentSubtask,
          complexity: currentComplexity / Math.max(1, sectionCount),
          dependencies: [],
          codeType: this.inferCodeType(currentSubtask),
          estimatedTokens: currentTokens,
          recommendedModelSize: 'medium'
        });
        currentSubtask = "";
        currentTokens = 0;
        currentComplexity = 0;
        sectionCount = 0;
      }
      currentSubtask += (currentSubtask ? "\n\n" : "") + section.content;
      currentTokens += sectionTokens;
      currentComplexity += section.complexity || 0.5;
      sectionCount++;
    }

    if (currentSubtask !== "") {
      subtasks.push({
        id: uuidv4(),
        description: currentSubtask,
        complexity: currentComplexity / Math.max(1, sectionCount),
        dependencies: [],
        codeType: this.inferCodeType(currentSubtask),
        estimatedTokens: currentTokens,
        recommendedModelSize: 'medium'
      });
    }

    // Set up dependencies between subtasks
    for (let i = 1; i < subtasks.length; i++) {
      subtasks[i].dependencies.push(subtasks[i-1].id);
    }

    return subtasks;
  },

  /**
   * Identify code sections and their characteristics
   * 
   * @param code Full code or task description
   * @returns Array of sections with their content and complexity
   */
  identifyCodeSections(code: string): Array<{ content: string; complexity: number }> {
    // Split the code by common section markers
    const sections: Array<{ content: string; complexity: number }> = [];
    const rawSections = code.split(/(?:^|\n)(?:\/\/\s*-{3,}|#{3,}|\*{3,}|={3,}|-{3,})/);

    for (const section of rawSections) {
      if (!section.trim()) continue;

      const sectionContent = section.trim();
      const complexity = this.estimateComplexity(sectionContent);

      sections.push({
        content: sectionContent,
        complexity
      });
    }

    return sections;
  },

  /**
   * Estimate complexity of a code section based on patterns
   * 
   * @param code Code section
   * @returns Complexity score (0-1)
   */
  estimateComplexity(code: string): number {
    // Simple complexity estimation based on indicators
    let complexity = 0.5; // Default medium complexity

    // Signs of higher complexity
    const complexityFactors = [
      { pattern: /\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/g, weight: 0.05 },  // Loops
      { pattern: /\bif\s*\(|\belse\s*\{|\bswitch\s*\(/g, weight: 0.03 }, // Conditionals
      { pattern: /\bcatch\s*\(|\btry\s*\{|\bfinally\s*\{/g, weight: 0.05 }, // Exception handling
      { pattern: /\basync\s+|\bawait\s+|\bPromise\s*\./g, weight: 0.07 }, // Async code
      { pattern: /\bclass\s+|\bextends\s+|\bimplements\s+/g, weight: 0.06 }, // OOP
      { pattern: /\bfunction\s*\*|\byield\s+/g, weight: 0.08 }, // Generators
      { pattern: /\bnew\s+[A-Z][a-zA-Z0-9]*/g, weight: 0.04 }, // Object instantiation
      { pattern: /\.map\s*\(|\.filter\s*\(|\.reduce\s*\(/g, weight: 0.05 }, // Functional patterns
      { pattern: /\<[^>]+\>/g, weight: 0.04 } // Generic types
    ];

    // Adjust complexity based on detected patterns
    for (const factor of complexityFactors) {
      const matches = code.match(factor.pattern) || [];
      complexity += matches.length * factor.weight;
    }

    // Also consider code length as a complexity factor
    complexity += Math.min(0.2, code.length / 5000);

    // Cap complexity between 0.1 and 1.0
    return Math.min(1.0, Math.max(0.1, complexity));
  },

  /**
   * Infer the type of code in a section
   * 
   * @param code Code content
   * @returns The inferred code type
   */
  inferCodeType(code: string): CodeSubtask['codeType'] {
    // Check for interface or type declaration
    if (/\binterface\s+\w+|type\s+\w+\s*=/i.test(code)) {
      return 'interface';
    }

    // Check for class
    if (/\bclass\s+\w+/i.test(code)) {
      return 'class';
    }

    // Check for function
    if (/\bfunction\s+\w+|\bconst\s+\w+\s*=\s*(?:\async\s*)?\([^)]*\)\s*=>/i.test(code)) {
      return 'function';
    }

    // Check for test
    if (/\bdescribe\s*\(|\bit\s*\(|\btest\s*\(/i.test(code)) {
      return 'test';
    }

    // Check for module or import/export heavy code
    if (/\bimport\s+|\bexport\s+/i.test(code)) {
      return 'module';
    }

    // Default
    return 'other';
  },

  /**
   * Optimize context for a code task by prioritizing important parts
   * 
   * @param context Full context string
   * @param taskDescription Task description
   * @param maxTokens Maximum tokens to use for context
   * @param model Model to use for tokenization
   * @returns Optimized context string
   */
  optimizeCodeContext(
    context: string,
    taskDescription: string,
    maxTokens: number = 2048,
    model: string = 'cl100k_base'
  ): string {
    const encoder = this.getEncoder(model);
    const taskTokens = encoder.encode(taskDescription).length;

    // Reserve tokens for the task description
    const availableContextTokens = maxTokens - taskTokens - 50; // 50 token buffer

    // If context already fits, return it unchanged
    const contextTokens = encoder.encode(context).length;
    if (contextTokens <= availableContextTokens) {
      return context;
    }

    // Need to optimize context - identify sections by relevance
    const sections = this.identifyCodeSections(context);
    const scoredSections = sections.map((section: { content: string; complexity: number }): ScoredSection => {
      const relevance = this.calculateRelevance(section.content, taskDescription);
      return {
        ...section,
        relevance
      };
    });

    // Sort sections by relevance (descending)
    scoredSections.sort((a: ScoredSection, b: ScoredSection) => b.relevance - a.relevance);

    // Build optimized context up to token limit
    let optimizedContext = "";
    let currentTokens = 0;

    for (const section of scoredSections) {
      const sectionTokens = encoder.encode(section.content).length;

      if (currentTokens + sectionTokens <= availableContextTokens) {
        optimizedContext += (optimizedContext ? "\n\n" : "") + section.content;
        currentTokens += sectionTokens;
      } else {
        // If we can't add the full section, try to add a summary
        const summary = this.summarizeSection(section.content);
        const summaryTokens = encoder.encode(summary).length;

        if (currentTokens + summaryTokens <= availableContextTokens) {
          optimizedContext += (optimizedContext ? "\n\n" : "") + summary;
          currentTokens += summaryTokens;
        }
      }
    }

    logger.debug(`Optimized context from ${contextTokens} to ${currentTokens} tokens`);
    return optimizedContext;
  },

  /**
   * Calculate relevance of a section to a task description
   * 
   * @param section Section content
   * @param taskDescription Task description
   * @returns Relevance score (0-1)
   */
  calculateRelevance(section: string, taskDescription: string): number {
    // Extract keywords from task description
    const taskWords = new Set(
      taskDescription
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3)
    );

    // Count matching keywords in section
    const sectionLower = section.toLowerCase();
    let matches = 0;

    for (const word of taskWords) {
      if (sectionLower.includes(word)) {
        matches++;
      }
    }

    // Calculate relevance score
    const relevance = taskWords.size > 0 ? matches / taskWords.size : 0;

    return relevance;
  },

  /**
   * Create a short summary of a code section
   * 
   * @param section Code section
   * @returns Summarized version
   */
  summarizeSection(section: string): string {
    // Extract key elements like function/class/interface signatures
    const lines = section.split('\n');
    const signatures: string[] = [];

    // Regular expressions to match important definitions
    const signaturePatterns = [
      /^\s*(export\s+)?(default\s+)?(class|interface|type|function|const|let|var)\s+(\w+)/,
      /^\s*(export\s+)(default\s+)?({.*})/,
      /^\s*\/\/\s*(.+)/ // Comments
    ];

    // Extract key signatures
    for (const line of lines) {
      for (const pattern of signaturePatterns) {
        if (pattern.test(line)) {
          signatures.push(line.trim());
          break;
        }
      }
    }

    // If we found signatures, use them as summary
    if (signatures.length > 0) {
      return `// Summary of section:\n${signatures.join('\n')}`;
    }

    // Otherwise just return the first few lines
    return `// Section summary:\n${lines.slice(0, 3).join('\n')}...`;
  }
};