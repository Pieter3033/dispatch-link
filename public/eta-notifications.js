/* Automatic sound for new ground-team ETA requests. */
(() => {
  "use strict";
  let identity = "";
  let seen = new Set();
  let waiting = new Set();
  let audio = null;
  let alarmBuffer = null;
  let alarmLoad = null;
  const alarmUrl = new URL("assets/mixkit-street-public-alarm-997.wav", document.currentScript?.src || window.location.href).href;

  function readStorage(storage, key) {
    try { return window[storage].getItem(key); } catch { return null; }
  }
  function writeStorage(storage, key, value) {
    try { window[storage].setItem(key, value); } catch { /* Sound also works without storage. */ }
  }
  function saveWaiting() {
    if (identity) writeStorage("sessionStorage", `pulsit-eta-sound-waiting:${identity}`, JSON.stringify([...waiting]));
  }
  function loadAlarm() {
    if (alarmBuffer || alarmLoad || !audio) return;
    alarmLoad = window.fetch(alarmUrl, { credentials: "same-origin", cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("ETA alarm could not be loaded.");
        return response.arrayBuffer();
      })
      .then((bytes) => audio.decodeAudioData(bytes))
      .then((buffer) => { alarmBuffer = buffer; flushSound(); })
      .catch(() => { alarmLoad = null; });
  }
  function playAlarm() {
    if (!audio || audio.state !== "running" || !alarmBuffer) return false;
    try {
      const sound = audio.createBufferSource();
      sound.buffer = alarmBuffer;
      // Play the selected recording at its original level, without attenuation.
      sound.connect(audio.destination);
      sound.onended = () => sound.disconnect();
      sound.start();
      return true;
    } catch { return false; }
  }
  function flushSound() {
    if (!identity || !waiting.size || audio?.state !== "running") return;
    const claimKey = `pulsit-eta-sounded:${identity}`;
    let claimed = [];
    try { claimed = JSON.parse(readStorage("localStorage", claimKey)) || []; } catch { /* Ignore corrupt storage. */ }
    if (!Array.isArray(claimed)) claimed = [];
    const fresh = [...waiting].filter((id) => !claimed.includes(id));
    if (!fresh.length) { waiting.clear(); saveWaiting(); return; }
    if (playAlarm()) {
      // Claim after audio starts: a blocked tab must not silence another tab.
      writeStorage("localStorage", claimKey, JSON.stringify([...claimed, ...fresh].slice(-2000)));
      waiting.clear();
      saveWaiting();
    }
  }
  function unlockAudio() {
    if (!identity) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audio || audio.state === "closed") {
        audio = new AudioContext();
        audio.addEventListener?.("statechange", flushSound);
      }
      loadAlarm();
      if (audio.state === "running") flushSound();
      else Promise.resolve(audio.resume()).then(flushSound).catch(() => {});
    } catch { /* Retry on the next click/keypress if autoplay was blocked. */ }
  }
  function update(context, pendingRequests) {
    const active = [true, 1, "1", "true"].includes(context?.teamIsActive);
    if (context?.role !== "DispatchTeam" || !active || !context.username || !context.teamId) {
      waiting.clear();
      saveWaiting();
      identity = "";
      return;
    }
    if (!Array.isArray(pendingRequests)) return;
    const nextIdentity = `${String(context.username).trim().toLowerCase()}:${context.teamId}`;
    const storageKey = `pulsit-eta-seen:${nextIdentity}`;
    let baseline = false;
    if (identity !== nextIdentity) {
      waiting.clear();
      saveWaiting();
      identity = nextIdentity;
      let stored = null;
      try { stored = JSON.parse(readStorage("sessionStorage", storageKey)); } catch { /* Quiet initial snapshot. */ }
      baseline = !Array.isArray(stored);
      seen = new Set(Array.isArray(stored) ? stored : []);
      let queued = null;
      try { queued = JSON.parse(readStorage("sessionStorage", `pulsit-eta-sound-waiting:${identity}`)); } catch { /* Ignore corrupt storage. */ }
      waiting = new Set(Array.isArray(queued) ? queued : []);
    }
    const pending = new Set(pendingRequests.filter((request) => request?.id != null).map((request) => String(request.id)));
    waiting = new Set([...waiting].filter((id) => pending.has(id)));
    for (const id of pending) {
      if (!baseline && !seen.has(id)) waiting.add(id);
      seen.add(id);
    }
    writeStorage("sessionStorage", storageKey, JSON.stringify([...seen].slice(-2000)));
    saveWaiting();
    unlockAudio();
  }
  // Sound is on by default. Normal page interaction unlocks browser autoplay.
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);
  globalThis.dispatchEtaNotifications = { update };
})();
