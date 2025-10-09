# 📊 Jira Work Log Report Generator

A simple tool to download work log reports from Jira into Excel format.

---

## ✅ What You Need Before Starting

1. **Node.js installed** on your computer
   - Check if installed: Open PowerShell and type `node --version`
   - If not installed: Download from [nodejs.org](https://nodejs.org/)

2. **Jira API Token**
   - Go to: https://id.atlassian.com/manage-profile/security/api-tokens
   - Click **"Create API token"**
   - Give it a name (e.g., "Work Log Reporter")
   - **Copy the token** - you'll need it in the next step

---

## � One-Time Setup

### Step 1: Install Required Packages

Open PowerShell in the `jira-worklog-reports` folder and run:

```powershell
npm install
```

### Step 2: Update Your Settings

Open the file **`jira-worklog-fetcher.js`** in any text editor (Notepad works fine).

Find these lines near the top (around line 25-30) and update them:

```javascript
email: 'your-email@idexcel.com',      // ⚠️ Change to your email
apiToken: 'YOUR_JIRA_API_TOKEN',      // ⚠️ Paste your API token here

groupName: 'AWS Team',                 // ⚠️ Change to your team name
useCurrentUser: false,                 // Keep false for team reports
```

**Save the file** after making changes.

---

## ▶️ How to Run

1. Open PowerShell
2. Navigate to the folder:
   ```powershell
   cd "D:\Los repos\cync-los-int-flow-service\jira-worklog-reports"
   ```

3. Run the script:
   ```powershell
   node jira-worklog-fetcher.js
   ```

4. **Choose date range:**
   - Press `1` and Enter for last 30 days (default)
   - Press `2` and Enter to specify custom dates

5. Wait for the script to complete (usually takes 1-2 minutes)

6. Find your Excel report in the **`generated-reports`** folder

---

## 📂 Where to Find Your Report

Your Excel file will be saved in:
```
jira-worklog-reports/generated-reports/
```

File name format: `TeamName_2025-10-09_16-04-16.xlsx`

The Excel file has 2 sheets:
- **Sheet 1 (Report)**: Summary with total hours per ticket
- **Sheet 2 (Work logs)**: Detailed entries with all work log details

---

## 🎯 What Settings You Can Change

Open `jira-worklog-fetcher.js` and look for the `CONFIG` section:

| Setting | What It Does | Example |
|---------|-------------|---------|
| `email` | Your Jira login email | `john.doe@idexcel.com` |
| `apiToken` | Your Jira API token (from Step 2 above) | `ATATT3xFfGF0...` |
| `groupName` | Team name to generate report for | `'AWS Team'` |
| `useCurrentUser` | Set to `true` for your own logs only | `false` |

---

## ❓ Troubleshooting

**Problem:** "Cannot find module 'node-fetch'"
- **Solution:** Run `npm install` in the folder

**Problem:** "Invalid API token"
- **Solution:** Generate a new token from the link in Step 2 above

**Problem:** "No issues found"
- **Solution:** Check that the team name is spelled correctly

**Problem:** Script takes too long
- **Solution:** This is normal for large teams or long date ranges (100+ issues can take 2-3 minutes)

---

## Help

Check the technical documentation in `RATE-LIMITS.md`

---

**Last Updated:** October 9, 2025

## 🎯 Usage Examples

### Example 1: Fetch Current User's Work Logs (Last 30 Days)

**Default configuration** - no changes needed:
```javascript
useCurrentUser: true,
startDate: getDateDaysAgo(30),
endDate: getDateDaysAgo(0)
```

```powershell
node jira-worklog-fetcher.js
```

### Example 2: Fetch Work Logs for a Specific Group

```javascript
useCurrentUser: false,
groupName: 'AWS Team',  // Your group name
startDate: getDateDaysAgo(30),
endDate: getDateDaysAgo(0)
```

### Example 3: Custom Date Range (Specific Dates)

```javascript
startDate: '2025-09-01',  // September 1, 2025
endDate: '2025-09-30',    // September 30, 2025
```

### Example 4: Last Quarter (90 days)

```javascript
startDate: getDateDaysAgo(90),
endDate: getDateDaysAgo(0)
```

## 📊 Output

### Console Output
The script displays:
- Summary statistics (total time, issues, team members)
- Detailed work logs grouped by issue
- Time spent per issue and per person

Example:
```
================================================================================
📊 JIRA WORK LOG REPORT
================================================================================

📈 SUMMARY:
   Date Range: 2025-09-08 to 2025-10-08
   Total Work Logs: 45
   Total Time Logged: 78h 30m (78.50 hours)
   Unique Issues: 12
   Team Members: 5

📋 DETAILED WORK LOGS:
--------------------------------------------------------------------------------

🎫 CA-179 - Implement user authentication
   Type: Story | Project: CA | Total: 8.00h
   ├─ John Doe logged 3h on 2025-10-01
   ├─ Jane Smith logged 5h on 2025-10-02
```

### JSON File Output
The script also saves a detailed JSON report to `jira-worklogs-report.json`:

```json
{
  "summary": {
    "totalWorkLogs": 45,
    "totalTimeSeconds": 282600,
    "totalTimeFormatted": "78h 30m",
    "totalTimeHours": "78.50",
    "dateRange": {
      "start": "2025-09-08",
      "end": "2025-10-08"
    },
    "uniqueIssues": ["CA-179", "CA-205", ...],
    "issueCount": 12,
    "authorCount": 5
  },
  "workLogs": [
    {
      "issueKey": "CA-179",
      "issueType": "Story",
      "issueSummary": "Implement user authentication",
      "projectKey": "CA",
      "author": "John Doe",
      "authorEmail": "john@example.com",
      "timeSpent": "3h",
      "timeSpentSeconds": 10800,
      "timeSpentHours": "3.00",
      "date": "2025-10-01",
      "started": "2025-10-01T10:30:00.000+0530",
      "comment": "Worked on OAuth integration"
    }
  ]
}
```

## 🔧 Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `jiraBaseUrl` | string | Your Jira instance URL | `https://idexcel.atlassian.net` |
| `email` | string | Your Jira account email | ⚠️ **Required** |
| `apiToken` | string | Your Jira API token | ⚠️ **Required** |
| `groupName` | string\|null | Jira group name or null | `null` |
| `useCurrentUser` | boolean | Use current user instead of group | `true` |
| `startDate` | string | Start date (YYYY-MM-DD) | 30 days ago |
| `endDate` | string | End date (YYYY-MM-DD) | Today |
| `maxResultsPerPage` | number | Pagination size | `100` |
| `saveToFile` | boolean | Save JSON report to file | `true` |
| `outputFileName` | string | Output file name | `'jira-worklogs-report.json'` |


## 🐛 Troubleshooting

### Error: "Please update CONFIG.apiToken"
- You need to set your actual Jira API token in the CONFIG section

### Error: "Jira API Error (401)"
- Check your email and API token are correct
- Ensure you have permission to access the Jira instance

### Error: "Jira API Error (404)"
- Verify the group name exists and you have access to it
- Check the Jira base URL is correct

### No work logs found
- Verify the date range contains work logs
- Check that the user/group members have logged work in Jira
- Ensure the group name is spelled correctly

## 📚 API References

- [Jira Cloud REST API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [Get Group Members](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-groups/#api-rest-api-3-group-member-get)
- [Search Issues (JQL)](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-post)
- [Get Issue Work Logs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/)

## 📝 Notes

- The script uses JQL (Jira Query Language) to efficiently search for issues
- Work logs are filtered on both the server side (JQL) and client side (for accuracy)
- Pagination is handled automatically for large result sets
- All times are displayed in both human-readable format (e.g., "3h 30m") and decimal hours

