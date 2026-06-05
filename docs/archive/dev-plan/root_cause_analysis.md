## Code Modification Policy

When addressing issues and modifying code blocks, all changes must be commented out instead of being deleted. Code modifications should be small and fixes should be verified before moving on to fix another issue. Verification should be a process of making sure there are no problems shown. This ensures that the original code is preserved for historical context and future reference.

Each commented-out code block must include a standardized header containing the author's name, and the date and time of the edit.

Example:

<!--
Author: Roo
Date: March 11, 2025, 11:23:19 AM
-->
```javascript
// Original code
console.log("Hello, world!");
```

1️⃣ Keep Modifications Small & Precise

Only modify specific lines related to the issue.

Do not refactor unrelated code unless explicitly required.

Keep diffs minimal to ensure traceability.

2️⃣ Preserve Original Code for Historical Context

Never delete old code—always comment it out.

Use a standardized comment header with author name & timestamp.

3️⃣ Require Verification Before Additional Fixes

Each fix must be validated before moving to another issue.

Check logs, unit tests, and debug outputs before assuming success.

4️⃣ Avoid Overwriting Global Variables

Ensure fixes do not change global states or shared variables unless necessary.

If modifying a shared variable, validate downstream effects.

5️⃣ Follow Existing Code Style & Conventions

Maintain the existing indentation, naming conventions, and spacing.

No sweeping stylistic changes unless fixing a linting issue.

6️⃣ Respect Dependency Integrity

Never remove or alter package dependencies unless explicitly fixing a dependency-related bug.

Validate changes against the expected library versions.

7️⃣ Use LLM Tokens Efficiently

Only request necessary context when asking the LLM to generate a fix.

Instead of feeding the entire file, focus on the affected function/class.

If context limits allow, provide relevant logs and error messages.

8️⃣ Validate External Calls Before Fixing API-Related Issues

If an issue involves an external API call, check request payloads and responses before modifying the function.

9️⃣ Ensure Fixes Are Testable

If possible, add a test case to confirm that the issue is resolved. Do not overflow context, suggest starting a new task if an overflow is likely.

# Root Cause Analysis

This document will be used to track the root cause analysis of issues encountered with the LocalLama MCP server.

## Issues

### Excessive "Found 40 free models from OpenRouter" messages

*   **Description:** The system logs excessive "Found 40 free models from OpenRouter" messages, indicating an inefficient model availability check.
*   **Root Cause:** The `get_free_models` function is likely being called multiple times within the `route_task` logic.
*   **Proposed Solution:** Implement caching or a more efficient mechanism for checking model availability.
*   **Status:** Resolved
*   **Notes:** Investigate the call stack to identify where `get_free_models` is being called.

### "Failed to analyze complexity: undefined" error

*   **Description:** The system throws a "Failed to analyze complexity: undefined" error, indicating a problem with the code complexity analysis logic.
*   **Root Cause:** The `analyzeComplexity` function in `codeTaskAnalyzer.ts` is not handling undefined inputs correctly.
*   **Proposed Solution:** Implement input validation in the `analyzeComplexity` function.
*   **Status:** Resolved
*   **Notes:** Added enhanced validation for undefined, null, or empty inputs in the `analyzeComplexity` function with improved error handling.

### "subtask.id.slice is not a function" error

*   **Description:** The system throws a "subtask.id.slice is not a function" error, indicating an issue with how subtask IDs are being handled.
*   **Root Cause:** The `subtask.id` is expected to be a string, but it is not.
*   **Proposed Solution:** Ensure that `subtask.id` is always a string.
*   **Status:** Resolved
*   **Notes:** Added explicit string conversion (`String(subtask.id)`) before calling `.slice()` method in the `visualizeDependencies` function of `dependencyMapper.ts`.

### "spawn # Legacy: Custom path specifically for Retriv Python module ENOENT" error

*   **Description:** The system throws a "spawn # Legacy: Custom path specifically for Retriv Python module ENOENT" error, indicating that the Python executable is not found.
*   **Root Cause:** The RETRIV_PYTHON_PATH environment variable is either not set or is set to an invalid path.
*   **Proposed Solution:** Ensure that the RETRIV_PYTHON_PATH environment variable is set to a valid path.
*   **Status:** Resolved
*   **Notes:** Improved Python path handling in BM25Searcher constructor, added validation of path existence and fallback to default Python when needed.

### "Unsupported model provider: mistralai/mistral-small-24b-instruct-2501" error

*   **Description:** The system throws an "Unsupported model provider: mistralai/mistral-small-24b-instruct-2501" error, indicating that the selected model is not supported.
*   **Root Cause:** The `executeTask` function does not have support for the `mistralai/mistral-small-24b-instruct-2501` model.
*   **Proposed Solution:** Add support for the `mistralai/mistral-small-24b-instruct-2501` model to the `executeTask` function.
*   **Status:** Resolved
*   **Notes:** The model provider handling logic in `src/modules/api-integration/task-execution/index.ts` has been updated to properly recognize and support the mistralai provider format along with other providers like google and anthropic.

### "Python retriv bridge initialization timeout. Assuming ready." warning

*   **Description:** The system logs a "Python retriv bridge initialization timeout. Assuming ready." warning, indicating that the Python retriv bridge is not initializing correctly.
*   **Root Cause:** The Python retriv bridge is not initializing correctly.
*   **Proposed Solution:** Investigate the Python retriv bridge initialization logic.
*   **Status:** Resolved
*   **Notes:** Check the Python environment and the retriv_bridge.py script.

### "No documents have been indexed yet" warning

*   **Description:** The system logs a "No documents have been indexed yet" warning, indicating that the code search engine has not indexed any documents.
*   **Root Cause:** The code search engine is not being initialized with any documents to index.
*   **Proposed Solution:** Ensure that the code search engine is initialized with the correct directories to index.
*   **Status:** Resolved
*   **Notes:** Fixed the CodeSearchEngineManager to automatically index configured directories during initialization. Fixed the document indexing functionality to properly handle individual documents. Added better error handling and reporting for document indexing failures.

### Chat Script Logging Not Working

*   **Description:** The chat.ts script was not generating log files, making it difficult to track and debug chat interactions.
*   **Root Cause:** The logger implementation only supported console output and lacked file logging capabilities.
*   **Proposed Solution:** Enhance logger implementation to support file logging and add LOG_FILE configuration.
*   **Status:** Resolved
*   **Notes:** Logger has been updated with file output support and proper timestamp formatting.

### [Issue Title]

*   **Description:** [Detailed description of the issue]
*   **Root Cause:** [Analysis of the root cause]
*   **Proposed Solution:** [Proposed solution to address the root cause]
*   **Status:** [Open/In Progress/Resolved]
*   **Notes:** [Any additional notes or context]