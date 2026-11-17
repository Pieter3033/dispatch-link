const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// These pages belong to the host application, outside this module's repository.
// Opt in explicitly; this check only reads HTML files and never uses a database.
test('host application pages include the Admin-only VESA navigation link', () => {
  const hostRoot = process.env.DISPATCH_HOST_APP_ROOT;
  assert.ok(hostRoot, 'Set DISPATCH_HOST_APP_ROOT to the host application directory');
  for (const name of ['index', 'dashboard', 'escalations', 'quick_logs', 'completed_quick_logs', 'quick_log_dashboard']) {
    const html = fs.readFileSync(path.join(hostRoot, 'internaltickets', `${name}.html`), 'utf8');
    assert.match(html, /href="\/dispatch_link\/public\/vesa\.html" data-show-for-user-type="7" hidden/,
      `The ${name} page must restrict VESA navigation to Admins`);
  }
});
