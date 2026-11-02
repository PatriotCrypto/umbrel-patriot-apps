import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseDate, parseCSV, parseOFX, parseStatement } from '../lib/parsers.js';

test('parseAmount handles common bank formats', () => {
  assert.equal(parseAmount('$1,234.56'), 123456);
  assert.equal(parseAmount('(12.34)'), -1234);
  assert.equal(parseAmount('-12.34'), -1234);
  assert.equal(parseAmount('12.34-'), -1234);
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('12,50'), 1250);
  assert.equal(parseAmount('1,234'), 123400);
  assert.equal(parseAmount('45.00 DR'), -4500);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('0.1'), 10);
  assert.equal(parseAmount('19.99'), 1999);
});

test('parseDate understands several layouts', () => {
  assert.equal(parseDate('2026-03-07'), '2026-03-07');
  assert.equal(parseDate('03/07/2026'), '2026-03-07');
  assert.equal(parseDate('03/07/2026', 'dmy'), '2026-07-03');
  assert.equal(parseDate('25/03/2026'), '2026-03-25');
  assert.equal(parseDate('3/7/26'), '2026-03-07');
  assert.equal(parseDate('20260307120000[0:GMT]'), '2026-03-07');
  assert.equal(parseDate('Mar 7, 2026'), '2026-03-07');
  assert.equal(parseDate('7 March 2026'), '2026-03-07');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('garbage'), null);
});

test('CSV: Date, Description, Amount with signed values', () => {
  const r = parseCSV('Date,Description,Amount\n03/01/2026,"KROGER #123, SEATTLE",-54.20\n03/02/2026,PAYROLL,2500.00\n');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { date: '2026-03-01', amount: -5420, desc: 'KROGER #123, SEATTLE' });
  assert.equal(r.rows[1].amount, 250000);
});

test('CSV: separate debit and credit columns, preamble lines, semicolons', () => {
  const r = parseCSV('Account: 1234\nGenerated;03/05/2026\n\nPosting Date;Details;Debit;Credit;Balance\n03/03/2026;Rent;1200.00;;800.00\n03/04/2026;Refund;;15.00;815.00\n');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].amount, -120000);
  assert.equal(r.rows[1].amount, 1500);
  assert.equal(r.endBalance, 81500);
});

test('CSV: a Type column does not flip already-signed amounts (card payment stays positive)', () => {
  const r = parseCSV('Transaction Date,Post Date,Description,Category,Type,Amount\n03/01/2026,03/02/2026,PAYMENT THANK YOU,,Payment,500.00\n03/03/2026,03/04/2026,SHELL,Gas,Sale,-40.00\n');
  assert.equal(r.rows[0].amount, 50000);
  assert.equal(r.rows[1].amount, -4000);
});

test('CSV: unsigned amounts use a Debit/Credit type column', () => {
  const r = parseCSV('Date,Description,Type,Amount\n03/01/2026,Coffee,DEBIT,4.50\n03/02/2026,Pay,CREDIT,100.00\n');
  assert.equal(r.rows[0].amount, -450);
  assert.equal(r.rows[1].amount, 10000);
});

test('CSV: day-first dates detected from the data', () => {
  const r = parseCSV('Date,Description,Amount\n25/03/2026,A,-1.00\n03/04/2026,B,-2.00\n');
  assert.equal(r.rows[0].date, '2026-03-25');
  assert.equal(r.rows[1].date, '2026-04-03');
});

test('CSV: headerless files are guessed, empty ones are rejected', () => {
  const r = parseCSV('03/01/2026,Some Store Name,-12.00\n03/02/2026,Another Place Here,-8.00\n');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].amount, -1200);
  assert.throws(() => parseCSV('just,some,words\n1,2,3\n'));
  assert.throws(() => parseStatement('   '));
});

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260301120000[0:GMT]
<TRNAMT>-54.20
<FITID>2026030101
<NAME>KROGER #123
<MEMO>POS PURCHASE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260302
<TRNAMT>2500.00
<FITID>2026030202
<NAME>ACME &amp; SONS PAYROLL
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1234.56<DTASOF>20260331</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('OFX/QFX (SGML without closing tags)', () => {
  const r = parseStatement(OFX, 'x.qfx');
  assert.equal(r.format, 'ofx');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].amount, -5420);
  assert.equal(r.rows[0].fitid, '2026030101');
  assert.match(r.rows[0].desc, /KROGER #123 POS PURCHASE/);
  assert.equal(r.rows[1].desc, 'ACME & SONS PAYROLL');
  assert.equal(r.endBalance, 123456);
  assert.equal(r.endDate, '2026-03-31');
});

test('PDF is refused with guidance', () => {
  assert.throws(() => parseStatement('%PDF-1.7 ....'), /CSV or OFX/);
});
