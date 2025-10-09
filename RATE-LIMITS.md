# 🚦 Jira API Rate Limits & Best Practices

This document provides detailed information about Jira Cloud API rate limits, how they affect this application, and best practices for avoiding issues.

---

## 📋 Table of Contents

- [API Endpoints Used](#api-endpoints-used)
- [Rate Limits Overview](#rate-limits-overview)
- [Subscription-Based Limits](#subscription-based-limits)
- [How This Application is Affected](#how-this-application-is-affected)
- [Rate Limit Headers](#rate-limit-headers)
- [Best Practices](#best-practices)
- [Troubleshooting Rate Limit Issues](#troubleshooting-rate-limit-issues)

---

## 🔌 API Endpoints Used

This application uses the following **Jira Cloud REST API v3** endpoints:

| Endpoint | Purpose | Frequency | Paginated |
|----------|---------|-----------|-----------|
| `/rest/api/3/myself` | Get current user details | Once per run | No |
| `/rest/api/3/group/member` | Get group members | 1+ per group (50 members/page) | Yes |
| `/rest/api/3/search/jql` | Search issues using JQL | 1+ per search (100 issues/page) | Yes |
| `/rest/api/3/issue/{key}/worklog` | Get work logs for an issue | Once per issue found | No |

### Typical API Call Volume

For a typical report generation:

```
1 call:   Get current user
N calls:  Get group members (N = ceil(members / 50))
M calls:  Search issues (M = ceil(issues / 100), max 500 issues)
P calls:  Get worklogs (P = number of issues found, max 500)

Total = 1 + N + M + P calls
```

**Example scenarios:**
- Small team (10 members, 50 issues): ~**53 API calls**
- Medium team (50 members, 200 issues): ~**206 API calls**
- Large team (100 members, 500 issues): ~**508 API calls**

---

## ⚡ Rate Limits Overview

### General Jira Cloud Rate Limits

Jira Cloud applies rate limits **per user** (based on API token or OAuth credentials):

| Metric | Typical Limit |
|--------|---------------|
| **Requests per minute** | 100-1000 (depends on plan) |
| **Concurrent requests** | 10-20 (depends on plan) |
| **Burst capacity** | 2x normal rate for short periods |

### Important Notes

✅ **Rate limits are per-user, not per application**
- If 5 people run this script simultaneously with different API tokens, each has their own limit

✅ **Limits reset on a rolling window**
- Not all requests reset at once; it's typically a sliding window

✅ **Different endpoints may have different limits**
- Search/JQL endpoints may have stricter limits than simple GET requests

---

## 💰 Subscription-Based Limits

**Rate limits HEAVILY depend on your Atlassian subscription plan:**

### Free Plan
- ⚠️ **~100-200 requests per minute**
- ⚠️ **~10 concurrent requests**
- Lower burst capacity
- Stricter enforcement

### Standard Plan
- ✅ **~300-500 requests per minute**
- ✅ **~15 concurrent requests**
- Better burst capacity

### Premium Plan
- ✅ **~500-1000 requests per minute**
- ✅ **~20 concurrent requests**
- High burst capacity
- Priority processing

### Enterprise Plan
- ✅ **Custom rate limits** (negotiable)
- ✅ **Highest concurrent requests**
- Dedicated infrastructure options
- SLA guarantees

### How to Check Your Plan

1. Log in to Jira
2. Go to **Settings** (⚙️) → **Products**
3. Look for **"Jira Software"** or **"Jira Work Management"**
4. Your plan tier is shown next to the product name

### HTTP 429 Response

When you exceed rate limits:

```
Status: 429 Too Many Requests
Retry-After: 60

{
  "errorMessages": [
    "Rate limit exceeded. Please retry after 60 seconds."
  ]
}
```

---

## ✅ Best Practices

### For Script Users

1. **Run during off-peak hours**
   - Early morning or late evening
   - Fewer users = more quota available

2. **Use appropriate date ranges**
   - Don't fetch more data than needed
   - Shorter date ranges = fewer issues = fewer API calls

3. **Monitor execution time**
   - If it takes >5 minutes, consider smaller batches
   - Split large reports into multiple runs

4. **Don't run multiple instances simultaneously**
   - Each run counts against your personal quota
   - Wait for one to finish before starting another

### For Administrators

1. **Upgrade plan if needed**
   - If rate limits are frequently hit, consider Premium plan
   - Cost vs. productivity analysis

2. **Use service accounts**
   - Create dedicated API tokens for automation
   - Easier to track and manage quotas

3. **Monitor API usage**
   - Check Atlassian admin console for usage metrics
   - Set up alerts for quota threshold

---

## 🔧 Troubleshooting Rate Limit Issues

### Error: 429 Too Many Requests

**Symptoms:**
```
Error: Jira API Error (429): Rate limit exceeded
```

**Solutions:**

1. **Wait and retry**
   ```powershell
   # Wait 1-2 minutes, then run again
   node jira-worklog-fetcher.js
   ```

2. **Reduce scope**
   - Use shorter date range
   - Target fewer issues
   - Run for smaller groups

3. **Check your quota**
   - Contact Jira admin to check plan limits
   - Verify no other scripts are running

### Slow Performance

**If the script takes >5 minutes:**

1. **Expected for large datasets**
   - 500 issues = ~500+ API calls
   - Each call takes 100-500ms
   - Total time: 50-250 seconds (normal)

2. **Optimize query**
   - Use more specific JQL filters
   - Reduce date range
   - Filter by specific projects

3. **Split the work**
   - Run multiple reports for different teams
   - Process different date ranges separately

### Frequent Rate Limit Hits

**If you consistently hit rate limits:**

1. **Check your plan**
   - Free/Standard plans have lower limits
   - Consider upgrading to Premium

2. **Coordinate with team**
   - Don't run multiple instances
   - Schedule regular report times

3. **Contact Atlassian Support**
   - Explain your use case
   - Request quota increase
   - Discuss enterprise options

---

## 📚 Additional Resources

- [Atlassian Rate Limiting Documentation](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
- [Jira REST API v3 Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [API Token Management](https://id.atlassian.com/manage-profile/security/api-tokens)
- [Atlassian Cloud Pricing](https://www.atlassian.com/software/jira/pricing)

**Last Updated:** October 9, 2025
**Document Version:** 1.0
