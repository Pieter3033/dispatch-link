// Test ETA identity/register/response mappings through SQLPage's configured connection.
// Execute SELECT-only extracts; never call the response mutation endpoint.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'api', file), 'utf8').replaceAll('\r\n', '\n');
const identity = read('current_user.sql');
const register = read('eta_requests.sql');
const respond = read('save_eta_response.sql');
const quote = text => "N'" + text.replaceAll("'", "''") + "'";

function identityProjection(source) {
  const end = source.indexOf('\nSELECT\n    CAST(1 AS bit)');
  const joinStart = source.indexOf('FROM resolved_user\n        LEFT JOIN');
  const joinEnd = source.indexOf('FOR JSON PATH, WITHOUT_ARRAY_WRAPPER', joinStart);
  assert.ok(end > 0 && joinStart > end && joinEnd > joinStart);
  return source.slice(0, end) + `
SELECT 'json' AS component, COALESCE((SELECT resolved_user.Usertype AS userType,
  team.TeamId AS teamId, team.TeamCode AS teamCode, COALESCE(team.IsActive, 0) AS teamIsActive
  ${source.slice(joinStart, joinEnd)} FOR JSON PATH, WITHOUT_ARRAY_WRAPPER), N'{}') AS contents;`;
}
function registerProjection(source) {
  const end = source.indexOf(',\nscoped_requests AS');
  assert.ok(end > 0);
  return source.slice(0, end) + `
SELECT 'json' AS component, (SELECT AccessRole AS role, TeamId AS teamId,
  TeamCode AS teamCode, TeamIsActive AS teamIsActive FROM access_context
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents;`;
}
function responseProjection(source) {
  const end = source.indexOf('SET eta_respond_status');
  assert.ok(end > 0);
  return source.slice(0, end) + `SELECT 'json' AS component,
    (SELECT TRY_CONVERT(int, $eta_respond_team_id) AS teamId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents;`;
}
const projections = [identityProjection(identity), registerProjection(register), responseProjection(respond)];

async function query(sql, parameters = {}) {
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\b(?:INSERT|UPDATE|DELETE|EXEC(?:UTE)?|ALTER|DROP|CREATE|MERGE|TRUNCATE|OPENQUERY)\b/i);
  const name = 'eta-mapping-readonly-' + crypto.randomBytes(12).toString('hex') + '.sql';
  const file = path.join(root, 'tmp', name);
  fs.writeFileSync(file, sql, { flag: 'wx' });
  try {
    const response = await fetch('http://127.0.0.1:8080/dispatch_link/tmp/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters), signal: AbortSignal.timeout(30000)
    });
    const body = await response.text();
    if (!response.ok || !body.trim().startsWith('{')) throw Error('ETA mapping read-only check failed (HTTP ' + response.status + '); raw response withheld.');
    return JSON.parse(body);
  } finally { fs.unlinkSync(file); }
}

function fixtures(sql, options = {}) {
  const c = { code: 'CA_FIXTURE', company: '', role: 11, active: 1, session: true, ...options };
  return sql.replaceAll("sqlpage.cookie('session')", "N'fixture-session'")
    .replace(/Current_session current_session/g, `(SELECT N'fixture-user' AS Username, N'fixture-session' AS session_id WHERE ${c.session ? 1 : 0}=1) current_session`)
    .replace(/Current_session(?! current_session)/g, `(SELECT N'fixture-user' AS Username, N'fixture-session' AS session_id WHERE ${c.session ? 1 : 0}=1) fixture_session`)
    .replaceAll('Jobcard.dbo.User_info', `(SELECT 1 AS Seqno, N'fixture-user' AS Username, N'Fixture' AS Name, N'User' AS Surname, ${c.role} AS Usertype, 0 AS Helpdesk, ${quote(c.code)} AS DispatchTeamCode, ${quote(c.company)} AS Company)`)
    .replaceAll('CC.dbo.DispatchTeams', `(SELECT 19 AS TeamId, N'CA_FIXTURE' AS TeamCode, N'Fixture team' AS TeamName, ${c.active} AS IsActive)`);
}

async function main() {
  let passed = 0;
  // Compile the real schema/parameters without needing or reading any live session cookie.
  for (const sql of projections) { const result = await query(sql); assert.equal(result.teamId, undefined); passed++; }
  for (const [options, expectedId, expectedRole] of [
    [{}, 19, 'DispatchTeam'],
    [{ code: ' ca_fixture ' }, 19, 'DispatchTeam'],
    [{ code: '', company: 'Fixture team' }, undefined, 'None'],
    [{ code: 'UNKNOWN', company: 'Fixture team' }, undefined, 'None'],
    [{ role: 2 }, undefined, 'None'],
    [{ role: 7 }, undefined, 'CallCentre'],
    [{ active: 0 }, 19, 'DispatchTeam'],
    [{ session: false }, undefined, 'None']
  ]) {
    const [current, list, save] = await Promise.all(projections.map(sql => query(fixtures(sql, options))));
    assert.equal(current.teamId, expectedId, 'Current user team mapping');
    assert.equal(list.teamId, expectedId, 'ETA register team mapping');
    assert.equal(list.role, expectedRole, 'ETA register access role');
    assert.equal(save.teamId, options.active === 0 ? undefined : expectedId, 'ETA response requires an active allocated team');
    passed += 3;
  }
  // Inspect allocations without logging usernames, company/contact data or session IDs.
  const profiles = await query(`SELECT 'json' AS component, (
    SELECT user_info.Seqno AS profileId, team.TeamId AS teamId, team.TeamCode AS teamCode,
      CAST(CASE WHEN LOWER(LTRIM(RTRIM(COALESCE(user_info.Company, N'')))) = LOWER(LTRIM(RTRIM(team.TeamName))) THEN 1 ELSE 0 END AS bit) AS legacyCompanyMatches
    FROM Jobcard.dbo.User_info user_info
    JOIN CC.dbo.DispatchTeams team ON LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(user_info.DispatchTeamCode)))
    WHERE TRY_CONVERT(int, user_info.Usertype) = 11 AND team.IsActive = 1
    FOR JSON PATH, ROOT('profiles')) AS contents;`);
  const activeProfiles = profiles.profiles || [];
  assert.ok(activeProfiles.length > 0, 'Existing active ground-team allocations are present');
  for (const profile of activeProfiles) {
    for (const sql of projections) {
      // A SELECT-derived fixture identity exercises the existing allocation; no real session is accessed or created.
      const derivative = sql.replaceAll("sqlpage.cookie('session')", "N'fixture-session'")
        .replace(/Current_session current_session/g, `(SELECT Username, N'fixture-session' AS session_id FROM Jobcard.dbo.User_info WHERE Seqno = TRY_CONVERT(int, :profileId)) current_session`)
        .replace(/Current_session(?! current_session)/g, `(SELECT Username, N'fixture-session' AS session_id FROM Jobcard.dbo.User_info WHERE Seqno = TRY_CONVERT(int, :profileId)) fixture_session`);
      assert.equal((await query(derivative, { profileId: String(profile.profileId) })).teamId, profile.teamId);
      passed++;
    }
  }
  console.log(JSON.stringify({ passed, databaseWrites: 0, activeGroundTeamProfilesVerified: activeProfiles.length,
    profilesRequiringCodeMapping: activeProfiles.filter(profile => !profile.legacyCompanyMatches).length,
    coverage: 'Current user, ETA register and response permission all use explicit team allocation; invalid, inactive, unassigned and non-team profiles remain restricted' }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
