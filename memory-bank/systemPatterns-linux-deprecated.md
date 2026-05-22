# System Patterns *Optional*

This file documents recurring patterns and standards used in the project.
It is optional, but recommended to be updated as the project evolves.
YYYY-MM-DD HH:MM:SS - Log of updates made.

*

## Coding Patterns

* Modular architecture: The project is designed with a modular architecture, promoting separation of concerns and maintainability. Modules are organized by functionality (e.g., api-integration, cost-monitor, decision-engine).
* Asynchronous operations: Asynchronous operations with Promises and async/await are extensively used for non-blocking operations, especially for API calls and task execution.
* TypeScript types and interfaces: TypeScript types and interfaces are used throughout the codebase to ensure type safety and improve code maintainability.

## Architectural Patterns

* Microservices-inspired architecture: The `api-integration/tools.ts` refactoring plan indicates a move towards a microservices-inspired architecture, with each tool handling a specific task and the decision engine acting as orchestrator.
* "Retriv First" strategy: The `revised_route_task_refactor_plan.md` mentions a "Retriv First" strategy, prioritizing the use of existing code retrieved by Retriv before generating new code.
* Phased implementation: Development plans (e.g., `linting_fix_plan.md`, `refactoring_plan.md`) are broken down into phases to manage complexity and ensure incremental progress.

## Testing Patterns

* Unit tests: Unit tests are mentioned in `refactoring_plan.md` as a key part of the refactoring process, indicating a focus on test-driven development and code quality.
* Integration tests and benchmark tests:  `minions-integration-plan.yaml` outlines integration and benchmark tests for different phases, suggesting a comprehensive testing strategy.

## Implementation Patterns

* Singleton Pattern: Used for managing services like `JobTracker`, `ModelsDbService`, `UserPreferencesManager`, and `CodeSearchEngineManager` to ensure a single instance controls shared resources or state.
* Dependency Injection (Manual): Used to manage dependencies, particularly circular ones (e.g., injecting `modelPerformanceTracker` into `codeModelSelector`).
* Facade Pattern: The `apiHandlers` service acts as a facade, providing a simplified interface to various underlying services for external API consumers.
* Event Emitter Pattern: The `JobTracker` extends `EventEmitter` to notify other parts of the system about job status changes.
* Caching Strategies: Implemented for model lists (OpenRouter, LM Studio, Ollama), prompts (`tokenManager`), and code snippets (`codeCache`) to improve performance and reduce redundant computations/API calls.
* Persistence Strategies: Uses JSON files for storing model tracking data, prompting strategies, user preferences, and the models DB. SQLite is used for benchmark results and job history.
* Python Bridge Pattern: The `BM25Searcher` communicates with a separate Python process (`retriv_bridge.py`) via stdin/stdout to leverage the `retriv` library for code search.

[2025-04-01 23:07:00] - Added Implementation Patterns section based on codebase analysis.