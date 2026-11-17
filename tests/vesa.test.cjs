const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/^(?:async )?function \w+\(/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function setup() {
  const elements = Object.fromEntries(['vesaRows', 'vesaCountLabel', 'vesaPreviousPage', 'vesaNextPage'].map(key => [key, {}]));
  elements.vesaFilters = { values: {} };
  const context = vm.createContext({
    elements, state: { vesaIncidents: [], vesaPage: 0 },
    FormData: class { constructor(form) { this.values = form?.values || {}; } get(key) { return this.values[key]; } },
    api: { vesaIncidents: '/dispatch_link/api/vesa_dispatches.sql' },
    requestJson: async () => ({ status: 'ok', incidents: [] })
  });
  for (const name of ['escapeHtml', 'getDateOnlyTime', 'getFilteredVesaIncidents', 'renderVesaRows', 'renderVesaError', 'loadVesaIncidents']) {
    vm.runInContext(functionSource(name), context);
  }
  return context;
}
test('search covers all four requested fields and date boundaries', () => {
  const c = setup();
  c.state.vesaIncidents = [{ RegNo: 'TEST123', Company: 'Example Fleet', OBNumber: 'OB-42', zoho_ob: 'ZOHO-72', CreatedAt: '2026-10-27T12:00:00' }];
  for (const search of [' test123 ', 'EXAMPLE', 'ob-42', 'zoho-72']) {
    c.elements.vesaFilters.values = { search };
    assert.equal(c.getFilteredVesaIncidents().length, 1);
  }
  for (const values of [{ search: 'absent' }, { createdFrom: '2026-10-28' }, { createdTo: '2026-10-26' }]) {
    c.elements.vesaFilters.values = values;
    assert.equal(c.getFilteredVesaIncidents().length, 0);
  }
  c.elements.vesaFilters.values = { createdFrom: '2026-10-27', createdTo: '2026-10-27' };
  assert.equal(c.getFilteredVesaIncidents().length, 1);
});
test('ten-row pagination, empty results, and page clamping', () => {
  const c = setup();
  c.state.vesaIncidents = Array.from({ length: 23 }, (_, i) => ({ RegNo: `TEST${i}`, CreatedAt: '2026-10-27T12:00:00' }));
  c.renderVesaRows();
  assert.equal((c.elements.vesaRows.innerHTML.match(/<tr>/g) || []).length, 10);
  assert.equal(c.elements.vesaCountLabel.textContent, '1–10 of 23 dispatches');
  assert.equal(c.elements.vesaPreviousPage.disabled, true);
  assert.equal(c.elements.vesaNextPage.disabled, false);
  c.state.vesaPage = 9;
  c.renderVesaRows();
  assert.equal(c.state.vesaPage, 2);
  assert.equal(c.elements.vesaCountLabel.textContent, '21–23 of 23 dispatches');
  assert.equal(c.elements.vesaNextPage.disabled, true);
  c.state.vesaIncidents = [];
  c.renderVesaRows();
  assert.equal(c.state.vesaPage, 0);
  assert.match(c.elements.vesaRows.innerHTML, /colspan="4".*No approved/);
  assert.equal(c.elements.vesaCountLabel.textContent, '0 dispatches');
});
test('renders only the requested columns, escapes data, and supplies missing-value placeholders', () => {
  const c = setup();
  c.state.vesaIncidents = [{ RegNo: '<img src=x onerror=alert(1)>', Company: 'A & B', Event: 'Hijacking' }];
  c.renderVesaRows();
  const html = c.elements.vesaRows.innerHTML;
  assert.equal((html.match(/<td>/g) || []).length, 4);
  assert.doesNotMatch(html, /<img|Hijacking/);
  assert.match(html, /&lt;img/);
  assert.match(html, /A &amp; B/);
  assert.equal((html.match(/<td>-<\/td>/g) || []).length, 2);
});
test('loads through SQLPage and removes stale rows after denial or network failure', async () => {
  const c = setup();
  c.requestJson = async url => { assert.match(url, /^\/dispatch_link\/api\/vesa_dispatches\.sql\?_=/); return { status: 'ok', incidents: [{ RegNo: 'TEST123' }] }; };
  await c.loadVesaIncidents();
  assert.equal(c.state.vesaIncidents.length, 1);
  for (const status of ['forbidden', 'unauthorized']) {
    c.requestJson = async () => ({ status });
    await assert.rejects(c.loadVesaIncidents());
    assert.equal(c.state.vesaIncidents.length, 0);
    assert.equal(c.elements.vesaCountLabel.textContent, 'Unavailable');
    assert.equal(c.elements.vesaNextPage.disabled, true);
  }
  c.requestJson = async () => { throw new Error('Network unavailable'); };
  await assert.rejects(c.loadVesaIncidents(), /Network unavailable/);
  assert.match(c.elements.vesaRows.innerHTML, /Network unavailable/);
});
test('VESA navigation is present after Completed with the correct table headings', () => {
  for (const name of ['index', 'dispatch', 'completed', 'cancelled', 'eta-requests', 'dispatch-dashboard', 'vesa']) {
    const html = fs.readFileSync(path.join(root, `public/${name}.html`), 'utf8');
    assert.match(html, /href="completed\.html"[\s\S]*href="vesa\.html"[^>]*data-show-for-user-type="7" hidden/);
    assert.doesNotMatch(html, /href="vesa\.html"[^>]*data-show-for-dispatch-operations/);
  }
  const html = fs.readFileSync(path.join(root, 'public/vesa.html'), 'utf8');
  assert.deepEqual([...html.matchAll(/<th>(.*?)<\/th>/g)].map(match => match[1]), ['Registration', 'Company', 'Dispatch OB', 'Zoho OB']);
  assert.match(html, /href="vesa\.html" aria-current="page"/);
});

test('VESA sidebar link is visible only to the existing Admin role', () => {
  const link = { hidden: true, dataset: { showForUserType: '7' } };
  const c = vm.createContext({
    state: { currentUser: null },
    document: { querySelectorAll: selector => selector === '[data-hide-for-user-type], [data-show-for-user-type]' ? [link] : [] }
  });
  for (const name of ['isCompletedDispatchViewer', 'canViewDispatchLink', 'canViewDispatchOperations', 'canViewEtaRequests', 'syncSidebarAccess']) vm.runInContext(functionSource(name), c);
  for (const userType of [null, '0', '1', '7', '8', '11', '12', '13', '14']) {
    c.state.currentUser = { userType, helpdesk: true, etaRole: 'CallCentre', canViewDispatchOperations: true };
    c.syncSidebarAccess();
    assert.equal(link.hidden, userType !== '7', `Menu for user type ${userType}`);
  }
});

test('direct VESA page access redirects non-admins and accepts all admins without a name allowlist', async () => {
  for (const user of [
    { name: 'First Admin', userType: '7', isApprover: true },
    { name: 'Second Admin', userType: '7', isApprover: true },
    { name: 'Another Admin', userType: '7', isApprover: true },
    { name: 'Operator', userType: '8', isApprover: false },
    { name: 'Call Centre', userType: '14', isApprover: false },
    { name: 'Helpdesk', userType: '1', helpdesk: true, isApprover: false },
    { name: 'Completed Viewer', userType: '15', completedDispatchOnly: true, isApprover: false }
  ]) {
    const calls = [];
    const c = vm.createContext({
      elements: { vesaRows: {} }, state: {}, api: { currentUser: '/dispatch_link/api/current_user.sql' },
      requestJson: async () => ({ authenticated: true, user: { ...user, etaRole: 'CallCentre', canViewDispatchOperations: true } }),
      window: { location: { replace: target => { throw new Error(`Redirect:${target}`); } } },
      renderCurrentUser: () => calls.push('render'), syncSidebarAccess: () => calls.push('sidebar')
    });
    for (const name of ['applyStandardEtaProfile', 'isDispatchAdmin', 'isCompletedDispatchViewer', 'syncCompletedViewerAccess', 'loadCurrentUser']) vm.runInContext(functionSource(name), c);
    if (user.isApprover) {
      await c.loadCurrentUser();
      assert.deepEqual(calls, ['render', 'sidebar']);
    } else {
      await assert.rejects(c.loadCurrentUser(), /Redirect:index\.html/);
      assert.deepEqual(calls, []);
    }
  }
});
