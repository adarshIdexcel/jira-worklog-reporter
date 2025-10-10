/**
 * Jira Work Log Fetcher
 * Standalone script to fetch work logs for a user/group within a date range
 * 
 * Prerequisites:
 * - Node.js installed
 * - Run: npm install node-fetch
 * 
 * Usage:
 * - Update the configuration section below
 * - Run: node jira-worklog-fetcher.js
 */

import fetch from 'node-fetch';
import XLSX from 'xlsx';
import readline from 'readline';

// ============================================
// GLOBAL STATS TRACKER
// ============================================

const STATS = {
  apiCalls: 0,
  issuesFetched: 0,
  workLogsFetched: 0,
  workLogsMatched: 0,
  totalTimeSeconds: 0,
  startTime: null,
  endTime: null
};

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================

const CONFIG = {
  // Jira instance URL
  jiraBaseUrl: 'https://idexcel.atlassian.net',
  
  // Authentication (email:apiToken will be base64 encoded)
  email: '<email>',  // Replace with your email
  apiToken: '<apiToken>',  // Replace with your Jira API token

  // Filter criteria - Choose ONE of the following:
  // Option 1: Specific user by email
  specificUserEmail: null,  // e.g., 'john.doe@idexcel.com' or null
  
  // Option 2: Team/Group
  groupName: "AWS Team",  // e.g., 'AWS Team' or null
  
  // Option 3: Current authenticated user
  useCurrentUser: false,  // Set to true to fetch only your own worklogs
  
  // Date range (ISO format YYYY-MM-DD or Date objects)
  // Default: Last 30 days - increase if you need more coverage
  startDate: getDateDaysAgo(60),  // 60 days ago (increased from 30)
  endDate: getDateDaysAgo(0),     // Today
  
  // Timezone for date conversion
  timezone: 'Asia/Kolkata',  // IST timezone
  
  // Pagination
  maxResultsPerPage: 500,
  maxIssuesToProcess: 3000,  // Increased for larger groups (60 people, 2500+ tickets)
  maxWorklogsPerIssue: 10000, // Safety limit for issues with excessive worklogs
  
  // Batch Processing (for groups only)
  enableBatchProcessing: true,      // Enable batch processing for large groups
  batchSize: 200,                   // Issues per batch (for groups)
  batchDelayMs: 1000,               // Delay between batches (1 second)
  maxRetries: 3,                    // Max retries for failed API calls
  retryDelayMs: 2000,               // Base delay for retry (2 seconds)
  
  // Output options
  outputFormat: 'console',  // 'console' or 'json'
  exportToExcel: true,
  reportsFolder: './generated-reports'  // Folder to store generated reports
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get date N days ago in YYYY-MM-DD format
 */
function getDateDaysAgo(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

/**
 * Generate dynamic filename for Excel report
 * Format: {GroupName/UserName}_{YYYY-MM-DD}_{HH-MM-SS}.xlsx
 */
function generateExcelFileName(userOrGroupName) {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  
  // Sanitize name for filename (remove special characters)
  const sanitizedName = userOrGroupName
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  return `${sanitizedName}_${date}_${time}.xlsx`;
}

/**
 * Prompt user for custom date range
 */
async function promptForDateRange() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  console.log('\n📅 Date Range Options:');
  console.log('   1. Last 30 days (default)');
  console.log('   2. Custom date range');
  
  const choice = await question('\nSelect option (1 or 2, press Enter for default): ');
  
  if (choice.trim() === '2') {
    console.log('\n📆 Enter custom date range (format: YYYY-MM-DD)');
    
    let startDate, endDate;
    let validDates = false;
    
    while (!validDates) {
      startDate = await question('Start date (e.g., 2025-09-01): ');
      endDate = await question('End date (e.g., 2025-10-09): ');
      
      // Validate dates
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      
      if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
        console.log('❌ Invalid date format. Please use YYYY-MM-DD format.\n');
      } else if (startDateObj > endDateObj) {
        console.log('❌ Start date must be before end date.\n');
      } else if (endDateObj > new Date()) {
        console.log('❌ End date cannot be in the future.\n');
      } else {
        validDates = true;
      }
    }
    
    rl.close();
    return { startDate: startDate.trim(), endDate: endDate.trim() };
  } else {
    rl.close();
    return { 
      startDate: getDateDaysAgo(30), 
      endDate: getDateDaysAgo(0) 
    };
  }
}

/**
 * Create Basic Auth header
 */
function getAuthHeader() {
  const credentials = `${CONFIG.email}:${CONFIG.apiToken}`;
  const base64Credentials = Buffer.from(credentials).toString('base64');
  return `Basic ${base64Credentials}`;
}

/**
 * Make authenticated request to Jira API
 */
async function jiraRequest(endpoint, options = {}) {
  const url = `${CONFIG.jiraBaseUrl}${endpoint}`;
  
  // Track API call
  STATS.apiCalls++;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira API Error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

/**
 * Make authenticated request to Jira API with retry logic and rate limit handling
 */
async function jiraRequestWithRetry(endpoint, options = {}, retryCount = 0) {
  try {
    const url = `${CONFIG.jiraBaseUrl}${endpoint}`;
    
    // Track API call
    STATS.apiCalls++;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    // Check rate limit headers
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    const rateLimitReset = response.headers.get('X-RateLimit-Reset');
    
    if (rateLimitRemaining && parseInt(rateLimitRemaining) < 10) {
      console.log(`   ⚠️  Low rate limit: ${rateLimitRemaining} requests remaining`);
    }
    
    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : CONFIG.retryDelayMs * Math.pow(2, retryCount);
      
      if (retryCount < CONFIG.maxRetries) {
        console.log(`   🔄 Rate limit hit. Retrying after ${waitTime/1000}s... (attempt ${retryCount + 1}/${CONFIG.maxRetries})`);
        await sleep(waitTime);
        return jiraRequestWithRetry(endpoint, options, retryCount + 1);
      } else {
        throw new Error(`Rate limit exceeded after ${CONFIG.maxRetries} retries`);
      }
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API Error (${response.status}): ${errorText}`);
    }
    
    return response.json();
    
  } catch (error) {
    // Retry on network errors
    if (retryCount < CONFIG.maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
      const waitTime = CONFIG.retryDelayMs * Math.pow(2, retryCount);
      console.log(`   🔄 Network error. Retrying after ${waitTime/1000}s... (attempt ${retryCount + 1}/${CONFIG.maxRetries})`);
      await sleep(waitTime);
      return jiraRequestWithRetry(endpoint, options, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Sleep utility function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// MAIN FUNCTIONS
// ============================================

/**
 * Get current user's account ID
 */
async function getCurrentUser() {
  console.log('📋 Fetching current user details...');
  const user = await jiraRequest('/rest/api/3/myself');
  console.log(`✅ Current user: ${user.displayName} (${user.emailAddress})`);
  return user;
}

/**
 * Get members of a Jira group
 */
async function getGroupMembers(groupName) {
  console.log(`👥 Fetching members of group: ${groupName}...`);
  
  let allMembers = [];
  let startAt = 0;
  const maxResults = 50;
  let hasMore = true;
  
  while (hasMore) {
    const response = await jiraRequest(
      `/rest/api/3/group/member?groupname=${encodeURIComponent(groupName)}&startAt=${startAt}&maxResults=${maxResults}`
    );
    
    allMembers = allMembers.concat(response.values);
    startAt += maxResults;
    hasMore = !response.isLast && response.values.length > 0;
  }
  
  console.log(`✅ Found ${allMembers.length} members in group "${groupName}"`);
  allMembers.forEach(member => {
    console.log(`   - ${member.displayName} (${member.emailAddress || member.accountId})`);
  });
  
  return allMembers;
}

/**
 * Get a specific user by email address
 */
async function getUserByEmail(email) {
  console.log(`👤 Fetching user details for: ${email}...`);
  
  // Search for user by email using the user search API
  const response = await jiraRequest(
    `/rest/api/3/user/search?query=${encodeURIComponent(email)}`
  );
  
  if (!response || response.length === 0) {
    throw new Error(`User not found with email: ${email}`);
  }
  
  // Find exact match (case-insensitive)
  const user = response.find(u => 
    u.emailAddress && u.emailAddress.toLowerCase() === email.toLowerCase()
  );
  
  if (!user) {
    throw new Error(`No exact match found for email: ${email}`);
  }
  
  console.log(`✅ Found user: ${user.displayName} (${user.emailAddress})`);
  return user;
}

/**
 * Search issues using JQL with work logs
 */
async function searchIssuesWithWorkLogs(accountIds, startDate, endDate) {
  console.log(`\n🔍 Searching issues with work logs...`);
  console.log(`   Date range: ${startDate} to ${endDate}`);
  console.log(`   Users: ${accountIds.length} account(s)`);
  
  // Build JQL query - use a broader search first, then filter by date when fetching work logs
  // Note: worklogDate JQL function may not work reliably in all Jira instances
  const accountIdsJql = accountIds.map(id => `"${id}"`).join(', ');
  
  // Try multiple JQL strategies
  let jql;
  let allIssues = [];
  let strategyUsed = "none";
  
  // Strategy 1: Try with worklogDate (may not work in all instances)
  try {
    jql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor in (${accountIdsJql}) ORDER BY updated DESC`;
    console.log(`   Trying JQL Strategy 1 (with worklogDate):`);
    console.log(`   JQL: ${jql.substring(0, 120)}...`);
    allIssues = await executeJQLSearch(jql);
    console.log(`   ✅ Strategy 1 result: ${allIssues.length} issues found\n`);
    strategyUsed = "worklogDate + worklogAuthor";
  } catch (error) {
    console.log(`   ⚠️  Strategy 1 failed: ${error.message}`);
    console.log(`   Trying alternative strategy...\n`);
  }
  
  // Strategy 2: Broader search - just worklogAuthor, filter by date later
  if (allIssues.length === 0) {
    try {
      jql = `worklogAuthor in (${accountIdsJql}) ORDER BY updated DESC`;
      console.log(`   Trying JQL Strategy 2 (broader search):`);
      console.log(`   JQL: ${jql.substring(0, 120)}...`);
      allIssues = await executeJQLSearch(jql);
      console.log(`   ✅ Strategy 2 result: ${allIssues.length} issues found\n`);
      strategyUsed = "worklogAuthor only";
    } catch (error) {
      console.log(`   ⚠️  Strategy 2 failed: ${error.message}`);
    }
  }
  
  // Strategy 3: Even broader - issues updated in the date range where user might have logged work
  if (allIssues.length === 0) {
    try {
      jql = `updated >= "${startDate}" AND updated <= "${endDate}" ORDER BY updated DESC`;
      console.log(`   Trying JQL Strategy 3 (updated date range):`);
      console.log(`   JQL: ${jql}`);
      allIssues = await executeJQLSearch(jql);
      console.log(`   ✅ Strategy 3 result: ${allIssues.length} issues found`);
      console.log(`   ℹ️  Note: Will filter work logs by author and date later\n`);
      strategyUsed = "updated date range";
    } catch (error) {
      console.log(`   ⚠️  Strategy 3 failed: ${error.message}`);
      console.log(`   No issues found with any search strategy\n`);
    }
  }
  
  console.log(`✅ Found ${allIssues.length} issues to check for work logs`);
  console.log(`📊 Strategy used: ${strategyUsed}\n`);
  
  // Add debug info about unique projects and date ranges
  if (allIssues.length > 0) {
    const projects = [...new Set(allIssues.map(issue => issue.fields.project?.key).filter(Boolean))];
    const createdDates = allIssues.map(issue => issue.fields.created?.split('T')[0]).filter(Boolean);
    const updatedDates = allIssues.map(issue => issue.fields.updated?.split('T')[0]).filter(Boolean);
    
    console.log(`📋 Debug Info:`);
    console.log(`   Projects found: ${projects.join(', ')}`);
    console.log(`   Date range of issues (created): ${Math.min(...createdDates)} to ${Math.max(...createdDates)}`);
    console.log(`   Date range of issues (updated): ${Math.min(...updatedDates)} to ${Math.max(...updatedDates)}\n`);
  }
  
  return allIssues;
}

/**
 * Execute JQL search with pagination (cursor-based for /search/jql endpoint)
 */
async function executeJQLSearch(jql) {
  let allIssues = [];
  let nextPageToken = null;
  let pageCount = 0;
  let isLast = false;
  
  do {
    pageCount++;
    
    // Build query parameters for the JQL search API (cursor-based pagination)
    const fields = ['summary', 'issuetype', 'status', 'project', 'assignee', 'created'];
    const queryParams = new URLSearchParams({
      jql: jql,
      fields: fields.join(','),
      maxResults: CONFIG.maxResultsPerPage
    });
    
    // Add pagination token if we have one
    if (nextPageToken) {
      queryParams.set('nextPageToken', nextPageToken);
    }
    
    // Try the JQL search endpoint (as required by newer Jira instances)
    const response = await jiraRequest(`/rest/api/3/search/jql?${queryParams.toString()}`);
    
    // Validate response
    if (!response || !Array.isArray(response.issues)) {
      console.log(`   ❌ Invalid response from Jira API:`, JSON.stringify(response, null, 2));
      break;
    }
    
    const issuesInThisPage = response.issues || [];
    allIssues = allIssues.concat(issuesInThisPage);
    
    // Update pagination info
    nextPageToken = response.nextPageToken;
    isLast = response.isLast || false;
    
    // Calculate percentage (estimate since we don't have total)
    console.log(`   Page ${pageCount}: Fetched ${issuesInThisPage.length} issues (total so far: ${allIssues.length})`);
    
    // Break if no more issues to fetch
    if (issuesInThisPage.length === 0 || isLast) {
      console.log(`   ℹ️  Reached end of results (isLast: ${isLast})`);
      break;
    }
    
    // Limit to reasonable number to avoid too many API calls
    if (allIssues.length >= CONFIG.maxIssuesToProcess) {
      console.log(`   ⚠️  Limiting to first ${CONFIG.maxIssuesToProcess} issues to avoid excessive API calls`);
      console.log(`   ℹ️  To process more issues, increase CONFIG.maxIssuesToProcess in the script`);
      console.log(`   📊 Current setting allows ~${CONFIG.maxIssuesToProcess} issues (good for groups of 60+ people)`);
      break;
    }
    
    // Continue pagination if we have more pages
  } while (nextPageToken && !isLast);
  
  console.log(`   ✅ Pagination complete. Fetched ${allIssues.length} total issues across ${pageCount} pages`);
  return allIssues;
}

/**
 * Get work logs for a specific issue
 */
async function getIssueWorkLogs(issueKey) {
  const response = await jiraRequest(`/rest/api/3/issue/${issueKey}/worklog`);
  return response.worklogs || [];
}

/**
 * Get work logs for a specific issue with retry logic and pagination
 */
async function getIssueWorkLogsWithRetry(issueKey) {
  let allWorklogs = [];
  let startAt = 0;
  const maxResults = 1000; // Maximum per request
  let total = 0;
  let hasMore = true;
  
  while (hasMore) {
    const queryParams = new URLSearchParams({
      startAt: startAt.toString(),
      maxResults: maxResults.toString()
    });
    
    const response = await jiraRequestWithRetry(`/rest/api/3/issue/${issueKey}/worklog?${queryParams.toString()}`);
    
    const worklogsInThisPage = response.worklogs || [];
    allWorklogs = allWorklogs.concat(worklogsInThisPage);
    
    // Update pagination info
    total = response.total || 0;
    startAt += worklogsInThisPage.length;
    hasMore = worklogsInThisPage.length === maxResults && startAt < total;
    
    // Debug log for issues with many worklogs
    if (total > 1000) {
      console.log(`     📊 ${issueKey}: Fetched ${allWorklogs.length}/${total} worklogs (page ${Math.ceil(startAt/maxResults)})`);
    }
    
    // Safety check to prevent infinite loops
    if (startAt > CONFIG.maxWorklogsPerIssue) {
      console.log(`     ⚠️  ${issueKey}: Stopping at ${allWorklogs.length} worklogs (safety limit: ${CONFIG.maxWorklogsPerIssue})`);
      break;
    }
  }
  
  // Update global stats
  STATS.workLogsFetched += allWorklogs.length;
  
  if (total > 1000) {
    console.log(`     ✅ ${issueKey}: Completed worklog fetch - ${allWorklogs.length} total worklogs`);
  }
  
  return allWorklogs;
}

/**
 * Process work logs in batches (for large groups)
 */
async function processBatchedWorkLogs(issues, accountIds, startDate, endDate, isGroupQuery = false) {
  const allWorkLogs = [];
  const totalIssues = issues.length;
  
  // Determine if we should use batch processing
  const useBatchProcessing = isGroupQuery && CONFIG.enableBatchProcessing && totalIssues > CONFIG.batchSize;
  
  if (useBatchProcessing) {
    console.log(`📦 Using batch processing for ${totalIssues} issues (batch size: ${CONFIG.batchSize})`);
    console.log(`   Estimated time: ${Math.ceil(totalIssues / CONFIG.batchSize) * (CONFIG.batchDelayMs / 1000)} seconds minimum\n`);
    
    // Process in batches
    for (let i = 0; i < totalIssues; i += CONFIG.batchSize) {
      const batchStart = i;
      const batchEnd = Math.min(i + CONFIG.batchSize, totalIssues);
      const batch = issues.slice(batchStart, batchEnd);
      const batchNumber = Math.floor(i / CONFIG.batchSize) + 1;
      const totalBatches = Math.ceil(totalIssues / CONFIG.batchSize);
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (issues ${batchStart + 1}-${batchEnd})...`);
      
      // Process current batch
      const batchWorkLogs = await processSingleBatch(batch, accountIds, startDate, endDate);
      allWorkLogs.push(...batchWorkLogs);
      
      // Progress update
      const processedCount = batchEnd;
      const progressPercent = ((processedCount / totalIssues) * 100).toFixed(1);
      console.log(`   ✅ Batch ${batchNumber} complete. Progress: ${processedCount}/${totalIssues} issues (${progressPercent}%)`);
      
      // Add delay between batches (except for the last batch)
      if (batchEnd < totalIssues) {
        console.log(`   ⏱️  Waiting ${CONFIG.batchDelayMs/1000}s before next batch...`);
        await sleep(CONFIG.batchDelayMs);
      }
      
      console.log(); // Empty line for readability
    }
    
    console.log(`✅ Batch processing complete! Processed ${totalIssues} issues in ${Math.ceil(totalIssues / CONFIG.batchSize)} batches\n`);
  } else {
    // Use regular processing for smaller datasets or non-group queries
    console.log(`📄 Processing ${totalIssues} issues sequentially...\n`);
    const batchWorkLogs = await processSingleBatch(issues, accountIds, startDate, endDate);
    allWorkLogs.push(...batchWorkLogs);
  }
  
  return allWorkLogs;
}

/**
 * Process a single batch of issues
 */
async function processSingleBatch(issues, accountIds, startDate, endDate) {
  const batchWorkLogs = [];
  
  for (const issue of issues) {
    try {
      // Use retry logic for group queries to handle rate limits better
      const worklogs = await getIssueWorkLogsWithRetry(issue.key);
      STATS.workLogsFetched += worklogs.length;
      
      const filteredLogs = filterWorkLogs(worklogs, accountIds, startDate, endDate);
      STATS.workLogsMatched += filteredLogs.length;
      
      if (worklogs.length > 0 && filteredLogs.length === 0) {
        console.log(`   ℹ️  ${issue.key}: Found ${worklogs.length} work logs, but 0 matched filters (author/date)`);
      } else if (filteredLogs.length > 0) {
        console.log(`   ✓ ${issue.key}: ${filteredLogs.length} work logs matched`);
      }
      
      filteredLogs.forEach(log => {
        // Track total time
        STATS.totalTimeSeconds += log.timeSpentSeconds;
        
        batchWorkLogs.push({
          issueKey: issue.key,
          issueType: issue.fields.issuetype.name,
          issueSummary: issue.fields.summary,
          projectKey: issue.fields.project.key,
          author: log.author.displayName,
          authorEmail: log.author.emailAddress || '',
          authorAccountId: log.author.accountId,
          timeSpent: log.timeSpent,
          timeSpentSeconds: log.timeSpentSeconds,
          date: log.started.split('T')[0],
          started: log.started,
          comment: log.comment || ''
        });
      });
      
    } catch (error) {
      console.error(`   ❌ Error processing ${issue.key}: ${error.message}`);
      // Continue with next issue
    }
  }
  
  return batchWorkLogs;
}

/**
 * Filter work logs by date range and authors
 */
function filterWorkLogs(worklogs, accountIds, startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00.000Z');
  const end = new Date(endDate + 'T23:59:59.999Z');
  
  const originalCount = worklogs.length;
  const filtered = worklogs.filter(log => {
    const logDate = new Date(log.started);
    const isInDateRange = logDate >= start && logDate <= end;
    const isAuthorInGroup = accountIds.includes(log.author.accountId);
    
    // Debug logging for filtering issues
    if (!isInDateRange) {
      const logDateStr = logDate.toISOString().split('T')[0];
      // Only log first few date mismatches to avoid spam
      if (Math.random() < 0.1) { // Log ~10% of date mismatches
        console.log(`     ⚠️  Date filter: ${logDateStr} not in range ${startDate} to ${endDate}`);
      }
    }
    
    if (!isAuthorInGroup) {
      // Only log first few author mismatches to avoid spam
      if (Math.random() < 0.1) { // Log ~10% of author mismatches
        console.log(`     ⚠️  Author filter: ${log.author.displayName} (${log.author.accountId}) not in group`);
      }
    }
    
    return isInDateRange && isAuthorInGroup;
  });
  
  // Summary of filtering
  if (originalCount > 0 && filtered.length === 0) {
    console.log(`     📊 Filtering debug: ${originalCount} logs → ${filtered.length} logs`);
    console.log(`     📅 Date range: ${startDate} to ${endDate}`);
    console.log(`     👥 Group size: ${accountIds.length} users`);
    
    // Sample a few logs to see what's being filtered out
    const sampleLogs = worklogs.slice(0, 3);
    sampleLogs.forEach(log => {
      const logDate = new Date(log.started);
      const logDateStr = logDate.toISOString().split('T')[0];
      const isInDateRange = logDate >= start && logDate <= end;
      const isAuthorInGroup = accountIds.includes(log.author.accountId);
      console.log(`     📋 Sample: ${log.author.displayName} on ${logDateStr} - Date OK: ${isInDateRange}, Author OK: ${isAuthorInGroup}`);
    });
  }
  
  return filtered;
}

/**
 * Format work logs into a readable report
 */
function formatWorkLogReport(workLogsData) {
  const report = {
    summary: {
      totalWorkLogs: workLogsData.length,
      totalTimeSeconds: 0,
      totalTimeFormatted: '',
      dateRange: {
        start: CONFIG.startDate,
        end: CONFIG.endDate
      },
      uniqueIssues: new Set(),
      uniqueAuthors: new Set()
    },
    workLogs: []
  };
  
  workLogsData.forEach(item => {
    report.summary.totalTimeSeconds += item.timeSpentSeconds;
    report.summary.uniqueIssues.add(item.issueKey);
    report.summary.uniqueAuthors.add(item.authorAccountId);
    
    report.workLogs.push({
      issueKey: item.issueKey,
      issueType: item.issueType,
      issueSummary: item.issueSummary,
      projectKey: item.projectKey,
      author: item.author,
      authorEmail: item.authorEmail,
      timeSpent: item.timeSpent,
      timeSpentSeconds: item.timeSpentSeconds,
      timeSpentHours: (item.timeSpentSeconds / 3600).toFixed(2),
      date: item.date,
      started: item.started,
      comment: item.comment || ''
    });
  });
  
  // Convert total seconds to human-readable format
  const hours = Math.floor(report.summary.totalTimeSeconds / 3600);
  const minutes = Math.floor((report.summary.totalTimeSeconds % 3600) / 60);
  report.summary.totalTimeFormatted = `${hours}h ${minutes}m`;
  report.summary.totalTimeHours = (report.summary.totalTimeSeconds / 3600).toFixed(2);
  report.summary.uniqueIssues = Array.from(report.summary.uniqueIssues);
  report.summary.uniqueAuthors = Array.from(report.summary.uniqueAuthors);
  report.summary.issueCount = report.summary.uniqueIssues.length;
  report.summary.authorCount = report.summary.uniqueAuthors.length;
  
  return report;
}

/**
 * Display report in console
 */
function displayConsoleReport(report) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 JIRA WORK LOG REPORT');
  console.log('='.repeat(80));
  
  console.log('\n📈 SUMMARY:');
  console.log(`   Date Range: ${report.summary.dateRange.start} to ${report.summary.dateRange.end}`);
  console.log(`   Total Work Logs: ${report.summary.totalWorkLogs}`);
  console.log(`   Total Time Logged: ${report.summary.totalTimeFormatted} (${report.summary.totalTimeHours} hours)`);
  console.log(`   Unique Issues: ${report.summary.issueCount}`);
  console.log(`   Team Members: ${report.summary.authorCount}`);
  
  console.log('\n📋 DETAILED WORK LOGS:');
  console.log('-'.repeat(80));
  
  // Group by issue
  const byIssue = {};
  report.workLogs.forEach(log => {
    if (!byIssue[log.issueKey]) {
      byIssue[log.issueKey] = {
        summary: log.issueSummary,
        type: log.issueType,
        project: log.projectKey,
        logs: []
      };
    }
    byIssue[log.issueKey].logs.push(log);
  });
  
  Object.entries(byIssue).forEach(([issueKey, data]) => {
    const totalIssueTime = data.logs.reduce((sum, log) => sum + log.timeSpentSeconds, 0);
    const totalIssueHours = (totalIssueTime / 3600).toFixed(2);
    
    console.log(`\n🎫 ${issueKey} - ${data.summary}`);
    console.log(`   Type: ${data.type} | Project: ${data.project} | Total: ${totalIssueHours}h`);
    
    data.logs.forEach(log => {
      console.log(`   ├─ ${log.author} logged ${log.timeSpent} on ${log.date}`);
      if (log.comment && typeof log.comment === 'string') {
        console.log(`   │  Comment: ${log.comment.substring(0, 80)}${log.comment.length > 80 ? '...' : ''}`);
      } else if (log.comment && typeof log.comment === 'object') {
        // Comment might be a rich text object
        const commentText = JSON.stringify(log.comment).substring(0, 80);
        console.log(`   │  Comment: ${commentText}...`);
      }
    });
  });
  
  console.log('\n' + '='.repeat(80));
}

/**
 * Export report to Excel with two sheets: Report Summary and Work Logs Detail
 */
async function exportToExcel(report, userOrGroupName) {
  console.log('\n📊 Generating Excel report...');
  
  // Create reports folder if it doesn't exist
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    await fs.access(CONFIG.reportsFolder);
  } catch {
    await fs.mkdir(CONFIG.reportsFolder, { recursive: true });
  }
  
  // Generate dynamic filename
  const fileName = generateExcelFileName(userOrGroupName);
  const filePath = path.join(CONFIG.reportsFolder, fileName);
  
  // Create a new workbook
  const workbook = XLSX.utils.book_new();
  
  // ============================================
  // SHEET 1: REPORT SUMMARY (by Issue)
  // ============================================
  
  // Group work logs by issue and calculate totals
  const issuesSummary = {};
  report.workLogs.forEach(log => {
    if (!issuesSummary[log.issueKey]) {
      issuesSummary[log.issueKey] = {
        issue: log.issueKey,
        totalHours: 0
      };
    }
    issuesSummary[log.issueKey].totalHours += log.timeSpentSeconds / 3600;
  });
  
  // Convert to array and sort by total hours (descending)
  const summaryData = Object.values(issuesSummary)
    .map(item => ({
      'Issue': item.issue,
      'Total Issue': parseFloat(item.totalHours.toFixed(2))
    }))
    .sort((a, b) => b['Total Issue'] - a['Total Issue']);
  
  // Add metadata header rows
  const summarySheet = [
    ['From', CONFIG.startDate, '', 'To'],
    ['Users & Groups', CONFIG.groupName || 'Current User'],
    ['Time Zone', CONFIG.timezone],
    ['Generated on', new Date().toISOString()],
    ['Report Time Format', 'Hours'],
    ['Work logs Time Format', 'Hours'],
    [], // Empty row
    ['Issue', 'Total Issue'] // Header row
  ];
  
  // Add data rows
  summaryData.forEach(row => {
    summarySheet.push([row.Issue, row['Total Issue']]);
  });
  
  // Create worksheet from array of arrays
  const ws1 = XLSX.utils.aoa_to_sheet(summarySheet);
  
  // Set column widths
  ws1['!cols'] = [
    { wch: 15 }, // Issue column
    { wch: 12 }  // Total Issue column
  ];
  
  // Add the worksheet to the workbook
  XLSX.utils.book_append_sheet(workbook, ws1, 'Report');
  
  // ============================================
  // SHEET 2: WORK LOGS DETAIL
  // ============================================
  
  // Prepare detailed work logs data
  const workLogsData = report.workLogs.map(log => ({
    'Author': log.author,
    'Issue': log.issueKey,
    'Issue Summary': log.issueSummary,
    'Work log added': log.started,
    'Work log created': log.started, // Jira doesn't separate these in API
    'Work log Time zone': CONFIG.timezone,
    'Time spent': parseFloat(log.timeSpentHours),
    'Work log comment': log.comment || ''
  }));
  
  // Sort by author, then by date
  workLogsData.sort((a, b) => {
    if (a.Author !== b.Author) return a.Author.localeCompare(b.Author);
    return new Date(a['Work log added']) - new Date(b['Work log added']);
  });
  
  // Create worksheet from JSON
  const ws2 = XLSX.utils.json_to_sheet(workLogsData);
  
  // Set column widths
  ws2['!cols'] = [
    { wch: 20 }, // Author
    { wch: 15 }, // Issue
    { wch: 50 }, // Issue Summary
    { wch: 20 }, // Work log added
    { wch: 20 }, // Work log created
    { wch: 20 }, // Work log Time zone
    { wch: 12 }, // Time spent
    { wch: 60 }  // Work log comment
  ];
  
  // Add the worksheet to the workbook
  XLSX.utils.book_append_sheet(workbook, ws2, 'Work logs');
  
  // ============================================
  // WRITE FILE
  // ============================================
  
  XLSX.writeFile(workbook, filePath);
  
  console.log(`✅ Excel report saved to: ${filePath}`);
  console.log(`   - Sheet 1: "Report" - ${summaryData.length} issues`);
  console.log(`   - Sheet 2: "Work logs" - ${workLogsData.length} entries`);
}

/**
 * Display execution summary
 */
function displayExecutionSummary(allWorkLogs = [], groupMembers = []) {
  const executionTime = ((STATS.endTime - STATS.startTime) / 1000).toFixed(2);
  const totalHours = (STATS.totalTimeSeconds / 3600).toFixed(2);
  const avgTimePerIssue = STATS.issuesFetched > 0 
    ? (STATS.totalTimeSeconds / STATS.issuesFetched / 3600).toFixed(2) 
    : 0;
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 EXECUTION SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n⏱️  Performance:`);
  console.log(`   Execution time: ${executionTime} seconds`);
  console.log(`   Total API calls: ${STATS.apiCalls}`);
  console.log(`   Average time per API call: ${(executionTime / STATS.apiCalls).toFixed(2)}s`);
  
  console.log(`\n📋 Data Fetched:`);
  console.log(`   Issues fetched: ${STATS.issuesFetched}`);
  console.log(`   Work logs fetched: ${STATS.workLogsFetched}`);
  console.log(`   Work logs matched filters: ${STATS.workLogsMatched}`);
  console.log(`   Match rate: ${((STATS.workLogsMatched / STATS.workLogsFetched) * 100).toFixed(1)}%`);
  
  console.log(`\n⏰ Time Logged:`);
  console.log(`   Total hours: ${totalHours}h`);
  console.log(`   Average per issue: ${avgTimePerIssue}h`);
  console.log(`   Average per work log: ${(STATS.totalTimeSeconds / STATS.workLogsMatched / 3600).toFixed(2)}h`);
  
  // Additional analysis for missing tickets
  if (allWorkLogs.length > 0) {
    const uniqueAuthors = [...new Set(allWorkLogs.map(log => log.author))];
    const uniqueProjects = [...new Set(allWorkLogs.map(log => log.projectKey))];
    const dateRange = allWorkLogs.map(log => log.date).sort();
    
    console.log(`\n🔍 Analysis for Missing Tickets:`);
    console.log(`   Authors in final report: ${uniqueAuthors.length} (expected: ${groupMembers.length})`);
    console.log(`   Projects in report: ${uniqueProjects.join(', ')}`);
    if (dateRange.length > 0) {
      console.log(`   Actual date range: ${dateRange[0]} to ${dateRange[dateRange.length - 1]}`);
    }
    console.log(`   Expected date range: ${CONFIG.startDate} to ${CONFIG.endDate}`);
    
    if (STATS.workLogsFetched > STATS.workLogsMatched) {
      const filteredOutCount = STATS.workLogsFetched - STATS.workLogsMatched;
      const filteredOutPercentage = ((filteredOutCount / STATS.workLogsFetched) * 100).toFixed(1);
      console.log(`\n⚠️  ${filteredOutCount} work logs (${filteredOutPercentage}%) were filtered out:`);
      console.log(`   - Check date range: Some logs might be outside ${CONFIG.startDate} to ${CONFIG.endDate}`);
      console.log(`   - Check group membership: Some logs might be from users not in the group`);
      console.log(`   - Check timezone issues: Logs might be in different timezone`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  try {
    // Start timer
    STATS.startTime = Date.now();
    
    console.log('🚀 Starting Jira Work Log Fetcher...\n');
    
    // Validate configuration
    if (CONFIG.apiToken === 'YOUR_JIRA_API_TOKEN') {
      throw new Error('Please update CONFIG.apiToken with your actual Jira API token');
    }
    
    // Step 0: Prompt for date range
    const dateRange = await promptForDateRange();
    const startDate = dateRange.startDate;
    const endDate = dateRange.endDate;
    
    console.log(`\n✅ Using date range: ${startDate} to ${endDate}\n`);
    
    // Step 1: Get user(s)
    let accountIds = [];
    let reportName = '';
    
    // Priority: specificUserEmail > useCurrentUser > groupName
    if (CONFIG.specificUserEmail) {
      const specificUser = await getUserByEmail(CONFIG.specificUserEmail);
      accountIds = [specificUser.accountId];
      reportName = specificUser.displayName || specificUser.emailAddress;
      console.log(`📋 Fetching worklogs for specific user: ${reportName}\n`);
    } else if (CONFIG.useCurrentUser) {
      const currentUser = await getCurrentUser();
      accountIds = [currentUser.accountId];
      reportName = currentUser.displayName || currentUser.emailAddress || 'CurrentUser';
      console.log(`📋 Fetching worklogs for current user: ${reportName}\n`);
    } else if (CONFIG.groupName) {
      const members = await getGroupMembers(CONFIG.groupName);
      accountIds = members.map(m => m.accountId);
      reportName = CONFIG.groupName;
      console.log(`📋 Fetching worklogs for group: ${reportName}\n`);
    } else {
      throw new Error('Please configure one of: specificUserEmail, useCurrentUser=true, or groupName');
    }
    
    // Step 2: Search issues with work logs
    const issues = await searchIssuesWithWorkLogs(accountIds, startDate, endDate);
    STATS.issuesFetched = issues.length;
    
    if (issues.length === 0) {
      console.log('⚠️  No issues found with work logs for the specified criteria');
      STATS.endTime = Date.now();
      displayExecutionSummary([], groupMembers);
      return;
    }
    
    // Step 3: Fetch and filter work logs for each issue
    console.log('📥 Fetching detailed work logs for each issue...');
    
    // Determine if this is a group query (for batch processing decision)
    const isGroupQuery = !!CONFIG.groupName;
    
    // Use batch processing for groups, regular processing for individuals
    const allWorkLogs = await processBatchedWorkLogs(issues, accountIds, startDate, endDate, isGroupQuery);
    
    console.log(`\n📊 Work Log Summary:`);
    console.log(`   Total work logs found: ${STATS.workLogsFetched}`);
    console.log(`   Work logs matching filters: ${STATS.workLogsMatched}`);
    console.log(`✅ Processed ${allWorkLogs.length} work log entries\n`);
    
    // Step 4: Format report
    const report = formatWorkLogReport(allWorkLogs);
    
    // Step 5: Display results
    if (CONFIG.outputFormat === 'console') {
      displayConsoleReport(report);
    }
    
    // Step 6: Export to Excel if requested
    if (CONFIG.exportToExcel) {
      await exportToExcel(report, reportName);
    }
    
    // End timer and display summary
    STATS.endTime = Date.now();
    displayExecutionSummary(allWorkLogs, specificUserEmail ? [{ displayName: specificUserEmail }] : []);
    
    console.log('\n✨ Done!\n');
    
  } catch (error) {
    STATS.endTime = Date.now();
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    
    // Display partial summary if available
    if (STATS.startTime) {
      console.log('\n⚠️  Partial execution summary:');
      displayExecutionSummary([], []);
    }
    
    process.exit(1);
  }
}

// Run the script
main();
