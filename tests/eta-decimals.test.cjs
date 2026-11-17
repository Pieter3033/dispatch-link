const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.ETA_DECIMALS_APP_SOURCE_PATH || path.join(root, 'public/app.js'), 'utf8');
const html = fs.readFileSync(process.env.ETA_DECIMALS_HTML_SOURCE_PATH || path.join(root, 'public/dispatch.html'), 'utf8');
const etaInput = html.match(/<input name="eta"[^>]*>/)[0];

function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Function ${name} exists`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/^(?:async )?function \w+\(/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function setup(eta = '12.5') {
  const calls = [];
  const values = new Map(Object.entries({
    eventDate: '2026-10-26', eventHour: '10', eventMinute: '30',
    eventDateTime: '2026-10-26T10:30', event: 'Test event', eta,
    dispatchReason: 'Test department', regNo: 'TEST-ETA', unitId: 'Fixture unit',
    company: 'Fixture company', geoLocation: 'Fixture location', latitude: '-26.2', longitude: '28.1',
    clientName: 'Fixture client', clientContactNumber: '0000000000', dispatchTeam: 'Fixture team',
    dispatchDateTime: '2026-10-26T11:00', obNumber: 'Fixture OB', standDownDateTime: '2026-10-26T12:00',
    vehicleRecovered: 'No', loadRecovered: 'No', vehicleKeyAvailable: 'No', trailersRecovered: 'No',
    driverOnScene: 'No', trackingUnitStatus: 'Fixture tracking', zohoAccount: 'Fixture account'
  }));
  const etaField = {
    value: eta, dataset: {}, attributes: {}, classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  };
  const form = { values, elements: { eta: etaField }, addEventListener(type, handler) { this[type] = handler; } };
  const incident = { id: 1, Status: 'Draft', RegNo: 'TEST-ETA', MSTrackRegistrationExists: true, dispatchMeta: { eta } };
  const context = vm.createContext({
    URLSearchParams, String, Number, Boolean, Date, Promise,
    FormData: class { constructor(form) { this.values = form.values; } get(name) { return this.values.get(name) ?? null; } },
    elements: { form }, state: { selectedIncidentDetail: { incident }, currentUser: {}, hasUnsavedChanges: true },
    api: { submitIncident: '/fixture/submit', incidentDetail: '/fixture/detail' },
    syncIncidentDateTimeValue() {}, normalizeCoordinateNotAvailable() {},
    findZohoAccount: () => ({ label: 'Fixture account' }), clientPoIsRequired: () => false,
    readAdditionalAssets: () => [], getMissingRequiredPhotoCategories: () => [],
    readCommunicationLogRows: () => ({ rows: [], deletedIds: [] }), readTimelineRows: () => ({ rows: [], deletedIds: [] }),
    dispatchTeamApiName: value => value,
    loadRegistrationLookup() { throw Error('Unexpected registration lookup'); },
    saveIncident: async () => calls.push({ save: true }),
    requestJson: async (url, options) => { calls.push({ url, options }); return options ? { status: 'ok' } : { incident }; },
    showNotice() {}, populateForm() {}, renderDetailPanel() {},
    loadIncidents() {}, loadPendingApprovals() {}, loadCompletedIncidents() {},
    updateDispatchPresentation() {}, updateDispatchSectionStatuses() {}, markDraftUnsaved() {}
  });
  for (const name of ['requiresDispatchCaptureFields', 'getDispatchCaptureFieldErrors', 'submitSelectedIncident', 'getIncidentPayloadFromForm', 'normalizeCapturedEta', 'syncEtaEditability']) {
    vm.runInContext(functionSource(name), context);
  }
  return { context, calls, form, values, etaField, incident };
}

const accepted = ['1', '45', '45.0', '12.5', '0.5', '0.01', '123.456789', '0.000001'];
const rejected = ['0', '0.0', '0.000000', '-1', '-0.5', 'abc', '12km', '12..5', '12,5', '1e3', 'NaN', 'Infinity'];

test('whole and fractional kilometres pass native form and submission validation without changing the saved value', async () => {
  const pattern = new RegExp(`^(?:${etaInput.match(/pattern="([^"]+)"/)[1]})$`, 'v');
  assert.match(etaInput, /inputmode="decimal"/);
  for (const value of accepted) {
    assert.equal(pattern.test(value), true, value);
    const f = setup(value);
    assert.equal(f.context.getIncidentPayloadFromForm().eta, value);
    await f.context.submitSelectedIncident();
    assert.equal(f.calls[0].save, true, 'Valid edits are saved before submission');
    assert.equal(f.calls[1].options.body.incidentId, 1);
    assert.equal(f.calls[1].options.method, 'POST');
  }
  for (const value of rejected) assert.equal(pattern.test(value), false, value);
});

test('invalid and missing ETAs cannot trigger a save or submission', async () => {
  for (const value of [...rejected, '', '   ']) {
    const f = setup(value);
    await assert.rejects(f.context.submitSelectedIncident(), error =>
      error.details?.missingFields.some(message => /First ETA/.test(message)));
    assert.equal(f.calls.length, 0, value);
  }
});

test('other required fields, coordinate ranges and evidence still block submission', async () => {
  for (const [name, value, message] of [
    ['company', '', 'Company is required'], ['latitude', '91', 'Latitude must be between'],
    ['longitude', '-181', 'Longitude must be between'], ['obNumber', '', 'Dispatch Team OB No is required']
  ]) {
    const f = setup();
    f.values.set(name, value);
    await assert.rejects(f.context.submitSelectedIncident(), error =>
      error.details?.missingFields.some(actual => actual.includes(message)));
    assert.equal(f.calls.length, 0);
  }
  const f = setup();
  f.context.getMissingRequiredPhotoCategories = () => ['LicenseDisk'];
  await assert.rejects(f.context.submitSelectedIncident(), error => error.details?.missingPhotos.includes('LicenseDisk'));
  assert.equal(f.calls.length, 0);
});

test('decimal ETA keeps explicit N/A coordinates and status restrictions intact', async () => {
  const f = setup();
  f.values.set('latitude', 'N/A');
  f.values.set('longitude', 'N/A');
  await f.context.submitSelectedIncident();
  assert.equal(f.calls[1].options.body.latitudeNotAvailable, '1');
  assert.equal(f.calls[1].options.body.longitudeNotAvailable, '1');
  const approved = setup();
  approved.incident.Status = 'Approved';
  await assert.rejects(approved.context.submitSelectedIncident(), /already been approved/);
  assert.equal(approved.calls.length, 0);
});

test('saved decimal ETA remains exact and editable, including ETA request drafts', () => {
  const f = setup();
  for (const value of ['12.5', '0.5', '123.456789']) {
    assert.equal(f.context.normalizeCapturedEta(value), value);
    f.incident.dispatchMeta.eta = value;
    f.incident.SaveRequestId = 'ETA_REQUEST_1';
    f.context.syncEtaEditability(f.incident);
    assert.equal(f.etaField.readOnly, false);
    assert.equal(f.etaField.attributes['aria-readonly'], undefined);
    assert.equal(f.etaField.dataset.capturedLock, undefined);
  }
  assert.equal(f.context.normalizeCapturedEta('45.0'), '45');
  f.context.syncEtaEditability({ ETA: '0.5', Status: 'Draft' });
  assert.equal(f.etaField.readOnly, false);
  f.context.syncEtaEditability(null);
  assert.equal(f.etaField.readOnly, false);
});

test('ETA editing follows dispatch status and view mode, including reopening returned reports', () => {
  const f = setup();
  for (const status of ['Draft', 'Rejected', 'PendingApproval', 'Approved']) {
    for (const dispatchStatus of ['Dispatch Requested', 'Dispatched', 'Stood Down', 'Closed', 'Cancelled']) {
      for (const viewOnly of [false, true]) {
        f.context.state.viewOnly = viewOnly;
        f.context.syncEtaEditability({ ...f.incident, Status: status, DispatchStatus: dispatchStatus });
        const locked = viewOnly || status === 'Approved' || ['Closed', 'Cancelled'].includes(dispatchStatus);
        assert.equal(f.etaField.readOnly, locked, `${status}, ${dispatchStatus}, viewOnly ${viewOnly}`);
        assert.equal(f.etaField.attributes['aria-readonly'], locked ? 'true' : undefined);
      }
    }
  }
  f.context.state.viewOnly = false;
  f.context.syncEtaEditability({ Status: 'Approved', ETA: '12.5' });
  assert.equal(f.etaField.readOnly, true);
  f.context.syncEtaEditability({ Status: 'PendingApproval', ETA: '12.5' });
  assert.equal(f.etaField.readOnly, false);
});

test('input handling preserves decimal points and retains digit-only behavior on other fields', () => {
  const f = setup();
  const start = source.indexOf('  elements.form?.addEventListener("input",');
  const end = source.indexOf('  window.addEventListener("pagehide",', start);
  vm.runInContext(source.slice(start, end), f.context);
  const field = (value, digitsOnly = false) => ({
    name: digitsOnly ? 'clientPo' : 'eta', value,
    matches(selector) {
      return selector === '[data-digits-only]' ? digitsOnly
        : selector === '[data-positive-integer]' && !digitsOnly && etaInput.includes('data-positive-integer');
    },
    closest: () => null
  });
  for (const value of ['12.', '12.5', '0.', '0.5', '0.01']) {
    const target = field(value);
    f.form.input({ target });
    assert.equal(target.value, value);
  }
  const target = field('12.5A', true);
  f.form.input({ target });
  assert.equal(target.value, '125');
});

test('incident reports retain fractional and whole kilometre values from supplied data', async () => {
  // Supply fixture data directly; the renderer does not fetch database records.
  const { Writable } = require('node:stream');
  const PDFDocument = require('pdfkit');
  const { generateIncidentReport } = require(path.join(process.env.DISPATCH_SQLPAGE_WORKSPACE || root, 'src/services/incidentReportService'));
  const originalText = PDFDocument.prototype.text;
  const seen = [];
  PDFDocument.prototype.text = function(value) {
    seen.push(String(value));
    return originalText.apply(this, arguments);
  };
  try {
    for (const eta of ['12.5', '0.5', '45']) {
      seen.length = 0;
      const output = new Writable({ write(chunk, encoding, done) { done(); } });
      const finished = new Promise((resolve, reject) => { output.once('finish', resolve); output.once('error', reject); });
      await generateIncidentReport({
        incident: { RegNo: 'TEST-ETA', EventDateTime: '2026-10-26T10:30:00Z', ETA: eta },
        photos: [], timeline: [], communications: []
      }, output);
      await finished;
      assert.ok(seen.includes(eta), 'Report must retain ETA ' + eta);
    }
  } finally {
    PDFDocument.prototype.text = originalText;
  }
});
