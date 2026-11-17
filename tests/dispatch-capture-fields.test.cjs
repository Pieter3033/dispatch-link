const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = process.env.DISPATCH_CAPTURE_SOURCE_ROOT || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/dispatch.html'), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/^(?:async )?function \w+\(/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function helpers(extra = {}) {
  const context = vm.createContext({ state: {}, ...extra });
  for (const name of ['requiresDispatchCaptureFields', 'getDispatchCaptureFieldErrors']) vm.runInContext(functionSource(name), context);
  return context;
}
test('only new dispatches require the fields, including ETA-created drafts', () => {
  const c = helpers();
  for (const incident of [null, undefined, {}, { id: 2000, DispatchCaptureVersion: 1 }, { id: 2001, DispatchCaptureVersion: '1', RiskEventReference: 'ETA-TEST' }]) {
    assert.equal(c.requiresDispatchCaptureFields(incident), true);
  }
  for (const status of ['Draft', 'Rejected', 'PendingApproval', 'Approved']) {
    for (const version of [null, undefined]) assert.equal(c.requiresDispatchCaptureFields({ id: 123, Status: status, DispatchCaptureVersion: version }), false);
  }
});
test('drafts accept blanks and every explicit Positive VESA option; submissions require both values', () => {
  const c = helpers();
  assert.equal(c.getDispatchCaptureFieldErrors({}).length, 0);
  assert.equal(c.getDispatchCaptureFieldErrors({}, true).length, 2);
  for (const positiveVesa of ['Hijacked', 'Stolen', 'No']) {
    assert.equal(c.getDispatchCaptureFieldErrors({ actualDispatchReason: 'Ground team confirmed the incident', positiveVesa }, true).length, 0);
    assert.equal(c.getDispatchCaptureFieldErrors({ positiveVesa }, true).length, 1);
  }
  for (const value of ['Yes', 'hijacked', 'Not Applicable', 'Robbery']) assert.equal(c.getDispatchCaptureFieldErrors({ positiveVesa: value }).length, 1);
  assert.equal(c.getDispatchCaptureFieldErrors({ actualDispatchReason: '\t\r\n  ', positiveVesa: 'No' }, true).length, 1);
  assert.equal(c.getDispatchCaptureFieldErrors({ actualDispatchReason: 'x'.repeat(1000), positiveVesa: 'No' }, true).length, 0);
  assert.equal(c.getDispatchCaptureFieldErrors({ actualDispatchReason: 'x'.repeat(1001) }).length, 1);
});
test('form has a text box, a blank default, and exactly the three requested choices without blocking Save Draft', () => {
  const input = html.match(/<input name="actualDispatchReason"[^>]*>/)?.[0];
  assert.match(input, /maxlength="1000"/);
  assert.doesNotMatch(input, /\brequired\b/);
  const select = html.match(/<select name="positiveVesa"[\s\S]*?<\/select>/)?.[0];
  assert.deepEqual([...select.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]), ['', 'Hijacked', 'Stolen', 'No']);
  assert.doesNotMatch(select, /selected|\brequired\b/);
});
test('historical dispatches hide mandatory markers and empty summary tiles', () => {
  const markers = [{ hidden: false }, { hidden: false }];
  const summaries = [{ hidden: false }, { hidden: false }];
  const help = {};
  const c = helpers({
    elements: { form: { elements: { actualDispatchReason: { value: '' }, positiveVesa: { value: '' } }, querySelectorAll: () => markers, querySelector: () => help } },
    document: { querySelectorAll: () => summaries }
  });
  vm.runInContext(functionSource('syncDispatchCaptureFields'), c);
  c.syncDispatchCaptureFields({ id: 123, DispatchCaptureVersion: null });
  assert.ok(markers.every(m => m.hidden));
  assert.ok(summaries.every(m => m.hidden));
  assert.match(help.textContent, /optional/);
  c.syncDispatchCaptureFields({ id: 2000, DispatchCaptureVersion: 1 });
  assert.ok(markers.every(m => !m.hidden));
  assert.ok(summaries.every(m => !m.hidden));
  assert.match(help.textContent, /Drafts can be saved/);
});

function submissionSetup(version, values = {}) {
  const incident = { id: 2000, Status: 'Draft', DispatchCaptureVersion: version, RegNo: 'FIXTURE', MSTrackRegistrationExists: true };
  const fields = {
    eventDateTime: '2026-10-27T10:30', event: 'Accident', eta: '12.5', dispatchReason: 'Risk', regNo: 'FIXTURE', unitId: 'TEST',
    company: 'Fixture', geoLocation: 'Fixture', latitude: 'N/A', longitude: 'N/A', clientName: 'Fixture', clientContactNumber: '0000000000',
    dispatchTeam: 'Fixture', dispatchDateTime: '2026-10-27T10:35', obNumber: 'FIXTURE', standDownDateTime: '2026-10-27T11:30',
    vehicleRecovered: 'No', loadRecovered: 'No', vehicleKeyAvailable: 'No', trailersRecovered: 'No', driverOnScene: 'No', trackingUnitStatus: 'Fixture', zohoAccount: 'Fixture',
    ...values
  };
  const calls = [];
  const c = helpers({
    URLSearchParams,
    state: { selectedIncidentDetail: { incident }, currentUser: {}, hasUnsavedChanges: true },
    elements: { form: { values: fields, elements: {} } },
    FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } },
    api: { submitIncident: '/fixture/submit', incidentDetail: '/fixture/detail' },
    syncIncidentDateTimeValue() {}, normalizeCoordinateNotAvailable() {}, findZohoAccount: () => ({ label: 'Fixture' }), clientPoIsRequired: () => false,
    readAdditionalAssets: () => [], getMissingRequiredPhotoCategories: () => [],
    saveIncident: async () => calls.push('save'),
    requestJson: async (url, options) => { calls.push(url); return options ? { status: 'ok' } : { incident }; },
    showNotice() {}, populateForm() {}, renderDetailPanel() {}, loadIncidents() {}, loadPendingApprovals() {}, loadCompletedIncidents() {}
  });
  vm.runInContext(functionSource('submitSelectedIncident'), c);
  return { c, calls };
}
test('new incomplete dispatches cannot submit, while existing dispatches keep their previous submission behavior', async () => {
  const fresh = submissionSetup(1);
  await assert.rejects(fresh.c.submitSelectedIncident(), error => {
    assert.ok(error.details.missingFields.some(message => /Actual Reason/.test(message)));
    assert.ok(error.details.missingFields.some(message => /Positive VESA/.test(message)));
    return true;
  });
  assert.deepEqual(fresh.calls, []);
  const old = submissionSetup(null);
  await old.c.submitSelectedIncident();
  assert.equal(old.calls[0], 'save');
  assert.equal(old.calls[1], '/fixture/submit');
  for (const positiveVesa of ['Hijacked', 'Stolen', 'No']) {
    const fresh = submissionSetup(1, { actualDispatchReason: 'Ground team reason', positiveVesa });
    await fresh.c.submitSelectedIncident();
    assert.equal(fresh.calls[0], 'save');
    assert.equal(fresh.calls[1], '/fixture/submit');
  }
});
test('saves and reloads both values without letting a client change the historical exemption', () => {
  for (const file of ['api/save_incident.sql', 'api/compat/save_incident.sql']) {
    const sql = fs.readFileSync(path.join(root, file), 'utf8');
    const updateSet = sql.slice(sql.indexOf('SET\n') < 0 ? sql.indexOf('SET\r\n') : sql.indexOf('SET\n'), sql.indexOf('FROM CC.dbo.DispatchIncidents incident'));
    assert.match(updateSet, /ActualDispatchReason = CASE WHEN :actualDispatchReason IS NULL THEN incident\.ActualDispatchReason/);
    assert.match(updateSet, /PositiveVESA = CASE WHEN :positiveVesa IS NULL THEN incident\.PositiveVESA/);
    assert.doesNotMatch(updateSet, /DispatchCaptureVersion\s*=/);
    assert.doesNotMatch(sql, /:dispatchCaptureVersion/);
    assert.match(sql, /ActualDispatchReason, PositiveVESA, DispatchCaptureVersion/);
  }
  for (const file of ['api/dispatch_incident_detail.sql', 'api/compat/dispatch_incident_detail.sql']) {
    const sql = fs.readFileSync(path.join(root, file), 'utf8');
    for (const name of ['ActualDispatchReason', 'PositiveVESA', 'DispatchCaptureVersion']) assert.match(sql, new RegExp(`i\\.${name}`));
  }
  const eta = fs.readFileSync(path.join(root, 'api/select_eta_response.sql'), 'utf8');
  assert.match(eta, /SaveRequestId, EventDateTime, Event, ETA, DispatchCaptureVersion/);
  assert.match(eta, /CONVERT\(nvarchar\(30\), eta_response\.DistanceKm\),\s+1,/);
});
test('migration is additive, keeps historical values NULL, and sets the version only on future inserts', () => {
  const sql = fs.readFileSync(path.join(root, 'database/migrations/dispatch_capture_fields.sql'), 'utf8').replace(/--[^\n]*/g, '');
  assert.equal((sql.match(/\bALTER TABLE\b/gi) || []).length, 3);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE|WITH VALUES|NOT NULL|EXEC|DROP)\b/i);
  assert.match(sql, /ActualDispatchReason nvarchar\(1000\) NULL/);
  assert.match(sql, /PositiveVESA nvarchar\(20\) NULL/);
  assert.match(sql, /DispatchCaptureVersion tinyint NULL[\s\S]*DEFAULT \(1\)/);
});
