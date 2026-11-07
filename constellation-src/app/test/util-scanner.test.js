'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../lib/util');
const S = require('../lib/scanner');
const oui = require('../lib/oui');
const { guessType } = require('../lib/classify');

test('normMac accepts common spellings and rejects junk', () => {
  assert.equal(U.normMac('AA-BB-CC-DD-EE-FF'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(U.normMac('aabb.ccdd.eeff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(U.normMac('0:1a:2b:3c:4d:5e'), '00:1a:2b:3c:4d:5e');
  assert.equal(U.normMac('00:00:00:00:00:00'), null);
  assert.equal(U.normMac('ff:ff:ff:ff:ff:ff'), null);
  assert.equal(U.normMac('01:00:5e:00:00:fb'), null); // multicast
  assert.equal(U.normMac('nonsense'), null);
});

test('random (private) MAC detection', () => {
  assert.equal(U.isRandomMac('da:4f:21:90:6b:17'), true);
  assert.equal(U.isRandomMac('ac:bc:32:11:22:33'), false);
});

test('CIDR parsing, host lists and limits', () => {
  const c = U.parseCidr('192.168.1.77/24');
  assert.equal(c.cidr, '192.168.1.0/24');
  assert.equal(U.hostsOf(c).length, 254);
  assert.equal(U.hostsOf(U.parseCidr('10.0.0.0/23')).length, 510);
  assert.equal(U.cidrFromNetmask('192.168.1.20', '255.255.255.0').cidr, '192.168.1.0/24');
  assert.equal(U.inCidr('192.168.1.200', c), true);
  assert.equal(U.inCidr('192.168.2.1', c), false);
  assert.equal(U.parseCidr('bad'), null);
  assert.equal(U.isPrivateV4('192.168.1.5'), true);
  assert.equal(U.isPrivateV4('8.8.8.8'), false);
});

test('overlap and clip treat open sessions as running until now', () => {
  const now = 1000;
  assert.equal(U.overlapMs([[100, 200], [300, null]], 150, 400, now), 50 + 100);
  assert.deepEqual(U.clipIntervals([[100, 200], [300, null]], 150, 400, now), [[150, 200], [300, 400]]);
});

test('route parsing finds the default gateway', () => {
  const text = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n' +
    'eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n' +
    'eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0\n';
  assert.deepEqual(S.parseRoute(text), { iface: 'eth0', gateway: '192.168.1.1', metric: 100 });
});

test('ARP parsing keeps only complete entries', () => {
  const text = 'IP address       HW type     Flags       HW address            Mask     Device\n' +
    '192.168.1.1      0x1         0x2         00:26:12:aa:bb:cc     *        eth0\n' +
    '192.168.1.55     0x1         0x0         00:00:00:00:00:00     *        eth0\n' +
    '192.168.1.60     0x1         0x2         da:4f:21:90:6b:17     *        eth0\n';
  const r = S.parseArp(text);
  assert.equal(r.length, 2);
  assert.equal(r[1].mac, 'da:4f:21:90:6b:17');
});

test('detectNetwork builds the scan range from the default route', () => {
  const routeText = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\n' +
    'eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\n';
  const ifaces = { eth0: [{ family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', mac: 'a0:36:bc:12:34:56', internal: false }] };
  const n = S.detectNetwork({ routeText, ifaces });
  assert.equal(n.ok, true);
  assert.equal(n.gateway, '192.168.1.1');
  assert.deepEqual(n.cidrs, ['192.168.1.0/24']);
  const custom = S.detectNetwork({ routeText, ifaces, override: ['192.168.1.0/24', '8.8.8.0/24', '10.0.0.0/8'] });
  assert.deepEqual(custom.cidrs, ['192.168.1.0/24']); // public and oversized ranges are ignored
  assert.equal(custom.source, 'custom');
  assert.equal(S.detectNetwork({ routeText: '', ifaces: {} }).ok, false);
});

test('scanOnce probes every address and returns only in-range complete entries (plus this machine)', async () => {
  const net = { ok: true, iface: 'eth0', ip: '192.168.1.20', mac: 'a0:36:bc:12:34:56', gateway: '192.168.1.1', source: 'auto', parsed: [U.parseCidr('192.168.1.0/24')] };
  const sent = [];
  const arp = 'IP address HW type Flags HW address Mask Device\n' +
    '192.168.1.1 0x1 0x2 00:26:12:aa:bb:cc * eth0\n' +
    '10.9.9.9 0x1 0x2 aa:aa:aa:aa:aa:01 * eth0\n' +
    '172.17.0.2 0x1 0x2 aa:aa:aa:aa:aa:02 * docker0\n';
  const r = await S.scanOnce(net, { settleMs: 0, send: async (ip) => { sent.push(ip); }, readArpText: () => arp });
  assert.equal(sent.length, 254);
  assert.deepEqual(r.hosts.map((h) => h.ip).sort(), ['192.168.1.1', '192.168.1.20']);
});

test('vendor lookup and type guessing', () => {
  assert.equal(oui.lookup('b8:27:eb:11:22:33'), 'Raspberry Pi Foundation');
  assert.match(oui.lookup('00:26:12:11:22:33'), /Space Exploration/);
  assert.equal(oui.lookup('da:4f:21:90:6b:17'), null);
  assert.equal(guessType({ vendor: 'Roku', hostname: null, role: 'device' }), 'tv');
  assert.equal(guessType({ vendor: null, hostname: 'Alexs-iPhone', role: 'device' }), 'phone');
  assert.equal(guessType({ vendor: 'Space Exploration Technologies', hostname: null, role: 'device' }), 'router');
  assert.equal(guessType({ vendor: null, hostname: null, role: 'gateway' }), 'router');
  assert.equal(guessType({ vendor: 'Nobody', hostname: 'x', role: 'device' }), 'other');
});
