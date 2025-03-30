#!/usr/bin/env node

/**
 * Comprehensive test for route_task functionality
 * This script tests the entire workflow from routing to code generation
 */

import { routeTask } from './dist/modules/api-integration/routing/index.js';
import { getJobTracker } from './dist/modules/decision-engine/services/jobTracker.js';
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
    console.log('Waiting for job to complete (this may take a few minutes)...\n');
    
    if (result.jobId) {
      const jobId = result.jobId;
      let jobTracker;
      let lastProgress = 0;
      let checkCount = 0;
      let job = null;
      
      // Function to get job tracker with retry logic
      const getJobTrackerWithRetry = async (maxAttempts = 5) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const tracker = await getJobTracker();
            return tracker;
          } catch (error) {
            console.log(`Failed to get job tracker (attempt ${attempt}/${maxAttempts}): ${error.message}`);
            if (attempt === maxAttempts) throw error;
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      };
      
      // Keep checking until job is completed or fails
      while (true) {
        try {
          // Get job tracker if not already obtained
          if (!jobTracker) {
            jobTracker = await getJobTrackerWithRetry();
          }
          
          // Get job status
          job = jobTracker.getJob(jobId);
          if (!job) {
            console.log(`Warning: Job ${jobId} not found in job tracker`);
            // Try alternative approach - check job files
            break;
          }
          
          // Only log when progress changes
          if (job.progress !== lastProgress) {
            console.log(`Job status: ${job.status}, progress: ${job.progress}%`);
            lastProgress = job.progress;
          }
          
          // Check if job is completed or failed
          if (job.status === 'completed' || job.status === 'failed' || job.progress === 100) {
            break;
          }
          
          // Prevent infinite loop if job appears stuck
          checkCount++;
          if (checkCount > 180) { // roughly 15 minutes at 5 second intervals
            console.log('Exceeded maximum check count. Job might be stuck.');
            break;
          }
          
          // Wait before checking again
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          console.log(`Error checking job status: ${error.message}`);
          // Reset job tracker to force retry on next iteration
          jobTracker = null;
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // At this point, job should be completed, failed, or timeout reached
      console.log('\n=== FINAL JOB STATUS ===');
      console.log(`Job ID: ${jobId}`);
      
      if (job) {
        console.log(`Status: ${job.status}`);
        console.log(`Progress: ${job.progress}%`);
        
        if (job.status === 'completed' || job.progress === 100) {
          console.log('\n========== GENERATED CODE ==========\n');
          if (job.results && job.results.length > 0) {
            job.results.forEach((codeBlock, index) => {
              console.log(`Code Block ${index + 1}:`);
              console.log(codeBlock);
              console.log('\n-----------------------------------\n');
            });
            
            // Save to a file for easier viewing
            fs.writeFileSync('job-results.txt', job.results.join('\n\n-----------------------------------\n\n'), 'utf8');
            console.log('Results also saved to job-results.txt');
            console.log('\n===> route_task IS WORKING CORRECTLY: CODE WAS GENERATED');
          } else {
            console.log('No code blocks were generated.');
            console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: NO CODE WAS GENERATED');
          }
        } else if (job.status === 'failed') {
          console.log(`Job failed: ${job.error || 'No error details available'}`);
          console.log('\n===> route_task IS NOT WORKING CORRECTLY: JOB FAILED');
        } else {
          console.log('Job did not complete within the expected time.');
          console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: JOB DID NOT COMPLETE');
        }
      } else {
        console.log('Could not retrieve job information.');
        
        // Try to find job file directly
        const cacheDir = './data/jobs';
        if (fs.existsSync(cacheDir)) {
          console.log('\nAttempting to find job file directly...');
          
          const files = fs.readdirSync(cacheDir);
          const jobFile = files.find(f => f.includes(jobId));
          
          if (jobFile) {
            console.log(`Found job file: ${jobFile}`);
            try {
              const jobData = JSON.parse(fs.readFileSync(`${cacheDir}/${jobFile}`, 'utf8'));
              
              console.log(`Status from file: ${jobData.status}`);
              console.log(`Progress from file: ${jobData.progress}%`);
              
              if (jobData.results && jobData.results.length > 0) {
                console.log('\n========== GENERATED CODE ==========\n');
                jobData.results.forEach((codeBlock, index) => {
                  console.log(`Code Block ${index + 1}:`);
                  console.log(codeBlock);
                  console.log('\n-----------------------------------\n');
                });
                
                fs.writeFileSync('job-results.txt', jobData.results.join('\n\n-----------------------------------\n\n'), 'utf8');
                console.log('Results also saved to job-results.txt');
                console.log('\n===> route_task IS WORKING CORRECTLY: CODE WAS GENERATED');
              } else {
                console.log('No code blocks were found in the job file.');
                console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: NO CODE WAS GENERATED');
              }
            } catch (err) {
              console.log(`Error reading job file: ${err.message}`);
            }
          } else {
            console.log(`Could not find a job file for ID: ${jobId}`);
          }
        }
      }
    } else {
      console.log('No job ID was returned from route_task');
      console.log('\n===> route_task IS NOT WORKING CORRECTLY: NO JOB WAS CREATED');
    }
    
    console.log('\nTest complete.');
    
  } catch (error) {
    console.error('Error testing route_task:', error);
  }
}

runTest();