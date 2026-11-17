// Regression tests use the actual development save functions and an in-memory
// SQLPage API model. They never connect to a database or call mutation routes.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const source = fs.readFileSync('public/app.js', 'utf8');
function definition(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Missing ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/^(?:async )?function /m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
const code = ['saveIncident', 'saveCommunicationRow', 'persistIncident'].map(definition).join('\n');
const log = (rowKey, displayOrder, extra = {}) => ({ rowKey, id: null, displayOrder,
  communicationDate: '2026-10-05', communicationTime: '08:00', communicationType: 'Internal Note',
  controlRoomAgent: 'Test agent', contactPerson: '', contactNumber: '', emailAddress: '',
  communicationNotes: 'Test communication', ...extra });
const contentFields = ['communicationDate', 'communicationTime', 'communicationType', 'controlRoomAgent',
  'contactPerson', 'contactNumber', 'emailAddress', 'communicationNotes'];
function setup(options = {}) {
  let fail = options.failure;
  let visible = options.rows || [log('row-a', 1)];
  const stored = (options.stored || []).map(row => ({ ...row }));
  const calls = [], recoveries = [];
  const controls = [{ disabled: false }, { disabled: true }];
  const editors = [{ value: 'true', getAttribute() { return this.value; }, setAttribute(name, value) { this.value = value; } }];
  const dragHandles = [{ draggable: true }];
  const nodes = visible.map(row => ({ dataset: { communicationRowKey: row.rowKey, communicationLogId: String(row.id || '') } }));
  const readRows = () => visible.map((row, index) => ({ ...row, displayOrder: index + 1,
    id: Number(nodes[index].dataset.communicationLogId) || null,
    pendingSave: nodes[index].dataset.communicationPendingSave ? JSON.parse(nodes[index].dataset.communicationPendingSave) : null }));
  const state = { selectedIncidentDetail: { incident: { id: options.newDraft ? undefined : 311 } },
    hasUnsavedChanges: true, draftSavePromise: null, saveRequestId: null };
  const api = { saveIncident: 'save-incident', saveCommunication: 'save-communication', incidentDetail: 'incident-detail',
    deleteCommunication: 'delete-communication', saveTimelineEntry: 'save-timeline', deleteTimelineEntry: 'delete-timeline' };
  const context = { state, api, URL, URLSearchParams, console,
    elements: { form: { elements: {}, querySelectorAll(selector) {
      return selector === '[contenteditable]' ? editors : selector === '[draggable]' ? dragHandles : controls;
    }, setAttribute() {}, removeAttribute() {} },
      communicationLogRows: { querySelectorAll: () => nodes },
      saveDraftButton: controls[0], saveDraftIconButton: controls[1] },
    window: { location: { href: 'http://test.invalid/dispatch' }, history: { replaceState() {} } },
    getIncidentPayloadFromForm: () => ({ additionalAssetsJson: JSON.stringify(options.additionalAssets || []), latitude: '', longitude: '',
      communicationLogJson: JSON.stringify(readRows()), deletedCommunicationLogIds: '',
      incidentTimelineJson: options.timeline ? '[{"id":null,"entryText":"Test timeline"}]' : '[]', deletedTimelineEntryIds: '' }),
    requestJson: async (url, options = {}) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (url === api.saveIncident) { calls.push({ type: 'incident', body: { ...options.body } }); return { status: 'ok', id: 311 }; }
      if (url === api.saveCommunication) {
        const body = { ...options.body }; calls.push({ type: 'communication', body });
        if (fail === 'second-row' && body.displayOrder === 2) { fail = null; throw new Error('Simulated row failure'); }
        let record = body.communicationId ? stored.find(row => row.id === Number(body.communicationId))
          : stored.find(row => row.displayOrder === body.displayOrder && contentFields.every(field => row[field] === body[field]));
        if (!record) { record = { id: 1000 + stored.length }; stored.push(record); }
        Object.assign(record, body, { id: record.id });
        if (fail === 'lost-response') { fail = null; throw new Error('Simulated lost response after insert'); }
        return { status: 'ok', communicationId: record.id };
      }
      if (url === api.saveTimelineEntry) {
        if (fail === 'timeline') { fail = null; throw new Error('Simulated timeline failure'); }
        return { status: 'ok' };
      }
      if (url.startsWith(api.incidentDetail)) {
        if (fail === 'reload') { fail = null; throw new Error('Simulated reload failure'); }
        return { incident: { id: 311 }, communications: stored.map(row => ({ ...row })) };
      }
      throw new Error(`Unexpected mock URL ${url}`);
    },
    // Rendering is left as a no-op to verify IDs survived before the reload.
    populateForm() {}, captureDraftRecovery: () => recoveries.push(JSON.parse(JSON.stringify(readRows()))),
    setDraftUnsavedChanges(value) { state.hasUnsavedChanges = value; },
    showNotice() {}, updateDispatchSectionStatuses() {}, renderDetailPanel() {}, clearDraftRecovery() {}, syncViewOnlyMode() {},
    loadIncidents: async () => {}, loadPendingApprovals: async () => {}, loadCompletedIncidents: async () => {}, loadTeamQuotas: async () => {} };
  vm.createContext(context); vm.runInContext(code, context);
  return { context, stored, calls, controls, editors, dragHandles, recoveries, nodes, visible, readRows };
}
async function main() {
  const tests = [];
  const run = async (name, fn) => { await fn(); tests.push(name); };
  await run('Overlapping Save calls share one operation; controls and editor state restore', async () => {
    const t = setup(); const first = t.context.saveIncident(), second = t.context.saveIncident();
    assert.equal(first, second); assert(t.controls.every(control => control.disabled));
    assert.equal(t.editors[0].value, 'false'); assert.equal(t.dragHandles[0].draggable, false);
    await Promise.all([first, second]); assert.equal(t.stored.length, 1);
    assert.deepEqual(t.controls.map(control => control.disabled), [false, true]);
    assert.equal(t.editors[0].value, 'true'); assert.equal(t.dragHandles[0].draggable, true);
    assert.equal(t.context.state.draftSavePromise, null);
  });
  await run('Two completed saves update the same communication ID', async () => {
    const t = setup(); await t.context.saveIncident(); await t.context.saveIncident();
    assert.equal(t.stored.length, 1); assert.equal(t.calls.filter(c => c.type === 'communication')[1].body.communicationId, 1000);
  });
  for (const failure of ['timeline', 'reload', 'second-row']) await run(`${failure} failure retains IDs for retry`, async () => {
    const t = setup({ failure, timeline: failure === 'timeline', rows: failure === 'second-row' ? [log('a', 1), log('b', 2)] : undefined });
    await assert.rejects(t.context.saveIncident(), /Simulated/);
    assert.equal(t.nodes[0].dataset.communicationLogId, '1000');
    assert.equal(t.context.state.draftSavePromise, null);
    await t.context.saveIncident(); assert.equal(t.stored.length, failure === 'second-row' ? 2 : 1);
  });
  await run('Lost response replays the original create before applying edited notes', async () => {
    const t = setup({ failure: 'lost-response' }); await assert.rejects(t.context.saveIncident(), /Simulated/);
    assert(t.nodes[0].dataset.communicationPendingSave); t.visible[0].communicationNotes = 'Edited after failure';
    await t.context.saveIncident(); assert.equal(t.stored.length, 1);
    assert.equal(t.stored[0].communicationNotes, 'Edited after failure');
    assert(!t.nodes[0].dataset.communicationPendingSave);
  });
  await run('Pending create survives draft recovery and browser reload', async () => {
    const first = setup({ failure: 'lost-response' }); await assert.rejects(first.context.saveIncident(), /Simulated/);
    const snapshot = first.readRows(); const restored = setup({ rows: snapshot, stored: first.stored });
    restored.nodes[0].dataset.communicationPendingSave = JSON.stringify(snapshot[0].pendingSave);
    await restored.context.saveIncident(); assert.equal(restored.stored.length, 1);
  });
  await run('Identical intentional rows at separate positions get separate IDs', async () => {
    const t = setup({ rows: [log('a', 1), log('b', 2)] }); await t.context.saveIncident();
    assert.equal(t.stored.length, 2); assert.notEqual(t.nodes[0].dataset.communicationLogId, t.nodes[1].dataset.communicationLogId);
  });
  await run('Inserting identical content ahead of an existing row moves the existing row first', async () => {
    const existing = log('existing', 1, { id: 900 });
    const t = setup({ rows: [log('new', 1), existing], stored: [existing] }); await t.context.saveIncident();
    assert.equal(t.stored.length, 2); assert.equal(t.stored.find(row => row.id === 900).displayOrder, 2);
    assert.notEqual(t.nodes[0].dataset.communicationLogId, '900');
  });
  await run('A recovered pending row moves before an identical new row is inserted ahead of it', async () => {
    const first = setup({ failure: 'lost-response' }); await assert.rejects(first.context.saveIncident(), /Simulated/);
    const pending = first.readRows()[0];
    const t = setup({ rows: [log('new', 1), pending], stored: first.stored });
    t.nodes[1].dataset.communicationPendingSave = JSON.stringify(pending.pendingSave);
    await t.context.saveIncident(); assert.equal(t.stored.length, 2);
    assert.equal(t.nodes[1].dataset.communicationLogId, '1000');
    assert.equal(t.stored.find(row => row.id === 1000).displayOrder, 2);
    assert.notEqual(t.nodes[0].dataset.communicationLogId, '1000');
  });
  await run('New parent dispatch retains its ID when a child request fails', async () => {
    const t = setup({ newDraft: true, failure: 'timeline', timeline: true });
    await assert.rejects(t.context.saveIncident(), /Simulated/); await t.context.saveIncident();
    assert.equal(t.calls.filter(c => c.type === 'incident')[1].body.id, 311); assert.equal(t.stored.length, 1);
  });
  await run('Validation failure releases the save lock without making requests', async () => {
    const t = setup(); t.context.getIncidentPayloadFromForm = () => { throw new Error('Validation failed'); };
    await assert.rejects(t.context.saveIncident(), /Validation failed/);
    assert.equal(t.calls.length, 0); assert.equal(t.context.state.draftSavePromise, null);
    assert.equal(t.controls[0].disabled, false);
  });
  await run('Schema routing uses compatible endpoints only when additional assets are unavailable', async () => {
    const context = { apiBase: '/dispatch_link/api', api: {} };
    vm.createContext(context); vm.runInContext(definition('configureSchemaCompatibleEndpoints'), context);
    context.configureSchemaCompatibleEndpoints(false);
    assert.equal(context.api.saveIncident, '/dispatch_link/api/compat/save_incident.sql');
    assert.equal(context.api.incidentDetail, '/dispatch_link/api/compat/dispatch_incident_detail.sql');
    assert.equal(context.api.uploadPhoto, '/dispatch_link/api/compat/upload_photo.sql');
    assert.equal(context.api.submitIncident, '/dispatch_link/api/compat/submit_incident.sql');
    context.configureSchemaCompatibleEndpoints(true);
    assert.equal(context.api.saveIncident, '/dispatch_link/api/save_incident.sql');
  });
  await run('Unavailable additional assets stop the save before any records can be changed', async () => {
    const t = setup({ additionalAssets: [{regNo:'TEST'}] });
    t.context.state.metadata = { additionalAssetsEnabled:false };
    await assert.rejects(t.context.saveIncident(), /Additional assets are not available/);
    assert.equal(t.calls.length,0);
  });
  const report = { passed: tests.length, tests, databaseWrites: 0, mutationRouteCalls: 0 };
  fs.writeFileSync('outputs/duplicate-communication-audit-20261005/fix-regression-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
