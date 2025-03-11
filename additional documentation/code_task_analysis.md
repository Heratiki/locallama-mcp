# Code Task Analysis

## Overview

The Code Task Analysis system is a core component of the LocalLama MCP Server that enables intelligent decomposition, analysis, and optimization of complex coding tasks. It helps break down large coding tasks into manageable subtasks, analyzes their dependencies, and provides optimal execution strategies.

## Key Features

### Task Decomposition

The task decomposition system breaks down complex coding tasks into smaller, focused subtasks that can be processed more efficiently. This process:

- Analyzes the original task description to identify logical components
- Creates independent subtasks with clear boundaries
- Estimates complexity and token requirements for each subtask
- Identifies code structure types (classes, functions, methods, etc.)

Example of task decomposition:

```json
{
  "originalTask": "Create a React component that fetches data from an API and displays it in a paginated table with sorting capabilities",
  "subtasks": [
    {
      "id": "12345-abcde",
      "description": "Setup basic React component structure",
      "complexity": 0.3,
      "estimatedTokens": 800,
      "dependencies": [],
      "codeType": "class"
    },
    {
      "id": "67890-fghij", 
      "description": "Implement API fetch functionality with error handling",
      "complexity": 0.5,
      "estimatedTokens": 1200,
      "dependencies": ["12345-abcde"],
      "codeType": "function"
    },
    {
      "id": "13579-klmno",
      "description": "Create table component with pagination control",
      "complexity": 0.6,
      "estimatedTokens": 1500,
      "dependencies": ["67890-fghij"],
      "codeType": "method"
    },
    {
      "id": "24680-pqrst",
      "description": "Add sorting capabilities to the table",
      "complexity": 0.7,
      "estimatedTokens": 1800,
      "dependencies": ["13579-klmno"],
      "codeType": "method"
    }
  ]
}
```

### Complexity Analysis

The complexity analysis system evaluates coding tasks across multiple dimensions:

1. **Algorithmic Complexity**: Assesses the computational complexity and algorithmic challenges
2. **Integration Complexity**: Evaluates how the task interacts with existing systems and components
3. **Domain Knowledge**: Determines the level of specialized knowledge required
4. **Technical Requirements**: Identifies specific technical constraints and requirements

Each dimension is scored on a 0-1 scale and combined into an overall complexity score that helps with model selection and resource allocation.

### Dependency Mapping

The dependency mapper creates a graph of relationships between subtasks and provides:

- **Dependency Graph Creation**: Visually represents relationships between components
- **Circular Dependency Detection**: Identifies and resolves circular dependencies
- **Critical Path Analysis**: Finds the sequence of tasks that determines the minimum time needed
- **Execution Order Optimization**: Arranges tasks for optimal parallel processing

Example dependency visualization:

```
# Code Task Dependencies

Original Task: Create a React component that fetches data from an API and displays it in a paginated table with sorting capabilities

## Execution Order

1. Setup basic React component structure (ID: 12345-abc..., Complexity: 0.3)
2. Implement API fetch functionality with error handling (ID: 67890-fgh..., Complexity: 0.5)
3. Create table component with pagination control (ID: 13579-klm..., Complexity: 0.6)
4. Add sorting capabilities to the table (ID: 24680-pqr..., Complexity: 0.7)

## Dependency Graph

[12345-abc] Setup basic React component structure
  └── (no dependencies)

[67890-fgh] Implement API fetch functionality with e...
  ├── depends on [12345-abc] Setup basic React component structure

[13579-klm] Create table component with pagination c...
  ├── depends on [67890-fgh] Implement API fetch functionality with e...

[24680-pqr] Add sorting capabilities to the table
  ├── depends on [13579-klm] Create table component with pagination c...

## Critical Path

Tasks on the critical path (bottlenecks):

1. Setup basic React component structure (Complexity: 0.3)
2. Implement API fetch functionality with error handling (Complexity: 0.5)
3. Create table component with pagination control (Complexity: 0.6)
4. Add sorting capabilities to the table (Complexity: 0.7)
```

## Usage

### Configuration

To enable and configure the Code Task Analysis system, add these settings to your `.env` file:

```
# Code Task Analysis Configuration
TASK_DECOMPOSITION_ENABLED=true
DEPENDENCY_ANALYSIS_ENABLED=true
MAX_SUBTASKS=8
SUBTASK_GRANULARITY=medium
```

Available options for `SUBTASK_GRANULARITY` are:
- `fine`: More granular subtasks (higher quantity, lower complexity per task)
- `medium`: Balanced approach (default)
- `coarse`: Larger, more comprehensive subtasks (lower quantity, higher complexity per task)

### Using with MCP Tools

The Code Task Analysis system integrates with MCP tools for easy analysis of code tasks:

#### analyze_code_task

Analyzes a coding task and returns a detailed breakdown:

```
/use_mcp_tool locallama analyze_code_task {"task": "Create a React component that fetches data from an API and displays it in a paginated table with sorting capabilities"}
```

Returns:
- Task decomposition into subtasks
- Complexity analysis of each subtask
- Dependencies between subtasks
- Recommended execution order
- Critical path identification

#### visualize_dependencies

Generates a visual representation of task dependencies:

```
/use_mcp_tool locallama visualize_dependencies {"taskId": "task123"}
```

Returns:
- ASCII or Markdown-based visualization of the dependency graph
- Execution order details
- Critical path visualization
- Parallel execution groups

### Programmatic Usage

If you're integrating with the MCP server programmatically, you can use these functions:

```typescript
// Decompose a complex code task
const decomposedTask = await codeTaskAnalyzer.decompose(
  "Create a React component that fetches data from an API and displays it in a paginated table with sorting capabilities",
  {
    maxSubtasks: 8,
    granularity: 'medium',
    includeTests: true
  }
);

// Analyze complexity of a code task
const complexityResult = await codeTaskAnalyzer.analyzeComplexity(
  "Create a React component that fetches data from an API and displays it in a paginated table with sorting capabilities"
);

// Get optimized execution order for subtasks
const optimizedOrder = dependencyMapper.getOptimizedExecutionOrder(decomposedTask);

// Visualize dependencies between subtasks
const visualization = dependencyMapper.visualizeDependencies(decomposedTask);

// Get suggestions for optimizing task execution
const optimizations = dependencyMapper.suggestOptimizations(decomposedTask);
```

## Benefits

- **Token Efficiency**: By breaking down tasks and analyzing complexity, the system can route subtasks to the most efficient models
- **Parallel Processing**: Identifies tasks that can be executed simultaneously for faster processing
- **Resource Optimization**: Routes simpler tasks to smaller models to conserve tokens and reduce costs
- **Bottleneck Identification**: Highlights critical path tasks that should be optimized for performance
- **Quality Improvement**: Ensures complex tasks are handled by appropriate models based on their requirements

## Integration with Other Systems

The Code Task Analysis system integrates with:

1. **Decision Engine**: Uses complexity analysis to inform model selection
2. **Cost Monitor**: Provides token estimation for budgeting and cost optimization
3. **Model Selector**: Routes subtasks to appropriate models based on complexity and requirements

By understanding the relationships and complexity of code tasks, the system can make intelligent routing decisions that optimize for both cost and quality.