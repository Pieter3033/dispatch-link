const config = require("../config/bisHistory");
const { execFileSync } = require("child_process");

let protectedConnectorToken;

function connectorToken() {
  if (config.token) return config.token;
  if (protectedConnectorToken !== undefined) return protectedConnectorToken;
  if (process.platform !== "win32") return "";
  try {
    const script = [
      "$machinePath = Join-Path (Get-Location) 'tools\\bis-history-connector\\connection.dat'",
      "$userPath = Join-Path $env:LOCALAPPDATA 'BISHistoryConnector\\connection.dat'",
      "$path = if (Test-Path -LiteralPath $machinePath) { $machinePath } else { $userPath }",
      "if (-not (Test-Path -LiteralPath $path)) { exit 2 }",
      "Add-Type -AssemblyName System.Security",
      "$encrypted = [IO.File]::ReadAllBytes($path)",
      "$scope = if ($path -eq $machinePath) { [System.Security.Cryptography.DataProtectionScope]::LocalMachine } else { [System.Security.Cryptography.DataProtectionScope]::CurrentUser }",
      "$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, $scope)",
      "$json = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json",
      "[Console]::Out.Write([string]$json.ApiToken)"
    ].join("; ");
    protectedConnectorToken = String(execFileSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000
    }) || "").trim();
  } catch (_error) {
    protectedConnectorToken = "";
  }
  return protectedConnectorToken;
}

function reportWindow(incident) {
  const dispatchStart = new Date(incident.DispatchDateTime || incident.EventDateTime);
  const dispatchEnd = new Date(incident.StandDownDateTime || incident.ClosedAt || incident.UpdatedAt);
  if (Number.isNaN(dispatchStart.getTime())) throw new Error("The dispatch start time is missing or invalid.");
  if (Number.isNaN(dispatchEnd.getTime())) throw new Error("The dispatch end time is missing or invalid.");
  const start = new Date(dispatchStart.getTime() - (24 * 60 * 60 * 1000));
  if (dispatchEnd <= start) throw new Error("The dispatch end time must be after the MSTrack history start time.");
  return { start: start.toISOString(), end: dispatchEnd.toISOString() };
}

async function fetchBisHistory(incident) {
  const token = connectorToken();
  if (!token) {
    return { configured: false, registration: incident.RegNo || null, rows: [], count: 0 };
  }

  const registration = String(incident.RegNo || "").trim();
  if (!registration) {
    return { configured: true, registration: null, rows: [], count: 0 };
  }

  const url = new URL(`${config.url}/history`);
  url.searchParams.set("registration", registration);
  let window;
  try { window = reportWindow(incident); } catch (error) {
    error.reportCode = "history-window";
    throw error;
  }
  url.searchParams.set("start", window.start);
  url.searchParams.set("end", window.end);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "X-BIS-Token": token },
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`MSTrack connector returned HTTP ${response.status}.`);
      error.reportCode = response.status === 401 ? "connector-auth"
        : response.status === 422 ? "history-window"
        : response.status === 500 ? "history-query" : "connector-response";
      throw error;
    }
    const payload = await response.json();
    return {
      configured: true,
      registration: payload.registration || registration,
      start: payload.start || window.start,
      end: payload.end || window.end,
      count: Number(payload.count) || 0,
      rows: Array.isArray(payload.rows) ? payload.rows : []
    };
  } catch (error) {
    if (!error.reportCode) {
      error.reportCode = error.name === "AbortError" ? "connector-timeout"
        : ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ETIMEDOUT"].includes(error.cause?.code)
          ? "connector-unreachable" : "connector-response";
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchBisHistory };
