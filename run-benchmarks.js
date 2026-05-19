#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const benchmarkTasks = [
  {
    taskId: 'simple-function',
    task: 'Write a JavaScript function that calculates the factorial of a number.',
    contextLength: 200,
    expectedOutputLength: 300,
    complexity: 0.2,
  },
  {
    taskId: 'simple-validation',
    task: 'Write a function to validate an email address using regular expressions.',
    contextLength: 250,
    expectedOutputLength: 350,
    complexity: 0.3,
  },
  {
    taskId: 'medium-algorithm',
    task: 'Implement a binary search algorithm in JavaScript with proper error handling and edge cases.',
    contextLength: 500,
    expectedOutputLength: 700,
    complexity: 0.5,
  },
  {
    taskId: 'medium-api',
    task: 'Create a simple Express.js API endpoint that handles user registration with validation and error handling.',
    contextLength: 600,
    expectedOutputLength: 800,
    complexity: 0.6,
  },
  {
    taskId: 'complex-design-pattern',
    task: 'Implement a TypeScript class that uses the Observer design pattern for a pub/sub event system with strong typing.',
    contextLength: 800,
    expectedOutputLength: 1200,
    complexity: 0.8,
  },
  {
    taskId: 'complex-async',
    task: 'Create a React component that fetches data from an API, handles loading states, errors, and implements pagination with proper TypeScript types.',
    contextLength: 1000,
    expectedOutputLength: 1500,
    complexity: 0.9,
  },
];

const defaultLocalModels = [
  'qwen2.5-coder-3b-instruct',
  'llama3',
  'codellama:7b-instruct',
  'mistral:7b-instruct-v0.2',
  'phi3:mini',
];

const defaultPaidModels = [
  'gpt-3.5-turbo',
  'gpt-4o',
  'claude-3-sonnet-20240229',
  'gemini-1.5-pro',
  'mistral-large-latest',
];

const benchmarkResultsDir = path.resolve(process.cwd(), 'benchmark-results');
const distEntry = path.resolve(process.cwd(), 'dist', 'modules', 'benchmark', 'index.js');

async function loadModules() {
  await fs.access(distEntry);

  const [benchmarkModule, loggerModule, costMonitorModule, resultsModule] = await Promise.all([
    import('./dist/modules/benchmark/index.js'),
    import('./dist/utils/logger.js'),
    import('./dist/modules/cost-monitor/index.js'),
    import('./dist/modules/benchmark/storage/results.js'),
  ]);

  return {
    benchmarkModule: benchmarkModule.benchmarkModule,
    logger: loggerModule.logger,
    costMonitor: costMonitorModule.costMonitor,
    saveSummary: resultsModule.saveSummary,
  };
}

async function loadModelConfig(logger) {
  try {
    const configData = await fs.readFile(path.resolve(process.cwd(), 'benchmark-models.json'), 'utf8');
    const config = JSON.parse(configData);

    logger.info('Loaded model configuration from benchmark-models.json');
    logger.info(`Found ${config.paidModels.length} paid models and ${config.localModels.length} local models`);

    return {
      localModels: config.localModels,
      paidModels: config.paidModels,
    };
  } catch (error) {
    logger.warn('Could not load model configuration file. Using default models.');
    logger.warn('Run model-selector.js first to customize which models to benchmark.');

    return {
      localModels: defaultLocalModels,
      paidModels: defaultPaidModels,
    };
  }
}

async function runModelComparison(benchmarkModule, logger, localModel, paidModel, task) {
  logger.info(`Comparing ${localModel} vs ${paidModel} on task: ${task.taskId}`);

  try {
    const result = await benchmarkModule.benchmarkTask({
      ...task,
      localModel,
      paidModel,
    });

    logger.info(`Benchmark completed for ${task.taskId}`);
    logger.info(`Local model (${result.local.model}): ${result.local.timeTaken}ms, Success: ${result.local.successRate}, Quality: ${result.local.qualityScore}`);
    logger.info(`Paid model (${result.paid.model}): ${result.paid.timeTaken}ms, Success: ${result.paid.successRate}, Quality: ${result.paid.qualityScore}`);
    logger.info(`Cost savings: $${result.paid.cost.toFixed(4)}`);

    return result;
  } catch (error) {
    logger.error(`Error running benchmark for ${localModel} vs ${paidModel} on ${task.taskId}:`, error);
    return null;
  }
}

async function runSequentialBenchmark(benchmarkModule, logger, tasks) {
  const results = [];

  for (const task of tasks) {
    logger.info(`Running benchmark for task: ${task.taskId}`);

    try {
      const result = await benchmarkModule.benchmarkTask(task);
      results.push(result);

      logger.info(`Benchmark completed for ${task.taskId}`);
      logger.info(`Local model (${result.local.model}): ${result.local.timeTaken}ms, Success: ${result.local.successRate}, Quality: ${result.local.qualityScore}`);
      logger.info(`Paid model (${result.paid.model}): ${result.paid.timeTaken}ms, Success: ${result.paid.successRate}, Quality: ${result.paid.qualityScore}`);
      logger.info(`Cost savings: $${result.paid.cost.toFixed(4)}`);
    } catch (error) {
      logger.error(`Error running benchmark for ${task.taskId}:`, error);
    }
  }

  return results;
}

async function runAllBenchmarks(benchmarkModule, logger, saveSummary) {
  logger.info(`Running batch benchmark for ${benchmarkTasks.length} tasks`);

  const results = await runSequentialBenchmark(benchmarkModule, logger, benchmarkTasks);
  if (results.length === 0) {
    logger.warn('No benchmark results were produced.');
    return null;
  }

  const summary = benchmarkModule.generateSummary(results);
  await saveSummary(summary, benchmarkResultsDir, 'batch');

  logger.info('Benchmark Summary:');
  logger.info(`Tasks: ${summary.taskCount}`);
  logger.info(`Avg Context Length: ${summary.avgContextLength} tokens`);
  logger.info(`Avg Output Length: ${summary.avgOutputLength} tokens`);
  logger.info(`Avg Complexity: ${summary.avgComplexity.toFixed(2)}`);

  logger.info('\nLocal Model Performance:');
  logger.info(`Avg Time: ${summary.local.avgTimeTaken}ms`);
  logger.info(`Avg Success Rate: ${summary.local.avgSuccessRate.toFixed(2)}`);
  logger.info(`Avg Quality Score: ${summary.local.avgQualityScore.toFixed(2)}`);
  logger.info(`Total Tokens: ${summary.local.totalTokenUsage.total}`);

  logger.info('\nPaid Model Performance:');
  logger.info(`Avg Time: ${summary.paid.avgTimeTaken}ms`);
  logger.info(`Avg Success Rate: ${summary.paid.avgSuccessRate.toFixed(2)}`);
  logger.info(`Avg Quality Score: ${summary.paid.avgQualityScore.toFixed(2)}`);
  logger.info(`Total Tokens: ${summary.paid.totalTokenUsage.total}`);
  logger.info(`Total Cost: $${summary.paid.totalCost.toFixed(4)}`);

  logger.info('\nComparison:');
  logger.info(`Time Ratio (Local/Paid): ${summary.comparison.timeRatio.toFixed(2)}x`);
  logger.info(`Success Rate Diff: ${summary.comparison.successRateDiff.toFixed(2)}`);
  logger.info(`Quality Score Diff: ${summary.comparison.qualityScoreDiff.toFixed(2)}`);
  logger.info(`Cost Savings: $${summary.comparison.costSavings.toFixed(4)}`);

  return summary;
}

async function runComprehensiveBenchmark(benchmarkModule, logger, costMonitor) {
  const { localModels: selectedLocalModels, paidModels: selectedPaidModels } = await loadModelConfig(logger);

  logger.info(`Running comprehensive benchmark with ${selectedLocalModels.length} local models, ${selectedPaidModels.length} paid models, and ${benchmarkTasks.length} tasks`);

  const results = [];
  const summaries = {};

  const availableModels = await costMonitor.getAvailableModels();
  const availableLocalModels = selectedLocalModels.filter(model =>
    availableModels.some(m => m.id === model || m.id.includes(model))
  );

  if (availableLocalModels.length === 0) {
    logger.warn('No local models are available. Using default model from configuration.');
    availableLocalModels.push(process.env.DEFAULT_LOCAL_MODEL || 'qwen2.5-coder-3b-instruct');
  }

  logger.info(`Available local models: ${availableLocalModels.join(', ')}`);

  for (const localModel of availableLocalModels) {
    summaries[localModel] = {};

    for (const paidModel of selectedPaidModels) {
      summaries[localModel][paidModel] = {
        tasks: 0,
        localAvgTime: 0,
        localAvgSuccessRate: 0,
        localAvgQualityScore: 0,
        paidAvgTime: 0,
        paidAvgSuccessRate: 0,
        paidAvgQualityScore: 0,
        totalCostSavings: 0,
      };

      for (const task of benchmarkTasks) {
        const result = await runModelComparison(benchmarkModule, logger, localModel, paidModel, task);

        if (!result) {
          continue;
        }

        results.push(result);

        const summary = summaries[localModel][paidModel];
        summary.tasks++;
        summary.localAvgTime += result.local.timeTaken;
        summary.localAvgSuccessRate += result.local.successRate;
        summary.localAvgQualityScore += result.local.qualityScore;
        summary.paidAvgTime += result.paid.timeTaken;
        summary.paidAvgSuccessRate += result.paid.successRate;
        summary.paidAvgQualityScore += result.paid.qualityScore;
        summary.totalCostSavings += result.paid.cost;
      }

      const summary = summaries[localModel][paidModel];
      if (summary.tasks > 0) {
        summary.localAvgTime /= summary.tasks;
        summary.localAvgSuccessRate /= summary.tasks;
        summary.localAvgQualityScore /= summary.tasks;
        summary.paidAvgTime /= summary.tasks;
        summary.paidAvgSuccessRate /= summary.tasks;
        summary.paidAvgQualityScore /= summary.tasks;
      }

      logger.info(`\nSummary for ${localModel} vs ${paidModel}:`);
      logger.info(`Tasks: ${summary.tasks}`);
      logger.info(`Local Avg Time: ${summary.localAvgTime.toFixed(2)}ms`);
      logger.info(`Local Avg Success Rate: ${summary.localAvgSuccessRate.toFixed(2)}`);
      logger.info(`Local Avg Quality Score: ${summary.localAvgQualityScore.toFixed(2)}`);
      logger.info(`Paid Avg Time: ${summary.paidAvgTime.toFixed(2)}ms`);
      logger.info(`Paid Avg Success Rate: ${summary.paidAvgSuccessRate.toFixed(2)}`);
      logger.info(`Paid Avg Quality Score: ${summary.paidAvgQualityScore.toFixed(2)}`);
      logger.info(`Total Cost Savings: $${summary.totalCostSavings.toFixed(4)}`);
      logger.info(`Time Ratio (Local/Paid): ${(summary.localAvgTime / summary.paidAvgTime).toFixed(2)}x`);
      logger.info(`Success Rate Diff: ${(summary.localAvgSuccessRate - summary.paidAvgSuccessRate).toFixed(2)}`);
      logger.info(`Quality Score Diff: ${(summary.localAvgQualityScore - summary.paidAvgQualityScore).toFixed(2)}`);
    }
  }

  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filePath = path.join(benchmarkResultsDir, `comprehensive-summary-${timestamp}.json`);

    await fs.mkdir(benchmarkResultsDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(summaries, null, 2));

    logger.info(`Saved comprehensive benchmark summary to ${filePath}`);
  } catch (error) {
    logger.error('Error saving comprehensive benchmark summary:', error);
  }

  return summaries;
}

async function generateMarkdownReport(logger, summaries) {
  let markdown = `# Benchmark Results: Local LLMs vs Paid APIs\n\n`;
  markdown += `*Generated on: ${new Date().toISOString()}*\n\n`;
  markdown += `## Overview\n\n`;
  markdown += `This report compares the performance of various local LLM models against paid API models for coding tasks.\n\n`;
  markdown += `## Model Comparisons\n\n`;

  for (const [localModel, paidModelResults] of Object.entries(summaries)) {
    markdown += `### Local Model: ${localModel}\n\n`;
    markdown += `| Paid Model | Time Ratio (Local/Paid) | Success Rate Diff | Quality Score Diff | Cost Savings |\n`;
    markdown += `|------------|-------------------------|-------------------|-------------------|-------------|\n`;

    for (const [paidModel, summary] of Object.entries(paidModelResults)) {
      if (summary.tasks > 0) {
        const timeRatio = (summary.localAvgTime / summary.paidAvgTime).toFixed(2);
        const successRateDiff = (summary.localAvgSuccessRate - summary.paidAvgSuccessRate).toFixed(2);
        const qualityScoreDiff = (summary.localAvgQualityScore - summary.paidAvgQualityScore).toFixed(2);
        const costSavings = summary.totalCostSavings.toFixed(4);

        markdown += `| ${paidModel} | ${timeRatio}x | ${successRateDiff} | ${qualityScoreDiff} | $${costSavings} |\n`;
      }
    }

    markdown += `\n`;
  }

  markdown += `## Task Results\n\n`;
  markdown += `The benchmark included the following tasks:\n\n`;

  benchmarkTasks.forEach(task => {
    markdown += `### ${task.taskId}\n\n`;
    markdown += `**Description:** ${task.task}\n\n`;
    markdown += `**Complexity:** ${task.complexity}\n\n`;
    markdown += `**Context Length:** ${task.contextLength} tokens\n\n`;
    markdown += `**Expected Output Length:** ${task.expectedOutputLength} tokens\n\n`;
  });

  markdown += `## Recommendations\n\n`;
  markdown += `Based on these benchmark results, the following recommendations can be made:\n\n`;
  markdown += `1. For simple coding tasks, consider using the strongest local model for low-latency, low-cost responses.\n\n`;
  markdown += `2. For complex tasks where quality is critical, compare the top-performing local model against the best paid option.\n\n`;
  markdown += `3. When response time is the priority, paid APIs may still offer faster responses depending on current network conditions.\n\n`;
  markdown += `4. For cost-sensitive applications with high usage volume, using local LLMs can result in significant cost savings.\n\n`;

  try {
    await fs.mkdir(benchmarkResultsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filePath = path.join(benchmarkResultsDir, `benchmark-report-${timestamp}.md`);

    await fs.writeFile(filePath, markdown);
    logger.info(`Saved benchmark report to ${filePath}`);

    return filePath;
  } catch (error) {
    logger.error('Error saving benchmark report:', error);
    return null;
  }
}

async function main() {
  const { benchmarkModule, logger, costMonitor, saveSummary } = await loadModules();
  const args = process.argv.slice(2);
  const mode = args[0] || 'all';
  const taskIndex = Number.parseInt(args[1] || '0', 10);

  if (mode === 'single') {
    if (taskIndex >= 0 && taskIndex < benchmarkTasks.length) {
      logger.info(`Running single benchmark for task: ${benchmarkTasks[taskIndex].taskId}`);
      try {
        const result = await benchmarkModule.benchmarkTask(benchmarkTasks[taskIndex]);
        logger.info('Benchmark completed:', JSON.stringify(result, null, 2));
      } catch (error) {
        logger.error('Error running benchmark:', error);
        process.exitCode = 1;
      }
    } else {
      logger.error(`Invalid task index: ${taskIndex}. Must be between 0 and ${benchmarkTasks.length - 1}.`);
      process.exitCode = 1;
    }
    return;
  }

  if (mode === 'sequential') {
    try {
      await runSequentialBenchmark(benchmarkModule, logger, benchmarkTasks);
    } catch (error) {
      logger.error('Error running sequential benchmarks:', error);
      process.exitCode = 1;
    }
    return;
  }

  if (mode === 'comprehensive') {
    try {
      const summaries = await runComprehensiveBenchmark(benchmarkModule, logger, costMonitor);
      if (summaries) {
        const reportPath = await generateMarkdownReport(logger, summaries);
        if (reportPath) {
          logger.info(`Benchmark report generated at: ${reportPath}`);
        }
      }
    } catch (error) {
      logger.error('Error running comprehensive benchmarks:', error);
      process.exitCode = 1;
    }
    return;
  }

  try {
    await runAllBenchmarks(benchmarkModule, logger, saveSummary);
  } catch (error) {
    logger.error('Error running batch benchmarks:', error);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('Failed to start benchmark runner:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});