const config = require("../config");
const { sql, getRequest } = require("../db/pool");
const { qualifiedTable } = require("../utils/sql");

const userTable = qualifiedTable(config.db.authDatabase, "User_info");
const sessionTable = qualifiedTable(config.db.authDatabase, "Current_session");

async function findUserByUsername(username) {
  const request = await getRequest();
  request.input("username", sql.NVarChar(200), username);
  const query = `
    SELECT TOP (1)
      Username AS username,
      Name AS name,
      Surname AS surname,
      Usertype AS userType,
      Seqno AS seqNo
    FROM ${userTable}
    WHERE Username = @username
  `;

  const result = await request.query(query);
  const user = result.recordset[0];
  if (!user) return null;

  const fullName = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return {
    ...user,
    displayName: fullName || user.username,
    isApprover: Number(user.userType) === 7
  };
}

async function findUserBySessionId(sessionId) {
  const request = await getRequest();
  request.input("sessionId", sql.NVarChar(500), sessionId);
  const query = `
    WITH session_identity AS
    (
      SELECT TOP (1)
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))), '') AS username
      FROM ${sessionTable} current_session
      WHERE current_session.session_id = @sessionId
    ),
    normalized_session AS
    (
      SELECT
        username,
        LOWER(
          CASE
            WHEN CHARINDEX('@', login_name) > 0 THEN LEFT(login_name, CHARINDEX('@', login_name) - 1)
            ELSE login_name
          END
        ) AS canonical_username
      FROM session_identity
      CROSS APPLY
      (
        SELECT CASE
          WHEN CHARINDEX('\\', username) > 0 THEN RIGHT(username, CHARINDEX('\\', REVERSE(username)) - 1)
          WHEN CHARINDEX('/', username) > 0 THEN RIGHT(username, CHARINDEX('/', REVERSE(username)) - 1)
          ELSE username
        END AS login_name
      ) session_parts
    )
    SELECT TOP (1)
      user_info.Username AS username,
      user_info.Name AS name,
      user_info.Surname AS surname,
      user_info.Usertype AS userType,
      user_info.Seqno AS seqNo
    FROM normalized_session identity_row
    JOIN ${userTable} user_info ON identity_row.username IS NOT NULL
    CROSS APPLY
    (
      SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), '') AS username
    ) ui_raw
    CROSS APPLY
    (
      SELECT CASE
        WHEN CHARINDEX('\\', ui_raw.username) > 0 THEN RIGHT(ui_raw.username, CHARINDEX('\\', REVERSE(ui_raw.username)) - 1)
        WHEN CHARINDEX('/', ui_raw.username) > 0 THEN RIGHT(ui_raw.username, CHARINDEX('/', REVERSE(ui_raw.username)) - 1)
        ELSE ui_raw.username
      END AS login_name
    ) ui_parts
    CROSS APPLY
    (
      SELECT LOWER(
        CASE
          WHEN CHARINDEX('@', ui_parts.login_name) > 0 THEN LEFT(ui_parts.login_name, CHARINDEX('@', ui_parts.login_name) - 1)
          ELSE ui_parts.login_name
        END
      ) AS canonical_username
    ) ui_normalized
    WHERE ui_raw.username = identity_row.username
       OR LOWER(ui_raw.username) = identity_row.canonical_username
       OR ui_normalized.canonical_username = identity_row.canonical_username
    ORDER BY
      CASE
        WHEN ui_raw.username = identity_row.username THEN 0
        WHEN LOWER(ui_raw.username) = identity_row.canonical_username THEN 1
        ELSE 2
      END,
      user_info.Seqno
  `;
  const result = await request.query(query);
  const user = result.recordset[0];
  if (!user) return null;
  const fullName = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return {
    ...user,
    displayName: fullName || user.username,
    isApprover: Number(user.userType) === 7
  };
}

module.exports = {
  findUserBySessionId,
  findUserByUsername
};
