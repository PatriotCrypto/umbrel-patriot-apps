// Real-time 3D DVD drive. Falls back to the CSS drawing if WebGL is not available.
import * as THREE from './vendor/three.module.min.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const host = document.getElementById('dvGL'), canvas = document.getElementById('dvCanvas'), dv = document.getElementById('dv');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
} catch (e) { renderer = null; }
if (renderer && host) init(); else if (host) host.hidden = true;

function init() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(28, 1.2, 1, 200);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-14, 26, 16); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 }); key.shadow.radius = 5; key.shadow.bias = -0.0004;
  scene.add(key);

  const W = 14, H = 3.6, D = 14, FZ = D / 2;
  const mats = {
    body: new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.32 }),
    tray: new THREE.MeshStandardMaterial({ metalness: 0.8, roughness: 0.38 }),
    recess: new THREE.MeshStandardMaterial({ color: 0x0c0e12, metalness: 0.2, roughness: 0.8 }),
  };
  const mk = (geo, mat, o = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = o.cast !== false; m.receiveShadow = true; return m; };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: 0.28 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const body = mk(new RoundedBoxGeometry(W, H, D, 6, 0.4), mats.body); body.position.y = H / 2; scene.add(body);

  // front panel painted onto a canvas: display, progress bar, slot, eject button
  const FW = 1360, FH = 330, fc = document.createElement('canvas'); fc.width = FW; fc.height = FH;
  const ftex = new THREE.CanvasTexture(fc); ftex.colorSpace = THREE.SRGBColorSpace; ftex.anisotropy = 8;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 3.3), new THREE.MeshStandardMaterial({ map: ftex, transparent: true, roughness: 0.45, metalness: 0.1 }));
  front.position.set(0, H / 2, FZ + 0.012); scene.add(front);

  // top badge
  const tc = document.createElement('canvas'); tc.width = 640; tc.height = 90;
  const ttex = new THREE.CanvasTexture(tc); ttex.colorSpace = THREE.SRGBColorSpace;
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.9), new THREE.MeshBasicMaterial({ map: ttex, transparent: true }));
  badge.rotation.x = -Math.PI / 2; badge.position.set(-3.1, H + 0.012, FZ - 1.2); scene.add(badge);

  // tray (lip at the front, plate behind it, disc on the plate)
  const trayG = new THREE.Group(); trayG.position.set(0, 0.8, FZ + 0.1); scene.add(trayG);
  const lip = mk(new RoundedBoxGeometry(12.9, 0.62, 0.34, 4, 0.12), mats.tray); lip.position.z = 0.05; trayG.add(lip);
  const plate = mk(new RoundedBoxGeometry(12.5, 0.22, 11.6, 4, 0.08), mats.tray); plate.position.set(0, -0.12, -5.9); trayG.add(plate);
  const rim = new THREE.Mesh(new THREE.CircleGeometry(5.95, 96), mats.recess); rim.rotation.x = -Math.PI / 2; rim.position.set(0, -0.005, -5.9); trayG.add(rim);
  const shape = new THREE.Shape(); shape.absarc(0, 0, 5.8, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.75, 0, Math.PI * 2, true); shape.holes.push(hole);
  const discMat = new THREE.MeshPhysicalMaterial({ color: 0xf6f8fb, metalness: 0.75, roughness: 0.26, emissive: 0x3a4452, envMapIntensity: 1.7, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 900], clearcoat: 0.6, clearcoatRoughness: 0.15 });
  const disc = mk(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false, curveSegments: 96 }), discMat);
  disc.rotation.x = -Math.PI / 2; disc.position.set(0, 0.0, -5.9); trayG.add(disc);
  const hub = new THREE.Mesh(new THREE.RingGeometry(0.78, 2.1, 64), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.1 }));
  hub.rotation.x = -Math.PI / 2; hub.position.set(0, 0.125, -5.9); disc.add(hub); hub.rotation.x = 0; hub.position.set(0, 0, 0.125);
  const dc = document.createElement('canvas'); dc.width = dc.height = 1024; { const g = dc.getContext('2d'); g.translate(512, 512);
    const cg = g.createConicGradient(0.5, 0, 0); ['#dfe9ff', '#ffd6ef', '#d5f7e6', '#fff2c8', '#cfe0ff', '#f3d9ff', '#dfe9ff'].forEach((c, i, a) => cg.addColorStop(i / (a.length - 1), c));
    g.fillStyle = cg; g.beginPath(); g.arc(0, 0, 512, 0, 7); g.arc(0, 0, 66, 0, 7, true); g.fill();
    g.strokeStyle = 'rgba(80,90,110,.16)'; g.lineWidth = 2; for (let r = 150; r < 505; r += 5) { g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(0, 0, 215, 0, 7); g.arc(0, 0, 150, 0, 7, true); g.fill(); }
  const dtex = new THREE.CanvasTexture(dc); dtex.colorSpace = THREE.SRGBColorSpace; dtex.anisotropy = 8;
  const face = new THREE.Mesh(new THREE.CircleGeometry(5.8, 96), new THREE.MeshPhysicalMaterial({ map: dtex, metalness: 0.5, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.2, transparent: true }));
  face.position.set(0, 0, 0.125); disc.add(face);
  const spin = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 32), new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 0.9, roughness: 0.3 }));
  spin.position.set(0, 0.13, -5.9); trayG.add(spin);

  // state
  const S = { open: false, disc: false, mode: 'idle', text: 'Ready', eta: '', pct: null, busy: false, dark: false };
  let openAmt = 0, discAmt = 0, discSpin = 0, dirty = true, themeKey = '', t0 = performance.now();
  const palette = (dark) => dark
    ? { body: 0x33383f, tray: 0x3a4048, tx: '#c8d0da', glass: '#05070a', accent: '#9aa5b3', bg: 0 }
    : { body: 0xd2d7de, tray: 0xdfe3e9, tx: '#5d6672', glass: '#07090c', accent: '#5d6672', bg: 0 };

  function drawFront() {
    const g = fc.getContext('2d'); g.clearRect(0, 0, FW, FH);
    const p = palette(S.dark);
    // display glass
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    rr(70, 24, FW - 140, 168, 22); const gl = g.createLinearGradient(0, 24, 0, 192); gl.addColorStop(0, '#0b0f14'); gl.addColorStop(1, '#030507'); g.fillStyle = gl; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 3; g.stroke();
    // LED
    const led = { idle: '#7b8594', work: '#2dd4a7', wait: '#f5a524', done: '#4ade80', bad: '#f87171' }[S.mode] || '#7b8594';
    const ledOn = S.open ? '#f5a524' : led;
    g.shadowColor = ledOn; g.shadowBlur = S.mode === 'idle' && !S.open ? 0 : 24; g.fillStyle = ledOn; g.beginPath(); g.arc(122, 70, 12, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#e6edf5'; g.font = '500 44px "IBM Plex Sans", system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(S.text, 154, 71);
    g.textAlign = 'right'; g.font = '500 38px "IBM Plex Mono", ui-monospace, monospace'; g.fillStyle = '#b8c7d6'; g.fillText(S.eta || '', FW - 106, 71);
    // progress track
    rr(100, 116, FW - 200, 56, 14); g.fillStyle = '#10161d'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 3; g.stroke();
    const tx = 104, tw = FW - 208, th = 48, ty = 120;
    const frac = S.pct == null ? 0 : Math.max(0, Math.min(1, S.pct / 100));
    g.save(); rr(tx, ty, tw, th, 11); g.clip();
    const grad = g.createLinearGradient(tx, 0, tx + tw, 0); grad.addColorStop(0, '#2f6bff'); grad.addColorStop(1, S.mode === 'done' ? '#4ade80' : '#2dd4a7');
    if (S.busy) { const ph = ((performance.now() - t0) / 1400) % 2, pos = ph < 1 ? ph : 2 - ph; const bw = tw * 0.34; g.fillStyle = grad; g.globalAlpha = 0.9; g.fillRect(tx + (tw - bw) * pos, ty, bw, th); g.globalAlpha = 1; }
    else { g.fillStyle = grad; g.shadowColor = '#2dd4a7'; g.shadowBlur = 22; g.fillRect(tx, ty, tw * (S.mode === 'done' ? 1 : frac), th); g.shadowBlur = 0; }
    g.fillStyle = 'rgba(0,0,0,.35)'; for (let x = tx; x < tx + tw; x += 16) g.fillRect(x + 12, ty, 3, th);
    g.restore();
    if (S.pct != null && S.mode !== 'done') { g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = '500 32px "IBM Plex Mono", ui-monospace, monospace'; g.shadowColor = '#000'; g.shadowBlur = 8; g.fillText(Math.round(S.pct) + '%', FW - 126, 146); g.shadowBlur = 0; }
    // slot
    rr(70, 226, FW - 140, 62, 14); g.fillStyle = '#06080b'; g.fill();
    // eject button
    g.fillStyle = p.tray === 0 ? '#999' : (S.dark ? '#444b55' : '#c0c6cf'); g.beginPath(); g.roundRect(FW - 230, 232, 110, 50, 12); g.fill();
    ftex.needsUpdate = true;
    // top badge
    const b = tc.getContext('2d'); b.clearRect(0, 0, 640, 90); b.strokeStyle = p.accent; b.fillStyle = p.accent; b.globalAlpha = 0.75; b.lineWidth = 4;
    b.beginPath(); b.arc(44, 45, 22, 0, 7); b.stroke(); b.beginPath(); b.arc(44, 45, 6, 0, 7); b.fill();
    b.font = '600 38px "IBM Plex Sans", system-ui, sans-serif'; b.textBaseline = 'middle'; b.fillText('Disc Ripper', 84, 47); ttex.needsUpdate = true;
  }
  function applyTheme() {
    const p = palette(S.dark);
    mats.body.color.set(p.body); mats.tray.color.set(p.tray);
    mats.body.roughness = S.dark ? 0.42 : 0.3;
  }

  function resize() {
    const w = Math.max(280, host.clientWidth), h = Math.round(Math.min(460, Math.max(330, w * 0.88)));
    host.style.height = h + 'px'; renderer.setSize(w, h, false); cam.aspect = w / h; cam.zoom = Math.min(1.1, w / 480); cam.updateProjectionMatrix(); dirty = true;
  }
  new ResizeObserver(resize).observe(host);

  let lastKey = '';
  function frame(now) {
    requestAnimationFrame(frame);
    if (!host.offsetParent) return;
    const tOpen = S.open ? 1 : 0, tDisc = S.disc && S.open ? 1 : 0;
    const dO = tOpen - openAmt; if (Math.abs(dO) > 0.0005) { openAmt += Math.sign(dO) * Math.min(Math.abs(dO), 0.016 * 0.9 + Math.abs(dO) * 0.06); dirty = true; }
    const dD = tDisc - discAmt; if (Math.abs(dD) > 0.001) { discAmt += dD * 0.12; dirty = true; }
    if (S.busy) { drawFront(); dirty = true; }
    const k = S.text + S.eta + S.pct + S.mode + S.open + S.dark + S.busy;
    if (k !== lastKey) { lastKey = k; drawFront(); applyTheme(); dirty = true; }
    if (!dirty) return; dirty = false;
    const e = openAmt < 0.5 ? 2 * openAmt * openAmt : 1 - Math.pow(-2 * openAmt + 2, 2) / 2;
    trayG.position.z = FZ + 0.1 + e * 10.6;
    disc.visible = spin.visible = discAmt > 0.02; disc.scale.setScalar(0.9 + 0.1 * discAmt);
    // camera: from the front-left and above; slides toward the tray as it opens
    const az = THREE.MathUtils.degToRad(-15), el = THREE.MathUtils.degToRad(21 + 5 * e), dist = 30 + 11 * e;
    const tgt = new THREE.Vector3(0.2, 1.3 - 1.0 * e, 0 + 5.4 * e);
    cam.position.set(tgt.x + dist * Math.cos(el) * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * Math.cos(el) * Math.cos(az));
    cam.lookAt(tgt);
    renderer.render(scene, cam);
  }
  window.DiscDrive = { set(s) { Object.assign(S, s); dirty = true; }, ready: true };
  if (window.__dv) Object.assign(S, window.__dv);
  const go = () => { resize(); applyTheme(); drawFront(); host.hidden = false; dv.classList.add('gl'); requestAnimationFrame(frame); };
  (document.fonts && document.fonts.load ? Promise.all([document.fonts.load('500 40px "IBM Plex Sans"'), document.fonts.load('500 30px "IBM Plex Mono"'), document.fonts.load('600 30px "IBM Plex Sans"')]).catch(() => {}) : Promise.resolve()).then(go);
  window.__dvShot = () => { dirty = true; };
}
