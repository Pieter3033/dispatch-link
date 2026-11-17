const { createHttpError } = require("./httpError");

function quoteIdentifier(name) {
  if (!/^[A-Za-z0-9_]+$/.test(String(name || ""))) {
    throw createHttpError(500, `Unsafe SQL identifier: ${name}`);
  }
  return `[${name}]`;
}

function qualifiedTable(database, table) {
  return `${quoteIdentifier(database)}.dbo.${quoteIdentifier(table)}`;
}

module.exports = {
  quoteIdentifier,
  qualifiedTable
};
