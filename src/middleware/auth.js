const { createHttpError } = require("../utils/httpError");
const { findUserBySessionId, findUserByUsername } = require("../services/userService");

function extractUsernameFromCookies(req) {
  const cookieValue = req.cookies?.username || req.cookies?.Username;
  return String(cookieValue || "").trim();
}

async function requireAuth(req, _res, next) {
  try {
    const username = extractUsernameFromCookies(req);
    const sessionId = String(req.cookies?.session || "").trim();
    const user = username
      ? await findUserByUsername(username)
      : (sessionId ? await findUserBySessionId(sessionId) : null);
    if (!user) {
      throw createHttpError(401, "An active authenticated session is required.");
    }

    if (Number(user.userType) === 15) {
      throw createHttpError(403, "Completed dispatch viewers must use the read-only SQLPage viewer.");
    }
    req.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireApprover(req, _res, next) {
  if (!req.authUser?.isApprover) {
    return next(createHttpError(403, "Approver access is required for this action."));
  }
  return next();
}

module.exports = {
  requireApprover,
  requireAuth
};
