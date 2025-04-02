# LocaLLama MCP Server (Testing Branch)

An MCP Server that works with Roo Code or Cline.Bot (Currently Untested with Claude Desktop or CoPilot MCP VS Code Extension) to optimize costs by intelligently routing coding tasks between local LLMs and paid APIs. Lot's of broken implementation in this.

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

### Server Lock Mechanism

- Prevents multiple instances of the server from running simultaneously
- Automatically detects and cleans up stale lock files from crashed processes
- Stores connection information in the lock file for better diagnostics
- Verifies if processes in existing lock files are still running
- Provides clear error messages when attempting to start a second instance

## Tools

The following tools are available in the LocalLama MCP Server:

*   `route_task`: Route a coding task to either a local LLM or a paid API based on cost and complexity.
    *   **Input:** `task`, `context_length`, `expected_output_length`, `complexity`, `priority`, `preemptive`
*   `retriv_init`: Initialize and configure Retriv for code search and indexing.
    *   **Input:** `directories`, `exclude_patterns`, `chunk_size`, `force_reindex`, `bm25_options`, `install_dependencies`
*   `cancel_job`: Cancel a running job.
    *   **Input:** `job_id`
*   `preemptive_route_task`: Quickly route a coding task without making API calls (faster but less accurate).
    *   **Input:** `task`, `context_length`, `expected_output_length`, `complexity`, `priority`
*   `get_cost_estimate`: Get an estimate of the cost for a task.
    *   **Input:** `context_length`, `expected_output_length`, `model`
*   `benchmark_task`: Benchmark the performance of local LLMs vs paid APIs for a specific task.
    *   **Input:** `task_id`, `task`, `context_length`, `expected_output_length`, `complexity`, `local_model`, `paid_model`, `runs_per_task`
*   `benchmark_tasks`: Benchmark the performance of local LLMs vs paid APIs for multiple tasks.
    *   **Input:** `tasks`, `runs_per_task`, `parallel`, `max_parallel_tasks`

The following tools are only available if Python and the `retriv` module are installed:

*   `retriv_search`: Search code using Retriv search engine.
    *   **Input:** `query`, `limit`

The following tools are only available if the OpenRouter API key is configured:

*   `get_free_models`: Get a list of free models available from OpenRouter.
    *   **Input:** None
*   `clear_openrouter_tracking`: Clear OpenRouter tracking data and force an update.
    *   **Input:** None
*   `benchmark_free_models`: Benchmark the performance of free models from OpenRouter.
    *   **Input:** `tasks`, `runs_per_task`, `parallel`, `max_parallel_tasks`
*   `set_model_prompting_strategy`: Update the prompting strategy for an OpenRouter model.
     *   **Input:** `task`, `context_length`, `expected_output_length`, `priority`, `complexity`, `preemptive`

## Resources

The following resources are available in the LocalLama MCP Server:

**Static Resources:**

*   `locallama://status`: Current status of the LocalLama MCP Server.
*   `locallama://models`: List of available local LLM models.
*   `locallama://jobs/active`: List of currently active jobs.
*   `locallama://memory-bank`: List of files in the memory bank directory (only available if the `memory-bank` directory exists).
*   `locallama://openrouter/models`: List of available models from OpenRouter (only available if the OpenRouter API key is configured).
*   `locallama://openrouter/free-models`: List of free models available from OpenRouter (only available if the OpenRouter API key is configured).
*   `locallama://openrouter/status`: Status of the OpenRouter integration (only available if the OpenRouter API key is configured).

**Resource Templates:**

*   `locallama://usage/{api}`: Token usage and cost statistics for a specific API.
*   `locallama://jobs/progress/{jobId}`: Progress information for a specific job.
*   `locallama://openrouter/model/{modelId}`: Details about a specific OpenRouter model (only available if the OpenRouter API key is configured).
*   `locallama://openrouter/prompting-strategy/{modelId}`: Prompting strategy for a specific OpenRouter model (only available if the OpenRouter API key is configured).

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/locallama-mcp.git
cd locallama-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Install retriv dependencies (if you want to use retriv)
pip install retriv>=0.3.1 numpy>=1.22.0 scikit-learn>=1.0.2 scipy>=1.8.0
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

# Server Lock Configuration
LOCK_FILE_CHECK_ACTIVE_PROCESS=true
REMOVE_STALE_LOCK_FILES=true

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

- **Server Lock Configuration** (New)
  - `LOCK_FILE_CHECK_ACTIVE_PROCESS`: Verify if processes in lock files are still running
  - `REMOVE_STALE_LOCK_FILES`: Automatically clean up stale lock files from crashed processes

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

The server uses a lock file mechanism to prevent multiple instances from running simultaneously. If you try to start the server when another instance is already running, you'll see a message with information about the existing instance and the process will exit.

If a previous server process crashed without properly cleaning up, the enhanced lock file mechanism will automatically detect and remove the stale lock file, allowing a new server instance to start correctly.

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

### Understanding Usage

The MCP server provides several ways to monitor and understand its usage:

*   **API Usage & Costs**: Track token usage and estimated costs for different APIs (like OpenRouter) using the `locallama://usage/{api}` resource. Replace `{api}` with the name of the API (e.g., `openrouter`). This information is gathered by the Cost Monitoring module.
*   **Job Tracking**: Monitor the status and progress of tasks submitted to the server:
    *   `locallama://jobs/active`: Lists all currently running jobs.
    *   `locallama://jobs/progress/{jobId}`: Shows the detailed progress percentage and status for a specific job ID.
*   **Model Execution Logs**: The server logs (`locallama.log` by default) contain detailed information about which models are being used for specific tasks, including decisions made by the Decision Engine.
*   **Advanced Local Model Features (LM Studio & Ollama)**:
    *   **Automatic Prompt Strategy Improvement**: The `lmStudioModule` (and potentially `ollamaModule` if implemented similarly) can automatically benchmark different prompting strategies for models over time. If a better strategy is found based on quality heuristics, it will be saved and used for future requests. This process happens periodically based on configuration (e.g., `promptImprovementConfig` in `lm-studio/index.ts`). Check the logs for messages indicating strategy updates.
    *   **Speculative Inference/Decoding**: The `lmStudioModule`'s `callWithSpeculativeInference` function (and potentially Ollama's equivalent) attempts to speed up responses by generating a few tokens speculatively and then validating them. This is controlled by configuration (e.g., `speculativeInferenceConfig` in `lm-studio/index.ts`) and requires model support. Logs will indicate when speculative inference is attempted, accepted, or rejected, and may show statistics on tokens generated/accepted.
    *   **Configuration**: While not directly controlled via tools/resources, the behavior of these features (enabled status, thresholds, cooldowns) is managed within the respective module files (`lm-studio/index.ts`, `ollama/index.ts`) and their associated configuration objects (like `DEFAULT_PROMPT_IMPROVEMENT_CONFIG`, `DEFAULT_SPECULATIVE_INFERENCE_CONFIG`).
*   **Speculative Inference Statistics**: When speculative inference is enabled for LM Studio or Ollama models, the logs may also contain statistics about the number of tokens generated, accepted, and potential time saved.
*   **Resource Status**: Check the general status of the server and integrations:
    *   `locallama://status`: General server status.
    *   `locallama://models`: List of detected local models (LM Studio, Ollama).
    *   `locallama://openrouter/status`: Status of the OpenRouter integration.

By utilizing these resources and checking the logs, users and LLMs interacting with the server can gain insights into its operation, costs, and performance, including the advanced optimizations happening within the local model modules.

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

All test files in the `/test` directory use proper mocking to prevent multiple actual server instances from starting during test runs. If you create custom test scripts, make sure they properly clean up server processes and remove lock files when done.

## Troubleshooting

### Server Won't Start Due to Lock File

If the server won't start because it detects another instance is already running:

1. Check if there's actually another instance running using `ps` or Task Manager
2. If no other instance is running, the lock file might be stale due to a previous crash
3. The enhanced lock mechanism should automatically detect and remove stale lock files
4. If needed, you can manually remove the `locallama.lock` file from the project root

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
