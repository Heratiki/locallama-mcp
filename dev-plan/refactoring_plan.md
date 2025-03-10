# Refactoring Plan for `src/modules/api-integration/tools.ts`

## Goal

To refactor the `src/modules/api-integration/tools.ts` file into a modular architecture with clear separation of concerns, well-defined interfaces, and a migration strategy that allows for incremental adoption.

## Objectives

*   Identify logical functional boundaries within the current implementation.
*   Design a modular architecture with clear separation of concerns.
*   Create well-defined interfaces between the new modules.
*   Maintain backward compatibility with existing code that imports from this file.
*   Implement proper export patterns to minimize changes required in dependent modules.
*   Include a migration strategy that allows for incremental adoption.
*   Consider performance implications of the modularization.
*   Provide specific file/folder structure recommendations.
*   Suggest appropriate naming conventions for the new modules.
*   Prioritize maintainability and testability in the new design.

## Suggestions

*   Watch Cross-Module Dependencies: Ensure each module genuinely stands on its own. If the modules start calling each other heavily, you’ll just move the tangle around.
*   Incremental Migration: Don’t try to refactor everything in one fell swoop. Migrate a module, test it, then move on.
*   Testing: Add or update tests as you break functions out, so you catch regressions right away.
*   Documentation: Provide usage instructions for each module in README or doc comments, so others can ramp up quickly.

## File/Folder Structure

```
src/modules/api-integration/
├── index.ts          # Main export file (re-exports from other modules)
├── tools.ts          # Deprecated (original file)
├── tool-definition/
│   ├── index.ts      # Tool definition module
│   └── types.ts      # Types for tool definitions
├── task-execution/
│   ├── index.ts      # Task execution module
│   └── types.ts      # Types for task execution
├── retriv-integration/
│   ├── index.ts      # Retriv integration module
│   └── types.ts      # Types for Retriv integration
├── openrouter-integration/
│   ├── index.ts      # OpenRouter integration module
│   └── types.ts      # Types for OpenRouter integration
├── cost-estimation/
│   ├── index.ts      # Cost estimation module
│   └── types.ts      # Types for cost estimation
├── routing/
│   ├── index.ts      # Routing module
│   └── types.ts      # Types for routing
└── types.ts          # Common types for the API integration module
```

## Naming Conventions

*   Use descriptive names for all modules, functions, types, and interfaces.
*   Follow the existing naming conventions in the codebase.
*   Use the `I` prefix for interfaces (e.g., `IToolDefinitionProvider`).
*   Use the `Module` suffix for modules (e.g., `ToolDefinitionModule`).

## Phased Refactoring Plan

### Phase 1: Create New Modules and Interfaces (Completed)

*   **Objective:** Create the new modules and interfaces without modifying the existing `tools.ts` file.
*   **Deliverables:**
    *   Create the following directories:
        *   `src/modules/api-integration/tool-definition/`
        *   `src/modules/api-integration/task-execution/`
        *   `src/modules/api-integration/retriv-integration/`
        *   `src/modules/api-integration/openrouter-integration/`
        *   `src/modules/api-integration/cost-estimation/`
        *   `src/modules/api-integration/routing/`
    *   Create the following files:
        *   `src/modules/api-integration/tool-definition/index.ts`
        *   `src/modules/api-integration/tool-definition/types.ts`
        *   `src/modules/api-integration/task-execution/index.ts`
        *   `src/modules/api-integration/task-execution/types.ts`
        *   `src/modules/api-integration/retriv-integration/index.ts`
        *   `src/modules/api-integration/retriv-integration/types.ts`
        *   `src/modules/api-integration/openrouter-integration/index.ts`
        *   `src/modules/api-integration/openrouter-integration/types.ts`
        *   `src/modules/api-integration/cost-estimation/index.ts`
        *   `src/modules/api-integration/cost-estimation/types.ts`
        *   `src/modules/api-integration/routing/index.ts`
        *   `src/modules/api-integration/routing/types.ts`
        *   `src/modules/api-integration/types.ts`
    *   Define the following interfaces:
        *   `IToolDefinitionProvider`
        *   `ITaskExecutor`
        *   `IRetrivIntegration`
        *   `IOpenRouterIntegration`
        *   `ICostEstimator`
        *   `IJobManager`
        *   `IRouter`
*   **Testing:** N/A
*   **Challenges:** N/A
*   **Adjustments:** N/A

### Phase 2: Move Tool Definition Logic

*   **Objective:** Move the tool definition logic (the `tools` array and the `ListToolsRequestSchema` handler) into the `tool-definition` module.
*   **Deliverables:**
    *   Move the `tools` array and the `ListToolsRequestSchema` handler from `src/modules/api-integration/tools.ts` to `src/modules/api-integration/tool-definition/index.ts`.
    *   Implement the `IToolDefinitionProvider` interface in the `tool-definition` module.
    *   Update the main export file (`src/modules/api-integration/index.ts`) to re-export the tool definition logic from the `tool-definition` module.
*   **Testing:** Add unit tests to verify that the tool definition logic is working correctly.
*   **Challenges:** N/A
*   **Adjustments:** N/A

### Phase 3: Move Task Execution Logic

*   **Objective:** Move the `executeTask`, `executeOllamaModel`, `executeLmStudioModel`, and `executeLocalModel` functions into the `task-execution` module.
*   **Deliverables:**
    *   Move the `executeTask`, `executeOllamaModel`, `executeLmStudioModel`, and `executeLocalModel` functions from `src/modules/api-integration/tools.ts` to `src/modules/api-integration/task-execution/index.ts`.
    *   Implement the `ITaskExecutor` interface in the `task-execution` module.
    *   Update the main export file (`src/modules/api-integration/index.ts`) to re-export the task execution logic from the `task-execution` module.
*   **Testing:** Add unit tests to verify that the task execution logic is working correctly.
*   **Challenges:** N/A
*   **Adjustments:** N/A

### Phase 4: Move Retriv Integration Logic

*   **Objective:** Isolate the Retriv-related functions (`isPythonAvailable`, `isPythonModuleInstalled`, `generateRequirementsTxt`, and the Retriv initialization logic within the `retriv_init` case) into the `retriv-integration` module.
*   **Deliverables:**
    *   Move the `isPythonAvailable`, `isPythonModuleInstalled`, `generateRequirementsTxt`, and the Retriv initialization logic from `src/modules/api-integration/tools.ts` to `src/modules/api-integration/retriv-integration/index.ts`.
    *   Implement the `IRetrivIntegration` interface in the `retriv-integration` module.
    *   Update the main export file (`src/modules/api-integration/index.ts`) to re-export the Retriv integration logic from the `retriv-integration` module.
*   **Testing:** Add unit tests to verify that the Retriv integration logic is working correctly.
*   **Challenges:** N/A
*   **Adjustments:** N/A

### Phase 5: Move OpenRouter Integration Logic

*   **Objective:** Extract the OpenRouter-specific tool handlers and logic (including `isOpenRouterConfigured` and the `clear_openrouter_tracking`, `get_free_models`, `benchmark_free_models`, and `set_model_prompting_strategy` cases) into the `openrouter-integration` module.
*   **Deliverables:**
    *   Move the OpenRouter-specific tool handlers and logic from `src/modules/api-integration/tools.ts` to `src/modules/api-integration/openrouter-integration/index.ts`.
    *   Implement the `IOpenRouterIntegration` interface in the `openrouter-integration` module.
    *   Update the main export file (`src/modules/api-integration/index.ts`) to re-export the OpenRouter integration logic from the `openrouter-integration` module.
*   **Testing:** Add unit tests to verify that the OpenRouter integration logic is working correctly.
*   **Challenges:** N/A
*   **Adjustments:** N/A

### Phase 6: Move Cost Estimation Logic

*   **Objective:** Move the cost estimation logic from the `route_task` case into the `cost-estimation` module.
*   **Deliverables:**
    *   Move the cost estimation logic from `src/modules/api-integration/tools.ts` to `src/modules/api-integration/cost-estimation/index.ts`.
    *   Implement the `ICostEstimator` interface in the `cost-estimation` module.
    *   Update the main export file (`src/modules/api-integration/index.ts`) to re-export the cost estimation logic from the `cost-estimation` module.
*   **Testing:** Add unit tests to verify that the cost estimation logic is working correctly.
*   **Challenges:** N/A
*   **Adjustments:** N/A

### Phase 7: Move Routing Logic

*   **Objective:** The `route_task` and `preemptive_route_task` cases, along with the core routing logic, will reside in the `routing` module.
*   **Deliverables:**
    *   Move the `route_task` and `preemptive_route_task` cases from `src/modules/api-integration/tools.ts` to `src/modules/api-integration/routing/index.ts`.
    *   Implement the `IRouter` interface in the `routing` module.
    *   Update the main export file (`src/modules/api-integration/index.ts`) to re-export the routing logic from the `routing` module.
*   **Testing:** Add unit tests to verify that the routing logic is working correctly.
*   **Challenges:** N/A
*   **Adjustments:** N/A

### Phase 8: Deprecate `tools.ts`

*   **Objective:** Deprecate the original `tools.ts` file and provide clear instructions on how to migrate to the new modules.
*   **Deliverables:**
    *   Add a deprecation warning to the top of the `src/modules/api-integration/tools.ts` file.
    *   Provide clear instructions on how to migrate to the new modules in the deprecation warning.
*   **Testing:** N/A
*   **Challenges:** N/A
*   **Adjustments:** N/A

## Updating the Plan

At the conclusion of each phase, the LLM should update this markdown document in the `dev-plan` directory to reflect the completed work, any encountered challenges, and any necessary adjustments to subsequent phases. The plan should prioritize incremental improvements and maintain functionality throughout the refactoring process.