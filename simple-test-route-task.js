#!/usr/bin/env node

/**
 * Simple test script for route_task functionality that directly checks results
 */

import { routeTask } from './dist/modules/api-integration/routing/index.js';
import fs from 'fs';

// Configure a test task
const testTask = {
  task: "Create a function to calculate the nth Fibonacci number",
  contextLength: 500,
  expectedOutputLength: 300,
  complexity: 0.4,  // Medium-low complexity
  priority: 'cost'  // Prioritize cost efficiency
};

// Helper to format output
function formatOutput(result) {
  console.log('\n========== ROUTE_TASK TEST RESULTS ==========\n');
  console.log(`Model Selected: ${result.model}`);
  console.log(`Provider: ${result.provider}`);
  console.log(`Reason: ${result.reason}`);
  
  if (result.jobId) {
    console.log(`Job ID: ${result.jobId}`);
  }
  
  if (result.details?.taskAnalysis) {
    console.log(`\nTask was decomposed into ${result.details.taskAnalysis.subtasks.length} subtasks`);
    
    result.details.taskAnalysis.subtasks.forEach((subtask, index) => {
      console.log(`\nSubtask ${index + 1}: ${subtask.description}`);
      console.log(`Type: ${subtask.codeType}`);
      console.log(`Complexity: ${subtask.complexity}`);
      console.log(`Recommended Model Size: ${subtask.recommendedModelSize}`);
    });
    
    // Only display execution order if it exists
    if (result.details.taskAnalysis.executionOrder && result.details.taskAnalysis.executionOrder.length > 0) {
      console.log('\nExecution Order:');
      result.details.taskAnalysis.executionOrder.forEach((id, index) => {
        const subtask = result.details.taskAnalysis.subtasks.find(s => s.id === id);
        console.log(`${index + 1}. ${subtask ? subtask.description : id}`);
      });
    }
  }
  
  console.log('\n============================================\n');
}

// Run the test
async function runTest() {
  try {
    console.log('Testing route_task with a Fibonacci function task...');
    const result = await routeTask(testTask);
    formatOutput(result);
    
    console.log('The task is now running asynchronously.');
    console.log('Writing job ID to a file for later checking...');
    
    if (result.jobId) {
      // Write job ID to a file for later checking
      fs.writeFileSync('last-job-id.txt', result.jobId);
      console.log(`Job ID ${result.jobId} saved to last-job-id.txt`);
      console.log(`To check results later, run: node check-job-results.js`);
    }
    
    console.log('\nTest complete.');
    process.exit(0);
    
  } catch (error) {
    console.error('Error testing route_task:', error);
    process.exit(1);
  }
}

runTest();