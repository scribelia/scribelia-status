/**
 * Send notifications via Discord webhook
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const STATUS_COLORS = {
  down: 0xef4444,      // Red
  degraded: 0xeab308,  // Yellow
  up: 0x22c55e         // Green
};

const STATUS_EMOJI = {
  down: '🔴',
  degraded: '🟡',
  up: '🟢'
};

/**
 * Send Discord webhook notification
 */
export async function sendDiscordNotification(webhookUrl, embed) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });

    if (!response.ok) {
      console.error(`Discord webhook failed: ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Discord notification error: ${error.message}`);
    return false;
  }
}

/**
 * Notify about a status change
 */
export async function notifyStatusChange(site, oldStatus, newStatus, responseTime) {
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  const webhookUrl = config.settings?.notifications?.discord;

  if (!webhookUrl) return;

  const isRecovery = newStatus === 'up' && (oldStatus === 'down' || oldStatus === 'degraded');
  const isIncident = newStatus === 'down' || newStatus === 'degraded';

  let title, description, color;

  if (isRecovery) {
    title = `${STATUS_EMOJI.up} ${site.name} est de retour`;
    description = `Le service est à nouveau opérationnel.`;
    color = STATUS_COLORS.up;
  } else if (isIncident) {
    title = `${STATUS_EMOJI[newStatus]} ${site.name} - ${newStatus === 'down' ? 'Panne détectée' : 'Performance dégradée'}`;
    description = newStatus === 'down' 
      ? `Le service ne répond pas.`
      : `Le service est lent ou partiellement indisponible.`;
    color = STATUS_COLORS[newStatus];
  } else {
    return; // No notification needed
  }

  const embed = {
    title,
    description,
    color,
    fields: [
      { name: 'Service', value: site.name, inline: true },
      { name: 'URL', value: site.url, inline: true },
      { name: 'Temps de réponse', value: `${responseTime}ms`, inline: true }
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Scribelia Status Monitor'
    }
  };

  const sent = await sendDiscordNotification(webhookUrl, embed);
  if (sent) {
    console.log(`📨 Discord notification sent for ${site.name}`);
  }
}

/**
 * Send a daily summary
 */
export async function sendDailySummary(data) {
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  const webhookUrl = config.settings?.notifications?.discord;

  if (!webhookUrl) return;

  const sites = Object.values(data.sites);
  const allUp = sites.every(s => s.status === 'up');
  const avgUptime = Math.round(sites.reduce((acc, s) => acc + (s.uptime?.day || 100), 0) / sites.length * 10) / 10;

  const statusFields = sites.map(site => ({
    name: `${STATUS_EMOJI[site.status]} ${site.name}`,
    value: `Uptime: ${site.uptime?.day || 100}% | ${site.responseTime}ms`,
    inline: true
  }));

  const embed = {
    title: allUp ? '📊 Rapport quotidien - Tout est opérationnel' : '📊 Rapport quotidien',
    color: allUp ? STATUS_COLORS.up : STATUS_COLORS.degraded,
    fields: [
      ...statusFields,
      { name: '\u200B', value: '\u200B', inline: false }, // Separator
      { name: 'Uptime moyen (24h)', value: `${avgUptime}%`, inline: true },
      { name: 'Incidents actifs', value: `${data.incidents.filter(i => !i.resolvedAt).length}`, inline: true }
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Scribelia Status Monitor'
    }
  };

  await sendDiscordNotification(webhookUrl, embed);
  console.log('📨 Daily summary sent to Discord');
}

