#!/usr/bin/env node

/**
 * Simple script to check for recently completed jobs and their results
 */

import fs from 'fs';
import path from 'path';

// Directory where jobs are stored
const jobsDir = path.join(process.cwd(), 'data', 'jobs');

// Check if the jobs directory exists
if (!fs.existsSync(jobsDir)) {
  console.log(`Jobs directory not found: ${jobsDir}`);
  process.exit(1);
}

// Get list of all job files
const jobFiles = fs.readdirSync(jobsDir);

if (jobFiles.length === 0) {
  console.log('No job files found.');
  process.exit(0);
}

console.log(`Found ${jobFiles.length} job files. Checking for completed jobs with results...`);

// Get the creation time for each file and sort by most recent
const jobFilesWithTime = jobFiles
  .map(file => ({
    file,
    time: fs.statSync(path.join(jobsDir, file)).mtime.getTime()
  }))
  .sort((a, b) => b.time - a.time); // Sort by most recent first

// Display the 5 most recent jobs
console.log('\nMost recent jobs:');
const recentJobs = jobFilesWithTime.slice(0, 5);

recentJobs.forEach((jobInfo, index) => {
  try {
    const jobPath = path.join(jobsDir, jobInfo.file);
    const jobData = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    
    const date = new Date(jobInfo.time);
    console.log(`\n[${index + 1}] Job: ${jobInfo.file}`);
    console.log(`    Time: ${date.toLocaleString()}`);
    console.log(`    Status: ${jobData.status || 'Unknown'}`);
    console.log(`    Task: ${jobData.task || 'Unknown'}`);
    
    // Check if the job has results
    if (jobData.results && jobData.results.length > 0) {
      console.log(`    Has Results: Yes (${jobData.results.length} code blocks)`);
      
      // Prompt to view the first result
      console.log('\n    --- First Code Block ---');
      console.log(jobData.results[0]);
      console.log('    -----------------------');
      
      // Save all results to a file for easier viewing
      const resultsPath = path.join(process.cwd(), `job-${jobInfo.file}-results.txt`);
      fs.writeFileSync(resultsPath, jobData.results.join('\n\n-----------------------------------\n\n'));
      console.log(`\n    All results saved to: ${resultsPath}`);
    } else {
      console.log('    Has Results: No');
    }
  } catch (error) {
    console.log(`\n[${index + 1}] Error reading job ${jobInfo.file}: ${error.message}`);
  }
});

console.log('\nDone.');