/**
 * Jira JQL Work Log Fetcher
 * Standalone script to fetch work logs for issues matching a specific JQL query
 * 
 * Prerequisites:
 * - Node.js installed
 * - Run: npm install node-fetch xlsx readline
 * 
 * Usage:
 * - Update the configuration section below with your JQL query
 * - Run: node jira-jql-worklog-fetcher.js
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

  // JQL Query - This is what you'll customize
  jqlQuery: 'project = "LOS " AND issuetype in (Bug) AND assignee is EMPTY',
  
  // Optional filters (leave null to get all worklogs from matched issues)
  dateFilter: {
    enabled: false,  // Set to true to filter worklogs by date
    startDate: '2025-09-01',  // YYYY-MM-DD format
    endDate: '2025-10-16'     // YYYY-MM-DD format
  },
  
  authorFilter: {
    enabled: false,  // Set to true to filter worklogs by specific authors
    authorEmails: []  // Array of author emails, e.g., ['user1@company.com', 'user2@company.com']
  },
  
  // Pagination and limits
  maxResultsPerPage: 500,
  maxIssuesToProcess: 5000,  // Safety limit for large JQL results
  maxWorklogsPerIssue: 10000, // Safety limit for issues with excessive worklogs
  
  // Retry configuration
  maxRetries: 3,
  retryDelayMs: 2000,
  
  // Output options
  outputFormat: 'console',  // 'console' or 'json'
  exportToExcel: true,
  reportsFolder: './generated-reports'
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate dynamic filename for Excel report
 * Format: JQL_{YYYY-MM-DD}_{HH-MM-SS}.xlsx
 */
function generateExcelFileName(jqlQuery) {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  
  // Create a readable name from JQL (first project or key words)
  let baseName = 'JQL_Query';
  const projectMatch = jqlQuery.match(/project\s*[=~]\s*["']?([A-Z][A-Z0-9_-]*)/i);
  if (projectMatch) {
    baseName = `Project_${projectMatch[1]}`;
  } else if (jqlQuery.toLowerCase().includes('order by')) {
    baseName = 'Custom_JQL';
  }
  
  return `${baseName}_${date}_${time}.xlsx`;
}

/**
 * Prompt user for JQL query
 */
async function promptForJQL() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  console.log('\n🔍 JQL Query Options:');
  console.log('   1. Use configured JQL from script');
  console.log('   2. Enter custom JQL query');
  
  const choice = await question('\nSelect option (1 or 2, press Enter for option 1): ');
  
  if (choice.trim() === '2') {
    console.log('\n📝 Enter your JQL query:');
    console.log('   Examples:');
    console.log('   - project = "MY_PROJECT" AND status = "Done"');
    console.log('   - assignee = currentUser() AND updated >= -30d');
    console.log('   - key in (PROJ-123, PROJ-456, PROJ-789)');
    console.log('   - "Epic Link" = PROJ-100');
    
    const customJQL = await question('\nJQL: ');
    
    rl.close();
    return customJQL.trim();
  } else {
    rl.close();
    return CONFIG.jqlQuery;
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
 * Make authenticated request to Jira API with retry logic
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

/**
 * Parse Jira worklog comment (handles both plain text and ADF format)
 */
function parseWorklogComment(comment) {
  if (!comment) return '';
  
  // If it's already a string, return as-is
  if (typeof comment === 'string') {
    return comment;
  }
  
  // If it's an ADF (Atlassian Document Format) object
  if (typeof comment === 'object' && comment.type === 'doc') {
    return extractTextFromADF(comment);
  }
  
  // Fallback: stringify the object
  return JSON.stringify(comment);
}

/**
 * Extract plain text from Atlassian Document Format (ADF)
 */
function extractTextFromADF(adfNode) {
  if (!adfNode || !adfNode.content) return '';
  
  let text = '';
  
  for (const contentItem of adfNode.content) {
    if (contentItem.type === 'paragraph' && contentItem.content) {
      // Extract text from paragraph
      for (const textItem of contentItem.content) {
        if (textItem.type === 'text' && textItem.text) {
          text += textItem.text;
        } else if (textItem.type === 'hardBreak') {
          text += '\n';
        }
      }
      text += '\n'; // Add line break after paragraph
    } else if (contentItem.type === 'bulletList' && contentItem.content) {
      // Handle bullet lists
      for (const listItem of contentItem.content) {
        if (listItem.type === 'listItem' && listItem.content) {
          text += '• ';
          text += extractTextFromADF({ content: listItem.content });
        }
      }
    } else if (contentItem.type === 'orderedList' && contentItem.content) {
      // Handle numbered lists
      contentItem.content.forEach((listItem, index) => {
        if (listItem.type === 'listItem' && listItem.content) {
          text += `${index + 1}. `;
          text += extractTextFromADF({ content: listItem.content });
        }
      });
    } else if (contentItem.type === 'codeBlock' && contentItem.content) {
      // Handle code blocks
      text += '```\n';
      text += extractTextFromADF({ content: contentItem.content });
      text += '```\n';
    }
  }
  
  return text.trim();
}

// ============================================
// MAIN FUNCTIONS
// ============================================

/**
 * Execute JQL search with pagination
 */
async function executeJQLSearch(jql) {
  console.log(`\n🔍 Executing JQL query:`);
  console.log(`   JQL: ${jql}`);
  
  let allIssues = [];
  let nextPageToken = null;
  let pageCount = 0;
  let isLast = false;
  
  do {
    pageCount++;
    
    // Build query parameters for the JQL search API (cursor-based pagination)
    const fields = ['summary', 'issuetype', 'status', 'project', 'assignee', 'created', 'updated'];
    const queryParams = new URLSearchParams({
      jql: jql,
      fields: fields.join(','),
      maxResults: CONFIG.maxResultsPerPage
    });
    
    // Add pagination token if we have one
    if (nextPageToken) {
      queryParams.set('nextPageToken', nextPageToken);
    }
    
    const response = await jiraRequestWithRetry(`/rest/api/3/search/jql?${queryParams.toString()}`);
    
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
    
    console.log(`   Page ${pageCount}: Fetched ${issuesInThisPage.length} issues (total so far: ${allIssues.length})`);
    
    // Break if no more issues to fetch
    if (issuesInThisPage.length === 0 || isLast) {
      console.log(`   ✅ Reached end of results (isLast: ${isLast})`);
      break;
    }
    
    // Safety limit
    if (allIssues.length >= CONFIG.maxIssuesToProcess) {
      console.log(`   ⚠️  Limiting to first ${CONFIG.maxIssuesToProcess} issues to avoid excessive API calls`);
      break;
    }
    
  } while (nextPageToken && !isLast);
  
  console.log(`   ✅ JQL search complete. Found ${allIssues.length} issues across ${pageCount} pages\n`);
  STATS.issuesFetched = allIssues.length;
  
  return allIssues;
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
    
    // Safety check
    if (startAt > CONFIG.maxWorklogsPerIssue) {
      console.log(`     ⚠️  ${issueKey}: Stopping at ${allWorklogs.length} worklogs (safety limit: ${CONFIG.maxWorklogsPerIssue})`);
      break;
    }
  }
  
  // Update global stats
  STATS.workLogsFetched += allWorklogs.length;
  
  return allWorklogs;
}

/**
 * Get user account ID by email (for author filtering)
 */
async function getAccountIdByEmail(email) {
  try {
    const response = await jiraRequestWithRetry(
      `/rest/api/3/user/search?query=${encodeURIComponent(email)}`
    );
    
    if (!response || response.length === 0) {
      console.log(`   ⚠️  User not found: ${email}`);
      return null;
    }
    
    const user = response.find(u => 
      u.emailAddress && u.emailAddress.toLowerCase() === email.toLowerCase()
    );
    
    return user ? user.accountId : null;
  } catch (error) {
    console.log(`   ❌ Error finding user ${email}: ${error.message}`);
    return null;
  }
}

/**
 * Filter work logs based on configured filters
 */
function filterWorkLogs(worklogs, authorAccountIds = null) {
  let filtered = [...worklogs];
  
  // Date filter
  if (CONFIG.dateFilter.enabled) {
    const start = new Date(CONFIG.dateFilter.startDate + 'T00:00:00.000Z');
    const end = new Date(CONFIG.dateFilter.endDate + 'T23:59:59.999Z');
    
    const beforeDateFilter = filtered.length;
    filtered = filtered.filter(log => {
      const logDate = new Date(log.started);
      return logDate >= start && logDate <= end;
    });
    
    console.log(`     📅 Date filter: ${beforeDateFilter} → ${filtered.length} worklogs`);
  }
  
  // Author filter
  if (CONFIG.authorFilter.enabled && authorAccountIds && authorAccountIds.length > 0) {
    const beforeAuthorFilter = filtered.length;
    filtered = filtered.filter(log => authorAccountIds.includes(log.author.accountId));
    
    console.log(`     👤 Author filter: ${beforeAuthorFilter} → ${filtered.length} worklogs`);
  }
  
  return filtered;
}

/**
 * Process all issues and fetch their worklogs
 */
async function processIssuesWorkLogs(issues) {
  console.log(`📥 Fetching worklogs for ${issues.length} issues...`);
  
  // Get author account IDs if author filter is enabled
  let authorAccountIds = null;
  if (CONFIG.authorFilter.enabled && CONFIG.authorFilter.authorEmails.length > 0) {
    console.log(`👤 Resolving author account IDs...`);
    authorAccountIds = [];
    
    for (const email of CONFIG.authorFilter.authorEmails) {
      const accountId = await getAccountIdByEmail(email);
      if (accountId) {
        authorAccountIds.push(accountId);
        console.log(`   ✓ ${email} → ${accountId}`);
      }
    }
    
    console.log(`   Found ${authorAccountIds.length}/${CONFIG.authorFilter.authorEmails.length} authors\n`);
  }
  
  const allWorkLogs = [];
  const allIssuesData = []; // Store all issues for Excel export
  let processedCount = 0;
  
  for (const issue of issues) {
    try {
      processedCount++;
      const progress = ((processedCount / issues.length) * 100).toFixed(1);
      console.log(`   Processing ${issue.key} (${processedCount}/${issues.length} - ${progress}%)...`);
      
      // Store issue data for Excel export (even if no worklogs)
      allIssuesData.push({
        key: issue.key,
        summary: issue.fields.summary,
        type: issue.fields.issuetype.name,
        project: issue.fields.project.key,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
        created: issue.fields.created,
        updated: issue.fields.updated
      });
      
      // Fetch all worklogs for this issue
      const worklogs = await getIssueWorkLogsWithRetry(issue.key);
      
      if (worklogs.length === 0) {
        console.log(`     ℹ️  No worklogs found`);
        continue;
      }
      
      // Apply filters
      const filteredLogs = filterWorkLogs(worklogs, authorAccountIds);
      
      if (filteredLogs.length === 0) {
        console.log(`     ℹ️  ${worklogs.length} worklogs found, but 0 matched filters`);
        continue;
      }
      
      console.log(`     ✓ ${filteredLogs.length}/${worklogs.length} worklogs matched filters`);
      
      // Convert to our format
      filteredLogs.forEach(log => {
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
          comment: parseWorklogComment(log.comment)
        });
      });
      
    } catch (error) {
      console.error(`     ❌ Error processing ${issue.key}: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Processed ${issues.length} issues, found ${allWorkLogs.length} matching worklogs\n`);
  return { workLogs: allWorkLogs, allIssues: allIssuesData };
}

/**
 * Format work logs into a readable report
 */
function formatWorkLogReport(workLogsData, allIssuesData, jqlQuery) {
  const report = {
    summary: {
      jqlQuery: jqlQuery,
      totalWorkLogs: workLogsData.length,
      totalTimeSeconds: STATS.totalTimeSeconds,
      totalTimeFormatted: '',
      totalTimeHours: (STATS.totalTimeSeconds / 3600).toFixed(2),
      uniqueIssues: [...new Set(workLogsData.map(item => item.issueKey))],
      uniqueAuthors: [...new Set(workLogsData.map(item => item.author))],
      uniqueProjects: [...new Set(workLogsData.map(item => item.projectKey))],
      dateRange: {
        earliest: null,
        latest: null
      },
      totalIssuesFound: allIssuesData.length,
      issuesWithWorklogs: [...new Set(workLogsData.map(item => item.issueKey))].length,
      issuesWithoutWorklogs: allIssuesData.length - [...new Set(workLogsData.map(item => item.issueKey))].length
    },
    workLogs: workLogsData.map(item => ({
      ...item,
      timeSpentHours: (item.timeSpentSeconds / 3600).toFixed(2)
    })),
    allIssues: allIssuesData
  };
  
  // Calculate date range
  if (workLogsData.length > 0) {
    const dates = workLogsData.map(item => item.date).sort();
    report.summary.dateRange.earliest = dates[0];
    report.summary.dateRange.latest = dates[dates.length - 1];
  }
  
  // Convert total seconds to human-readable format
  const hours = Math.floor(STATS.totalTimeSeconds / 3600);
  const minutes = Math.floor((STATS.totalTimeSeconds % 3600) / 60);
  report.summary.totalTimeFormatted = `${hours}h ${minutes}m`;
  
  // Update summary counts
  report.summary.issueCount = report.summary.uniqueIssues.length;
  report.summary.authorCount = report.summary.uniqueAuthors.length;
  report.summary.projectCount = report.summary.uniqueProjects.length;
  
  return report;
}

/**
 * Display report in console
 */
function displayConsoleReport(report) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 JIRA JQL WORKLOG REPORT');
  console.log('='.repeat(80));
  
  console.log('\n🔍 JQL QUERY:');
  console.log(`   ${report.summary.jqlQuery}`);
  
  console.log('\n📈 SUMMARY:');
  console.log(`   Total Issues Found: ${report.summary.totalIssuesFound}`);
  console.log(`   Issues with Worklogs: ${report.summary.issuesWithWorklogs}`);
  console.log(`   Issues without Worklogs: ${report.summary.issuesWithoutWorklogs}`);
  console.log(`   Total Work Logs: ${report.summary.totalWorkLogs}`);
  console.log(`   Total Time Logged: ${report.summary.totalTimeFormatted} (${report.summary.totalTimeHours} hours)`);
  console.log(`   Unique Authors: ${report.summary.authorCount}`);
  console.log(`   Projects: ${report.summary.uniqueProjects.join(', ')}`);
  
  if (report.summary.dateRange.earliest) {
    console.log(`   Date Range: ${report.summary.dateRange.earliest} to ${report.summary.dateRange.latest}`);
  }
  
  console.log('\n📋 WORKLOG BREAKDOWN BY ISSUE:');
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
      if (log.comment) {
        // Clean up comment for display (remove extra newlines)
        const cleanComment = log.comment.replace(/\n+/g, ' ').trim();
        const commentPreview = cleanComment.substring(0, 80);
        console.log(`   │  Work Description: ${commentPreview}${cleanComment.length > 80 ? '...' : ''}`);
      }
    });
  });
  
  console.log('\n' + '='.repeat(80));
}

/**
 * Export report to Excel
 */
async function exportToExcel(report, jqlQuery) {
  console.log('\n📊 Generating Excel report...');
  
  // Create reports folder if it doesn't exist
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    await fs.access(CONFIG.reportsFolder);
  } catch {
    await fs.mkdir(CONFIG.reportsFolder, { recursive: true });
  }
  
  // Generate filename
  const fileName = generateExcelFileName(jqlQuery);
  const filePath = path.join(CONFIG.reportsFolder, fileName);
  
  // Create workbook
  const workbook = XLSX.utils.book_new();
  
  // Sheet 1: All Issues Summary (includes issues with 0 worklogs)
  const issuesSummary = {};
  
  // First, add all issues with 0 hours
  report.allIssues.forEach(issue => {
    issuesSummary[issue.key] = {
      issue: issue.key,
      summary: issue.summary,
      type: issue.type,
      project: issue.project,
      status: issue.status,
      assignee: issue.assignee,
      totalHours: 0
    };
  });
  
  // Then, update with actual worklog hours for issues that have them
  report.workLogs.forEach(log => {
    if (issuesSummary[log.issueKey]) {
      issuesSummary[log.issueKey].totalHours += log.timeSpentSeconds / 3600;
    }
  });
  
  const summaryData = Object.values(issuesSummary)
    .map(item => ({
      'Issue': item.issue,
      'Summary': item.summary,
      'Type': item.type,
      'Project': item.project,
      'Status': item.status,
      'Assignee': item.assignee,
      'Total Hours': parseFloat(item.totalHours.toFixed(2))
    }))
    .sort((a, b) => b['Total Hours'] - a['Total Hours']);
  
  // Add metadata
  const summarySheet = [
    ['JQL Query', jqlQuery],
    ['Generated on', new Date().toISOString()],
    ['Total Issues Found', report.summary.totalIssuesFound],
    ['Issues with Worklogs', report.summary.issuesWithWorklogs],
    ['Issues without Worklogs', report.summary.issuesWithoutWorklogs],
    ['Total Worklogs', report.summary.totalWorkLogs],
    ['Total Hours', report.summary.totalTimeHours],
    [], // Empty row
    ['Issue', 'Summary', 'Type', 'Project', 'Status', 'Assignee', 'Total Hours']
  ];
  
  summaryData.forEach(row => {
    summarySheet.push([row.Issue, row.Summary, row.Type, row.Project, row.Status, row.Assignee, row['Total Hours']]);
  });
  
  const ws1 = XLSX.utils.aoa_to_sheet(summarySheet);
  ws1['!cols'] = [
    { wch: 15 }, // Issue
    { wch: 50 }, // Summary
    { wch: 15 }, // Type
    { wch: 15 }, // Project
    { wch: 15 }, // Status
    { wch: 20 }, // Assignee
    { wch: 12 }  // Total Hours
  ];
  
  XLSX.utils.book_append_sheet(workbook, ws1, 'All Issues');
  
  // Sheet 2: Work Logs Detail (only issues with worklogs)
  const workLogsData = report.workLogs.map(log => ({
    'Work Logged By': log.author,
    'User Email': log.authorEmail,
    'Issue Key': log.issueKey,
    'Issue Summary': log.issueSummary,
    'Project': log.projectKey,
    'Issue Type': log.issueType,
    'Date Logged': log.date,
    'Time Spent (Hours)': parseFloat(log.timeSpentHours),
    'Work Description': log.comment || ''
  }));
  
  const ws2 = XLSX.utils.json_to_sheet(workLogsData);
  ws2['!cols'] = [
    { wch: 25 }, // Work Logged By
    { wch: 30 }, // User Email
    { wch: 15 }, // Issue Key
    { wch: 50 }, // Issue Summary
    { wch: 15 }, // Project
    { wch: 15 }, // Issue Type
    { wch: 15 }, // Date Logged
    { wch: 15 }, // Time Spent (Hours)
    { wch: 60 }  // Work Description
  ];
  
  XLSX.utils.book_append_sheet(workbook, ws2, 'Work logs');
  
  // Write file
  XLSX.writeFile(workbook, filePath);
  
  console.log(`✅ Excel report saved to: ${filePath}`);
  console.log(`   - Sheet 1: "All Issues" - ${summaryData.length} issues (including ${report.summary.issuesWithoutWorklogs} with 0 hours)`);
  console.log(`   - Sheet 2: "Work logs" - ${workLogsData.length} entries`);
}

/**
 * Display execution summary
 */
function displayExecutionSummary() {
  const executionTime = ((STATS.endTime - STATS.startTime) / 1000).toFixed(2);
  const totalHours = (STATS.totalTimeSeconds / 3600).toFixed(2);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 EXECUTION SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n⏱️  Performance:`);
  console.log(`   Execution time: ${executionTime} seconds`);
  console.log(`   Total API calls: ${STATS.apiCalls}`);
  console.log(`   Issues processed: ${STATS.issuesFetched}`);
  console.log(`   Worklogs fetched: ${STATS.workLogsFetched}`);
  
  console.log(`\n⏰ Results:`);
  console.log(`   Total time logged: ${totalHours} hours`);
  console.log(`   Average per issue: ${STATS.issuesFetched > 0 ? (STATS.totalTimeSeconds / STATS.issuesFetched / 3600).toFixed(2) : 0}h`);
  console.log(`   Average per worklog: ${STATS.workLogsFetched > 0 ? (STATS.totalTimeSeconds / STATS.workLogsFetched / 3600).toFixed(2) : 0}h`);
  
  console.log('\n' + '='.repeat(80));
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  try {
    // Start timer
    STATS.startTime = Date.now();
    
    console.log('🚀 Starting Jira JQL Work Log Fetcher...\n');
    
    // Validate configuration
    if (CONFIG.apiToken === '<apiToken>') {
      throw new Error('Please update CONFIG.apiToken with your actual Jira API token');
    }
    if (CONFIG.email === '<email>') {
      throw new Error('Please update CONFIG.email with your actual email address');
    }
    
    // Step 1: Get JQL query (either from config or user input)
    const jqlQuery = await promptForJQL();
    
    console.log(`\n✅ Using JQL query: ${jqlQuery}\n`);
    
    // Step 2: Execute JQL search to get issues
    const issues = await executeJQLSearch(jqlQuery);
    
    if (issues.length === 0) {
      console.log('⚠️  No issues found matching the JQL query');
      STATS.endTime = Date.now();
      displayExecutionSummary();
      return;
    }
    
    // Step 3: Process all issues and fetch their worklogs
    const processResult = await processIssuesWorkLogs(issues);
    const allWorkLogs = processResult.workLogs;
    const allIssuesData = processResult.allIssues;
    
    if (allWorkLogs.length === 0) {
      console.log('⚠️  No worklogs found for the matched issues (or all filtered out)');
      STATS.endTime = Date.now();
      displayExecutionSummary();
      return;
    }
    
    // Step 4: Format report
    const report = formatWorkLogReport(allWorkLogs, allIssuesData, jqlQuery);
    
    // Step 5: Display results
    if (CONFIG.outputFormat === 'console') {
      displayConsoleReport(report);
    }
    
    // Step 6: Export to Excel if requested
    if (CONFIG.exportToExcel) {
      await exportToExcel(report, jqlQuery);
    }
    
    // End timer and display summary
    STATS.endTime = Date.now();
    displayExecutionSummary();
    
    console.log('\n✨ Done!\n');
    
  } catch (error) {
    STATS.endTime = Date.now();
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    
    if (STATS.startTime) {
      console.log('\n⚠️  Partial execution summary:');
      displayExecutionSummary();
    }
    
    process.exit(1);
  }
}

// Run the script
main();