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
  specificUserEmail: "<email>",  // e.g., 'john.doe@idexcel.com' or null
  
  // Option 2: Team/Group
  groupName: null,  // e.g., 'AWS Team' or null
  
  // Option 3: Current authenticated user
  useCurrentUser: false,  // Set to true to fetch only your own worklogs
  
  // Date range (ISO format YYYY-MM-DD or Date objects)
  // Default: Last 30 days
  startDate: getDateDaysAgo(30),  // 30 days ago
  endDate: getDateDaysAgo(0),     // Today
  
  // Timezone for date conversion
  timezone: 'Asia/Kolkata',  // IST timezone
  
  // Pagination
  maxResultsPerPage: 100,
  
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
  
  // Strategy 1: Try with worklogDate (may not work in all instances)
  try {
    jql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor in (${accountIdsJql}) ORDER BY updated DESC`;
    console.log(`   Trying JQL Strategy 1 (with worklogDate): ${jql}\n`);
    allIssues = await executeJQLSearch(jql);
  } catch (error) {
    console.log(`   ⚠️  Strategy 1 failed, trying alternative...`);
  }
  
  // Strategy 2: Broader search - just worklogAuthor, filter by date later
  if (allIssues.length === 0) {
    jql = `worklogAuthor in (${accountIdsJql}) ORDER BY updated DESC`;
    console.log(`   Trying JQL Strategy 2 (broader search): ${jql}\n`);
    allIssues = await executeJQLSearch(jql);
  }
  
  // Strategy 3: Even broader - issues updated in the date range where user might have logged work
  if (allIssues.length === 0) {
    jql = `updated >= "${startDate}" AND updated <= "${endDate}" ORDER BY updated DESC`;
    console.log(`   Trying JQL Strategy 3 (updated date range): ${jql}\n`);
    allIssues = await executeJQLSearch(jql);
    console.log(`   ℹ️  Note: Will filter work logs by author later\n`);
  }
  
  console.log(`✅ Found ${allIssues.length} issues to check for work logs\n`);
  return allIssues;
}

/**
 * Execute JQL search with pagination
 */
async function executeJQLSearch(jql) {
  let allIssues = [];
  let startAt = 0;
  let total = 0;
  
  do {
    // Build query parameters for the new API
    const fields = ['summary', 'issuetype', 'status', 'project', 'assignee', 'created'];
    const queryParams = new URLSearchParams({
      jql: jql,
      fields: fields.join(','),
      maxResults: CONFIG.maxResultsPerPage,
      startAt: startAt
    });
    
    const response = await jiraRequest(`/rest/api/3/search/jql?${queryParams.toString()}`);
    
    total = response.total;
    allIssues = allIssues.concat(response.issues);
    startAt += CONFIG.maxResultsPerPage;
    
    console.log(`   Fetched ${allIssues.length} of ${total} issues...`);
    
    // Limit to reasonable number to avoid too many API calls
    if (allIssues.length >= 500) {
      console.log(`   ⚠️  Limiting to first 500 issues to avoid excessive API calls`);
      break;
    }
    
  } while (allIssues.length < total);
  
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
 * Filter work logs by date range and authors
 */
function filterWorkLogs(worklogs, accountIds, startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00.000Z');
  const end = new Date(endDate + 'T23:59:59.999Z');
  
  return worklogs.filter(log => {
    const logDate = new Date(log.started);
    const isInDateRange = logDate >= start && logDate <= end;
    const isAuthorInGroup = accountIds.includes(log.author.accountId);
    return isInDateRange && isAuthorInGroup;
  });
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
function displayExecutionSummary() {
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
      displayExecutionSummary();
      return;
    }
    
    // Step 3: Fetch and filter work logs for each issue
    console.log('📥 Fetching detailed work logs for each issue...');
    const allWorkLogs = [];
    
    for (const issue of issues) {
      const worklogs = await getIssueWorkLogs(issue.key);
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
        
        allWorkLogs.push({
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
    }
    
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
    displayExecutionSummary();
    
    console.log('\n✨ Done!\n');
    
  } catch (error) {
    STATS.endTime = Date.now();
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    
    // Display partial summary if available
    if (STATS.startTime) {
      console.log('\n⚠️  Partial execution summary:');
      displayExecutionSummary();
    }
    
    process.exit(1);
  }
}

// Run the script
main();
