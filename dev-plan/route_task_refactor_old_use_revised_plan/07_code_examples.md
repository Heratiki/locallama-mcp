# VII. Code Examples

*   **Example of a new `route_task` implementation:**

```typescript
// src/modules/api-integration/tools.ts
case 'route_task': {
  try {
    // Step 0: Load Stored User Execution Preference
    let executionMode: string | undefined = await vscode.workspace.getConfiguration('locallama').get('executionMode');

    // Step 1: User-Defined Execution Mode Selection
    if (!executionMode) {
      executionMode = await vscode.window.showQuickPick(
        ['Local model only', 'Free API first, then local models', 'Paid API for best results', 'Fully automated selection'],
        { placeHolder: 'Select execution mode' }
      );

      if (executionMode) {
        // Store the preference if the user selects one
        await vscode.workspace.getConfiguration('locallama').update('executionMode', executionMode, vscode.ConfigurationTarget.Global);
      }
    }

    if (!executionMode) {
      return {
        content: [{ type: 'text', text: 'No execution mode selected.' }],
        isError: true,
      };
    }

    // Step 2: Cost Estimation
    const costEstimate = await costMonitor.estimateCost({
      contextLength: (args.context_length as number) || 0,
      outputLength: (args.expected_output_length as number) || 0,
      complexity: (args.complexity as number) || 0.5,
    });

    const costThreshold = config.costThreshold || 0.5; // Example threshold
    if (costEstimate.openrouter_paid > costThreshold && executionMode !== 'Local model only') {
      const confirmExecution = await vscode.window.showWarningMessage(
        `Estimated cost: ${costEstimate.openrouter_paid}. Continue?`,
        'Yes',
        'No'
      );
      if (confirmExecution !== 'Yes') {
        return {
          content: [{ type: 'text', text: 'Execution cancelled by user due to high cost.' }],
          isError: true,
        };
      }
    }

    // Step 3: Task Breakdown Analysis
    let subtasks: any[] = [];
    if (executionMode !== 'Local model only'){
        subtasks = await decisionEngine.breakdownTask(args.task);
    }

    // Step 4: Retriv Search
    let retrivResults: any[] = [];
    if (subtasks.length === 0){
        retrivResults = await retriv.search(args.task);
    }

    if (retrivResults.length > 0) {
      // Use existing code (implementation details omitted for brevity)
      return {
        content: [{ type: 'text', text: 'Using existing code from Retriv.' }],
      };
    } else {
      // Step 5: Decision Engine Routing
      const decision = await decisionEngine.routeTask({
        task: args.task as string,
        contextLength: (args.context_length as number) || 0,
        expectedOutputLength: (args.expected_output_length as number) || 0,
        complexity: (args.complexity as number) || 0.5,
        priority: (args.priority as 'speed' | 'cost' | 'quality') || 'quality',
      });

      // Step 6: Job Creation
      const job = await jobTracker.createJob(decision.model, args.task);

      // Step 7: Progress Tracking
      jobTracker.updateProgress(job.id, 'Queued');

      // Step 8: Code Output (implementation details omitted for brevity)
      const result = await executeTask(decision.model, args.task);
      const formattedResult = formatResult(result);

      // Store result in Retriv (implementation details omitted for brevity)
      await retriv.store(formattedResult);

      // Step 9: Task Cancellation Support (VS Code command to cancel job)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ jobId: job.id, status: 'Queued', eta: '3 minutes' }, null, 2),
          },
        ],
      };
    }
  } catch (error: any) {
    logger.error('Error routing task:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error routing task: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
=======
// src/modules/api-integration/tools.ts
case 'route_task': {
  try {
    // Step 0: Load Stored User Execution Preference
    let executionMode: string | undefined = await vscode.workspace.getConfiguration('locallama').get('executionMode');

    // Step 1: User-Defined Execution Mode Selection
    if (!executionMode) {
      executionMode = await vscode.window.showQuickPick(
        ['Local model only', 'Free API first, then local models', 'Paid API for best results', 'Fully automated selection'],
        { placeHolder: 'Select execution mode' }
      );

      if (executionMode) {
        // Store the preference if the user selects one
        await vscode.workspace.getConfiguration('locallama').update('executionMode', executionMode, vscode.ConfigurationTarget.Global);
      }
    }

    if (!executionMode) {
      return {
        content: [{ type: 'text', text: 'No execution mode selected.' }],
        isError: true,
      };
    }

    // Step 2: Cost Estimation
    const costEstimate = await costMonitor.estimateCost({
      contextLength: (args.context_length as number) || 0,
      outputLength: (args.expected_output_length as number) || 0,
      complexity: (args.complexity as number) || 0.5,
    });

    const costThreshold = config.costThreshold || 0.5; // Example threshold
    if (costEstimate.openrouter_paid > costThreshold && executionMode !== 'Local model only') {
      const confirmExecution = await vscode.window.showWarningMessage(
        `Estimated cost: ${costEstimate.openrouter_paid}. Continue?`,
        'Yes',
        'No'
      );
      if (confirmExecution !== 'Yes') {
        return {
          content: [{ type: 'text', text: 'Execution cancelled by user due to high cost.' }],
          isError: true,
        };
      }
    }

    // Step 3: Task Breakdown Analysis
    let subtasks: any[] = [];
    if (executionMode !== 'Local model only'){
        subtasks = await decisionEngine.breakdownTask(args.task);
    }

    // Step 4: Retriv Search
    let retrivResults: any[] = [];
    if (subtasks.length === 0){
        retrivResults = await retriv.search(args.task);
    }

    if (retrivResults.length > 0) {
      // Use existing code (implementation details omitted for brevity)
      return {
        content: [{ type: 'text', text: 'Using existing code from Retriv.' }],
      };
    } else {
      // Step 5: Decision Engine Routing
      const decision = await decisionEngine.routeTask({
        task: args.task as string,
        contextLength: (args.context_length as number) || 0,
        expectedOutputLength: (args.expected_output_length as number) || 0,
        complexity: (args.complexity as number) || 0.5,
        priority: (args.priority as 'speed' | 'cost' | 'quality') || 'quality',
      });

      // Step 6: Job Creation
      const job = await jobTracker.createJob(decision.model, args.task);

      // Step 7: Progress Tracking
      jobTracker.updateProgress(job.id, 'Queued');

      // Step 8: Code Output (implementation details omitted for brevity)
      const result = await executeTask(decision.model, args.task);
      const formattedResult = formatResult(result);

      // Store result in Retriv (implementation details omitted for brevity)
      await retriv.store(formattedResult);

      // Step 9: Task Cancellation Support (VS Code command to cancel job)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ jobId: job.id, status: 'Queued', eta: '3 minutes' }, null, 2),
          },
        ],
      };
    }
  } catch (error: any) {
    logger.error('Error routing task:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error routing task: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}