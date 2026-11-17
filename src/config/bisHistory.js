// Also used by SQLPage's standalone report generator, which does not need
// the alternative Node backend's Dispatch database credentials.
module.exports = {
  url: (process.env.BIS_HISTORY_API_URL || "http://127.0.0.1:43128").trim().replace(/\/+$/, ""),
  token: (process.env.BIS_HISTORY_API_TOKEN || "").trim()
};
