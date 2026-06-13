#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) {
    args.set(key, 'true');
  } else {
    args.set(key, next);
    i += 1;
  }
}

function required(name) {
  const value = args.get(name) || process.env[name.toUpperCase().replaceAll('-', '_')];
  if (!value) {
    console.error(`Missing required --${name}`);
    process.exit(2);
  }
  return value;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function link(url) {
  if (!url) return '';
  const safe = esc(url);
  return `<a href="${safe}">${safe}</a>`;
}

const datasetId = required('dataset-id');
const backendUrl = (args.get('backend-url') || process.env.BACKEND_URL || 'http://localhost:3501').replace(/\/$/, '');
const frontendUrl = (args.get('frontend-url') || process.env.FRONTEND_URL || 'http://localhost:3500').replace(/\/$/, '');
const outDir = resolve(args.get('out-dir') || `artifacts/dataset-reports/${datasetId}`);
const title = args.get('title') || 'BigSet Dataset Report';
const pdf = args.get('pdf') !== 'false';

async function fetchJson(path) {
  const res = await fetch(`${backendUrl}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const [{ dataset }, { rows }] = await Promise.all([
  fetchJson(`/cli/datasets/${encodeURIComponent(datasetId)}`),
  fetchJson(`/cli/datasets/${encodeURIComponent(datasetId)}/rows`),
]);

if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/dataset.json`, JSON.stringify({ dataset, rows }, null, 2));

const columns = dataset.columns?.map((c) => c.name) || [];
const scoreColumn = columns.find((c) => /score|priority|confidence/i.test(c));
const primaryColumn = dataset.columns?.find((c) => c.isPrimaryKey)?.name || columns[0] || 'row';
const sourceColumn = columns.find((c) => /source.*url|url.*source|source_url/i.test(c));
const websiteColumn = columns.find((c) => /^website$/i.test(c));

const sorted = [...rows].sort((a, b) => {
  const av = Number(a.data?.[scoreColumn] ?? 0);
  const bv = Number(b.data?.[scoreColumn] ?? 0);
  return bv - av;
});
const top = sorted.slice(0, Math.min(5, sorted.length));
const topHtml = top
  .map((row) => `<li><strong>${esc(row.data?.[primaryColumn])}</strong>${scoreColumn ? ` — ${esc(row.data?.[scoreColumn])}` : ''}</li>`)
  .join('\n');

const cards = rows
  .map((row, index) => {
    const data = row.data || {};
    const fields = columns
      .map((column) => {
        const value = data[column];
        const rendered = column === sourceColumn || column === websiteColumn ? link(value) : esc(value);
        return `<tr><th>${esc(column)}</th><td>${rendered}</td></tr>`;
      })
      .join('\n');
    const sources = (row.sources || [])
      .map((src) => `<li>${link(src)}</li>`)
      .join('\n');
    return `<section class="card"><div class="rank">#${index + 1}${scoreColumn ? ` · ${esc(scoreColumn)} ${esc(data[scoreColumn])}` : ''}</div><h2>${esc(data[primaryColumn])}</h2><table>${fields}</table>${sources ? `<h3>Sources</h3><ul>${sources}</ul>` : ''}</section>`;
  })
  .join('\n');

const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: Letter; margin: 0.45in; }
body { font-family: -apple-system, BlinkMacSystemFont, Inter, Helvetica, Arial, sans-serif; color:#111827; font-size:12px; line-height:1.4; }
h1 { font-size:28px; margin:0 0 8px; letter-spacing:-.03em; }
h2 { font-size:18px; margin:4px 0 8px; }
h3 { font-size:12px; margin:10px 0 4px; }
.subtitle { color:#4b5563; margin-bottom:18px; }
.summary { border:1px solid #d1d5db; border-radius:10px; padding:14px 16px; background:#f9fafb; margin-bottom:18px; }
.card { page-break-inside:avoid; border-top:2px solid #111827; padding-top:10px; margin:18px 0 22px; }
.rank { font-size:11px; font-weight:700; color:#2563eb; text-transform:uppercase; letter-spacing:.04em; }
table { border-collapse:collapse; width:100%; }
th { width:22%; vertical-align:top; text-align:left; color:#374151; background:#f3f4f6; border:1px solid #e5e7eb; padding:6px; font-size:11px; }
td { vertical-align:top; border:1px solid #e5e7eb; padding:6px; }
a { color:#1d4ed8; text-decoration:none; word-break:break-all; }
.footer { color:#6b7280; font-size:10px; border-top:1px solid #e5e7eb; padding-top:8px; margin-top:20px; }
</style></head><body>
<h1>${esc(title)}</h1>
<div class="subtitle">Dataset: <a href="${frontendUrl}/dataset/${esc(datasetId)}">${esc(dataset.name || datasetId)}</a> · Rows: ${rows.length} · Status: ${esc(dataset.status)} · Generated: ${esc(now)}</div>
<div class="summary"><h3>Top rows</h3><ul>${topHtml}</ul></div>
${cards}
<div class="footer">Generated from BigSet local CLI endpoints. Keep public-source and privacy constraints in the dataset prompt; do not collect private personal contact data without explicit consent and a lawful basis.</div>
</body></html>`;

const htmlPath = `${outDir}/report.html`;
await writeFile(htmlPath, html);

let pdfPath = null;
if (pdf) {
  pdfPath = `${outDir}/report.pdf`;
  const wk = spawnSync('wkhtmltopdf', ['--quiet', htmlPath, pdfPath], { encoding: 'utf8' });
  if (wk.status !== 0) {
    console.error(wk.stderr || wk.stdout || 'wkhtmltopdf failed');
    console.error('HTML report was still written. Install wkhtmltopdf or rerun with --pdf false.');
    pdfPath = null;
  }
}

const result = { datasetId, datasetUrl: `${frontendUrl}/dataset/${datasetId}`, status: dataset.status, rowCount: rows.length, outDir, htmlPath, pdfPath };
console.log(JSON.stringify(result, null, 2));
if (pdfPath && !existsSync(pdfPath)) process.exit(1);
