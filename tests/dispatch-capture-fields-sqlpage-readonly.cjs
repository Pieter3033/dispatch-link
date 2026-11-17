// Executes SELECT/VALUES fixtures only, using local SQLPage's configured connection.
// Never invokes save, submit, approval, ETA selection, or migration endpoints.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = process.env.DISPATCH_CAPTURE_SOURCE_ROOT || path.resolve(__dirname, '..');
const workspace = process.env.DISPATCH_SQLPAGE_WORKSPACE || process.cwd();
const literal = value => value === null ? 'NULL' : `N'${String(value).replaceAll("'", "''")}'`;
async function query(sql) {
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\b(?:UPDATE|INSERT|DELETE|EXEC(?:UTE)?|ALTER|CREATE|DROP|TRUNCATE|MERGE|OPENQUERY)\b/i);
  assert.doesNotMatch(sql, /203\.0\.113\.10|ExampleLinkedDatabase/i);
  const name = `dispatch-capture-readonly-${crypto.randomBytes(12).toString('hex')}.sql`;
  const file = path.join(workspace, 'tmp', name);
  fs.writeFileSync(file, sql, { flag: 'wx' });
  try {
    const response = await fetch('http://127.0.0.1:8080/dispatch_link/tmp/' + name, { signal: AbortSignal.timeout(30000) });
    const raw = await response.text();
    assert.ok(response.ok && raw.trim().startsWith('{'), `Read-only fixture failed (HTTP ${response.status}); raw response withheld.`);
    return JSON.parse(raw);
  } finally { fs.unlinkSync(file); }
}
async function main() {
  let checks = 0;
  const cases = [];
  for (const version of [null, 1]) for (const reason of [null, '', '   ', '\t\r\n', '\u00a0', 'Ground team confirmed the incident', 'x'.repeat(1000), 'x'.repeat(1001), '😀'.repeat(500), '😀'.repeat(501)])
    for (const positive of [null, '', 'Hijacked', 'Stolen', 'No', 'Yes', 'hijacked']) cases.push({ version, reason, positive,
      expected: version === null || Boolean(reason?.trim() && reason.length <= 1000 && ['Hijacked', 'Stolen', 'No'].includes(positive)) });
  for (const file of ['api/submit_incident.sql', 'api/compat/submit_incident.sql', 'api/approve_incident.sql']) {
    const sql = fs.readFileSync(path.join(root, file), 'utf8');
    const guard = sql.match(/-- Existing dispatches keep a NULL version and remain exempt\.\s+AND \(([\s\S]*?)\n  \)/)?.[1];
    assert.ok(guard, file);
    const response = await query(`SELECT 'json' AS component, (
      SELECT fixture_id, CAST(CASE WHEN (${guard}) THEN 1 ELSE 0 END AS bit) AS allowed
      FROM (VALUES ${cases.map((c, i) => `(${i}, ${c.version ?? 'NULL'}, ${literal(c.reason)}, ${literal(c.positive)})`).join(',')}) incident(fixture_id, DispatchCaptureVersion, ActualDispatchReason, PositiveVESA)
      ORDER BY fixture_id FOR JSON PATH, ROOT('cases')
    ) AS contents;`);
    for (const [i, c] of cases.entries()) assert.equal(response.cases[i].allowed, c.expected, `${file}, fixture ${i}`);
    checks += cases.length;
  }
  for (const file of ['api/save_incident.sql', 'api/compat/save_incident.sql']) {
    const sql = fs.readFileSync(path.join(root, file), 'utf8');
    const guards = [...sql.matchAll(/-- Drafts may omit these values; supplied values must be valid\.([\s\S]*?\n  \))/g)].map(m => m[1]);
    assert.equal(guards.length, 2, 'Separate create and update draft guards');
    for (const guard of guards) {
      const predicate = guard.replaceAll(':actualDispatchReason', 'fixture.reason').replaceAll(':positiveVesa', 'fixture.positive');
      const response = await query(`SELECT 'json' AS component, (
        SELECT fixture_id, CAST(CASE WHEN 1 = 1 ${predicate} THEN 1 ELSE 0 END AS bit) AS allowed
        FROM (VALUES ${cases.map((c, i) => `(${i}, ${literal(c.reason)}, ${literal(c.positive)})`).join(',')}) fixture(fixture_id, reason, positive)
        ORDER BY fixture_id FOR JSON PATH, ROOT('cases')
      ) AS contents;`);
      for (const [i, c] of cases.entries()) {
        const expected = String(c.reason ?? '').replace(/^ +| +$/g, '').length <= 1000 && (c.positive === null || c.positive === '' || ['Hijacked', 'Stolen', 'No'].includes(c.positive));
        assert.equal(response.cases[i].allowed, expected, `${file}, draft fixture ${i}`);
      }
      checks += cases.length;
    }
    for (const [field, parameter, value] of [['ActualDispatchReason', 'actualDispatchReason', 'Existing ground team reason'], ['PositiveVESA', 'positiveVesa', 'No']]) {
      const expression = sql.match(new RegExp(`^    ${field} = (.*),\\r?$`, 'm'))[1];
      const preserved = await query(`SELECT 'json' AS component, (
        SELECT ${expression.replaceAll(':' + parameter, 'CAST(NULL AS nvarchar(1000))')} AS savedValue
        FROM (VALUES (${literal(value)})) incident(${field}) FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
      ) AS contents;`);
      assert.equal(preserved.savedValue, value, 'Omitted optional field preserves existing saved value');
      checks += 1;
    }
  }
  console.log(JSON.stringify({ status: 'passed', savedAndDraftFixtures: checks, databaseWrites: 0 }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
