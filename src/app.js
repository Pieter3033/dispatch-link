const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const config = require("./config");
const dispatchRoutes = require("./routes/dispatchRoutes");

const app = express();

app.disable("x-powered-by");
app.use(cookieParser());
app.use((req, res, next) => {
  const origin = req.headers.origin;

  function isAllowedLocalOrigin(value) {
    if (value === "null") return true;
    if (!value) return false;
    try {
      const parsed = new URL(value);
      const hostname = parsed.hostname;
      const isPrivateIpv4 = /^10\./.test(hostname)
        || /^192\.168\./.test(hostname)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
      return ["http:", "https:"].includes(parsed.protocol)
        && (["localhost", "127.0.0.1", "::1"].includes(hostname) || isPrivateIpv4);
    } catch (_error) {
      return false;
    }
  }

  if (isAllowedLocalOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});
app.use("/uploads", express.static(config.uploads.root, {
  fallthrough: false,
  index: false,
  immutable: false,
  maxAge: "1h"
}));
app.use("/api", dispatchRoutes);
app.use("/dispatch_link/public", express.static(path.join(process.cwd(), "public"), {
  extensions: ["html"]
}));
app.use(express.static(path.join(process.cwd(), "public"), {
  extensions: ["html"]
}));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: err.message || "Unexpected server error.",
      details: err.details || null
    }
  });
});

module.exports = app;
