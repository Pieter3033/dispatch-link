const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ TextEncoder, Blob });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/dispatch-dashboard-export.js'), 'utf8'), context);
const exporter = context.DispatchDashboardExport;

async function unpack(data, period = 'Last 24 hours — 2026-11-09 10:52:02 to 2026-11-10 10:52:02') {
  const bytes = Buffer.from(await exporter.workbook(data, period).arrayBuffer());
  const files = {};
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, 'Export entries are stored without compression');
    const size = bytes.readUInt32LE(offset + 18);
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    files[bytes.toString('utf8', offset + 30, offset + 30 + bytes.readUInt16LE(offset + 26))] = bytes.toString('utf8', start, start + size);
    offset = start + size;
  }
  return files;
}

function fixture() {
  return {
    metrics: { dispatches: 5, actions: 8, contributors: 1, openedDispatches: 3 },
    contributors: [{ name: 'Existing', surname: 'Contributor', accounts: 'operator@example.test', actions: 8,
      dispatches: 2, actionShare: 1, dispatchShare: 0.4, communication: 2, fieldChanges: 1, timeline: 1, evidence: 1, other: 3 }],
    openedDispatches: [{ name: 'Opening', surname: 'Operator', dispatches: 2 }, { name: 'Unlisted.account', surname: '', dispatches: 1 }]
  };
}

test('exports separate Summary and Opened dispatches sheets with typed operator totals', async () => {
  const files = await unpack(fixture());
  assert.match(files['xl/workbook.xml'], /sheet name="Summary" sheetId="1" r:id="rId1"/);
  assert.match(files['xl/workbook.xml'], /sheet name="Opened dispatches" sheetId="2" r:id="rId3"/);
  assert.match(files['xl/_rels/workbook.xml.rels'], /Id="rId3"[^>]*Target="worksheets\/sheet2.xml"/);
  assert.match(files['[Content_Types].xml'], /PartName="\/xl\/worksheets\/sheet2.xml"/);
  const sheet = files['xl/worksheets/sheet2.xml'];
  assert.match(sheet, /<c r="B3" s="1"><v>3<\/v>/);
  assert.match(sheet, /<c r="A7"[^>]*>.*Opening Operator/);
  assert.match(sheet, /<c r="B7" s="0"><v>2<\/v>/);
  assert.match(sheet, /<c r="B8" s="0"><v>1<\/v>/);
  assert.match(sheet, /Last 24 hours — 2026-11-09 10:52:02 to 2026-11-10 10:52:02/);
  assert.match(sheet, /Counted by dispatch creation time/);
  assert.match(sheet, /autoFilter ref="A6:B8"/);
  assert.match(sheet, /pane ySplit="6" topLeftCell="A7"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /<c r="B3" s="1"><v>5<\/v>/);
  assert.match(files['xl/worksheets/sheet1.xml'], /<c r="E7" s="2"><v>1<\/v>/);
});

test('operators and periods remain safe literal text in both worksheets', async () => {
  const data = fixture();
  data.openedDispatches[0].name = '=HYPERLINK("bad") <&>\u0001';
  data.contributors[0].name = '+SUM(1,1)';
  const files = await unpack(data, 'Custom <period> & bounds');
  const sheet = files['xl/worksheets/sheet2.xml'];
  assert.match(sheet, /<c r="A7" s="0" t="inlineStr">/);
  assert.match(sheet, /=HYPERLINK\(&quot;bad&quot;\) &lt;&amp;&gt; Operator/);
  assert.match(sheet, /Custom &lt;period&gt; &amp; bounds/);
  for (const name of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.doesNotMatch(files[name], /<f[ >]|\u0001/);
  }
});

test('an empty opening period retains a zero total, headings and readable empty state', async () => {
  const data = fixture();
  data.openedDispatches = [];
  data.metrics.openedDispatches = 0;
  const files = await unpack(data, 'All dispatch event times');
  const sheet = files['xl/worksheets/sheet2.xml'];
  assert.match(sheet, /<c r="B3" s="1"><v>0<\/v>/);
  assert.match(sheet, /All dispatch opening times/);
  assert.match(sheet, /No dispatches opened for this period/);
  assert.match(sheet, /autoFilter ref="A6:B6"/);
});

test('missing opening data cannot silently produce an empty report', () => {
  const data = fixture();
  delete data.openedDispatches;
  assert.throws(() => exporter.workbook(data, 'Test'), /Opened dispatches are missing/);
});
