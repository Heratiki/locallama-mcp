#!/usr/bin/env node

/**
 * Test script for route_task functionality
 * This script tests the route_task tool with a simple coding task
 * and captures the key outputs to verify it's working as intended.
 */

import { routeTask } from './dist/modules/api-integration/routing/index.js';
import { getJobTracker } from './dist/modules/decision-engine/services/jobTracker.js';

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
    console.log('Waiting for the job to complete to see the generated code...');
    
    if (result.jobId) {
      // Wait for job completion and check the results
      const waitForJobCompletion = async (jobId, maxWaitTimeMs = 120000) => {
        let attempts = 0;
        const maxAttempts = 3;
        let jobTracker;
        
        // Try multiple times to get the job tracker
        while (attempts < maxAttempts) {
          try {
            jobTracker = await getJobTracker();
            break; // Successfully got the job tracker
          } catch (error) {
            attempts++;
            console.log(`Failed to get job tracker (attempt ${attempts}/${maxAttempts}): ${error.message}`);
            if (attempts >= maxAttempts) {
              return { status: 'error', error: 'Failed to initialize job tracker after multiple attempts' };
            }
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        const startTime = Date.now();
        
        // Poll every 5 seconds for job completion
        return new Promise((resolve) => {
          const interval = setInterval(async () => {
            try {
              const job = jobTracker.getJob(jobId);
              console.log(`Current job status: ${job.status}, progress: ${job.progress}%`);
              
              if (job.status === 'completed' || job.status === 'failed') {
                clearInterval(interval);
                resolve(job);
              }
              
              // Check if we've waited too long
              if (Date.now() - startTime > maxWaitTimeMs) {
                console.log('Maximum wait time exceeded. Job still in progress.');
                clearInterval(interval);
                resolve({ status: 'timeout', results: null });
              }
            } catch (error) {
              console.log('Error checking job status:', error);
              clearInterval(interval);
              resolve({ status: 'error', error });
            }
          }, 5000);
        });
      };
      
      const completedJob = await waitForJobCompletion(result.jobId);
      
      if (completedJob.status === 'completed') {
        console.log('\n========== GENERATED CODE ==========\n');
        if (completedJob.results && completedJob.results.length > 0) {
          completedJob.results.forEach((codeBlock, index) => {
            console.log(`Code Block ${index + 1}:`);
            console.log(codeBlock);
            console.log('\n-----------------------------------\n');
          });
        } else {
          console.log('No code blocks were generated.');
        }
        console.log('=====================================\n');
      } else {
        console.log(`Job did not complete successfully. Status: ${completedJob.status}`);
      }
    }
    
    console.log('\nTest complete. Exiting...');
    process.exit(0);
    
  } catch (error) {
    console.error('Error testing route_task:', error);
    process.exit(1);
  }
}

runTest();