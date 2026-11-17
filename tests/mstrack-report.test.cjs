const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const generatorSource = fs.readFileSync(path.join(root, 'tools/generate_mstrack_history.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'src/services/bisHistoryService.js'), 'utf8');
const appSource = fs.readFileSync(process.env.MSTRACK_APP_SOURCE_PATH || path.join(root, 'public/app.js'), 'utf8');
const reportService = require('../src/services/bisHistoryReportService');
const incident = { id: 344, RegNo: 'TEST-REPORT', EventDateTime: '2026-10-12T07:00:00Z', DispatchDateTime: '2026-10-12T08:00:00Z', StandDownDateTime: '2026-10-12T09:00:00Z' };
const history = { configured: true, registration: incident.RegNo, start: '2026-10-11T08:00:00Z', end: incident.StandDownDateTime, count: 1, rows: [{ Registration: incident.RegNo, DateTime: '2026-10-12T08:30:00Z', Event: 'Test event' }] };

function generator(format = 'xls', supplied = incident, fetchHistory = async () => history) {
  const outputRoot = path.join(root, 'outputs/mstrack-report-fix-20261013-080451/tests', crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(path.join(outputRoot, 'tools'), { recursive: true });
  const imported = [];
  const context = vm.createContext({
    __dirname: path.join(outputRoot, 'tools'), module: { exports: {} },
    process: { argv: ['node', 'generator', '344', format, supplied === undefined ? undefined : JSON.stringify(supplied)], chdir() {} },
    require(name) {
      imported.push(name);
      if (['crypto', 'fs', 'path'].includes(name)) return require(name);
      if (name === 'dotenv') return { config(options) { assert.equal(options.quiet, true); return {}; } };
      if (name === '../src/services/bisHistoryService') return { fetchBisHistory: fetchHistory };
      if (name === '../src/services/bisHistoryReportService') return reportService;
      throw Error('Unexpected dependency: ' + name);
    }
  });
  vm.runInContext(generatorSource, context);
  return { ...context.module.exports, outputRoot, imported };
}

test('generator creates Excel, PDF and JSON from SQLPage input without importing database services', async () => {
  for (const format of ['xls', 'pdf', 'json']) {
    let received;
    const run = generator(format, incident, async value => { received = value; return history; });
    const url = await run.main();
    assert.deepEqual(JSON.parse(JSON.stringify(received)), incident);
    const outputPath = path.join(run.outputRoot, decodeURIComponent(url.replace('/dispatch_link/', '')));
    const output = fs.readFileSync(outputPath);
    assert.ok(output.length > 0);
    if (format === 'xls') assert.match(output.toString(), /Test event/);
    if (format === 'pdf') assert.equal(output.subarray(0, 5).toString(), '%PDF-');
    if (format === 'json') assert.deepEqual(JSON.parse(output), history);
    assert.ok(!run.imported.some(name => /dispatchService|db\/pool|mssql|\.\.\/src\/config$/.test(name)));
  }
});

test('missing, invalid or mismatched SQLPage input is rejected before contacting the connector', () => {
  const run = generator();
  for (const value of [undefined, '', 'not-json', 'null', '[]', JSON.stringify({ id: 343 })]) {
    assert.throws(() => run.parseIncident(value, 344), error => error.reportCode === 'incident-input');
  }
});

test('configuration and runtime failures return controlled codes without leaking raw errors', async () => {
  const run = generator('xls', incident, async () => ({ configured: false }));
  await assert.rejects(run.main(), error => error.reportCode === 'connector-config');
  for (const [error, expected] of [
    [{ reportCode: 'connector-auth', message: 'password=secret' }, 'connector-auth'],
    [{ code: 'MODULE_NOT_FOUND', message: 'private runtime path' }, 'report-runtime'],
    [{ code: 'EACCES', message: 'private output path' }, 'report-output'],
    [{ message: 'server=secret;password=secret' }, 'report-generation']
  ]) {
    const url = run.reportErrorUrl(error);
    assert.equal(new URL(url, 'https://example.invalid').searchParams.get('reportError'), 'mstrack-' + expected);
    assert.ok(!url.includes('secret') && !url.includes('private'));
  }
});

function service(fetch) {
  const context = vm.createContext({
    module: { exports: {} }, process: { platform: 'win32' }, URL, Date, AbortController, fetch,
    setTimeout() { return 1; }, clearTimeout() {},
    require(name) {
      if (name === '../config/bisHistory') return { url: 'http://127.0.0.1:43128', token: 'test-only-token' };
      if (name === 'child_process') return { execFileSync() { throw Error('Real credential access is prohibited in these tests.'); } };
      throw Error('Database configuration must never be imported: ' + name);
    }
  });
  vm.runInContext(serviceSource, context);
  return context.module.exports;
}

test('connector errors distinguish authentication, invalid dates, SQL failure, timeout and connection failure', async () => {
  for (const [status, expected] of [[401, 'connector-auth'], [422, 'history-window'], [500, 'history-query'], [503, 'connector-response']]) {
    const run = service(async () => ({ ok: false, status }));
    await assert.rejects(run.fetchBisHistory(incident), error => error.reportCode === expected);
  }
  for (const [error, expected] of [[Object.assign(Error('aborted'), { name: 'AbortError' }), 'connector-timeout'], [Object.assign(Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), 'connector-unreachable']]) {
    await assert.rejects(service(async () => { throw error; }).fetchBisHistory(incident), error => error.reportCode === expected);
  }
  await assert.rejects(service(async () => { throw Error('Must not fetch invalid dates'); }).fetchBisHistory({ ...incident, DispatchDateTime: 'invalid' }), error => error.reportCode === 'history-window');
});

test('SQLPage UTC dates preserve the expected 24-hour lead-in and stand-down end time', async () => {
  let requested;
  const result = await service(async url => {
    requested = url;
    return { ok: true, json: async () => history };
  }).fetchBisHistory(incident);
  assert.equal(requested.searchParams.get('start'), '2026-10-11T08:00:00.000Z');
  assert.equal(requested.searchParams.get('end'), '2026-10-12T09:00:00.000Z');
  assert.equal(result.count, 1);
});

function functionSource(name) {
  const start = appSource.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0);
  const rest = appSource.slice(start);
  const next = rest.slice(1).search(/^(?:async )?function \w+\(/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function frontend(url, contentType) {
  const events = [];
  const classes = new Set();
  const label = { textContent: 'Download MSTrack History Excel' };
  const link = { href: '/generate.sql', dataset: { downloadFilename: 'history.xls' }, classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) }, querySelector: () => label, setAttribute() {}, removeAttribute() {} };
  class DownloadURL extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} }
  const context = vm.createContext({
    URL: DownloadURL, dispatchLinkBase: '/dispatch_link',
    fetch: async () => ({ ok: true, url, headers: { get: name => name === 'Content-Type' ? contentType : '' }, blob: async () => Buffer.from('test report') }),
    document: { body: { appendChild() {} }, createElement: () => ({ click() { events.push('download'); }, remove() {} }) },
    window: { setTimeout() {} }, showNotice: message => events.push(message)
  });
  for (const name of ['historyReportErrorMessage', 'responseDownloadFileName', 'downloadReportWithProgress']) vm.runInContext(functionSource(name), context);
  return { context, link, events, classes, label };
}

test('Excel HTML workbook downloads succeed; HTML error pages are rejected and the button recovers', async () => {
  const file = frontend('https://example.invalid/dispatch_link/public/generated-reports/' + 'a'.repeat(32) + '/history.xls', 'text/html');
  await file.context.downloadReportWithProgress(file.link);
  assert.ok(file.events.includes('download'));
  assert.equal(file.classes.size, 0);
  const failure = frontend('https://example.invalid/dispatch_link/api/generate_mstrack_history.sql', 'text/html');
  await assert.rejects(failure.context.downloadReportWithProgress(failure.link), /server returned an error page/);
  assert.ok(!failure.events.includes('download'));
  assert.equal(failure.classes.size, 0);
  assert.equal(failure.label.textContent, 'Download MSTrack History Excel');
});

test('failed redirects distinguish connector authentication from expired browser sessions', async () => {
  for (const [url, expected] of [
    ['https://example.invalid/dispatch_link/public/completed.html?reportError=mstrack-connector-auth', /could not authenticate/],
    ['https://example.invalid/signin.sql?error', /session has expired/]
  ]) {
    const run = frontend(url, 'text/html');
    await assert.rejects(run.context.downloadReportWithProgress(run.link), expected);
    assert.ok(!run.events.includes('download'));
  }
});
