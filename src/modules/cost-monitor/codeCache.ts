import { logger } from '../../utils/logger.js';
import { tokenManager, CodeTaskContext } from './tokenManager.js';
import { CodeSubtask } from '../decision-engine/types/codeTask.js';

/**
 * Interface for cached code information
 */
interface CachedCodeEntry {
  code: string;
  tokens: number[];
  lastUsed: number;
  useCount: number;
  taskType: string;
  codeType: string;
  complexity: number;
  tokenCount: number; // Total token count for quick reference
  dependencies?: string[]; // References to other cached components
}

/**
 * Code pattern to match against the cache
 */
interface CodePattern {
  code: string;
  taskType?: string;
  codeType?: string;
  complexityRange?: [number, number];
}

/**
 * Code cache match result
 */
interface CodeCacheMatch {
  entry: CachedCodeEntry;
  similarity: number;
  tokenOverlap: number;
  reuseScore: number;
}

/**
 * Code chunk for context window management
 */
interface CodeChunk {
  content: string;
  tokenCount: number;
  priority: number;
  metadata?: Record<string, any>;
}

// Export interfaces
export type { CachedCodeEntry, CodePattern, CodeCacheMatch, CodeChunk };

/**
 * Service for caching and retrieving code snippets
 * This helps reduce redundant token usage for similar coding tasks
 */
export const codeCache = {
  // Cache storage
  cache: new Map<string, CachedCodeEntry>(),
  
  // Pattern cache for matching similar code
  patternCache: new Map<string, Set<string>>(),
  
  // Cache capacity
  maxCacheSize: 1000,
  
  // Minimum similarity for a match (0-1)
  minSimilarity: 0.7,
  
  /**
   * Add a code snippet to the cache
   * 
   * @param code The code snippet
   * @param taskType Type of task (e.g., 'api', 'ui', 'database')
   * @param codeType Type of code structure (e.g., 'class', 'function', 'interface')
   * @param complexity Complexity of the code (0-1)
   * @returns The cache key
   */
  add(
    code: string,
    taskType: string = 'general',
    codeType: string = 'other',
    complexity: number = 0.5
  ): string {
    // Generate a key for this code snippet
    const key = this.generateCacheKey(code, taskType, codeType);
    
    // Check if this is already in the cache
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)!;
      entry.lastUsed = Date.now();
      entry.useCount++;
      return key;
    }
    
    // Encode the code into tokens
    const encoder = tokenManager.getEncoder('cl100k_base');
    const tokens = encoder.encode(code);
    
    // Add to cache
    this.cache.set(key, {
      code,
      tokens,
      lastUsed: Date.now(),
      useCount: 1,
      taskType,
      codeType,
      complexity,
      tokenCount: tokens.length
    });
    
    // Update pattern cache for faster similarity matching
    this.updatePatternCache(key, code, taskType, codeType);
    
    // If the cache exceeds its maximum size, remove the least recently used entries
    if (this.cache.size > this.maxCacheSize) {
      this.evictLeastUsed();
    }
    
    return key;
  },
  
  /**
   * Update the pattern cache with extracted patterns from code
   * 
   * @param key Cache key
   * @param code Code content
   * @param taskType Task type
   * @param codeType Code type
   */
  updatePatternCache(key: string, code: string, taskType: string, codeType: string): void {
    // Extract code patterns (simplified for now - could be enhanced with AST parsing)
    const patterns = this.extractCodePatterns(code);
    
    // Add to pattern cache for faster lookup
    for (const pattern of patterns) {
      const patternKey = `${taskType}:${codeType}:${pattern}`;
      
      if (!this.patternCache.has(patternKey)) {
        this.patternCache.set(patternKey, new Set<string>());
      }
      
      this.patternCache.get(patternKey)!.add(key);
    }
  },
  
  /**
   * Extract common patterns from code for pattern matching
   * 
   * @param code Code content
   * @returns Array of pattern strings
   */
  extractCodePatterns(code: string): string[] {
    const patterns: Set<string> = new Set();
    
    // Extract function signatures
    const functionMatches = code.match(/function\s+(\w+)\s*\([^)]*\)/g);
    if (functionMatches) {
      for (const match of functionMatches) {
        patterns.add(match.replace(/\s+/g, ' ').trim());
      }
    }
    
    // Extract arrow function patterns
    const arrowMatches = code.match(/const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
    if (arrowMatches) {
      for (const match of arrowMatches) {
        patterns.add(match.replace(/\s+/g, ' ').trim());
      }
    }
    
    // Extract class definitions
    const classMatches = code.match(/class\s+(\w+)(?:\s+extends\s+(\w+))?/g);
    if (classMatches) {
      for (const match of classMatches) {
        patterns.add(match.replace(/\s+/g, ' ').trim());
      }
    }
    
    // Extract interface definitions
    const interfaceMatches = code.match(/interface\s+(\w+)(?:\s+extends\s+(\w+))?/g);
    if (interfaceMatches) {
      for (const match of interfaceMatches) {
        patterns.add(match.replace(/\s+/g, ' ').trim());
      }
    }
    
    // Extract method signatures
    const methodMatches = code.match(/(?:public|private|protected)?\s*(?:async\s*)?\w+\s*\([^)]*\)/g);
    if (methodMatches) {
      for (const match of methodMatches) {
        patterns.add(match.replace(/\s+/g, ' ').trim());
      }
    }
    
    return Array.from(patterns);
  },
  
  /**
   * Find similar code snippets in the cache
   * 
   * @param pattern Pattern to match against
   * @param limit Maximum number of results to return
   * @returns Array of matching entries sorted by similarity
   */
  findSimilar(pattern: CodePattern, limit: number = 5): CodeCacheMatch[] {
    const results: CodeCacheMatch[] = [];
    const patternTokens = tokenManager.getEncoder('cl100k_base').encode(pattern.code);
    const patternTokenSet = new Set(patternTokens);
    
    // Fast path: try to find matches via pattern cache first
    const candidateKeys = new Set<string>();
    const extractedPatterns = this.extractCodePatterns(pattern.code);
    
    for (const extractedPattern of extractedPatterns) {
      const patternKey = `${pattern.taskType || '*'}:${pattern.codeType || '*'}:${extractedPattern}`;
      
      // Try exact match
      if (this.patternCache.has(patternKey)) {
        for (const key of this.patternCache.get(patternKey)!) {
          candidateKeys.add(key);
        }
      }
      
      // Try wildcard task type
      const wildcardTaskKey = `*:${pattern.codeType || '*'}:${extractedPattern}`;
      if (this.patternCache.has(wildcardTaskKey)) {
        for (const key of this.patternCache.get(wildcardTaskKey)!) {
          candidateKeys.add(key);
        }
      }
      
      // Try wildcard code type
      const wildcardCodeKey = `${pattern.taskType || '*'}:*:${extractedPattern}`;
      if (this.patternCache.has(wildcardCodeKey)) {
        for (const key of this.patternCache.get(wildcardCodeKey)!) {
          candidateKeys.add(key);
        }
      }
    }
    
    // Evaluate candidate matches first (these are likely to be more relevant)
    for (const key of candidateKeys) {
      const entry = this.cache.get(key);
      if (!entry) continue;
      
      // Skip if task type doesn't match (if specified)
      if (pattern.taskType && entry.taskType !== pattern.taskType) {
        continue;
      }
      
      // Skip if code type doesn't match (if specified)
      if (pattern.codeType && entry.codeType !== pattern.codeType) {
        continue;
      }
      
      // Skip if complexity is outside the specified range (if specified)
      if (
        pattern.complexityRange && 
        (entry.complexity < pattern.complexityRange[0] || 
         entry.complexity > pattern.complexityRange[1])
      ) {
        continue;
      }
      
      // Count token overlap
      const entryTokenSet = new Set(entry.tokens);
      let overlap = 0;
      
      for (const token of patternTokens) {
        if (entryTokenSet.has(token)) {
          overlap++;
        }
      }
      
      // Calculate similarity metrics
      const tokenOverlap = overlap;
      const similarity = overlap / Math.max(patternTokens.length, entry.tokens.length);
      
      // Calculate a reuse score that also accounts for recency and use count
      const recencyFactor = Math.min(1.0, (Date.now() - entry.lastUsed) / (1000 * 60 * 60 * 24 * 7)); // 1 week
      const usageBonus = Math.min(0.2, entry.useCount / 50); // Max 0.2 bonus for frequently used entries
      const reuseScore = similarity * (1.0 - recencyFactor * 0.2) + usageBonus;
      
      // Add to results if similarity is above threshold
      if (similarity >= this.minSimilarity) {
        results.push({
          entry,
          similarity,
          tokenOverlap,
          reuseScore
        });
      }
    }
    
    // If we don't have enough results, search the entire cache
    if (results.length < limit) {
      // Iterate over remaining cache entries (excluding ones we've already processed)
      for (const [key, entry] of this.cache.entries()) {
        if (candidateKeys.has(key)) continue; // Skip already processed entries
        
        // Skip if task type doesn't match (if specified)
        if (pattern.taskType && entry.taskType !== pattern.taskType) {
          continue;
        }
        
        // Skip if code type doesn't match (if specified)
        if (pattern.codeType && entry.codeType !== pattern.codeType) {
          continue;
        }
        
        // Skip if complexity is outside the specified range (if specified)
        if (
          pattern.complexityRange && 
          (entry.complexity < pattern.complexityRange[0] || 
           entry.complexity > pattern.complexityRange[1])
        ) {
          continue;
        }
        
        // Count token overlap
        const entryTokenSet = new Set(entry.tokens);
        let overlap = 0;
        
        for (const token of patternTokens) {
          if (entryTokenSet.has(token)) {
            overlap++;
          }
        }
        
        // Calculate similarity metrics
        const tokenOverlap = overlap;
        const similarity = overlap / Math.max(patternTokens.length, entry.tokens.length);
        
        // Calculate a reuse score that also accounts for recency and use count
        const recencyFactor = Math.min(1.0, (Date.now() - entry.lastUsed) / (1000 * 60 * 60 * 24 * 7)); // 1 week
        const usageBonus = Math.min(0.2, entry.useCount / 50); // Max 0.2 bonus for frequently used entries
        const reuseScore = similarity * (1.0 - recencyFactor * 0.2) + usageBonus;
        
        // Add to results if similarity is above threshold
        if (similarity >= this.minSimilarity) {
          results.push({
            entry,
            similarity,
            tokenOverlap,
            reuseScore
          });
        }
      }
    }
    
    // Sort by reuse score (descending) and limit results
    return results
      .sort((a, b) => b.reuseScore - a.reuseScore)
      .slice(0, limit);
  },
  
  /**
   * Find the best code snippets to reuse for a set of subtasks
   * 
   * @param subtasks Array of code subtasks
   * @returns Map of subtask ID to best matching cache entry
   */
  findBestMatchesForSubtasks(subtasks: CodeSubtask[]): Map<string, CodeCacheMatch> {
    const matches = new Map<string, CodeCacheMatch>();
    
    for (const subtask of subtasks) {
      // Create a pattern to match against the cache
      const pattern: CodePattern = {
        code: subtask.description,
        codeType: subtask.codeType,
        complexityRange: [Math.max(0, subtask.complexity - 0.2), Math.min(1, subtask.complexity + 0.2)]
      };
      
      // Find similar entries
      const similar = this.findSimilar(pattern, 1);
      
      // If we found a good match, store it
      if (similar.length > 0 && similar[0].similarity >= this.minSimilarity) {
        matches.set(subtask.id, similar[0]);
      }
    }
    
    return matches;
  },
  
  /**
   * Get a cached entry by key
   * 
   * @param key Cache key
   * @returns Cached entry or undefined if not found
   */
  get(key: string): CachedCodeEntry | undefined {
    const entry = this.cache.get(key);
    
    if (entry) {
      // Update usage metrics
      entry.lastUsed = Date.now();
      entry.useCount++;
    }
    
    return entry;
  },
  
  /**
   * Remove an entry from the cache
   * 
   * @param key Cache key
   * @returns True if the entry was removed, false otherwise
   */
  remove(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    // Remove from pattern cache as well
    const patterns = this.extractCodePatterns(entry.code);
    for (const pattern of patterns) {
      const patternKey = `${entry.taskType}:${entry.codeType}:${pattern}`;
      if (this.patternCache.has(patternKey)) {
        this.patternCache.get(patternKey)!.delete(key);
        
        // Clean up empty sets
        if (this.patternCache.get(patternKey)!.size === 0) {
          this.patternCache.delete(patternKey);
        }
      }
    }
    
    return this.cache.delete(key);
  },
  
  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.patternCache.clear();
  },
  
  /**
   * Generate a cache key for a code snippet
   * 
   * @param code Code snippet
   * @param taskType Type of task
   * @param codeType Type of code structure
   * @returns Cache key
   */
  generateCacheKey(code: string, taskType: string = 'general', codeType: string = 'other'): string {
    // Create a normalized version of the code for keying
    const normalizedCode = code
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .toLowerCase();
    
    // Create a hash based on code and types
    const hashInput = `${taskType}:${codeType}:${normalizedCode.substring(0, 100)}`;
    
    return this.simpleHash(hashInput);
  },
  
  /**
   * Create a simple hash for use as a cache key
   * 
   * @param input String to hash
   * @returns Hash string
   */
  simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  },
  
  /**
   * Evict the least recently used items from the cache
   */
  evictLeastUsed(): void {
    // Sort entries by last used time and use count
    const entries = [...this.cache.entries()].sort((a, b) => {
      // Primary sort by use count (ascending)
      const countDiff = a[1].useCount - b[1].useCount;
      if (countDiff !== 0) return countDiff;
      
      // Secondary sort by last used time (ascending)
      return a[1].lastUsed - b[1].lastUsed;
    });
    
    // Remove the oldest 10% of entries
    const removeCount = Math.max(1, Math.floor(this.cache.size * 0.1));
    for (let i = 0; i < removeCount; i++) {
      if (entries[i]) {
        this.remove(entries[i][0]);
      }
    }
    
    logger.debug(`Evicted ${removeCount} entries from code cache.`);
  },
  
  /**
   * Chunk code by section for context window optimization
   * Inspired by minions.py:chunk_by_section
   * 
   * @param code The complete code to chunk
   * @param maxTokensPerChunk Maximum tokens per chunk
   * @param model Model to use for tokenization
   * @returns Array of code chunks
   */
  chunkCodeBySection(
    code: string,
    maxTokensPerChunk: number = 2048,
    model: string = 'cl100k_base'
  ): CodeChunk[] {
    // First identify logical sections in the code
    const sections = tokenManager.identifyCodeSections(code);
    const encoder = tokenManager.getEncoder(model);
    const chunks: CodeChunk[] = [];
    
    let currentChunk = "";
    let currentTokens = 0;
    
    for (const section of sections) {
      const sectionTokens = encoder.encode(section.content).length;
      
      // If section is too big to fit in a single chunk, split it further
      if (sectionTokens > maxTokensPerChunk) {
        // Add current chunk if it's not empty
        if (currentChunk) {
          chunks.push({
            content: currentChunk,
            tokenCount: currentTokens,
            priority: 1.0  // Default priority
          });
          currentChunk = "";
          currentTokens = 0;
        }
        
        // Split large section into smaller pieces
        const lines = section.content.split('\n');
        let lineChunk = "";
        let lineTokens = 0;
        
        for (const line of lines) {
          const lineTokenCount = encoder.encode(line).length + 1; // +1 for newline
          
          if (lineTokens + lineTokenCount > maxTokensPerChunk && lineChunk) {
            // Add accumulated lines as a chunk
            chunks.push({
              content: lineChunk,
              tokenCount: lineTokens,
              priority: section.complexity // Use section complexity as priority
            });
            lineChunk = "";
            lineTokens = 0;
          }
          
          lineChunk += line + '\n';
          lineTokens += lineTokenCount;
        }
        
        // Add any remaining lines
        if (lineChunk) {
          chunks.push({
            content: lineChunk,
            tokenCount: lineTokens,
            priority: section.complexity
          });
        }
      }
      // If current section fits within current chunk
      else if (currentTokens + sectionTokens <= maxTokensPerChunk) {
        currentChunk += (currentChunk ? "\n\n" : "") + section.content;
        currentTokens += sectionTokens;
      }
      // Start a new chunk for this section
      else {
        // Add current chunk
        if (currentChunk) {
          chunks.push({
            content: currentChunk,
            tokenCount: currentTokens,
            priority: 1.0
          });
        }
        
        // Start new chunk with this section
        currentChunk = section.content;
        currentTokens = sectionTokens;
      }
    }
    
    // Add any remaining content
    if (currentChunk) {
      chunks.push({
        content: currentChunk,
        tokenCount: currentTokens,
        priority: 1.0
      });
    }
    
    return chunks;
  },
  
  /**
   * Create an optimized context for a code task, prioritizing relevant chunks
   * 
   * @param code The complete code or context
   * @param taskDescription The task description
   * @param maxContextTokens Maximum context tokens to include
   * @param model Model to use for tokenization
   * @returns Optimized code context
   */
  createOptimizedContext(
    code: string,
    taskDescription: string,
    maxContextTokens: number = 4096,
    model: string = 'cl100k_base'
  ): string {
    // First chunk the code
    const chunks = this.chunkCodeBySection(code, Math.min(2048, maxContextTokens / 2), model);
    
    // Score chunks by relevance to task
    for (const chunk of chunks) {
      const relevance = tokenManager.calculateRelevance(chunk.content, taskDescription);
      chunk.priority = relevance;
    }
    
    // Sort by priority (descending)
    chunks.sort((a, b) => b.priority - a.priority);
    
    // Build optimized context up to token limit
    let optimizedContext = "";
    let totalTokens = 0;
    const taskTokens = tokenManager.countTokens(taskDescription, model);
    const availableTokens = maxContextTokens - taskTokens - 100; // Reserve 100 tokens for formatting
    
    for (const chunk of chunks) {
      if (totalTokens + chunk.tokenCount <= availableTokens) {
        optimizedContext += (optimizedContext ? "\n\n// ---\n\n" : "") + chunk.content;
        totalTokens += chunk.tokenCount;
      }
    }
    
    logger.debug(`Created optimized context with ${totalTokens} tokens.`);
    return optimizedContext;
  },
  
  /**
   * Cache code with dependency awareness
   * 
   * @param code The code to cache
   * @param taskType Type of task
   * @param codeType Type of code structure
   * @param complexity Complexity score
   * @param dependencies Array of dependent component names
   * @returns Cache key
   */
  addWithDependencies(
    code: string,
    taskType: string,
    codeType: string,
    complexity: number,
    dependencies: string[] = []
  ): string {
    const key = this.add(code, taskType, codeType, complexity);
    
    // Add dependencies to the cached entry
    const entry = this.cache.get(key);
    if (entry) {
      entry.dependencies = dependencies;
    }
    
    return key;
  },
  
  /**
   * Analyze code context to extract task context information
   * 
   * @param code The code to analyze
   * @param language Programming language
   * @returns Code task context information
   */
  analyzeCodeContext(code: string, language: string = 'typescript'): CodeTaskContext {
    const context: CodeTaskContext = {
      language,
      imports: [],
      symbols: [],
      dependencies: {},
      tokensPerSection: {}
    };
    
    // Extract imports
    const importMatches = code.match(/import\s+.*?from\s+['"].*?['"];?/g);
    if (importMatches) {
      context.imports = importMatches.map(imp => imp.trim());
    }
    
    // Extract symbols (variables, functions, classes)
    const exportedSymbols = code.match(/export\s+(const|let|var|function|class|interface|type)\s+(\w+)/g);
    if (exportedSymbols) {
      exportedSymbols.forEach(symbol => {
        const name = symbol.match(/\b\w+$/)?.[0];
        if (name) {
          context.symbols.push(name);
        }
      });
    }
    
    // Count tokens per section
    const sections = tokenManager.identifyCodeSections(code);
    sections.forEach((section, index) => {
      // Generate a name for the section based on content or index
      let sectionName = `section_${index}`;
      const functionMatch = section.content.match(/function\s+(\w+)/);
      const classMatch = section.content.match(/class\s+(\w+)/);
      
      if (functionMatch) {
        sectionName = `function_${functionMatch[1]}`;
      } else if (classMatch) {
        sectionName = `class_${classMatch[1]}`;
      }
      
      context.tokensPerSection[sectionName] = tokenManager.countTokens(section.content);
    });
    
    // Simple dependency analysis
    context.symbols.forEach(symbol => {
      // Find other parts of code that reference this symbol
      const regex = new RegExp(`\\b${symbol}\\b`, 'g');
      const matches = code.match(regex);
      
      if (matches && matches.length > 1) {
        // Count references to this symbol
        context.dependencies[symbol] = matches.length.toString();
      }
    });
    
    return context;
  }
};