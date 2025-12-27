/**
 * Handle incidents - create/close GitHub issues automatically
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const DATA_PATH = path.join(ROOT, 'data', 'status.json');

function runGH(args) {
  try {
    return execSync(`gh ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    console.error(`gh command failed: ${args}`);
    return null;
  }
}

function getOpenIncidentIssues() {
  const result = runGH('issue list --label "incident" --state open --json number,title');
  if (!result) return [];
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

function createIncidentIssue(site, status) {
  const title = `🚨 ${site.name} is ${status}`;
  const body = `## Incident Detected

**Service:** ${site.name}
**URL:** ${site.url}
**Status:** ${status}
**Detected at:** ${new Date().toISOString()}

---

This issue was automatically created by the status monitor.
It will be automatically closed when the service recovers.`;

  const result = runGH(`issue create --title "${title}" --body "${body}" --label "incident"`);
  if (result) {
    console.log(`✅ Created incident issue for ${site.name}`);
  }
}

function closeIncidentIssue(issueNumber, siteName) {
  const comment = `## ✅ Resolved

**Service:** ${siteName}
**Resolved at:** ${new Date().toISOString()}

The service is back online.`;

  runGH(`issue close ${issueNumber} --comment "${comment}"`);
  console.log(`✅ Closed incident issue #${issueNumber} for ${siteName}`);
}

async function main() {
  try {
    const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf-8'));
    const openIssues = getOpenIncidentIssues();
    
    // Check each site
    for (const [slug, site] of Object.entries(data.sites)) {
      const isDown = site.status === 'down' || site.status === 'degraded';
      const existingIssue = openIssues.find(i => i.title.includes(site.name));
      
      if (isDown && !existingIssue) {
        // Service is down and no open issue exists - create one
        createIncidentIssue(site, site.status);
      } else if (!isDown && existingIssue) {
        // Service is up but issue is open - close it
        closeIncidentIssue(existingIssue.number, site.name);
      }
    }
    
    console.log('✅ Incident handling complete');
  } catch (error) {
    console.error('Error handling incidents:', error.message);
    // Don't fail the workflow if incident handling fails
  }
}

main();

