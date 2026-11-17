const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const PDFDocument = require('pdfkit');
const { generateCommunicationLogReport } = require('../src/services/incidentReportService');

test('long communication comments paginate without crossing the footer or losing text', async () => {
  const originalText = PDFDocument.prototype.text;
  const originalCard = PDFDocument.prototype.roundedRect;
  let fragments = [];
  let cards = [];
  PDFDocument.prototype.text = function(text, x, y, options) {
    if (options?.lineGap === 2 && Math.abs(options.width - 515.28) < .01 && this._fontSize === 8) {
      fragments.push({ text, y, height: options.height });
    }
    return originalText.apply(this, arguments);
  };
  PDFDocument.prototype.roundedRect = function(x, y, width, height) {
    if (Math.abs(width - 539.28) < .01 && y >= 112 && height > 27) cards.push({ y, height });
    return originalCard.apply(this, arguments);
  };
  try {
    for (const notes of [
      'An ordinary short comment.',
      Array.from({ length: 250 }, (_, n) => `Paragraph ${n}: preserve the full comment and its order.`).join('\n\n'),
      'A'.repeat(15000),
      Array.from({ length: 350 }, (_, n) => `Line ${n}\n`).join(''),
      '<p>First paragraph &amp; detail.</p><p>Second paragraph.</p>'
    ]) {
      fragments = [];
      cards = [];
      const output = new Writable({ write(chunk, encoding, done) { done(); } });
      const finished = new Promise((resolve, reject) => { output.once('finish', resolve); output.once('error', reject); });
      await generateCommunicationLogReport({
        incident: { RegNo: 'TEST-PDF', EventDateTime: new Date('2026-10-09T12:00:00Z'), Company: 'Test Company', CreatedBy: 'Test Operator' },
        communications: [{ CommunicationDate: new Date('2026-10-09T12:00:00Z'), CommunicationTime: new Date('1970-01-01T12:00:00Z'), CommunicationType: 'Internal Note', CommunicationNotes: notes }]
      }, output);
      await finished;
      const expected = notes.replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/gi, '&').replace(/\n{3,}/g, '\n\n').trim();
      assert.equal(fragments.map(f => f.text).join(''), expected, 'All comment characters must survive in order');
      assert.ok(cards.length);
      assert.equal(cards.length, fragments.length, 'Each fragment has its own bounded card');
      for (const card of cards) assert.ok(card.y + card.height <= 806, 'Card must stop above the footer');
      for (const fragment of fragments) assert.ok(fragment.y + fragment.height <= 798, 'Text must retain bottom padding above the footer');
      if (notes.length > 1000) assert.ok(fragments.length > 1, 'An oversized comment must continue on another page');
    }
  } finally {
    PDFDocument.prototype.text = originalText;
    PDFDocument.prototype.roundedRect = originalCard;
  }
});
