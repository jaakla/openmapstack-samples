import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';

const directory = 'test-results/maintenance';
await mkdir(directory, { recursive: true });
let report;
try { report = JSON.parse(await readFile(`${directory}/playwright.json`, 'utf8')); }
catch { /* Setup failures must be reported as unknown, never as passing. */ }
const checks = [];
function walk(suite) {
  for (const spec of suite.specs || []) for (const test of spec.tests || []) {
    const result = test.results?.at(-1);
    const evidence = {};
    for (const a of result?.attachments || []) if (a.contentType === 'application/json' && a.body) {
      try { evidence[a.name] = JSON.parse(Buffer.from(a.body, 'base64').toString('utf8')); }
      catch { /* Preserve malformed evidence in the complete Playwright report. */ }
    }
    checks.push({ name: spec.title, project: test.projectName, status: result?.status || 'unknown',
      durationMs: result?.duration, errors: result?.errors, evidence,
      attachments: (result?.attachments || []).map(a => ({ name: a.name, path: a.path, contentType: a.contentType })) });
  }
  for (const child of suite.suites || []) walk(child);
}
for (const suite of report?.suites || []) walk(suite);
const status = !report || !checks.length ? 'unknown'
  : report.errors?.length || checks.some(c => c.status !== 'passed') ? 'failed' : 'passed';
const result = { schema: 'openmapstack-health/v1', service: 'tallinn-transit',
  checkedAt: new Date().toISOString(), timezone: 'Europe/Tallinn', status,
  target: process.env.PLAYWRIGHT_BASE_URL || 'https://jaakla.github.io/openmapstack-samples/tallinn-transit/',
  // This is the monitoring-code version, not a claim about the deployed app SHA.
  monitorCommit: process.env.GITHUB_SHA || null,
  reportUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  checks, errors: report?.errors || [], stats: report?.stats };
await writeFile(`${directory}/health.json`, `${JSON.stringify(result, null, 2)}\n`);
const labels = { passed: 'Läbis', failed: 'Viga', timedOut: 'Aegus', skipped: 'Vahele jäetud', interrupted: 'Katkestatud', unknown: 'Teadmata' };
const lines = ['## Tallinn liigub – nädalakontroll', '', `Tulemus: **${labels[status]}**`, '',
  'Kiirused, andmeversioonid ja ekraanipildid asuvad töö artefaktis.', '',
  '| Vaade / teenus | Kontroll | Tulemus | Kestus |', '|---|---|---|---|',
  ...checks.map(c => `| ${c.project} | ${c.name.replaceAll('|', '/')} | ${labels[c.status] || c.status} | ${(c.durationMs / 1000).toFixed(1)} s |`),
  '', 'Kontroll on kirjutuskaitstud: see ei uuenda andmeid ega avalda rakendust.', ''];
const timings = checks.filter(c => c.evidence['startup-timings']);
if (timings.length) lines.push('### Avamise kiirus', '',
  '| Vaade | HTML/JS | Kasutusvalmis kokku | Andmete võrgulaadimine | Kasutusvalmis ilma võrgulaadimiseta |',
  '|---|---|---|---|---|',
  ...timings.map(c => {
    const t = c.evidence['startup-timings'], seconds = n => `${(n / 1000).toFixed(2)} s`;
    return `| ${c.project} | ${seconds(t.domContentLoadedMs)} | ${seconds(t.readyMs)} | ${seconds(t.dataTransferMs)} | ${seconds(t.readyExcludingDataTransferMs)} |`;
  }), '');
const deployed = checks.find(c => c.evidence['deployed-data-versions'])?.evidence['deployed-data-versions'];
if (deployed) lines.push('### Avaliku andmepaketi allikad', '',
  '| Allikas | Versioon | Alla laaditud | Suurus |', '|---|---|---|---|',
  ...Object.entries(deployed.sources).map(([name, s]) => `| ${name} | ${String(s.version?.identifier || 'Teadmata').replaceAll('|', '/')} | ${s.retrievedAt || 'Teadmata'} | ${s.bytes ?? 'Teadmata'} B |`), '');
if (!report) lines.push('Testiraport puudub; kontrolli sõltuvuste ja brauseri paigaldamise samme.');
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
console.log(lines.join('\n'));
if (status !== 'passed') process.exitCode = 1;
