# JIRA Worklog Reporter 📊

A collection of easy-to-use scripts that help you extract worklog data from JIRA and export it to Excel reports. Perfect for project managers, team leads, and administrators who need to track time spent on tasks.

## 📋 What These Scripts Do

### 1. **jira-worklog-fetcher.js** - Team & Individual Reports
- Get worklogs for a **specific person** by email
- Get worklogs for an **entire team/group**
- Get worklogs for **yourself** (the person running the script)
- Filter by custom date ranges
- Export to Excel with detailed breakdowns

### 2. **jira-jql-worklog-fetcher.js** - Advanced Query Reports
- Use **JQL queries** to find specific issues (bugs, tasks, etc.)
- Get all worklogs from those issues
- Perfect for project-specific reports
- Export to Excel with issue summaries

---

## 🛠️ Prerequisites (One-time Setup)

### Step 1: Install Node.js
1. Go to [nodejs.org](https://nodejs.org/)
2. Download and install the **LTS version** (recommended for most users)


### Step 2: Install Required Packages
1. Open **Command Prompt** or **PowerShell**
2. Navigate to the project folder:
   ```bash
   cd "d:\Los repos\cync-los-int-flow-service\jira-worklog-reports"
   ```
   ```bash
   npm install
   ```

### Step 3: Get Your JIRA API Token
1. Log into your JIRA account in a web browser
2. Go to **Account Settings** → **Security** → **API Tokens**
3. Click **Create API Token**
4. Give it a name like "Worklog Reports"
5. **Copy the token** - you'll need this for the scripts!

---

## 🚀 How to Use the Scripts

## Option 1: Team & Individual Reports (`jira-worklog-fetcher.js`)

### Step 1: Configure the Script
Open `jira-worklog-fetcher.js` in any text editor and update these settings:

```javascript
const CONFIG = {
  // Your JIRA instance URL
  jiraBaseUrl: 'https://idexcel.atlassian.net',  // Change this to your JIRA URL
  
  // Your credentials
  email: 'your.email@company.com',  // ← Replace with your email
  apiToken: 'ATATT3xFfGF0...',      // ← Replace with your API token
  
  // Choose ONE of these options:
  
  // Option A: Get worklogs for a specific person
  specificUserEmail: 'john.doe@company.com',  // ← Person's email
  groupName: null,
  useCurrentUser: false,
  
  // Option B: Get worklogs for an entire team
  specificUserEmail: null,
  groupName: "AWS Team",  // ← Your team/group name in JIRA
  useCurrentUser: false,
  
  // Option C: Get worklogs for yourself only
  specificUserEmail: null,
  groupName: null,
  useCurrentUser: true,  // ← Set to true
}
```

### Step 2: Run the Script
1. Open **Command Prompt** or **PowerShell**
2. Navigate to the project folder:
   ```bash
   cd "d:\Los repos\cync-los-int-flow-service\jira-worklog-reports"
   ```
3. Run the script:
   ```bash
   node jira-worklog-fetcher.js
   ```
4. Follow the prompts to select your date range
5. Wait for the script to complete
6. Find your Excel report in the `generated-reports` folder!

---

## Option 2: Advanced Query Reports (`jira-jql-worklog-fetcher.js`)

### Step 1: Configure the Script
Open `jira-jql-worklog-fetcher.js` in any text editor and update these settings:

```javascript
const CONFIG = {
  // Your JIRA instance URL
  jiraBaseUrl: 'https://idexcel.atlassian.net',  // Change this to your JIRA URL
  
  // Your credentials
  email: 'your.email@company.com',  // ← Replace with your email
  apiToken: 'ATATT3xFfGF0...',      // ← Replace with your API token
  
  // Your JQL query - examples below:
  jqlQuery: 'project = "LOS " AND issuetype in (Bug) AND assignee is EMPTY',
}
```

### Common JQL Query Examples:
```javascript
// All bugs in a specific project
jqlQuery: 'project = "MY_PROJECT" AND issuetype = Bug'

// All tasks assigned to you
jqlQuery: 'assignee = currentUser() AND issuetype = Task'

// All issues updated in the last 30 days
jqlQuery: 'updated >= -30d'

// Specific issues by key
jqlQuery: 'key in (PROJ-123, PROJ-456, PROJ-789)'

// All issues in an epic
jqlQuery: '"Epic Link" = PROJ-100'

// Issues assigned to no one
jqlQuery: 'assignee is EMPTY AND project = "MY_PROJECT"'
```

### Step 2: Run the Script
1. Open **Command Prompt** or **PowerShell**
2. Navigate to the project folder:
   ```bash
   cd "d:\Los repos\cync-los-int-flow-service\jira-worklog-reports"
   ```
3. Run the script:
   ```bash
   node jira-jql-worklog-fetcher.js
   ```
4. Choose to use your configured query or enter a custom one
5. Wait for the script to complete
6. Find your Excel report in the `generated-reports` folder!

---

## 📊 Understanding Your Excel Reports

### Team/Individual Reports Structure:
- **Sheet 1 "Report"**: Summary by issue with total hours per issue
- **Sheet 2 "Work logs"**: Detailed entries with who logged what when

### JQL Query Reports Structure:
- **Sheet 1 "All Issues"**: All issues found (including ones with no worklogs)
- **Sheet 2 "Work logs"**: Detailed worklog entries

---

## ⚙️ Advanced Configuration Options

### Date Range Settings
```javascript
// Use specific dates
startDate: '2025-01-01',  // YYYY-MM-DD format
endDate: '2025-01-31',

// Or use relative dates
startDate: getDateDaysAgo(30),  // 30 days ago
endDate: getDateDaysAgo(0),     // Today
```

### Filter Options (JQL Script Only)
```javascript
// Filter worklogs by date (even if issue was created earlier)
dateFilter: {
  enabled: true,
  startDate: '2025-09-01',
  endDate: '2025-10-16'
},

// Filter worklogs by specific people
authorFilter: {
  enabled: true,
  authorEmails: ['user1@company.com', 'user2@company.com']
}
```

### Performance Settings (for large teams)
```javascript
// For teams with 50+ people or 2000+ tickets
enableBatchProcessing: true,
batchSize: 200,           // Process 200 issues at a time
batchDelayMs: 1000,       // Wait 1 second between batches
maxIssuesToProcess: 5000, // Safety limit
```

---

## 🚨 Troubleshooting

### "Authentication failed" or "401 Unauthorized"
- Double-check your email and API token are correct
- Make sure your API token hasn't expired
- Verify your JIRA base URL is correct

### "User not found" or "Group not found"
- Check the spelling of email addresses or group names
- Group names are case-sensitive
- Make sure the person has access to JIRA

### "No issues found" or "No worklogs found"
- Try expanding your date range
- Check if the issues actually have worklogs in that time period
- For JQL queries, test your query in JIRA's issue search first

### Script runs but Excel file is empty
- The date range might not match when work was actually logged
- Team members might not have logged time in that period
- Check the console output for filtering information

### "Rate limit exceeded"
- The script will automatically retry, just wait
- For large teams, enable batch processing in the config
- Consider running during off-peak hours

### "Module not found" errors
- Make sure you ran `npm install node-fetch xlsx readline`
- Try running as Administrator
- Restart your command prompt after installing Node.js

---

## 📁 File Locations

- **Scripts**: Main project folder
- **Excel Reports**: `generated-reports/` folder
- **Report Names**: 
  - Team reports: `GroupName_YYYY-MM-DD_HH-MM-SS.xlsx`
  - JQL reports: `Project_Name_YYYY-MM-DD_HH-MM-SS.xlsx`


---

## 📋 Quick Start Checklist

- [ ] Node.js installed
- [ ] Packages installed (`npm install node-fetch xlsx readline`)
- [ ] JIRA API token created
- [ ] Script configured with your credentials
- [ ] Email/group name/JQL query set correctly
- [ ] Date range configured
- [ ] Ready to run!

Happy reporting! 📈

