(() => {
  "use strict";

  const signInPath = "/signin.sql";
  const returnStorageKey = "dispatch-link-auth-return";
  let redirectStarted = false;

  function currentReturnPath() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function normalizeParsedJson(value) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          return normalizeParsedJson(JSON.parse(trimmed));
        } catch {
          return value;
        }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => normalizeParsedJson(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalizeParsedJson(item)])
      );
    }
    return value;
  }

  function redirectToSignIn() {
    if (redirectStarted) return new Promise(() => {});
    redirectStarted = true;
    const returnTo = currentReturnPath();
    try {
      sessionStorage.setItem(returnStorageKey, returnTo);
    } catch {
      // The returnTo query parameter remains available if storage is disabled.
    }
    const query = new URLSearchParams({ error: "1", returnTo });
    window.location.replace(`${signInPath}?${query.toString()}`);
    return new Promise(() => {});
  }

  async function validateSession() {
    try {
      const response = await fetch("/dispatch_link/api/current_user.sql?v=20261112-reader-menu-2", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) return redirectToSignIn();
      const responseText = await response.text();
      let payload = null;
      try {
        payload = normalizeParsedJson(JSON.parse(responseText));
      } catch {
        const responseDocument = new DOMParser().parseFromString(responseText, "text/html");
        for (const cell of responseDocument.querySelectorAll("td")) {
          try {
            payload = normalizeParsedJson(JSON.parse(cell.textContent.trim()));
            break;
          } catch {
            // Continue through SQLPage-rendered cells until JSON is found.
          }
        }
      }
      if (payload?.authenticated !== true || !payload?.user) return redirectToSignIn();
      const userType = String(payload.user.user_type ?? payload.user.userType ?? "").trim();
      const completedOnly = userType === "15" || [true, 1, "1", "true"].includes(payload.user.completedDispatchOnly);
      document.documentElement.dataset.dispatchAccess = completedOnly ? "completed-only" : "standard";
      if (completedOnly) {
        const page = window.location.pathname.split("/").pop().toLowerCase();
        const detail = page === "dispatch.html" && /^\d+$/.test(new URLSearchParams(window.location.search).get("id") || "");
        if (page !== "completed.html" && !detail) {
          window.location.replace("/dispatch_link/public/completed.html");
          return new Promise(() => {});
        }
      }
      document.documentElement.classList.remove("auth-pending");
      return payload;
    } catch {
      return redirectToSignIn();
    }
  }

  globalThis.redirectDispatchToSignIn = redirectToSignIn;
  globalThis.dispatchAuthReady = validateSession();
})();
