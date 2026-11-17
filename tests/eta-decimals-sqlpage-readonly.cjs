// Evaluate the real ETA predicates with SELECT/VALUES only, through SQLPage's
// active configured connection. Never invoke the mutation endpoints themselves.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => {
  const staged = process.env.ETA_DECIMALS_SQL_SOURCE_ROOT && path.join(process.env.ETA_DECIMALS_SQL_SOURCE_ROOT, file);
  return fs.readFileSync(staged && fs.existsSync(staged) ? staged : path.join(root, file), 'utf8');
};
const literal = value => value === null ? 'CAST(NULL AS nvarchar(100))' : `N'${value.replaceAll("'", "''")}'`;

async function query(sql) {
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\b(?:UPDATE|INSERT|DELETE|EXEC(?:UTE)?|ALTER|CREATE|DROP|TRUNCATE|MERGE|OPENQUERY)\b/i);
  assert.doesNotMatch(sql, /203\.0\.113\.10|ExampleLinkedDatabase/i);
  const name = 'eta-decimals-readonly-' + crypto.randomBytes(12).toString('hex') + '.sql';
  const file = path.join(root, 'tmp', name);
  fs.writeFileSync(file, sql, { flag: 'wx' });
  try {
    const response = await fetch('http://127.0.0.1:8080/dispatch_link/tmp/' + name, {
      signal: AbortSignal.timeout(30000)
    });
    const body = await response.text();
    if (!response.ok || !body.trim().startsWith('{')) {
      throw Error('Read-only SQLPage check failed (HTTP ' + response.status + '); raw response withheld.');
    }
    return JSON.parse(body);
  } finally {
    fs.unlinkSync(file);
  }
}

async function main() {
  const endpoints = ['api/submit_incident.sql', 'api/compat/submit_incident.sql', 'api/approve_incident.sql'];
  const cases = [
    ['45', true], ['45.0', true], ['12.5', true], ['0.5', true], ['0.01', true],
    ['123.456789', true], ['0.000001', true], ['0', false], ['0.0', false],
    ['-1', false], ['-0.5', false], ['', false], [null, false],
    ['abc', false], ['12..5', false], ['12km', false], ['1e3', false], ['12,5', false]
  ];
  for (const endpoint of endpoints) {
    const etaChecks = read(endpoint).split(/\r?\n/).filter(line => /^\s+AND .*incident\.ETA/.test(line));
    assert.ok(etaChecks.length, 'Extract actual saved-row ETA guards from ' + endpoint);
    const predicate = etaChecks.map(line => line.replace(/^\s+AND /, '')).join(' AND ');
    const result = await query(`SELECT 'json' AS component, (
      SELECT fixture_id, ETA, CAST(CASE WHEN ${predicate} THEN 1 ELSE 0 END AS bit) AS accepted
      FROM (VALUES ${cases.map(([value], id) => `(${id}, ${literal(value)})`).join(',')}) incident(fixture_id, ETA)
      ORDER BY fixture_id FOR JSON PATH, ROOT('cases')
    ) AS contents;`);
    for (const [id, [, expected]] of cases.entries()) {
      assert.equal(result.cases[id].accepted, expected, endpoint + ' fixture ' + id);
    }
  }
  // Confirm the actual column supports decimals without altering its schema.
  const schema = await query(`SELECT 'json' AS component, (
    SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLength
    FROM CC.INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'DispatchIncidents' AND COLUMN_NAME = N'ETA'
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  ) AS contents;`);
  assert.equal(schema.dataType, 'nvarchar');
  assert.equal(schema.maxLength, 100);

  // Exercise the real save expressions on inline fixtures. Edits replace saved
  // values; omission preserves them; explicitly clearing a draft stores NULL.
  // No rows are saved, and no mutation endpoint is invoked.
  const saveCases = [
    ['12', '25.5', '25.5'], ['12.5', '0.5', '0.5'], [null, '0.5', '0.5'],
    ['12.5', null, '12.5'], ['12.5', '', null], ['12.5', ' 45.25 ', '45.25'],
    ['12.5', '123.456789', '123.456789'], ['12.5', '0.01', '0.01']
  ];
  for (const endpoint of ['api/save_incident.sql', 'api/compat/save_incident.sql']) {
    const expression = read(endpoint).match(/^\s+ETA = (.+),\r?$/m)?.[1];
    assert.ok(expression);
    const result = await query(`SELECT 'json' AS component, (
      SELECT fixture_id, ${expression.replaceAll(':eta', 'incident.incoming')} AS savedValue
      FROM (VALUES ${saveCases.map(([saved, incoming], id) => `(${id}, ${literal(saved)}, ${literal(incoming)})`).join(',')}) incident(fixture_id, ETA, incoming)
      ORDER BY fixture_id FOR JSON PATH, ROOT('cases')
    ) AS contents;`);
    for (const [id, [, , expected]] of saveCases.entries()) assert.equal(result.cases[id].savedValue ?? null, expected, endpoint + ' save fixture ' + id);
  }
  // Inspect only the ETA and status flags for the reported incident; no personal
  // fields are requested, and the incident's saved data is never changed.
  const incident = await query(`SELECT 'json' AS component, (
    SELECT CAST(CASE WHEN EXISTS (
      SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = 1473 AND IsDeleted = 0
        AND TRY_CONVERT(decimal(18,6), ETA) > 0
        AND TRY_CONVERT(decimal(18,6), ETA) <> FLOOR(TRY_CONVERT(decimal(18,6), ETA))
    ) THEN 1 ELSE 0 END AS bit) AS reportedIncidentHasPositiveFraction
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  ) AS contents;`);
  console.log(JSON.stringify({
    status: 'passed', predicates: endpoints, fixtureChecks: endpoints.length * cases.length,
    etaColumn: schema, savedValueEditChecks: saveCases.length * 2, ...incident
  }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
