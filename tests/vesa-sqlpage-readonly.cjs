// SELECT/VALUES only; all SQL runs through the existing local SQLPage connection.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const endpoint = fs.readFileSync(path.join(root, 'api/vesa_dispatches.sql'), 'utf8');
function safe(sql) {
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\b(?:UPDATE|INSERT|DELETE|EXEC(?:UTE)?|ALTER|CREATE|DROP|TRUNCATE|MERGE|OPENQUERY)\b/i);
  assert.doesNotMatch(sql, /203\.0\.113\.10|ExampleLinkedDatabase/i);
}
async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const body = await response.text();
  assert.ok(response.ok, `Read-only SQLPage request returned HTTP ${response.status}`);
  // SQLPage may render the single JSON result in a table cell.
  const raw = body.trim().startsWith('{') ? body.trim() : body.match(/<td[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  assert.ok(raw, 'SQLPage returned a JSON value');
  return JSON.parse(raw.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
}
async function query(sql) {
  safe(sql);
  const name = `vesa-readonly-${crypto.randomBytes(12).toString('hex')}.sql`;
  const file = path.join(root, 'tmp', name);
  fs.writeFileSync(file, sql, { flag: 'wx' });
  try { return await readJson('http://127.0.0.1:8080/dispatch_link/tmp/' + name); }
  finally { fs.unlinkSync(file); }
}
const literal = value => value === null ? 'NULL' : `N'${String(value).replaceAll("'", "''")}'`;
async function main() {
  safe(endpoint);
  const anonymous = await readJson('http://127.0.0.1:8080/dispatch_link/api/vesa_dispatches.sql');
  assert.equal(anonymous.status, 'unauthorized');
  assert.deepEqual(anonymous.incidents, []);
  const predicate = endpoint.match(/WHERE access_check\.status = N'ok'([\s\S]*?)\s+ORDER BY/)[1];
  const cases = [];
  for (const event of ['Hijacking', 'Armed Robbery', 'Vehicle Theft', 'Accident', null])
    for (const status of ['Approved', 'Draft', 'PendingApproval', 'Rejected'])
      for (const dispatchStatus of ['Closed', 'Stood Down', 'Cancelled', null])
        for (const deleted of [0, 1])
          for (const positiveVesa of [null, '', 'No', 'Hijacked', 'Stolen', 'Yes', 'hijacked']) cases.push({ event, status, dispatchStatus, deleted, positiveVesa,
            expected: ['Hijacked', 'Stolen'].includes(positiveVesa) && status === 'Approved' && dispatchStatus !== 'Cancelled' && deleted === 0 });
  for (let start = 0; start < cases.length; start += 400) {
    const batch = cases.slice(start, start + 400);
    const result = await query(`SELECT 'json' AS component, (
      SELECT fixture_id, CAST(CASE WHEN 1 = 1 ${predicate} THEN 1 ELSE 0 END AS bit) AS included
      FROM (VALUES ${batch.map((c, id) => `(${id}, ${literal(c.event)}, ${literal(c.status)}, ${literal(c.dispatchStatus)}, ${c.deleted}, ${literal(c.positiveVesa)})`).join(',')}) i(fixture_id, Event, Status, DispatchStatus, IsDeleted, PositiveVESA)
      ORDER BY fixture_id FOR JSON PATH, ROOT('cases')
    ) AS contents;`);
    for (const [id, c] of batch.entries()) assert.equal(result.cases[id].included, c.expected, `Filter fixture ${start + id}`);
  }
  const access = endpoint.slice(endpoint.indexOf('access_check AS'), endpoint.indexOf('\nSELECT\n    access_check.status') === -1 ? endpoint.indexOf('\r\nSELECT\r\n    access_check.status') : endpoint.indexOf('\nSELECT\n    access_check.status'));
  const roleCases = [[7, 0, 'ok'], [7, 1, 'ok'], [0, 0, 'forbidden'], [8, 0, 'forbidden'], [14, 0, 'forbidden'], [1, 1, 'forbidden'], [1, 0, 'forbidden'], [11, 0, 'forbidden'], [12, 0, 'forbidden'], [13, 0, 'forbidden']];
  for (const [type, helpdesk, expected] of roleCases) {
    const result = await query(`WITH resolved_user AS (SELECT ${type} AS Usertype, ${helpdesk} AS Helpdesk), ${access} SELECT 'json' AS component, (SELECT status FROM access_check FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents;`);
    assert.equal(result.status, expected, `Role ${type}, helpdesk ${helpdesk}`);
    if (expected === 'forbidden') {
      // Exercise the full response as a non-admin, including its data gate.
      const response = endpoint.slice(endpoint.search(/^SELECT\r?\n    access_check\.status/m)).trim().replace(/;$/, '');
      const denied = await query(`WITH resolved_user AS (SELECT ${type} AS Usertype, ${helpdesk} AS Helpdesk), ${access}
        SELECT 'json' AS component, (${response}) AS contents;`);
      assert.equal(denied.status, 'forbidden');
      assert.deepEqual(denied.incidents, []);
    }
  }
  console.log(JSON.stringify({ status: 'passed', filterFixtures: cases.length, roleFixtures: roleCases.length, anonymousAccess: 'blocked' }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
