# LocaLLama MCP Server

An MCP Server that works with Roo Code or Cline.Bot (Currently Untested with Claude Desktop or CoPilot MCP VS Code Extension) to optimize costs by intelligently routing coding tasks between local LLMs and paid APIs.

## Overview

LocalLama MCP Server is designed to reduce token usage and costs by dynamically deciding whether to offload a coding task to a local, less capable instruct LLM (e.g., LM Studio, Ollama) versus using a paid API. Version 1.7.0 introduces smart code task analysis, advanced dependency mapping, and intelligent task decomposition features.

## Key Components

### Cost & Token Monitoring Module

- Queries the current API service for context usage, cumulative costs, API token prices, and available credits
- Gathers real-time data to inform the decision engine
- Implements intelligent code pattern recognition and semantic search for optimizing token usage
- Provides context-aware code suggestions to reduce redundancy and improve efficiency
- Features new pattern-based caching with ~30% token reduction in complex tasks

### Decision Engine

- Defines rules that compare the cost of using the paid API against the cost (and potential quality trade-offs) of offloading to a local LLM
- Includes configurable thresholds for when to offload
- Uses preemptive routing based on benchmark data to make faster decisions without API calls
- New adaptive model selection system with performance history tracking
- Enhanced code task decomposition with complexity analysis
- **NEW** Smart task dependency mapping with critical path analysis
- **NEW** Code complexity evaluation system with technical and domain knowledge assessment
- **NEW** Execution order optimization for parallel task processing

### API Integration & Configurability

- Provides a configuration interface that allows users to specify the endpoints for their local instances (e.g., LM Studio, Ollama)
- Interacts with these endpoints using standardized API calls
- Integrates with OpenRouter to access free and paid models from various providers
- Includes robust directory handling and caching mechanisms for reliable operation
- New BM25-based semantic code search integration

### Fallback & Error Handling

- Implements fallback mechanisms in case the paid API's data is unavailable or the local service fails
- Includes robust logging and error handling strategies

### Benchmarking System

- Compares performance of local LLM models against paid API models
- Measures response time, success rate, quality score, and token usage
- Generates detailed reports for analysis and decision-making
- Includes new tools for benchmarking free models and updating prompting strategies

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/locallama-mcp.git
cd locallama-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Python Setup for Retriv (Code Search)

The code search functionality uses Retriv, a Python-based semantic search library. To use this feature:

1. **Install Python**: Ensure Python 3.8+ is installed on your system.

2. **Create a Virtual Environment** (recommended):
   ```bash
   # For Linux/macOS:
   python3 -m venv venv
   source venv/bin/activate

   # For Windows:
   python -m venv venv
   venv\Scripts\activate
   ```

3. **Install Retriv and dependencies**:
   ```bash
   pip install retriv>=0.3.1 numpy>=1.22.0 scikit-learn>=1.0.2 scipy>=1.8.0
   ```

4. **Configure the server to use your virtual environment**:
   Add these lines to your `.env` file:
   ```
   # Python Configuration
   PYTHON_PATH=./venv/bin/python  # For Linux/macOS
   # PYTHON_PATH=./venv/Scripts/python.exe  # For Windows
   PYTHON_DETECT_VENV=true
   ```

> **Note**: You can also let the server install Retriv automatically by using the `retriv_init` tool with `install_dependencies` set to `true`.

## Configuration

Copy the `.env.example` file to create your own `.env` file:

```bash
cp .env.example .env
```

Then edit the `.env` file with your specific configuration:

```
# Local LLM Endpoints
LM_STUDIO_ENDPOINT=http://localhost:1234/v1
OLLAMA_ENDPOINT=http://localhost:11434/api

# Configuration
DEFAULT_LOCAL_MODEL=qwen2.5-coder-3b-instruct
TOKEN_THRESHOLD=1500
COST_THRESHOLD=0.02
QUALITY_THRESHOLD=0.7

# Code Search Configuration
CODE_SEARCH_ENABLED=true
CODE_SEARCH_EXCLUDE_PATTERNS=["node_modules/**","dist/**",".git/**"]
CODE_SEARCH_INDEX_ON_START=true
CODE_SEARCH_REINDEX_INTERVAL=3600

# Code Task Analysis Configuration
TASK_DECOMPOSITION_ENABLED=true
DEPENDENCY_ANALYSIS_ENABLED=true
MAX_SUBTASKS=8
SUBTASK_GRANULARITY=medium

# Benchmark Configuration
BENCHMARK_RUNS_PER_TASK=3
BENCHMARK_PARALLEL=false
BENCHMARK_MAX_PARALLEL_TASKS=2
BENCHMARK_TASK_TIMEOUT=60000
BENCHMARK_SAVE_RESULTS=true
BENCHMARK_RESULTS_PATH=./benchmark-results

# API Keys (replace with your actual keys)
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Logging
LOG_LEVEL=debug

# Python Configuration
PYTHON_PATH=./venv/bin/python  # For Linux/macOS
# PYTHON_PATH=./venv/Scripts/python.exe  # For Windows
PYTHON_DETECT_VENV=true
```

### Environment Variables Explained

- **Local LLM Endpoints**
  - `LM_STUDIO_ENDPOINT`: URL where your LM Studio instance is running
  - `OLLAMA_ENDPOINT`: URL where your Ollama instance is running

- **Configuration**
  - `DEFAULT_LOCAL_MODEL`: The local LLM model to use when offloading tasks
  - `TOKEN_THRESHOLD`: Maximum token count before considering offloading to local LLM
  - `COST_THRESHOLD`: Cost threshold (in USD) that triggers local LLM usage
  - `QUALITY_THRESHOLD`: Quality score below which to use paid APIs regardless of cost

- **Code Search Configuration**
  - `CODE_SEARCH_ENABLED`: Enable or disable semantic code search functionality
  - `CODE_SEARCH_EXCLUDE_PATTERNS`: Patterns to exclude from code indexing (JSON array)
  - `CODE_SEARCH_INDEX_ON_START`: Whether to index code files when server starts
  - `CODE_SEARCH_REINDEX_INTERVAL`: Interval in seconds between reindexing (0 to disable)

- **Code Task Analysis Configuration** (New)
  - `TASK_DECOMPOSITION_ENABLED`: Enable smart task decomposition
  - `DEPENDENCY_ANALYSIS_ENABLED`: Enable dependency mapping and critical path analysis
  - `MAX_SUBTASKS`: Maximum number of subtasks to create when decomposing a task
  - `SUBTASK_GRANULARITY`: Level of detail for subtasks (fine, medium, coarse)

- **API Keys**
  - `OPENROUTER_API_KEY`: Your OpenRouter API key for accessing various LLM services

- **Python Configuration** (New)
  - `PYTHON_PATH`: Path to your Python executable (set to virtual environment Python if available)
  - `PYTHON_VENV_PATH`: Path to your Python virtual environment 
  - `PYTHON_DETECT_VENV`: Enable automatic detection of Python virtual environments

- **New Tools**
  - `clear_openrouter_tracking`: Clears OpenRouter tracking data and forces an update
  - `benchmark_free_models`: Benchmarks the performance of free models from OpenRouter
  - `analyze_code_task`: Analyzes a code task and suggests decomposition strategy
  - `visualize_dependencies`: Creates a visual representation of task dependencies
  - `retriv_init`: Initializes and configures Retriv for code search and indexing
  - `cancel_job`: Cancels a running job to prevent runaway costs
  - Enhanced `route_task`: Implements a structured workflow with user preferences, cost confirmation, Retriv search, and job tracking

### Environment Variables for Cline.Bot and Roo Code

When integrating with Cline.Bot or Roo Code, you can pass these environment variables directly:

- For **simple configuration**: Use the basic env variables in your MCP setup
- For **advanced routing**: Configure thresholds to fine-tune when local vs. cloud models are used
- For **model selection**: Specify which local models should handle different types of requests
- For **task decomposition**: Configure how complex tasks are broken down and processed

## Usage

### Starting the Server

```bash
npm start
```

### OpenRouter Integration

The server integrates with OpenRouter to access a variety of free and paid models from different providers. Key features include:

- **Free Models Access**: Automatically retrieves and tracks free models available from OpenRouter
- **Model Tracking**: Maintains a local cache of available models to reduce API calls
- **Force Update Tool**: Includes a `clear_openrouter_tracking` tool to force a fresh update of models
- **Improved Reliability**: Features robust directory handling and enhanced error logging

To use the OpenRouter integration:

1. Set your `OPENROUTER_API_KEY` in the environment variables
2. The server will automatically retrieve available models on startup
3. If you encounter issues with free models not appearing, you can use the `clear_openrouter_tracking` tool through the MCP interface

Current OpenRouter integration provides access to approximately 240 models, including 30+ free models from providers like Google, Meta, Mistral, and Microsoft.

### Code Task Analysis

The new task analysis system intelligently decomposes complex coding tasks for optimal processing:

- **Task Decomposition**: Breaks down complex tasks into manageable subtasks
- **Dependency Mapping**: Identifies relationships between code components
- **Complexity Analysis**: Assesses algorithmic, integration, domain knowledge, and technical requirements
- **Critical Path Analysis**: Identifies bottlenecks and optimization opportunities
- **Execution Order Optimization**: Arranges tasks for optimal parallel execution

Example of code task analysis usage through the MCP interface:

```
/use_mcp_tool locallama analyze_code_task {"task": "Create a React component that fetches data from an API and displays it in a paginated table with sorting capabilities"}
```

This will return a structured analysis including:

- Subtasks with their dependencies
- Complexity assessment
- Recommended execution order
- Critical path identification
- Suggested optimizations

### User Preferences and Job Tracking

The server now includes user preferences and job tracking features:

#### User Preferences

User preferences are stored in a `user-preferences.json` file and include:

- **Execution Mode**: Control how tasks are routed:
  - `Fully automated selection`: Let the decision engine choose the best option
  - `Local model only`: Always use local models
  - `Free API only`: Prefer free API models when available
  - `Paid API only`: Always use paid API models

- **Cost Confirmation Threshold**: Set a threshold for when to ask for confirmation before using paid APIs
- **Retriv Search Priority**: Enable or disable prioritizing Retriv search for existing code solutions
- **Default Directories**: Configure default directories for Retriv indexing
- **Exclude Patterns**: Specify patterns to exclude from Retriv indexing

#### Job Tracking

The server now provides job tracking resources:

- **Active Jobs**: View all currently active jobs via `locallama://jobs/active`
- **Job Progress**: Track the progress of a specific job via `locallama://jobs/progress/{jobId}`
- **Job Cancellation**: Cancel a running job using the `cancel_job` tool

### Using with Cline.Bot

To use this MCP Server with Cline.Bot, add it to your Cline MCP settings:

```json
{
  "mcpServers": {
    "locallama": {
      "command": "node",
      "args": ["/path/to/locallama-mcp"],
      "env": {
        "LM_STUDIO_ENDPOINT": "http://localhost:1234/v1",
        "OLLAMA_ENDPOINT": "http://localhost:11434/api",
        "DEFAULT_LOCAL_MODEL": "qwen2.5-coder-3b-instruct",
        "TOKEN_THRESHOLD": "1500",
        "COST_THRESHOLD": "0.02",
        "QUALITY_THRESHOLD": "0.07",
        "TASK_DECOMPOSITION_ENABLED": "true",
        "DEPENDENCY_ANALYSIS_ENABLED": "true",
        "OPENROUTER_API_KEY": "your_openrouter_api_key_here"
      },
      "disabled": false
    }
  }
}
```

Once configured, you can use the MCP tools in Cline.Bot:

- `get_free_models`: Retrieve the list of free models from OpenRouter
- `clear_openrouter_tracking`: Force a fresh update of OpenRouter models if you encounter issues
- `benchmark_free_models`: Benchmark the performance of free models from OpenRouter
- `analyze_code_task`: Analyze a complex coding task and get a decomposition plan
- `visualize_dependencies`: Generate a visual representation of task dependencies
- `retriv_init`: Initialize and configure Retriv for code search and indexing
- `cancel_job`: Cancel a running job to prevent runaway costs

Example usage in Cline.Bot:

```
/use_mcp_tool locallama clear_openrouter_tracking {}
```

This will clear the tracking data and force a fresh update of the models, which is useful if you're not seeing any free models or if you want to ensure you have the latest model information.

### Enhanced Route Task Workflow

The `route_task` tool now follows a structured workflow:

1. **Load User Preferences**: Loads stored user preferences from the configuration file
2. **Cost Estimation**: Assesses execution costs and prompts for confirmation if the cost exceeds the threshold
3. **Task Breakdown Analysis**: Determines if task segmentation is necessary
4. **Retriv Search**: Checks Retriv for existing code solutions before generating anything new
5. **Decision Engine Routing**: Determines the most cost-efficient way to execute the task
6. **Job Creation**: Creates a new job and logs it in `locallama://jobs/active`
7. **Progress Tracking**: Uses `locallama://jobs/progress/{jobId}` to track job progress
8. **Result Storage**: Stores the result in Retriv for future reuse

Example usage:

```
/use_mcp_tool locallama route_task {
  "task": "Create a function to calculate the Fibonacci sequence",
  "context_length": 1000,
  "expected_output_length": 500,
  "complexity": 0.3,
  "priority": "cost"
}
```

### "Retriv First" Strategy

The server now implements a "Retriv First" strategy to prioritize existing code:

1. **Set up Python environment**: Follow the Python setup instructions above
2. **Code Indexing**: Use `retriv_init` to index your code repositories
3. **Semantic Search**: When a task is submitted, Retriv searches for similar code
4. **Code Reuse**: If similar code is found, it's returned immediately without generating new code
5. **Fallback**: If no suitable code is found, the task is routed to the appropriate model

Example usage:

```
/use_mcp_tool locallama retriv_init {
  "directories": ["/path/to/your/code/repo"],
  "exclude_patterns": ["node_modules/**", "dist/**"],
  "install_dependencies": true,
  "force_reindex": true
}
```

### Running Benchmarks

The project includes a comprehensive benchmarking system to compare local LLM models against paid API models:

```bash
# Run a simple benchmark
node run-benchmarks.js

# Run a comprehensive benchmark across multiple models
node run-benchmarks.js comprehensive
```

Benchmark results are stored in the `benchmark-results` directory and include:

- Individual task performance metrics in JSON format
- Summary reports in JSON and Markdown formats
- Comprehensive analysis of model performance

## Benchmark Results

The repository includes benchmark results that provide valuable insights into the performance of different models. These results:

1. Do not contain any sensitive API keys or personal information
2. Provide performance metrics that help inform the decision engine
3. Include response times, success rates, quality scores, and token usage statistics
4. Are useful for anyone who wants to understand the trade-offs between local LLMs and paid APIs

## Development

### Running in Development Mode

```bash
npm run dev
```

### Running Tests

```bash
npm test
```

## Security Notes

- The `.gitignore` file is configured to prevent sensitive data from being committed to the repository
- API keys and other secrets should be stored in your `.env` file, which is excluded from version control
- Benchmark results included in the repository do not contain sensitive information

## License

ISC

## Phases

### Phase 1: Code Task Analysis
- Status: Completed
- Completion: 100%
- Features: Task decomposition, complexity analysis, dependency mapping, token estimation

### Phase 2: Token Optimization
- Status: Completed
- Completion: 100%
- Features: Pattern-based caching, similarity matching, cache invalidation, reuse optimization

### Phase 3: Model Selection Enhancement
- Status: Completed
- Completion: 100%
- Features: Dynamic model scoring, performance history tracking, resource optimization

### Phase 4: Code Quality Integration
- Status: Completed
- Completion: 100%
- Features: Code validation, quality evaluation, task-specific analysis, model-based assessment

### Phase 5: Performance Optimization
- Status: Completed
- Completion: 100%
- Features: Cache optimization, retrieval efficiency, resource usage optimization

### Phase 6: New Module Integration
- Status: In Progress
- Completion: 60%
- Features: Module system architecture, component framework, extensibility improvements, user preferences, job tracking, Retriv integration
- Current Focus: Implementing "Retriv First" strategy and job management system
