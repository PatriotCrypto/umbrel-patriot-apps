'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../lib/names');

// Build a minimal mDNS-style PTR response for 20.1.168.192.in-addr.arpa -> host.local
function ptrResponse(target) {
  const q = N.buildQuery('20.1.168.192.in-addr.arpa', 12);
  const h = Buffer.from(q.subarray(0, 12));
  h.writeUInt16BE(0x8400, 2);
  h.writeUInt16BE(1, 6);
  const question = q.subarray(12);
  // answer: pointer to the question name, type PTR, class IN, ttl, rdlength, rdata
  const rdata = N.encodeName(target);
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(12, 0);
  fixed.writeUInt16BE(1, 2);
  fixed.writeUInt32BE(120, 4);
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([h, question, Buffer.from([0xc0, 12]), fixed, rdata]);
}

test('mDNS reverse query is well formed', () => {
  const q = N.buildQuery(N.reverseArpa('192.168.1.20'), 12);
  assert.equal(q.readUInt16BE(4), 1);
  assert.equal(N.readName(q, 12).name, '20.1.168.192.in-addr.arpa');
});

test('PTR answers are parsed, including compressed names', () => {
  assert.equal(N.parsePtrAnswer(ptrResponse('Alexs-iPhone.local')), 'Alexs-iPhone.local');
  assert.equal(N.parsePtrAnswer(Buffer.alloc(5)), null);
});

test('hostnames are cleaned up', () => {
  assert.equal(N.cleanHostname('Alexs-iPhone.local.'), 'Alexs-iPhone');
  assert.equal(N.cleanHostname('printer.lan'), 'printer');
  assert.equal(N.cleanHostname('192.168.1.5'), null);
  assert.equal(N.cleanHostname('_gateway'), null);
  assert.equal(N.cleanHostname(''), null);
  assert.equal(N.cleanHostname('a<b>c'), 'abc');
});

test('NetBIOS node-status replies yield the machine name', () => {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(1, 6);
  const nameField = Buffer.concat([Buffer.from([32]), Buffer.from('CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), Buffer.from([0])]);
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(0x21, 0);
  fixed.writeUInt16BE(1, 2);
  const entry = (name, suffix, flags) => {
    const b = Buffer.alloc(18, 0x20);
    b.write(name, 0, 'latin1');
    b[15] = suffix;
    b.writeUInt16BE(flags, 16);
    return b;
  };
  const names = Buffer.concat([Buffer.from([2]), entry('WORKGROUP', 0, 0x8400), entry('OFFICE-PC', 0, 0x0400)]);
  fixed.writeUInt16BE(names.length, 8);
  const pkt = Buffer.concat([head, nameField, fixed, names, Buffer.alloc(46)]);
  assert.equal(N.parseNbnsAnswer(pkt), 'OFFICE-PC'); // skips the group name
});

test('NetBIOS query packet is 50 bytes', () => {
  assert.equal(N.buildNbnsQuery().length, 50);
});
