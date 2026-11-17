// Exercise only the incident SELECT and a CLI argument probe through SQLPage's
// configured connection. Never run the real report generator or BIS connector.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'api/generate_mstrack_history.sql'), 'utf8');
const projection = source.slice(source.indexOf('SET incident_id_text'), source.indexOf('SET report_url'));
assert.ok(projection.includes('FOR JSON PATH, WITHOUT_ARRAY_WRAPPER'));
assert.doesNotMatch(projection.replace(/--[^\n]*/g, ''), /\b(?:UPDATE|INSERT|DELETE|EXEC(?:UTE)?|ALTER|DROP|TRUNCATE|MERGE|OPENQUERY)\b|203\.0\.113\.10/i);
const token = crypto.randomBytes(12).toString('hex');
const endpointName = `mstrack-incident-readonly-${token}.sql`;
const probeName = `mstrack-input-probe-${token}.cjs`;
const endpointFile = path.join(root, 'tmp', endpointName);
const probeFile = path.join(root, 'tmp', probeName);
const output = path.join(root, 'outputs/mstrack-report-fix-20261013-080451/sqlpage-readonly-results.json');
const probe = `
const incident = JSON.parse(process.argv[4] || '{}');
const dates = [incident.EventDateTime, incident.DispatchDateTime, incident.StandDownDateTime];
process.stdout.write(JSON.stringify({
  IncidentMatched: incident.id === Number(process.argv[2]),
  FormatMatched: process.argv[3] === 'xls',
  ExplicitUtcDates: dates.every(value => typeof value === 'string' && value.endsWith('Z') && !Number.isNaN(Date.parse(value))),
  RegistrationPresent: typeof incident.RegNo === 'string' && incident.RegNo.length > 0,
  QuotedUnicodePreserved: incident.IncidentNumber === 'TEST "with spaces" & café'
}));
`;
const exec = source.slice(source.indexOf('SET report_url'), source.indexOf("SELECT 'redirect' AS component, $report_url"))
  .replace('dispatch_link/tools/generate_mstrack_history.js', 'dispatch_link/tmp/' + probeName);
const response = "SELECT 'json' AS component, $report_url AS contents;";

async function run(sql) {
  assert.doesNotMatch(sql, /203\.0\.113\.10|OPENQUERY|\b(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|MERGE)\b/i);
  fs.writeFileSync(endpointFile, sql, 'utf8');
  const result = await fetch('http://127.0.0.1:8080/dispatch_link/tmp/' + endpointName, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ incidentId: '344', format: 'xls' }), signal: AbortSignal.timeout(30000)
  });
  const text = await result.text();
  if (!result.ok || !text.trim().startsWith('{')) throw Error('Read-only SQLPage verification failed (HTTP ' + result.status + '); raw response withheld.');
  return JSON.parse(text);
}

async function main() {
  fs.writeFileSync(probeFile, probe, { flag: 'wx', encoding: 'utf8' });
  try {
    const actual = await run(projection + exec + response);
    assert.equal(actual.IncidentMatched, true);
    assert.equal(actual.FormatMatched, true);
    assert.equal(actual.ExplicitUtcDates, true);
    assert.equal(actual.RegistrationPresent, true);
    const fixture = `(SELECT 344 AS id, N'TEST "with spaces" & café' AS IncidentNumber, N'TEST-REPORT' AS RegNo,
      CONVERT(datetime2, '2026-10-12T09:00:00', 126) AS EventDateTime,
      CONVERT(datetime2, '2026-10-12T10:00:00', 126) AS DispatchDateTime,
      CONVERT(datetime2, '2026-10-12T11:00:00', 126) AS StandDownDateTime,
      CONVERT(datetime2, '2026-10-12T12:00:00', 126) AS UpdatedAt,
      N'Approved' AS Status, N'Stood Down' AS DispatchStatus, 0 AS IsDeleted) incident`;
    const synthetic = await run(projection.replace('CC.dbo.DispatchIncidents incident', fixture) + exec + response);
    assert.equal(synthetic.QuotedUnicodePreserved, true);
    assert.equal(synthetic.ExplicitUtcDates, true);
    const evidence = { method: 'Local SQLPage active configured connection; SELECT-only incident projection and isolated Node argument probe', checks: 6, passed: 6, databaseWrites: 0, bisRequests: 0, actualIncidentMetadata: actual, fixtureMetadata: synthetic };
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
    console.log('PASS: 6 read-only SQLPage/CLI checks; no database writes or BIS requests.');
  } finally {
    if (fs.existsSync(endpointFile)) fs.unlinkSync(endpointFile);
    if (fs.existsSync(probeFile)) fs.unlinkSync(probeFile);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
