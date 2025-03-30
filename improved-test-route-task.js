#!/usr/bin/env node

/**
 * Comprehensive test script for route_task functionality with proper timeouts
 * Based on real-world benchmark performance data
 */

import fs from 'fs';
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

// Set timeout configuration based on benchmark data
const CONFIG = {
  // Timeout for initial job tracker initialization
  initTimeoutMs: 5000,
  
  // Timeout for waiting for job tracker to return a job
  jobTrackerTimeoutMs: 10000,
  
  // Maximum time to wait for job completion
  // Based on benchmark results showing most models complete within 30s
  // but adding buffer for task decomposition and other processing
  maxWaitTimeMs: 60000,
  
  // Progress check interval
  progressCheckIntervalMs: 3000,
  
  // Maximum number of progress check attempts
  // This ensures we don't wait indefinitely if something gets stuck
  maxProgressChecks: 20
};

// Run the test
async function runTest() {
  try {
    console.log('Testing route_task with a Fibonacci function task...');
    const result = await routeTask(testTask);
    formatOutput(result);
    
    console.log('The task is now running asynchronously.');
    console.log(`Waiting for job to complete (maximum wait time: ${CONFIG.maxWaitTimeMs / 1000} seconds)...\n`);
    
    if (result.jobId) {
      const jobId = result.jobId;
      let jobTracker;
      let lastProgress = 0;
      let checkCount = 0;
      let job = null;
      
      // Function to get job tracker with retry logic and timeout
      const getJobTrackerWithRetry = async (maxAttempts = 3) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            // Add timeout to prevent hanging
            const trackerPromise = getJobTracker();
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Job tracker initialization timed out')), CONFIG.initTimeoutMs)
            );
            
            const tracker = await Promise.race([trackerPromise, timeoutPromise]);
            return tracker;
          } catch (error) {
            console.log(`Failed to get job tracker (attempt ${attempt}/${maxAttempts}): ${error.message}`);
            if (attempt === maxAttempts) throw error;
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      };
      
      // Try to initialize job tracker
      try {
        jobTracker = await getJobTrackerWithRetry();
      } catch (error) {
        console.log(`Error initializing job tracker: ${error.message}`);
        console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: CANNOT TRACK JOB');
        process.exit(1);
      }
      
      // Keep checking until job is completed or times out
      const startTime = Date.now();
      
      while (true) {
        try {
          // Get job status with timeout
          const getJobPromise = new Promise(resolve => {
            try {
              const job = jobTracker.getJob(jobId);
              resolve(job);
            } catch (e) {
              resolve(null);
            }
          });
          
          const timeoutPromise = new Promise(resolve => 
            setTimeout(() => resolve(null), CONFIG.jobTrackerTimeoutMs)
          );
          
          job = await Promise.race([getJobPromise, timeoutPromise]);
          
          if (!job) {
            console.log(`Warning: Job ${jobId} not found or timed out`);
            break;
          }
          
          // Only log when progress changes
          if (job.progress !== lastProgress) {
            console.log(`Job status: ${job.status}, progress: ${job.progress}`);
            lastProgress = job.progress;
          }
          
          // Check if job is completed or failed
          if (job.status === 'Completed' || job.status === 'Failed' || job.progress === '100%') {
            break;
          }
          
          // Check if we've waited too long
          const elapsedMs = Date.now() - startTime;
          if (elapsedMs > CONFIG.maxWaitTimeMs) {
            console.log(`\nMaximum wait time of ${CONFIG.maxWaitTimeMs/1000} seconds exceeded.`);
            console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: TIMEOUT WAITING FOR JOB');
            break;
          }
          
          // Prevent infinite loop with hard limit on checks
          checkCount++;
          if (checkCount > CONFIG.maxProgressChecks) {
            console.log('\nExceeded maximum progress check count. Job appears to be stuck.');
            console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: JOB APPEARS STUCK');
            break;
          }
          
          // Wait before checking again
          await new Promise(resolve => setTimeout(resolve, CONFIG.progressCheckIntervalMs));
        } catch (error) {
          console.log(`Error checking job status: ${error.message}`);
          break;
        }
      }
      
      // At this point, job should be completed, failed, or timeout reached
      console.log('\n=== FINAL JOB STATUS ===');
      console.log(`Job ID: ${jobId}`);
      
      if (job) {
        console.log(`Status: ${job.status}`);
        console.log(`Progress: ${job.progress}`);
        
        if (job.status === 'Completed' || job.progress === '100%') {
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
            console.log('No code blocks were generated in the job.');
            
            // Alternative approach - check in job files
            console.log('\nChecking for job files directly...');
            
            // Check in both possible locations
            const jobDirs = ['./data/jobs', './.cache/jobs', './.cache'];
            
            let jobData = null;
            let jobFilePath = null;
            
            for (const dir of jobDirs) {
              if (fs.existsSync(dir)) {
                try {
                  const files = fs.readdirSync(dir);
                  const jobFile = files.find(f => f.includes(jobId));
                  
                  if (jobFile) {
                    jobFilePath = `${dir}/${jobFile}`;
                    console.log(`Found job file: ${jobFilePath}`);
                    jobData = JSON.parse(fs.readFileSync(jobFilePath, 'utf8'));
                    break;
                  }
                } catch (err) {
                  console.log(`Error reading directory ${dir}: ${err.message}`);
                }
              }
            }
            
            if (jobData) {
              console.log(`Status from file: ${jobData.status}`);
              console.log(`Progress from file: ${jobData.progress}`);
              
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
            } else {
              console.log('Could not find job file in expected locations.');
              console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: NO JOB FILE FOUND');
            }
          }
        } else if (job.status === 'Failed') {
          console.log(`Job failed: ${job.error || 'No error details available'}`);
          console.log('\n===> route_task IS NOT WORKING CORRECTLY: JOB FAILED');
        } else {
          console.log('Job did not complete within the expected time.');
          console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: JOB DID NOT COMPLETE');
        }
      } else {
        console.log('Could not retrieve job information.');
        console.log('\n===> route_task MAY NOT BE WORKING CORRECTLY: JOB INFO NOT AVAILABLE');
      }
    }
    
    console.log('\nTest complete. Exiting...');
    process.exit(0);
    
  } catch (error) {
    console.error('Error testing route_task:', error);
    console.log('\n===> route_task IS NOT WORKING CORRECTLY: ERROR DURING TEST');
    process.exit(1);
  }
}

runTest();