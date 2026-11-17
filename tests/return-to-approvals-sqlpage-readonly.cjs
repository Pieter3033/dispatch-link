// Compile and exercise the endpoint's authorization/transition predicates using
// SELECT-only derivatives through SQLPage. Never invoke the mutation endpoint.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.env.RETURN_APPROVALS_SQL_SOURCE_PATH || path.join(__dirname, '../api/return_dispatch_to_approvals.sql'), 'utf8');
const started = source.slice(source.indexOf('SET return_approval_started_at'), source.indexOf('WITH admin_user'));
const firstCte = source.slice(source.indexOf('WITH admin_user'), source.indexOf('UPDATE incident'));
const from = source.slice(source.indexOf('FROM CC.dbo.DispatchIncidents incident'), source.indexOf(';', source.indexOf('FROM CC.dbo.DispatchIncidents incident')));
const response = source.slice(source.indexOf('WITH admin_user', source.indexOf('UPDATE incident')));
const predicate = firstCte + "SELECT 'json' AS component,(SELECT COUNT(*) AS WouldUpdate " + from + ' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS contents;';
const out = process.env.RETURN_APPROVALS_VERIFICATION_PATH || path.resolve(__dirname, '../outputs/return-approvals-feature-20261009');
fs.mkdirSync(out, { recursive: true });
const quote = s => String(s).split('\\').map(part => "N'" + part.replaceAll("'", "''") + "'").join('+NCHAR(92)+');
async function query(sql, parameters = {}) {
  const executable = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(executable, /\b(?:UPDATE|INSERT|DELETE|EXEC(?:UTE)?|ALTER|DROP|TRUNCATE|MERGE)\b/i, 'Only SELECT/SQLPage SET queries are permitted');
  const name = 'return-approvals-readonly-' + crypto.randomBytes(16).toString('hex') + '.sql';
  const file = path.resolve(__dirname, '../tmp', name);
  fs.writeFileSync(file, sql, { flag: 'wx' });
  try {
    const r = await fetch('http://127.0.0.1:8080/dispatch_link/tmp/' + name, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(parameters), signal: AbortSignal.timeout(45000) });
    const body = await r.text();
    if (!r.ok || !body.trim().startsWith('{')) throw Error('SQLPage read-only check failed HTTP ' + r.status + ': ' + [...new Set(body.match(/(?:Invalid column name|Invalid object name|Incorrect syntax near|Conversion failed)[^<\n]{0,100}/gi) || [])].join('; '));
    return JSON.parse(body);
  } finally { fs.unlinkSync(file); }
}
const expected = '2026-10-09T14:02:15.309';
function fixtures(sql, options = {}) {
  const c = { actor: 'CORP/admin', user: 'admin@example.invalid', role: 7, session: true, id: 355, deleted: 0, status: 'Approved', dispatchStatus: 'Dispatch Requested', updatedAt: `CONVERT(datetime2(3),${quote(expected)},126)`, updatedBy: 'CORP/admin', audit: false, cleared: false, ...options };
  const session = `(SELECT N'fixture-session' AS session_id,${quote(c.actor)} AS Username WHERE ${c.session ? 1 : 0}=1)`;
  const users = `(SELECT ${quote(c.user)} AS Username,${c.role} AS Usertype)`;
  const incident = `(SELECT ${c.id} AS id,${c.deleted} AS IsDeleted,${quote(c.status)} AS Status,${quote(c.dispatchStatus)} AS DispatchStatus,${c.updatedAt} AS UpdatedAt,${quote(c.updatedBy)} AS UpdatedBy,${c.cleared ? 'CAST(NULL AS datetime2(3))' : `CONVERT(datetime2(3),${quote(expected)},126)`} AS ApprovedAt,${c.cleared ? 'CAST(NULL AS nvarchar(128))' : "N'admin'"} AS ApprovedBy,${c.cleared ? 'CAST(NULL AS nvarchar(max))' : "N'Approved previously'"} AS ApprovalComments)`;
  const audit = `(SELECT 355 AS dispatch_id,N'Status' AS FieldName,N'Approved' AS OldValue,N'PendingApproval' AS NewValue,${quote(c.updatedBy)} AS AuditUsername,DATEADD(millisecond,1,SYSDATETIME()) AS CreatedAt WHERE ${c.audit ? 1 : 0}=1)`;
  return sql.replaceAll('sqlpage.cookie(\'session\')', "N'fixture-session'")
    .replace(/Current_session(?! current_session)/g, session + ' fixture_session')
    .replaceAll('Current_session', session).replaceAll('Jobcard.dbo.User_info', users)
    .replace(/CC\.dbo\.DispatchIncidents(?! incident)/g, incident + ' fixture_incident')
    .replaceAll('CC.dbo.DispatchIncidents', incident).replaceAll('CC.dbo.DispatchAuditLog', audit);
}
async function main() {
  const results = [];
  const params = { incidentId: '355', expectedUpdatedAt: expected };
  // Compile the real schema and authorization checks without any mutation.
  assert.equal((await query(predicate, params)).WouldUpdate, 0);
  assert.equal((await query(started + response, params)).status, 'unauthorized');
  results.push({ case: 'Real schema and SQLPage parameter compilation', passed: true });
  for (const [name, options, parameters, expectedCount] of [
    ['Admin approved/open', {}, {}, 1], ['Email session and domain account', { actor: 'ADMIN@example.invalid', user: 'CORP\\admin' }, {}, 1],
    ['Operator role', { role: 8 }, {}, 0], ['Unauthenticated', { session: false }, {}, 0],
    ['Different username', { user: 'other@example.invalid' }, {}, 0], ['Deleted', { deleted: 1 }, {}, 0],
    ['Draft', { status: 'Draft' }, {}, 0], ['Already pending', { status: 'PendingApproval' }, {}, 0],
    ['Closed', { dispatchStatus: 'Closed' }, {}, 0], ['Cancelled', { dispatchStatus: 'Cancelled' }, {}, 0],
    ['Stale version', {}, { expectedUpdatedAt: '2026-10-09T14:00:00' }, 0], ['Invalid version', {}, { expectedUpdatedAt: 'invalid' }, 0],
    ['Invalid ID', {}, { incidentId: 'invalid' }, 0]
  ]) {
    const r = await query(fixtures(predicate, options), { ...params, ...parameters });
    assert.equal(r.WouldUpdate, expectedCount, name);
    results.push({ case: name, passed: true });
  }
  for (const [name, options, parameters, expectedStatus] of [
    ['Unauthenticated response', { session: false }, {}, 'unauthorized'], ['Forbidden response', { role: 8 }, {}, 'forbidden'],
    ['Validation response', {}, { expectedUpdatedAt: 'invalid' }, 'validation_error'], ['Missing record', { id: 999 }, {}, 'not_found'],
    ['Deleted response', { deleted: 1 }, {}, 'not_found'], ['Stale response', {}, { expectedUpdatedAt: '2026-10-09T14:00:00' }, 'conflict'],
    ['Closed response', { dispatchStatus: 'Closed' }, {}, 'locked_status'], ['Cancelled response', { dispatchStatus: 'Cancelled' }, {}, 'locked_status'],
    ['Already pending response', { status: 'PendingApproval', cleared: true }, {}, 'locked_status'],
    ['Successful audited return', { status: 'PendingApproval', cleared: true, audit: true, updatedAt: 'CONVERT(datetime2(3),DATEADD(millisecond,1,SYSDATETIME()))' }, {}, 'ok'],
    ['Missing audit cannot report success', { status: 'PendingApproval', cleared: true, updatedAt: 'CONVERT(datetime2(3),DATEADD(millisecond,1,SYSDATETIME()))' }, {}, 'locked_status']
  ]) {
    const r = await query(fixtures(started + response, options), { ...params, ...parameters });
    assert.equal(r.status, expectedStatus, name);
    results.push({ case: name, passed: true });
  }
  fs.writeFileSync(path.join(out, 'sqlpage-readonly-verification.json'), JSON.stringify({ Connection: 'SQLPage active configured connection', DatabaseWrites: 0, Checks: results.length, Results: results, VerifiedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ Checks: results.length, Passed: results.length, DatabaseWrites: 0 }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
