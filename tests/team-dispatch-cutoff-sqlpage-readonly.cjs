// Verify the actual endpoint through the local SQLPage configured connection.
// Fixtures are SELECT/VALUES expressions; no records or sessions are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'api/team_active_dispatches.sql'), 'utf8');
const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "N'" + value.replaceAll("'", "''") + "'";
const date = value => `CONVERT(datetime2, ${literal(value)}, 126)`;
const table = (columns, rows) => `(SELECT * FROM (VALUES ${rows.map(row => '(' + row.join(',') + ')').join(',')}) fixture(${columns.join(',')}))`;

async function query(sql, params = {}) {
  const executable = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(executable, /\b(?:UPDATE|INSERT|DELETE|EXEC(?:UTE)?|ALTER|DROP|TRUNCATE|MERGE|OPENQUERY)\b/i);
  const name = 'team-cutoff-readonly-' + crypto.randomBytes(12).toString('hex') + '.sql';
  const file = path.join(root, 'tmp', name);
  const jsonSql = sql.replace('SELECT (\nSELECT', "SELECT 'json' AS component, (\nSELECT").replace(/\) AS json;\s*$/, ') AS contents;');
  assert.notEqual(jsonSql, sql, 'Wrap the endpoint response as raw JSON');
  fs.writeFileSync(file, jsonSql, { flag: 'wx' });
  try {
    const response = await fetch('http://127.0.0.1:8080/dispatch_link/tmp/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params), signal: AbortSignal.timeout(30000)
    });
    const body = await response.text();
    if (!response.ok || !body.trim().startsWith('{')) {
      // Withhold raw responses because the real-schema check uses the configured database.
      throw new Error('Read-only SQLPage verification failed (HTTP ' + response.status + ').');
    }
    return JSON.parse(body);
  } finally {
    fs.unlinkSync(file);
  }
}

function fixtures(teamCode, extraCount = 0) {
  const teamName = 'Fixture ' + teamCode;
  const old = '2026-10-21T23:59:59';
  const today = '2026-10-22T00:00:00';
  const future = '2026-10-23T12:00:00';
  const rows = [
    [1001, old, old], [1002, today, old], [1003, future, old],
    [1004, null, old], [1005, null, today], [1006, null, old], [1007, null, today],
    [1008, old, old, 'OB-COMPLETE'], [1009, old, old, 'OB-ONLY'], [1010, old, old],
    [1011, today, today, 'OB-COMPLETE'], [1012, null, null], [1013, old, old],
    [1014, today, today, null, 1], [1015, today, today, null, 0, 'Other fixture team'],
    [35, today, today],
    ...Array.from({ length: extraCount }, (_, i) => [2000 + i, future, today])
  ];
  const incidents = table([
    'id', 'IncidentNumber', 'RiskEventReference', 'SaveRequestId', 'RegNo', 'Event',
    'DispatchStatus', 'ClosureApprovalStatus', 'EventDateTime', 'DispatchDateTime',
    'StandDownDateTime', 'GeoLocation', 'Latitude', 'Longitude', 'ETA', 'CreatedAt',
    'OBNumber', 'UpdatedAt', 'DispatchTeam', 'IsDeleted'
  ], rows.map(([id, dispatchAt, createdAt, ob = null, deleted = 0, assigned = teamName]) => [
    id, literal('FIXTURE-' + id), "CAST(NULL AS nvarchar(100))", "CAST(NULL AS nvarchar(100))",
    literal('REG-' + id), "N'Fixture event'", "N'Dispatched'", "CAST(NULL AS nvarchar(100))",
    date(old), date(dispatchAt), date(null), "N'Fixture location'", 'CAST(NULL AS decimal(10,6))',
    'CAST(NULL AS decimal(10,6))', "N'10'", date(createdAt), `CAST(${literal(ob)} AS nvarchar(100))`,
    date(future), literal(assigned), deleted
  ]));
  const etaRequests = table([
    'DispatchIncidentId', 'SelectedTeamId', 'RequestStatus', 'RequestNumber',
    'Registration', 'ShortDescription', 'Latitude', 'Longitude', 'SelectedDistanceKm', 'SelectedAt'
  ], [[1005, old], [1006, today], [1013, today]].map(([id, selected]) => [
    id, 1, "N'Selected'", literal('ETA-FIXTURE-' + id), "N'Fixture registration'", "N'Fixture event'",
    'CAST(NULL AS decimal(10,6))', 'CAST(NULL AS decimal(10,6))', 10, date(selected)
  ]));
  const reports = table([
    'dispatch_id', 'IsDeleted', 'FileType', 'id', 'OriginalFileName', 'MimeType', 'UploadedAt', 'UploadedBy', 'FilePath'
  ], [1008, 1010, 1011].map(id => [
    id, 0, "N'TeamIncidentReport'", id, "N'fixture.pdf'", "N'application/pdf'", date(today), "N'fixture'", "N'/fixture.pdf'"
  ]));
  return source.replaceAll("sqlpage.cookie('session')", "N'fixture-session'")
    .replaceAll('Current_session', "(SELECT N'fixture-user' AS Username, N'fixture-session' AS session_id) fixture_session")
    .replaceAll('Jobcard.dbo.User_info', `(SELECT N'fixture-user' AS Username, 11 AS Usertype, ${literal(teamCode)} AS DispatchTeamCode, 1 AS Seqno)`)
    .replaceAll('CC.dbo.DispatchTeams', `(SELECT 1 AS TeamId, ${literal(teamCode)} AS TeamCode, ${literal(teamName)} AS TeamName, 1 AS IsActive)`)
    .replaceAll('CC.dbo.DispatchIncidents', incidents)
    .replaceAll('CC.dbo.DispatchEtaRequests', etaRequests)
    .replaceAll('CC.dbo.DispatchIncidentFiles', reports);
}

async function main() {
  const results = [];
  const real = await query(source, { view: 'active', page: '1' });
  assert.equal(real.context.role, 'None');
  assert.deepEqual(real.dispatches, []);
  results.push('Actual database schema and SQLPage parameters compile; unauthenticated access remains empty');
  for (const teamCode of ['CapitalFixture', 'PanC', 'OtherFixture']) {
    const sql = fixtures(teamCode);
    const active = await query(sql, { view: 'active', page: '1' });
    const expected = [1002, 1003, 1006, 1007, ...(teamCode === 'PanC' ? [] : [35])].sort((a, b) => a - b);
    assert.deepEqual(active.dispatches.map(row => row.id).sort((a, b) => a - b), expected);
    assert.equal(active.summary.activeCount, expected.length);
    assert.equal(active.summary.filteredCount, expected.length);
    assert.equal(active.summary.completedCount, 2);
    results.push(teamCode + ': fixed midnight cutoff, future dates, selection/creation fallback, edited legacy rows, deleted rows and other teams');
    const completed = await query(sql, { view: 'completed', page: '1' });
    assert.deepEqual(completed.dispatches.map(row => row.id).sort((a, b) => a - b), [1008, 1011]);
    assert.equal(completed.summary.filteredCount, 2);
    results.push(teamCode + ': completed history preserved before and after cutoff');
    const hiddenSearch = await query(sql, { view: 'active', search: 'REG-1001', page: '1' });
    assert.deepEqual(hiddenSearch.dispatches, []);
    assert.equal(hiddenSearch.summary.filteredCount, 0);
    const obSearch = await query(sql, { view: 'active', search: 'OB-ONLY', page: '1' });
    assert.deepEqual(obSearch.dispatches, []);
    results.push(teamCode + ': registration and OB search cannot restore legacy active dispatches');
  }
  const paginated = fixtures('CapitalFixture', 12);
  const first = await query(paginated, { view: 'active', page: '1' });
  const second = await query(paginated, { view: 'active', page: '2' });
  assert.equal(first.summary.activeCount, 17);
  assert.equal(first.summary.filteredCount, 17);
  assert.equal(first.dispatches.length, 10);
  assert.equal(second.dispatches.length, 7);
  assert.equal(new Set([...first.dispatches, ...second.dispatches].map(row => row.id)).size, 17);
  results.push('Counts and pagination use the same visible dispatches without gaps or duplicates');
  console.log(JSON.stringify({ passed: results.length, databaseWrites: 0, results }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
