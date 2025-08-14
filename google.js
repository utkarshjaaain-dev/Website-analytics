// google.js
// Node: v18+ recommended
// npm i express cors @google-analytics/data dotenv

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

const app = express();
app.use(cors());
app.use(express.json());

const PROPERTY_ID = process.env.PROPERTY_ID; // GA4 numeric id
if (!PROPERTY_ID) {
  console.error('Missing PROPERTY_ID env var');
  process.exit(1);
}

// GOOGLE_APPLICATION_CREDENTIALS should point to the JSON key file
// e.g., /etc/secrets/ga4-key.json

const analyticsDataClient = new BetaAnalyticsDataClient();

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange(days = 28) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { startDate: toISO(start), endDate: toISO(end) };
}

function rowsToObjects(rows = [], dimensionHeaders = [], metricHeaders = []) {
  return rows.map((row) => {
    const obj = {};
    dimensionHeaders.forEach((h, i) => (obj[h.name] = row.dimensionValues?.[i]?.value ?? null));
    metricHeaders.forEach((h, i) => (obj[h.name] = Number(row.metricValues?.[i]?.value ?? 0)));
    return obj;
  });
}

async function runReport({ dateRanges, dimensions = [], metrics = [] }) {
  const [res] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges,
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
  });
  return {
    meta: {
      rowCount: res.rowCount ?? 0,
      samplesReadCount: res?.metadata?.samplesReadCount ?? 0,
      samplingMetadatas: res?.metadata?.samplingMetadatas ?? [],
    },
    rows: rowsToObjects(res.rows, res.dimensionHeaders, res.metricHeaders),
  };
}

// --- Routes ---

// Overview KPIs
app.get('/api/ga/overview', async (req, res) => {
  try {
    const { start, end } = req.query;
    const range = [{ ...(start && end ? { startDate: start, endDate: end } : defaultRange(28)) }];
    const data = await runReport({
      dateRanges: range,
      metrics: [
        'totalUsers',
        'activeUsers',
        'newUsers',
        'sessions',
        'screenPageViews',
        'engagementRate',
        'averageSessionDuration',
        'bounceRate',
      ],
    });
    const row = data.rows[0] || {};
    res.json({
      range: range[0],
      kpis: {
        totalUsers: row.totalUsers ?? 0,
        activeUsers: row.activeUsers ?? 0,
        newUsers: row.newUsers ?? 0,
        sessions: row.sessions ?? 0,
        screenPageViews: row.screenPageViews ?? 0,
        engagementRate: row.engagementRate ?? 0,
        averageSessionDuration: row.averageSessionDuration ?? 0,
        bounceRate: row.bounceRate ?? 0,
      },
      meta: data.meta,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'overview_failed', details: e.message });
  }
});

// Daily time series
app.get('/api/ga/timeseries', async (req, res) => {
  try {
    const { start, end, metric = 'activeUsers' } = req.query;
    const range = [{ ...(start && end ? { startDate: start, endDate: end } : defaultRange(28)) }];
    const data = await runReport({
      dateRanges: range,
      dimensions: ['date'],
      metrics: [String(metric)],
    });
    res.json({ range: range[0], metric, rows: data.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'timeseries_failed', details: e.message });
  }
});

// Top pages
app.get('/api/ga/top-pages', async (req, res) => {
  try {
    const { start, end, limit = 10 } = req.query;
    const range = [{ ...(start && end ? { startDate: start, endDate: end } : defaultRange(28)) }];
    const data = await runReport({
      dateRanges: range,
      dimensions: ['pageTitle', 'pagePath'],
      metrics: ['screenPageViews', 'activeUsers'],
    });
    const rows = data.rows
      .sort((a, b) => b.screenPageViews - a.screenPageViews)
      .slice(0, Number(limit));
    res.json({ range: range[0], rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'top_pages_failed', details: e.message });
  }
});

// Traffic sources
app.get('/api/ga/sources', async (req, res) => {
  try {
    const { start, end, limit = 10 } = req.query;
    const range = [{ ...(start && end ? { startDate: start, endDate: end } : defaultRange(28)) }];
    const data = await runReport({
      dateRanges: range,
      dimensions: ['sessionDefaultChannelGroup'],
      metrics: ['sessions', 'activeUsers', 'engagedSessions'],
    });
    const rows = data.rows
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, Number(limit));
    res.json({ range: range[0], rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'sources_failed', details: e.message });
  }
});

// Devices
app.get('/api/ga/devices', async (req, res) => {
  try {
    const { start, end } = req.query;
    const range = [{ ...(start && end ? { startDate: start, endDate: end } : defaultRange(28)) }];
    const data = await runReport({
      dateRanges: range,
      dimensions: ['deviceCategory'],
      metrics: ['activeUsers', 'sessions'],
    });
    res.json({ range: range[0], rows: data.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'devices_failed', details: e.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GA4 API server running on :${PORT}`));