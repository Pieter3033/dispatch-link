const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadIncidentReportService() {
  const root = path.resolve(__dirname, '../..');
  const filename = path.join(root, 'src/services/incidentReportService.js');
  const serviceRequire = createRequire(filename);
  const fixtureConfig = {
    db: { database: 'FixtureDatabase' },
    uploads: { root: path.join(root, 'storage/dispatch-uploads') }
  };
  const fixturePool = {
    sql: {},
    getRequest() {
      assert.fail('Database access is disabled in offline report tests');
    }
  };
  const isolatedRequire = name => {
    if (name === '../config') return fixtureConfig;
    if (name === '../db/pool') return fixturePool;
    if (name === 'mssql' || name === 'dotenv') {
      assert.fail('Offline report tests must not load database or environment configuration');
    }
    return serviceRequire(name);
  };
  const module = { exports: {} };
  const load = vm.compileFunction(fs.readFileSync(filename, 'utf8'),
    ['require', 'module', 'exports', '__filename', '__dirname'], { filename });
  load(isolatedRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

module.exports = { loadIncidentReportService };
