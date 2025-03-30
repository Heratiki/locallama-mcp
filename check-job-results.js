#!/usr/bin/env node

/**
 * Check results of a previously completed job
 */

import fs from 'fs';
import { getJobTracker } from './dist/modules/decision-engine/services/jobTracker.js';

async function checkJobResults() {
  try {
    // Read the job ID from the file
    if (!fs.existsSync('last-job-id.txt')) {
      console.log('No job ID file found. Run the simple-test-route-task.js first.');
      process.exit(1);
    }
    
    const jobId = fs.readFileSync('last-job-id.txt', 'utf8').trim();
    console.log(`Checking results for job ID: ${jobId}`);
    
    // Get the job tracker
    try {
      const jobTracker = await getJobTracker();
      const job = jobTracker.getJob(jobId);
      
      if (!job) {
        console.log(`No job found with ID: ${jobId}`);
        process.exit(1);
      }
      
      console.log(`\nJob status: ${job.status}`);
      console.log(`Progress: ${job.progress}%`);
      
      if (job.status === 'completed') {
        console.log('\n========== GENERATED CODE ==========\n');
        if (job.results && job.results.length > 0) {
          job.results.forEach((codeBlock, index) => {
            console.log(`Code Block ${index + 1}:`);
            console.log(codeBlock);
            console.log('\n-----------------------------------\n');
          });
          
          // Also save to a file for easier viewing
          fs.writeFileSync('job-results.txt', job.results.join('\n\n-----------------------------------\n\n'), 'utf8');
          console.log('Results also saved to job-results.txt');
        } else {
          console.log('No code blocks were generated.');
        }
        console.log('=====================================\n');
      } else if (job.status === 'failed') {
        console.log(`Job failed: ${job.error || 'No error details available'}`);
      } else {
        console.log('Job is still in progress. Try again later.');
      }
    } catch (error) {
      console.error('Error connecting to job tracker:', error);
      // Try an alternative approach - manually check the job storage
      console.log('\nAttempting alternative approach to find job results...');
      
      // The job results are often stored in a cache directory
      const cacheDir = './data/jobs';
      
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        const jobFile = files.find(f => f.includes(jobId));
        
        if (jobFile) {
          console.log(`Found job file: ${jobFile}`);
          const jobData = JSON.parse(fs.readFileSync(`${cacheDir}/${jobFile}`, 'utf8'));
          
          console.log('\n========== GENERATED CODE ==========\n');
          if (jobData.results && jobData.results.length > 0) {
            jobData.results.forEach((codeBlock, index) => {
              console.log(`Code Block ${index + 1}:`);
              console.log(codeBlock);
              console.log('\n-----------------------------------\n');
            });
            
            // Also save to a file for easier viewing
            fs.writeFileSync('job-results.txt', jobData.results.join('\n\n-----------------------------------\n\n'), 'utf8');
            console.log('Results also saved to job-results.txt');
          } else {
            console.log('No code blocks were found in the job file.');
          }
          console.log('=====================================\n');
        } else {
          console.log(`Could not find a job file for ID: ${jobId}`);
        }
      } else {
        console.log(`Cache directory ${cacheDir} not found`);
      }
    }
  } catch (error) {
    console.error('Error checking job results:', error);
    process.exit(1);
  }
}

checkJobResults();