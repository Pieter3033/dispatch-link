const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.env.RETURN_APPROVALS_APP_SOURCE_PATH || path.join(__dirname, '../public/app.js'), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Function ${name} exists`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/^(?:async )?function \w+\(/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function setup() {
  const calls = [];
  const button = () => ({ hidden: true, disabled: false, focus() { calls.push('focus'); }, addEventListener(type, handler) { this[type] = handler; } });
  const elements = Object.fromEntries(['returnToApprovalsButton', 'returnToApprovalsConfirmOverlay', 'returnToApprovalsConfirmAccept', 'returnToApprovalsConfirmBack', 'returnToApprovalsConfirmClose'].map(k => [k, button()]));
  const context = vm.createContext({
    URL, Number, Boolean, String,
    state: { currentUser: { isApprover: true }, selectedIncidentDetail: { incident: { id: 355, Status: 'Approved', DispatchStatus: 'Dispatch Requested', UpdatedAt: '2026-10-09T14:02:15.309' } } },
    elements, api: { returnToApprovals: '/dispatch_link/api/return_dispatch_to_approvals.sql' },
    document: { body: { classList: { toggle: (...args) => calls.push(args) } }, activeElement: { focus: () => calls.push('restoreFocus') } },
    window: { location: { href: 'http://127.0.0.1:8080/dispatch_link/public/dispatch.html?id=355&mode=view', assign: url => calls.push({ navigation: url }) }, requestAnimationFrame: fn => fn() },
    requestJson: async (url, options) => { calls.push({ url, options }); return { status: 'ok' }; },
    clearDraftRecovery: () => calls.push('clearRecovery'), setDraftUnsavedChanges: value => calls.push({ unsaved: value }),
    showNotice: message => calls.push({ notice: message }), updateDispatchPresentation: () => calls.push('presentation'),
    returnToApprovalsPreviousFocus: null, returnToApprovalsInProgress: false
  });
  for (const name of ['isDispatchAdmin', 'isTrueFlag', 'canReturnDispatchToApprovals', 'setReturnToApprovalsConfirmationOpen', 'returnCurrentDispatchToApprovals']) vm.runInContext(functionSource(name), context);
  return { context, calls, elements };
}
test('admin eligibility excludes other users, unapproved reports, closed/cancelled and deleted records', () => {
  const { context } = setup();
  for (const approver of [true, false]) for (const status of ['Approved', 'Draft', 'PendingApproval', 'Rejected']) for (const dispatchStatus of ['Dispatch Requested', 'Dispatched', 'Stood Down', 'Closed', 'Cancelled']) {
    context.state.currentUser.isApprover = approver;
    context.state.selectedIncidentDetail.incident.Status = status;
    context.state.selectedIncidentDetail.incident.DispatchStatus = dispatchStatus;
    assert.equal(context.canReturnDispatchToApprovals(), approver && status === 'Approved' && !['Closed', 'Cancelled'].includes(dispatchStatus));
  }
  context.state.selectedIncidentDetail = null;
  assert.equal(context.canReturnDispatchToApprovals(), false);
  const { context: deleted } = setup();
  deleted.state.selectedIncidentDetail.incident.IsDeleted = true;
  assert.equal(deleted.canReturnDispatchToApprovals(), false);
});
test('confirmation opens safely, cancel restores focus, and neither submits', () => {
  const { context, calls, elements } = setup();
  context.setReturnToApprovalsConfirmationOpen(true);
  assert.equal(elements.returnToApprovalsConfirmOverlay.hidden, false);
  assert.ok(calls.includes('focus'));
  context.setReturnToApprovalsConfirmationOpen(false);
  assert.equal(elements.returnToApprovalsConfirmOverlay.hidden, true);
  assert.ok(calls.includes('restoreFocus'));
  assert.equal(calls.filter(c => c?.url).length, 0);
  context.state.currentUser.isApprover = false;
  context.setReturnToApprovalsConfirmationOpen(true);
  assert.equal(elements.returnToApprovalsConfirmOverlay.hidden, true);
});
test('successful return POSTs the saved version and opens the same dispatch in edit mode', async () => {
  const { context, calls } = setup();
  await context.returnCurrentDispatchToApprovals();
  const request = calls.find(c => c?.url);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body.incidentId, 355);
  assert.equal(request.options.body.expectedUpdatedAt, '2026-10-09T14:02:15.309');
  const target = new URL(calls.find(c => c?.navigation).navigation);
  assert.equal(target.searchParams.get('id'), '355');
  assert.equal(target.searchParams.has('mode'), false);
  assert.equal(target.searchParams.get('returnedToApprovals'), '1');
  assert.ok(calls.includes('clearRecovery'));
});
test('server denial and stale versions keep the current record and draft recovery', async () => {
  for (const status of ['forbidden', 'unauthorized', 'validation_error', 'conflict', 'locked_status', 'not_found']) {
    const { context, calls } = setup();
    context.requestJson = async () => ({ status });
    await assert.rejects(context.returnCurrentDispatchToApprovals());
    assert.equal(calls.some(c => c?.navigation || c === 'clearRecovery'), false);
  }
});
test('non-admin callers cannot submit even if they invoke the handler directly', async () => {
  const { context, calls } = setup();
  context.state.currentUser.isApprover = false;
  await assert.rejects(context.returnCurrentDispatchToApprovals(), /administrators/);
  assert.equal(calls.length, 0);
});
test('double clicks submit once, keep the modal open during the request, and restore controls on failure', async () => {
  const { context, calls, elements } = setup();
  const start = source.indexOf('  elements.returnToApprovalsButton?.addEventListener');
  const end = source.indexOf('  document.addEventListener("keydown"', start);
  vm.runInContext(source.slice(start, end), context);
  let reject;
  context.requestJson = () => { calls.push('request'); return new Promise((_, fail) => { reject = fail; }); };
  elements.returnToApprovalsButton.click();
  const first = elements.returnToApprovalsConfirmAccept.click();
  await elements.returnToApprovalsConfirmAccept.click();
  elements.returnToApprovalsConfirmBack.click();
  assert.equal(calls.filter(c => c === 'request').length, 1);
  assert.equal(elements.returnToApprovalsConfirmOverlay.hidden, false);
  assert.equal(elements.returnToApprovalsConfirmAccept.disabled, true);
  reject(new Error('Connection interrupted'));
  await first;
  assert.equal(elements.returnToApprovalsConfirmOverlay.hidden, true);
  assert.equal(elements.returnToApprovalsConfirmAccept.disabled, false);
  assert.equal(context.returnToApprovalsInProgress, false);
  assert.ok(calls.some(c => c?.notice === 'Connection interrupted'));
});
