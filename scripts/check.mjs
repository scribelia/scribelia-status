/**
 * Scribelia Status Monitor
 * Checks all configured endpoints and updates status data
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_PATH = path.join(ROOT, 'data', 'status.json');

/**
 * Check a single endpoint
 */
async function checkEndpoint(site) {
  const start = Date.now();
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(site.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Scribelia-Status-Monitor/1.0' }
    });
    
    clearTimeout(timeout);
    const responseTime = Date.now() - start;
    
    const result = {
      status: response.status === site.expectedStatus ? 'up' : 'degraded',
      statusCode: response.status,
      responseTime,
      timestamp: new Date().toISOString()
    };
    
    // Parse health check response for detailed info
    if (site.type === 'health-check' && response.ok) {
      try {
        const healthData = await response.json();
        result.healthCheck = {
          version: healthData.version || null,
          environment: healthData.environment || null,
          uptime: healthData.uptime || null,
          deployedAt: healthData.deployedAt || null,
          checks: {}
        };
        
        // Parse sub-checks (database, redis, etc.)
        if (healthData.checks) {
          for (const [name, check] of Object.entries(healthData.checks)) {
            result.healthCheck.checks[name] = {
              status: check.status === 'ok' ? 'up' : 'down',
              latency: check.latency || null
            };
            
            // If any sub-check is down, mark as degraded
            if (check.status !== 'ok') {
              result.status = 'degraded';
            }
          }
        }
      } catch {
        // Ignore JSON parse errors, keep basic status
      }
    }
    
    return result;
  } catch (error) {
    return {
      status: 'down',
      statusCode: 0,
      responseTime: Date.now() - start,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Calculate uptime percentage from history
 */
function calculateUptime(history, days) {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const relevant = history.filter(h => new Date(h.timestamp).getTime() > cutoff);
  
  if (relevant.length === 0) return 100;
  
  const upCount = relevant.filter(h => h.status === 'up').length;
  return Math.round((upCount / relevant.length) * 10000) / 100;
}

/**
 * Calculate average response time from history
 */
function calculateAvgResponseTime(history, days) {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const relevant = history.filter(h => 
    new Date(h.timestamp).getTime() > cutoff && h.status === 'up'
  );
  
  if (relevant.length === 0) return 0;
  
  const sum = relevant.reduce((acc, h) => acc + h.responseTime, 0);
  return Math.round(sum / relevant.length);
}

/**
 * Main monitoring function
 */
async function monitor() {
  console.log('🔍 Starting status check...\n');
  
  // Load config
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  
  // Load existing data or create new
  let data;
  try {
    data = JSON.parse(await fs.readFile(DATA_PATH, 'utf-8'));
  } catch {
    data = { 
      lastUpdate: null, 
      sites: {},
      incidents: []
    };
  }
  
  const previousStatuses = {};
  let hasChanges = false;
  
  // Check each site
  for (const site of config.sites) {
    const slug = site.name.toLowerCase().replace(/\s+/g, '-');
    console.log(`Checking ${site.name} (${site.url})...`);
    
    // Store previous status for incident detection
    if (data.sites[slug]) {
      previousStatuses[slug] = data.sites[slug].status;
    }
    
    const result = await checkEndpoint(site);
    console.log(`  → ${result.status.toUpperCase()} (${result.statusCode}) - ${result.responseTime}ms\n`);
    
    // Initialize site data if needed
    if (!data.sites[slug]) {
      data.sites[slug] = {
        name: site.name,
        url: site.url,
        description: site.description,
        status: result.status,
        history: []
      };
    }
    
    // Update current status
    data.sites[slug].status = result.status;
    data.sites[slug].lastCheck = result.timestamp;
    data.sites[slug].responseTime = result.responseTime;
    data.sites[slug].statusCode = result.statusCode;
    
    // Store health check details if available
    if (result.healthCheck) {
      data.sites[slug].healthCheck = result.healthCheck;
    }
    
    // Add to history
    data.sites[slug].history.push({
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      timestamp: result.timestamp
    });
    
    // Trim history to configured days
    const cutoff = Date.now() - (config.settings.historyDays * 24 * 60 * 60 * 1000);
    data.sites[slug].history = data.sites[slug].history.filter(
      h => new Date(h.timestamp).getTime() > cutoff
    );
    
    // Calculate uptimes
    data.sites[slug].uptime = {
      day: calculateUptime(data.sites[slug].history, 1),
      week: calculateUptime(data.sites[slug].history, 7),
      month: calculateUptime(data.sites[slug].history, 30),
      all: calculateUptime(data.sites[slug].history, config.settings.historyDays)
    };
    
    // Calculate average response times
    data.sites[slug].avgResponseTime = {
      day: calculateAvgResponseTime(data.sites[slug].history, 1),
      week: calculateAvgResponseTime(data.sites[slug].history, 7),
      month: calculateAvgResponseTime(data.sites[slug].history, 30)
    };
    
    // Detect status changes for incidents
    const prevStatus = previousStatuses[slug];
    if (prevStatus && prevStatus !== result.status) {
      hasChanges = true;
      
      if (result.status === 'down' || result.status === 'degraded') {
        // New incident
        data.incidents.unshift({
          id: Date.now(),
          site: site.name,
          slug,
          status: result.status,
          startedAt: result.timestamp,
          resolvedAt: null,
          updates: [{
            status: result.status,
            message: `${site.name} is ${result.status}`,
            timestamp: result.timestamp
          }]
        });
      } else if (result.status === 'up' && (prevStatus === 'down' || prevStatus === 'degraded')) {
        // Resolve incident
        const incident = data.incidents.find(i => i.slug === slug && !i.resolvedAt);
        if (incident) {
          incident.resolvedAt = result.timestamp;
          incident.updates.push({
            status: 'resolved',
            message: `${site.name} is back up`,
            timestamp: result.timestamp
          });
        }
      }
    }
  }
  
  // Update metadata
  data.lastUpdate = new Date().toISOString();
  
  // Calculate overall status
  const statuses = Object.values(data.sites).map(s => s.status);
  if (statuses.every(s => s === 'up')) {
    data.overallStatus = 'operational';
  } else if (statuses.some(s => s === 'down')) {
    data.overallStatus = 'outage';
  } else {
    data.overallStatus = 'degraded';
  }
  
  // Save data
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2));
  console.log('✅ Status data updated');
  
  // Return status for workflow
  return { data, hasChanges };
}

// Run
monitor().catch(console.error);

