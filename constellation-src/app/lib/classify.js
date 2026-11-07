'use strict';
// Best-guess device type from vendor and hostname. The user can always override.

const TYPES = ['router', 'server', 'computer', 'phone', 'tablet', 'tv', 'speaker', 'console', 'camera', 'printer', 'iot', 'other'];

const HOST_RULES = [
  [/iphone|pixel|galaxy-?s|oneplus|redmi|android|moto-?g/i, 'phone'],
  [/ipad|tablet|kindle|fire-?hd|galaxy-?tab/i, 'tablet'],
  [/macbook|imac|mac-?mini|laptop|desktop|thinkpad|surface|workstation|^pc-|-pc$/i, 'computer'],
  [/roku|bravia|chromecast|apple-?tv|fire-?tv|firestick|vizio|webos|smart-?tv|\btv\b|^tv-|-tv$/i, 'tv'],
  [/echo|alexa|sonos|homepod|google-?home|nest-?(mini|hub|audio)/i, 'speaker'],
  [/xbox|playstation|^ps[345]\b|nintendo|steam-?deck/i, 'console'],
  [/cam\b|camera|doorbell|arlo|wyze|eufy|reolink|blink|^ring-/i, 'camera'],
  [/printer|laserjet|officejet|deskjet|envy|^epson|^brw|^brother|^canon/i, 'printer'],
  [/umbrel|raspberry|^rpi|pi-?hole|\bnas\b|synology|qnap|home-?assistant|unraid|proxmox|server/i, 'server'],
  [/esp[-_]?\d|tasmota|shelly|tuya|sonoff|thermostat|ecobee|hue|bulb|plug|sensor|wled|homebridge|nest\b/i, 'iot'],
];

const VENDOR_RULES = [
  [/space exploration|starlink/i, 'router'],
  [/tp-?link|netgear|ubiquiti|linksys|eero|mikrotik|zyxel|d-?link|arris|ruckus|aruba|cisco meraki/i, 'router'],
  [/raspberry pi/i, 'server'],
  [/synology|qnap|western digital|seagate/i, 'server'],
  [/roku|vizio|tcl|hisense|lg electronics/i, 'tv'],
  [/sonos|bose/i, 'speaker'],
  [/nintendo|sony interactive|valve/i, 'console'],
  [/brother|canon|seiko epson|lexmark|xerox|kyocera|ricoh/i, 'printer'],
  [/espressif|tuya|shelly|sonoff|ecobee|signify|philips lighting|wyze|resideo|honeywell|belkin|tp-?link smart|meross|govee|ring llc|arlo|nest labs/i, 'iot'],
  [/dell|lenovo|intel corporate|micro-star|gigabyte|liteon|azurewave|hon hai|foxconn|asustek|acer|giga-byte/i, 'computer'],
];

function guessType({ vendor, hostname, role }) {
  if (role === 'gateway') return 'router';
  if (role === 'self') return 'server';
  const h = hostname || '';
  const v = vendor || '';
  for (const [re, t] of HOST_RULES) if (h && re.test(h)) return t;
  for (const [re, t] of VENDOR_RULES) if (v && re.test(v)) return t;
  return 'other';
}

module.exports = { TYPES, guessType };
