/**
 * Generate README.md from status data
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_PATH = path.join(ROOT, 'data', 'status.json');
const README_PATH = path.join(ROOT, 'README.md');

function getStatusEmoji(status) {
  switch (status) {
    case 'up': return '✅';
    case 'degraded': return '⚠️';
    case 'down': return '❌';
    default: return '❓';
  }
}

function getStatusText(status) {
  switch (status) {
    case 'up': return 'Opérationnel';
    case 'degraded': return 'Dégradé';
    case 'down': return 'Hors service';
    default: return 'Inconnu';
  }
}

function getOverallEmoji(status) {
  switch (status) {
    case 'operational': return '🟢';
    case 'degraded': return '🟡';
    case 'outage': return '🔴';
    default: return '⚪';
  }
}

function getOverallText(status) {
  switch (status) {
    case 'operational': return 'Tous les systèmes opérationnels';
    case 'degraded': return 'Performance dégradée';
    case 'outage': return 'Panne détectée';
    default: return 'Statut inconnu';
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}j ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

async function generate() {
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf-8'));
  
  const overallEmoji = getOverallEmoji(data.overallStatus);
  const overallText = getOverallText(data.overallStatus);
  
  let readme = `# ${overallEmoji} ${config.settings.title}

[![Status](https://status.scribelia.com/badge.svg)](https://status.scribelia.com)

> ${config.settings.description}

**Statut actuel:** ${overallEmoji} ${overallText}

*Dernière mise à jour: ${new Date(data.lastUpdate).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}*

---

## 📊 État des services

| Service | État | Temps de réponse | Uptime (24h) | Uptime (7j) | Uptime (30j) |
|---------|------|------------------|--------------|-------------|--------------|
`;

  // Add each site
  for (const [slug, site] of Object.entries(data.sites)) {
    const emoji = getStatusEmoji(site.status);
    const statusText = getStatusText(site.status);
    readme += `| **${site.name}** | ${emoji} ${statusText} | ${site.responseTime}ms | ${site.uptime.day}% | ${site.uptime.week}% | ${site.uptime.month}% |\n`;
  }

  readme += `
---

## 📈 Historique récent

`;

  // Active incidents
  const activeIncidents = data.incidents.filter(i => !i.resolvedAt);
  if (activeIncidents.length > 0) {
    readme += `### 🚨 Incidents en cours\n\n`;
    for (const incident of activeIncidents) {
      const duration = formatDuration(Date.now() - new Date(incident.startedAt).getTime());
      readme += `- **${incident.site}** - ${getStatusEmoji(incident.status)} ${getStatusText(incident.status)} depuis ${duration}\n`;
    }
    readme += '\n';
  }

  // Recent resolved incidents
  const recentResolved = data.incidents
    .filter(i => i.resolvedAt)
    .slice(0, 5);
  
  if (recentResolved.length > 0) {
    readme += `### ✅ Incidents résolus récemment\n\n`;
    for (const incident of recentResolved) {
      const date = new Date(incident.startedAt).toLocaleDateString('fr-FR');
      const duration = formatDuration(
        new Date(incident.resolvedAt).getTime() - new Date(incident.startedAt).getTime()
      );
      readme += `- **${incident.site}** - ${date} - Résolu en ${duration}\n`;
    }
    readme += '\n';
  }

  if (activeIncidents.length === 0 && recentResolved.length === 0) {
    readme += `*Aucun incident récent* 🎉\n\n`;
  }

  readme += `---

## 📋 Services monitorés

`;

  for (const site of config.sites) {
    const slug = site.name.toLowerCase().replace(/\s+/g, '-');
    const siteData = data.sites[slug];
    readme += `### ${site.name}
- **URL:** \`${site.url}\`
- **Description:** ${site.description}
- **Temps de réponse moyen (24h):** ${siteData?.avgResponseTime?.day || 0}ms
- **Temps de réponse moyen (7j):** ${siteData?.avgResponseTime?.week || 0}ms

`;
  }

  readme += `---

## 🔧 À propos

Cette page de statut est mise à jour automatiquement toutes les 5 minutes via GitHub Actions.

- 📁 [Voir les données brutes](./data/status.json)
- 🌐 [Page de statut](https://${config.settings.cname})

---

*Propulsé par [Scribelia Status Monitor](https://github.com/scribelia-org/scribelia-status)*
`;

  await fs.writeFile(README_PATH, readme);
  console.log('✅ README.md generated');
}

generate().catch(console.error);

