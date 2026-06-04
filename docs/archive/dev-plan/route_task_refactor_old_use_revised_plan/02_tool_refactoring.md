# II. Tool Refactoring

1.  **route\_task:**
    *   Modify the `route_task` tool to initiate a structured workflow.
    *   **Step 0: Load Stored User Execution Preference:** The `route_task` tool should load stored user execution preferences from VS Code. VS Code should prompt the user to use the saved preference or override it.
    *   **Step 1: User-Defined Execution Mode Selection:** If no preference is stored or the user overrides, VS Code should prompt the user to select how the task is handled (Local model only, Free API first, then local models, Paid API for best results, or Fully automated selection).
    *   **Step 2: Cost Estimation:** Before routing the task, `route_task` must query the `get_cost_estimate` API to assess execution costs. If the estimated cost exceeds a predefined threshold, VS Code must prompt the user to confirm or cancel execution before proceeding.
    *   **Step 3: Task Breakdown Analysis:** The `route_task` tool must query the Decision Engine to determine if task segmentation is necessary.
    *   **Step 4: Retriv Search:** If no segmentation is needed, the system checks Retriv for existing code solutions before generating anything new.
    *   **Step 5: Decision Engine Routing:** If no suitable code is found, the decision engine will determine the most cost-efficient way to execute the task, considering task complexity and benchmarking data.
    *   **Step 6: Job Creation:** A new job will be created and logged in `locallama://jobs/active`.
    *   **Step 7: Progress Tracking:** The tool will use `locallama://jobs/progress/{jobId}` to track the progress of the job.
    *   **Step 8: Code Output:** The tool will enforce a standardized return format (DIFF or new file) and store the result in Retriv.
    *   **Step 9: Task Cancellation Support:** Users must be able to cancel an active job from VS Code. If a job is running too long or is unnecessary, they should have a cancel option available via a button or command. If the job was already completed or too far along, warn the user instead of confirming cancellation.
2.  **get\_cost\_estimate:**
    *   No changes required.
3.  **get\_active\_jobs:**
    *   No changes required.
4.  **get\_job\_progress/{jobId}:**
    *   No changes required.
5.  **cancel\_job/{jobId}:**
    *   Implement the missing API endpoint for canceling a running job.
6.  **get\_free\_models:**
    *   No changes required.
7.  **benchmark\_task:**
    *   No changes required.