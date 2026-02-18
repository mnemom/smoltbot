/**
 * PDF fleet compliance report generator.
 * Uses pdf-lib (pure JS, Cloudflare Worker compatible).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

interface FleetAgent {
  agent_name?: string;
  owner_email?: string | null;
  integrity_score?: number;
  latest_verdict?: string | null;
  last_seen?: string | null;
  active_drift_alerts?: number;
  check_count?: number;
}

export async function generateFleetPdf(
  agents: Array<Record<string, unknown>>,
  orgName: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const reportId = `FR-${Date.now().toString(36).toUpperCase()}`;
  const generatedAt = new Date().toISOString();
  const dateRange = `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;

  // ---- Page 1: Title + Executive Summary ----
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  // Title
  page.drawText('Mnemom Fleet Compliance Report', {
    x: MARGIN, y, size: 22, font: fontBold, color: rgb(0.1, 0.1, 0.1),
  });
  y -= 30;

  page.drawText(orgName, {
    x: MARGIN, y, size: 14, font, color: rgb(0.3, 0.3, 0.3),
  });
  y -= 20;

  page.drawText(dateRange, {
    x: MARGIN, y, size: 10, font, color: rgb(0.5, 0.5, 0.5),
  });
  y -= 40;

  // Executive Summary
  page.drawText('Executive Summary', {
    x: MARGIN, y, size: 16, font: fontBold, color: rgb(0.1, 0.1, 0.1),
  });
  y -= 25;

  const typedAgents = agents as FleetAgent[];
  const fleetSize = typedAgents.length;
  const avgIntegrity = fleetSize > 0
    ? Math.round(typedAgents.reduce((sum, a) => sum + (a.integrity_score ?? 1), 0) / fleetSize * 100)
    : 0;
  const totalDrift = typedAgents.reduce((sum, a) => sum + (a.active_drift_alerts ?? 0), 0);
  const activeCount = typedAgents.filter(a => {
    if (!a.last_seen) return false;
    return Date.now() - new Date(a.last_seen).getTime() < 24 * 60 * 60 * 1000;
  }).length;

  const summaryLines = [
    `Fleet Size: ${fleetSize} agents`,
    `Active Agents (last 24h): ${activeCount}`,
    `Average Integrity Score: ${avgIntegrity}%`,
    `Total Active Drift Alerts: ${totalDrift}`,
  ];

  for (const line of summaryLines) {
    page.drawText(line, {
      x: MARGIN + 10, y, size: 11, font, color: rgb(0.2, 0.2, 0.2),
    });
    y -= 18;
  }

  y -= 20;

  // Separator line
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 30;

  // ---- Pages 2+: Agent Table ----
  page.drawText('Agent Details', {
    x: MARGIN, y, size: 16, font: fontBold, color: rgb(0.1, 0.1, 0.1),
  });
  y -= 25;

  // Table header
  const COL_X = [MARGIN, MARGIN + 140, MARGIN + 240, MARGIN + 310, MARGIN + 380, MARGIN + 440];
  const HEADERS = ['Agent Name', 'Owner', 'Integrity', 'Status', 'Checks', 'Alerts'];

  function drawTableHeader(pg: typeof page, startY: number): number {
    for (let i = 0; i < HEADERS.length; i++) {
      pg.drawText(HEADERS[i], {
        x: COL_X[i], y: startY, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3),
      });
    }
    return startY - 5;
  }

  function drawSeparator(pg: typeof page, startY: number): number {
    pg.drawLine({
      start: { x: MARGIN, y: startY },
      end: { x: PAGE_WIDTH - MARGIN, y: startY },
      thickness: 0.3,
      color: rgb(0.85, 0.85, 0.85),
    });
    return startY - 15;
  }

  y = drawTableHeader(page, y);
  y = drawSeparator(page, y);

  for (const agent of typedAgents) {
    // Check if we need a new page
    if (y < MARGIN + 40) {
      // Footer on current page
      page.drawText(`Report ID: ${reportId}  |  Generated: ${generatedAt}`, {
        x: MARGIN, y: 25, size: 7, font, color: rgb(0.6, 0.6, 0.6),
      });

      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      y = drawTableHeader(page, y);
      y = drawSeparator(page, y);
    }

    const name = truncate(String(agent.agent_name ?? ''), 22);
    const owner = truncate(String(agent.owner_email ?? '-'), 16);
    const score = typeof agent.integrity_score === 'number'
      ? Math.round(agent.integrity_score * 100) + '%'
      : 'N/A';
    const verdict = agent.latest_verdict ?? 'none';
    const status = verdict === 'boundary_violation' ? 'VIOLATION'
      : (agent.active_drift_alerts ?? 0) > 0 ? 'DRIFTING'
      : 'OK';
    const checks = String(agent.check_count ?? 0);
    const alerts = String(agent.active_drift_alerts ?? 0);

    const scoreColor = (agent.integrity_score ?? 1) >= 0.8
      ? rgb(0.1, 0.6, 0.1)
      : (agent.integrity_score ?? 1) >= 0.5
        ? rgb(0.7, 0.6, 0)
        : rgb(0.8, 0.1, 0.1);

    const statusColor = status === 'VIOLATION' ? rgb(0.8, 0.1, 0.1)
      : status === 'DRIFTING' ? rgb(0.7, 0.6, 0)
      : rgb(0.2, 0.2, 0.2);

    page.drawText(name, { x: COL_X[0], y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(owner, { x: COL_X[1], y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(score, { x: COL_X[2], y, size: 9, font: fontBold, color: scoreColor });
    page.drawText(status, { x: COL_X[3], y, size: 9, font: fontBold, color: statusColor });
    page.drawText(checks, { x: COL_X[4], y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(alerts, { x: COL_X[5], y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });

    y -= 16;
  }

  // Footer on last page
  page.drawText(`Report ID: ${reportId}  |  Generated: ${generatedAt}`, {
    x: MARGIN, y: 25, size: 7, font, color: rgb(0.6, 0.6, 0.6),
  });

  return doc.save();
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}
