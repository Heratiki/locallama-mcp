# IV. VS Code Integration

1.  **Execution Mode Selection:**
    *   Load stored user execution preferences.
    *   Prompt the user to select execution preferences before processing tasks.
2.  **Cost Estimation Prompt:**
    *   If the estimated cost exceeds a predefined threshold, prompt the user to confirm or cancel execution before proceeding.
3.  **Task Progress Display:**
    *   Use `locallama://jobs/progress/{jobId}` to update the user inside VS Code's output panel or status bar.
4.  **Job Queue Visibility:**
    *   Show active jobs in VS Code's Problems/Task List panel.
5.  **Code Diff Preview:**
    *   Allow Claude to suggest DIFFs as VS Code inline edits, not just raw text.
6.  **Task Cancellation UI:**
    *   Implement a `cancel_job` endpoint, allowing users to abort tasks via VS Code commands.