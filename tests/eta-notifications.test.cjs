const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/eta-notifications.js'), 'utf8');
const team = { username: 'preview-user', role: 'DispatchTeam', teamId: 1, teamIsActive: true };
const request = id => ({ id });
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const document = new EventTarget();
  document.currentScript = { src: 'http://localhost:8080/dispatch_link/public/eta-notifications.js' };
  document.title = 'ETA Requests';
  document.createElement = () => { throw new Error('Sound notifications must not add UI'); };
  const tones = [];
  const downloads = [];
  const decodedAlarm = { selectedSound: 'Street public alarm' };
  let allowed = !options.blocked;
  let contexts = 0;
  class AudioContext extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.currentTime = 0; contexts++; }
    resume() {
      if (!allowed) return Promise.reject(new Error('Autoplay blocked'));
      this.state = 'running';
      this.dispatchEvent(new Event('statechange'));
      return Promise.resolve();
    }
    async decodeAudioData() { return decodedAlarm; }
    createBufferSource() {
      if (options.audioError) throw new Error('Audio device unavailable');
      return { connect() {}, disconnect() {}, start() { tones.push({ buffer: this.buffer }); } };
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const localStorage = options.localStorage || storage();
  const sessionStorage = options.sessionStorage || storage();
  const window = { AudioContext, localStorage, sessionStorage, fetch: async url => {
    downloads.push(url);
    return { ok: !options.loadError, arrayBuffer: async () => new ArrayBuffer(8) };
  } };
  if (options.noWebAudio) delete window.AudioContext;
  if (options.blockedStorage) for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('Storage blocked'); } });
  const context = vm.createContext({ document, window, URL });
  vm.runInContext(source, context);
  return {
    update: context.dispatchEtaNotifications.update, document, tones, downloads, decodedAlarm, localStorage, sessionStorage,
    get contexts() { return contexts; },
    async interact(event = 'pointerdown') { allowed = true; document.dispatchEvent(new Event(event)); await settle(); }
  };
}
test('sound is on by default; each new arrival plays the chosen Street public alarm once', async () => {
  const f = setup();
  f.update(team, [request(1)]);
  await settle();
  assert.equal(f.tones.length, 0, 'Existing requests are quiet');
  f.update(team, [request(1), request(2)]);
  assert.equal(f.tones.length, 1);
  assert.equal(f.tones[0].buffer, f.decodedAlarm);
  assert.deepEqual(f.downloads, ['http://localhost:8080/dispatch_link/public/assets/mixkit-street-public-alarm-997.wav']);
  f.update(team, [request(1), request(2)]);
  await settle();
  assert.equal(f.tones.length, 1, 'Refresh must not replay the sound');
  assert.equal(f.document.title, 'ETA Requests');
});
test('a new request before autoplay unlock waits and sounds on the next ordinary click', async () => {
  const f = setup({ blocked: true });
  f.update(team, []);
  f.update(team, [request(1)]);
  await settle();
  assert.equal(f.tones.length, 0);
  assert.equal(f.localStorage.getItem('pulsit-eta-sounded:preview-user:1'), null);
  await f.interact();
  assert.equal(f.tones.length, 1);
  await f.interact();
  assert.equal(f.tones.length, 1);
});
test('keyboard interaction unlocks audio too', async () => {
  const f = setup({ blocked: true });
  f.update(team, []);
  f.update(team, [request(1)]);
  await settle();
  await f.interact('keydown');
  assert.equal(f.tones.length, 1);
});
test('queued requests that are answered or closed before audio unlock stay quiet', async () => {
  const f = setup({ blocked: true });
  f.update(team, []);
  f.update(team, [request(1)]);
  f.update(team, []);
  await settle();
  await f.interact();
  assert.equal(f.tones.length, 0);
});
test('Call Centre, inactive teams, signed-out and unmapped users cannot trigger sound', async () => {
  for (const context of [{ ...team, role: 'CallCentre' }, { ...team, teamIsActive: '0' }, { ...team, username: '' }, { role: 'None' }, null]) {
    const f = setup();
    f.update(context, []);
    f.update(context, [request(1)]);
    await f.interact();
    assert.equal(f.tones.length, 0);
    assert.equal(f.contexts, 0);
  }
});
test('changing teams or signing out clears sounds queued for the previous team', async () => {
  for (const next of [{ ...team, teamId: 2 }, { role: 'None' }]) {
    const f = setup({ blocked: true });
    f.update(team, []);
    f.update(team, [request(1)]);
    f.update(next, [request(2)]);
    await settle();
    await f.interact();
    assert.equal(f.tones.length, 0);
  }
});
test('seen requests survive page navigation and new arrivals between pages still sound', async () => {
  const saved = storage();
  const shared = storage();
  const first = setup({ sessionStorage: saved, localStorage: shared });
  first.update(team, []);
  first.update(team, [request(1)]);
  await settle();
  const next = setup({ sessionStorage: saved, localStorage: shared });
  next.update(team, [request(1)]);
  await settle();
  assert.equal(next.tones.length, 0);
  next.update(team, [request(1), request(2)]);
  assert.equal(next.tones.length, 1);
});
test('multiple new requests in one refresh play the selected recording once', async () => {
  const f = setup();
  f.update(team, []);
  f.update(team, [request(1), request(2), request(3)]);
  await settle();
  assert.equal(f.tones.length, 1);
});
test('a failed alarm download keeps the request queued and retries successfully', async () => {
  const options = { loadError: true };
  const f = setup(options);
  f.update(team, []);
  f.update(team, [request(1)]);
  await settle();
  assert.equal(f.tones.length, 0);
  assert.equal(f.localStorage.getItem('pulsit-eta-sounded:preview-user:1'), null);
  options.loadError = false;
  f.update(team, [request(1)]);
  await settle();
  assert.equal(f.tones.length, 1);
  assert.equal(f.downloads.length, 2);
});
test('sounds blocked by autoplay survive navigation and play when the next page unlocks audio', async () => {
  const saved = storage();
  const first = setup({ blocked: true, sessionStorage: saved });
  first.update(team, []);
  first.update(team, [request(1)]);
  await settle();
  const next = setup({ sessionStorage: saved });
  next.update(team, [request(1)]);
  await settle();
  assert.equal(next.tones.length, 1);
});
test('a blocked tab does not claim the sound and silence a tab that can play it', async () => {
  const shared = storage();
  const blocked = setup({ blocked: true, localStorage: shared });
  const audible = setup({ localStorage: shared });
  for (const f of [blocked, audible]) f.update(team, []);
  for (const f of [blocked, audible]) f.update(team, [request(1)]);
  await settle();
  assert.equal(audible.tones.length, 1);
  await blocked.interact();
  assert.equal(blocked.tones.length, 0);
});
test('legacy disabled alerts preference does not disable the requested default sound', async () => {
  const saved = storage();
  saved.setItem('pulsit-ground-team-alerts', '0');
  const f = setup({ localStorage: saved });
  f.update(team, []);
  f.update(team, [request(1)]);
  await settle();
  assert.equal(f.tones.length, 1);
});
test('blocked storage, unsupported audio, device failures, corrupt snapshots, and bad payloads are safe', async () => {
  for (const options of [{ blockedStorage: true }, { noWebAudio: true }, { audioError: true }]) {
    const f = setup(options);
    f.update(team, []);
    f.update(team, null);
    f.update(team, [request(1)]);
    await settle();
    assert.equal(f.tones.length, options.blockedStorage ? 1 : 0);
  }
});
test('sound implementation has no opt-in switch, banner, desktop permission, or title changes', () => {
  assert.doesNotMatch(source, /createElement|requestPermission|new\s+(?:window\.)?Notification|document\.title|enabled|toggleAlerts/);
  for (const file of ['eta-requests.html', 'team-dispatches.html']) {
    const html = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
    assert.ok(html.includes('eta-notifications.js?v=20261022-street-alarm-3'));
    assert.ok(!html.includes('eta-notifications.css'));
  }
});
test('notification feed stays read-only and restricted to the active team\'s open unanswered requests', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../api/eta_team_notifications.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|EXEC|CREATE|DROP)\b/i);
  for (const fragment of ["sqlpage.cookie('session')", "context.AccessRole = N'DispatchTeam'", 'context.TeamIsActive = 1', 'response.TeamId = context.TeamId', "response.ResponseStatus = N'Pending'", "request.RequestStatus = N'Open'", "N'[]')) AS pendingRequests"]) assert.ok(sql.includes(fragment), fragment);
});
test('ETA-page integration forwards only the current team\'s open unanswered requests', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/eta-requests.js'), 'utf8');
  const hook = page.match(/globalThis\.dispatchEtaNotifications\?\.update\(state\.context,[\s\S]*?\);/)[0];
  let forwarded;
  vm.runInNewContext(hook, {
    state: { context: team, requests: [
      { id: 1, status: 'Open', responses: [{ teamId: 1, status: 'Pending' }] },
      { id: 2, status: 'Open', responses: [{ teamId: 2, status: 'Pending' }] },
      { id: 3, status: 'Selected', responses: [{ teamId: 1, status: 'Pending' }] },
      { id: 4, status: 'Open', responses: [{ teamId: 1, status: 'Available' }] }
    ] },
    dispatchEtaNotifications: { update: (context, requests) => { forwarded = requests; } }
  });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].id, 1);
});

