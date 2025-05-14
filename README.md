[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/heratiki-locallama-mcp-badge.png)](https://mseep.ai/app/heratiki-locallama-mcp)

# LocaLLama MCP Server

An MCP Server that works with Roo Code or Cline.Bot (Currently Untested with Claude Desktop or CoPilot MCP VS Code Extension) to optimize costs by intelligently routing coding tasks between local LLMs and paid APIs.

## Overview

LocalLama MCP Server is designed to reduce token usage and costs by dynamically deciding whether to offload a coding task to a local, less capable instruct LLM (e.g., LM Studio, Ollama) versus using a paid API.

## Key Components

### Cost & Token Monitoring Module

- Queries the current API service for context usage, cumulative costs, API token prices, and available credits
- Gathers real-time data to inform the decision engine

### Decision Engine

- Defines rules that compare the cost of using the paid API against the cost (and potential quality trade-offs) of offloading to a local LLM
- Includes configurable thresholds for when to offload
- Uses preemptive routing based on benchmark data to make faster decisions without API calls

### API Integration & Configurability

- Provides a configuration interface that allows users to specify the endpoints for their local instances (e.g., LM Studio, Ollama)
- Interacts with these endpoints using standardized API calls
- Integrates with OpenRouter to access free and paid models from various providers
- Includes robust directory handling and caching mechanisms for reliable operation

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

- **API Keys**
  - `OPENROUTER_API_KEY`: Your OpenRouter API key for accessing various LLM services

- **New Tools**
  - `clear_openrouter_tracking`: Clears OpenRouter tracking data and forces an update
  - `benchmark_free_models`: Benchmarks the performance of free models from OpenRouter

### Environment Variables for Cline.Bot and Roo Code

When integrating with Cline.Bot or Roo Code, you can pass these environment variables directly:

- For **simple configuration**: Use the basic env variables in your MCP setup
- For **advanced routing**: Configure thresholds to fine-tune when local vs. cloud models are used
- For **model selection**: Specify which local models should handle different types of requests

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

Example usage in Cline.Bot:

```
/use_mcp_tool locallama clear_openrouter_tracking {}
```

This will clear the tracking data and force a fresh update of the models, which is useful if you're not seeing any free models or if you want to ensure you have the latest model information.

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
