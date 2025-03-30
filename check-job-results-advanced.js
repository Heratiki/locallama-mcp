#!/usr/bin/env node

/**
 * Advanced job results checker - searches in multiple possible locations
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { getJobTracker } from './dist/modules/decision-engine/services/jobTracker.js';

// Check for a specific job ID passed as argument
const jobId = process.argv[2] || (fs.existsSync('last-job-id.txt') 
  ? fs.readFileSync('last-job-id.txt', 'utf8').trim()
  : null);

if (!jobId) {
  console.log('No job ID provided. Usage: node check-job-results-advanced.js [jobId]');
  process.exit(1);
}

console.log(`Looking for results of job: ${jobId}`);

async function checkJobTracker() {
  console.log('\nMethod 1: Checking JobTracker service...');
  try {
    const jobTracker = await getJobTracker();
    const job = jobTracker.getJob(jobId);
    
    if (!job) {
      console.log('  No job found in job tracker with this ID');
      return null;
    }
    
    console.log(`  Found job in tracker: ${job.id}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Progress: ${job.progress}`);
    
    return job;
  } catch (error) {
    console.log(`  Error accessing job tracker: ${error.message}`);
    return null;
  }
}

function checkDataDirectory() {
  console.log('\nMethod 2: Checking data/jobs directory...');
  
  // Check common locations for job data
  const possiblePaths = [
    path.join(process.cwd(), 'data', 'jobs'),
    path.join(process.cwd(), '.cache', 'jobs'),
    path.join(process.cwd(), '.cache')
  ];
  
  for (const dir of possiblePaths) {
    if (fs.existsSync(dir)) {
      console.log(`  Found directory: ${dir}`);
      
      try {
        const files = fs.readdirSync(dir);
        // Check for files containing the jobId
        const jobFile = files.find(f => f.includes(jobId));
        
        if (jobFile) {
          console.log(`  Found job file: ${jobFile}`);
          try {
            const jobData = JSON.parse(fs.readFileSync(path.join(dir, jobFile), 'utf8'));
            return { file: path.join(dir, jobFile), data: jobData };
          } catch (error) {
            console.log(`  Error reading file: ${error.message}`);
          }
        } else {
          console.log(`  No matching file found in ${dir}`);
        }
      } catch (error) {
        console.log(`  Error reading directory ${dir}: ${error.message}`);
      }
    } else {
      console.log(`  Directory not found: ${dir}`);
    }
  }
  
  return null;
}

function findJobFilesRecursively() {
  console.log('\nMethod 3: Searching recursively for job files...');
  
  try {
    // Exclude node_modules and .git directories for efficiency
    const jobFiles = glob.sync('**/*' + jobId + '*', { 
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      nodir: true
    });
    
    if (jobFiles.length === 0) {
      console.log('  No files containing the job ID found in the workspace');
      return null;
    }
    
    console.log(`  Found ${jobFiles.length} potential job files:`);
    
    for (const file of jobFiles) {
      console.log(`  - ${file}`);
      
      // Try to read each file as JSON
      try {
        const content = fs.readFileSync(file, 'utf8');
        // Simple check to see if it looks like JSON
        if (content.trim().startsWith('{')) {
          try {
            const data = JSON.parse(content);
            // Check if it has job-like properties
            if (data.status || data.progress || data.results) {
              console.log(`  Found likely job data in: ${file}`);
              return { file, data };
            }
          } catch (parseError) {
            // Not valid JSON, continue to next file
          }
        }
      } catch (readError) {
        console.log(`  Error reading file ${file}: ${readError.message}`);
      }
    }
  } catch (error) {
    console.log(`  Error during recursive search: ${error.message}`);
  }
  
  return null;
}

function displayJobResults(jobData) {
  console.log('\n========== JOB INFORMATION ==========');
  console.log(`Status: ${jobData.status || 'Unknown'}`);
  console.log(`Progress: ${jobData.progress || 0}%`);
  
  if (jobData.task) {
    console.log(`Task: ${jobData.task}`);
  }
  
  if (jobData.results && jobData.results.length > 0) {
    console.log(`\nFound ${jobData.results.length} code blocks in results:`);
    
    jobData.results.forEach((codeBlock, index) => {
      console.log(`\n----- CODE BLOCK ${index + 1} -----`);
      console.log(codeBlock);
      console.log('---------------------------');
    });
    
    // Save results to a file
    const resultsPath = `job-${jobId}-results.txt`;
    fs.writeFileSync(resultsPath, jobData.results.join('\n\n-----------------------------------\n\n'), 'utf8');
    console.log(`\nAll results saved to: ${resultsPath}`);
    
    console.log('\n===> ROUTE_TASK IS WORKING CORRECTLY: CODE WAS GENERATED');
  } else {
    console.log('\nNo code blocks were found in the job data');
    console.log('\n===> ROUTE_TASK MAY NOT BE WORKING CORRECTLY: NO CODE WAS GENERATED');
  }
  console.log('\n=======================================');
}

async function checkJobResults() {
  try {
    // Method 1: Check job tracker
    const jobFromTracker = await checkJobTracker();
    if (jobFromTracker && jobFromTracker.results && jobFromTracker.results.length > 0) {
      console.log('\nFound results in job tracker.');
      displayJobResults(jobFromTracker);
      return;
    }
    
    // Method 2: Check in data directory
    const jobFromData = checkDataDirectory();
    if (jobFromData && jobFromData.data) {
      console.log(`\nFound results in data directory: ${jobFromData.file}`);
      displayJobResults(jobFromData.data);
      return;
    }
    
    // Method 3: Search recursively
    const jobFromSearch = findJobFilesRecursively();
    if (jobFromSearch && jobFromSearch.data) {
      console.log(`\nFound results in search: ${jobFromSearch.file}`);
      displayJobResults(jobFromSearch.data);
      return;
    }
    
    console.log('\n========== NO JOB RESULTS FOUND ==========');
    console.log('Could not find job results in any location.');
    console.log('Possible reasons:');
    console.log('1. The job is still running or queued');
    console.log('2. The job failed without creating results');
    console.log('3. The job storage mechanism is not working properly');
    console.log('4. Results are stored in an unexpected location');
    console.log('\nTry running a new task with the comprehensive test and');
    console.log('manually capturing the output before interrupting.');
    
  } catch (error) {
    console.error('Error checking job results:', error);
  }
}

// Run the check
checkJobResults();