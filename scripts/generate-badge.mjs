/**
 * Generate dynamic status badge SVG
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const DATA_PATH = path.join(ROOT, 'data', 'status.json');
const BADGE_PATH = path.join(ROOT, 'badge.svg');

const STATUS_CONFIG = {
  operational: { label: 'operational', color: '#22c55e' },
  degraded: { label: 'degraded', color: '#eab308' },
  outage: { label: 'outage', color: '#ef4444' }
};

function generateBadge(status, uptime) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.outage;
  const uptimeText = `${uptime}%`;
  
  // Calculate widths
  const labelWidth = 50;
  const statusWidth = 75;
  const uptimeWidth = 45;
  const totalWidth = labelWidth + statusWidth + uptimeWidth;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="status: ${config.label}">
  <title>Scribelia Status: ${config.label} (${uptimeText} uptime)</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${statusWidth}" height="20" fill="${config.color}"/>
    <rect x="${labelWidth + statusWidth}" width="${uptimeWidth}" height="20" fill="#333"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="14" fill="#fff">status</text>
    <text x="${labelWidth + statusWidth / 2}" y="14" fill="#fff" font-weight="bold">${config.label}</text>
    <text x="${labelWidth + statusWidth + uptimeWidth / 2}" y="14" fill="#fff">${uptimeText}</text>
  </g>
</svg>`;
}

async function main() {
  try {
    const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf-8'));
    
    // Calculate overall uptime (average of all sites)
    const sites = Object.values(data.sites);
    const avgUptime = sites.length > 0 
      ? Math.round(sites.reduce((acc, s) => acc + (s.uptime?.day || 100), 0) / sites.length * 10) / 10
      : 100;
    
    const svg = generateBadge(data.overallStatus, avgUptime);
    await fs.writeFile(BADGE_PATH, svg);
    
    console.log(`✅ Badge generated: ${data.overallStatus} (${avgUptime}% uptime)`);
  } catch (error) {
    console.error('Error generating badge:', error.message);
    process.exit(1);
  }
}

main();

