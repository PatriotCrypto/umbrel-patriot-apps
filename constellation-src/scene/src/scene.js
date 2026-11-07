// The 3D network view. Gateway at the centre, devices orbiting on rings by kind,
// a dish above linked to a train of satellites, a planet limb on the horizon.
// Pure presentation: it only draws what the API reports and invents no data.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, Group, Mesh, SphereGeometry, MeshBasicMaterial,
  Sprite, SpriteMaterial, CanvasTexture, AdditiveBlending, NormalBlending, BufferGeometry, Float32BufferAttribute,
  Line, LineBasicMaterial, LineSegments, Points, PointsMaterial, Vector3, QuadraticBezierCurve3,
  TorusGeometry, CylinderGeometry, ConeGeometry, ShaderMaterial, Raycaster, Vector2, MathUtils, Plane, Quaternion, Texture, BufferAttribute,
} from 'three';

const TWO_PI = Math.PI * 2;
const GOLDEN = 2.399963;
const RING_R = [0, 3.4, 6.0, 8.8];
const RING_Y = [0.35, 0.55, 1.15, 1.8];
const DEFAULT_VIEW = { yaw: 0.38, pitch: 0.55, dist: 24 };
const HOME_TARGET = new Vector3(0, 1.1, 0);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function tierOf(d) {
  if (d.role === 'gateway') return 0;
  if (d.role === 'self' || d.type === 'server') return 1;
  if (d.type === 'computer' || d.type === 'phone' || d.type === 'tablet') return 2;
  return 3;
}

const UMBREL = new Color('#5351f3');
// A device counts as an Umbrel when its discovered hostname or the name you gave it says so.
const BTC = new Color('#f7931a');
const WINGBITS = new Color('#0b0c0f');
const WINGBITS_HALO = new Color('#9aa3b8');
const CAR = new Color('#cf2a2f');

// A plain white car silhouette (side view, generic sedan) for devices named Tesla.
function carTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.beginPath();
  x.moveTo(26, 150); x.bezierCurveTo(26, 136, 38, 130, 60, 126); x.lineTo(98, 114);
  x.bezierCurveTo(120, 90, 152, 84, 180, 88); x.bezierCurveTo(202, 92, 216, 112, 226, 126);
  x.lineTo(236, 134); x.bezierCurveTo(246, 138, 248, 146, 248, 156); x.lineTo(248, 166); x.lineTo(26, 166); x.closePath(); x.fill();
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.moveTo(108, 113); x.lineTo(128, 96); x.lineTo(172, 95); x.lineTo(206, 114); x.closePath(); x.fill();
  x.fillRect(150, 94, 5, 22);
  for (const cx of [80, 200]) { x.beginPath(); x.arc(cx, 168, 28, 0, TWO_PI); x.fill(); }
  x.globalCompositeOperation = 'source-over';
  for (const cx of [80, 200]) {
    x.beginPath(); x.arc(cx, 168, 21, 0, TWO_PI); x.fill();
    x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(cx, 168, 13, 0, TWO_PI); x.fill();
    x.globalCompositeOperation = 'source-over'; x.beginPath(); x.arc(cx, 168, 6, 0, TWO_PI); x.fill();
  }
  const t = new Texture(c); t.needsUpdate = true; return t;
}
// 'btc' (named bitcoin/btc, or found listening on the Bitcoin port), 'umbrel' (named umbrel), 'wingbits' (named wingbits), or null.
function kindOf(d) {
  const nm = [d.hostname, d.name].filter(Boolean).join(' ');
  if (/bitcoin|btc/i.test(nm)) return 'btc';
  if (/umbrel/i.test(nm)) return 'umbrel';
  if (/wingbits/i.test(nm)) return 'wingbits';
  if (/tesla/i.test(nm)) return 'car';
  return d.btc ? 'btc' : null;
}


function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n, f) => new Color(((cs.getPropertyValue(n) || '').trim()) || f);
  return {
    bg: g('--bg', '#000000'), node: g('--scene-node', '#e8f1ff'), off: g('--scene-off', '#3a414d'),
    link: g('--scene-link', '#9fb7d6'), rim: g('--scene-rim', '#7fb2ff'), warn: g('--warn', '#ffb547'),
    bad: g('--bad', '#ff5d5d'), ok: g('--ok', '#7ee0b0'), accent: g('--accent', '#ffffff'),
    light: (cs.getPropertyValue('--scene-light') || '').trim() === '1',
  };
}

function glowTexture(inner = 0.0) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, inner * 64, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = 'rgba(255,255,255,1)';
  x.lineWidth = 5;
  x.beginPath();
  x.arc(64, 64, 52, 0, TWO_PI);
  x.stroke();
  return new CanvasTexture(c);
}

function circleLine(radius, segs = 160) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TWO_PI;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return g;
}

function create(container, opts = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    return { supported: false };
  }
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.className = 'cs-canvas';
  container.appendChild(canvas);
  const labelsLayer = document.createElement('div');
  labelsLayer.className = 'cs-labels';
  container.appendChild(labelsLayer);

  let T = readTheme();
  const blendNow = () => (T.light ? NormalBlending : AdditiveBlending);
  const scene = new Scene();
  renderer.setClearColor(0x000000, 0);
  scene.fog = new Fog(T.bg.clone(), 30, 90);
  const camera = new PerspectiveCamera(42, 1, 0.1, 1200);

  const glowTex = glowTexture();
  const ringTex = ringTexture();
  const disposables = [glowTex, ringTex];
  let logoTex = null;
  let btcTex = null;
  let wbTex = null;
  const carTex = carTexture();
  disposables.push(carTex);
  if (opts.wingbitsLogo) {
    const wi = new Image();
    wi.onload = () => { wbTex = new Texture(wi); wbTex.needsUpdate = true; disposables.push(wbTex); for (const n of nodes.values()) restyle(n); };
    wi.src = opts.wingbitsLogo;
  }
  if (opts.bitcoinLogo) {
    const bi = new Image();
    bi.onload = () => { btcTex = new Texture(bi); btcTex.needsUpdate = true; disposables.push(btcTex); for (const n of nodes.values()) restyle(n); };
    bi.src = opts.bitcoinLogo;
  }
  if (opts.umbrelLogo) {
    const im = new Image();
    im.onload = () => { logoTex = new Texture(im); logoTex.needsUpdate = true; disposables.push(logoTex); for (const n of nodes.values()) restyle(n); };
    im.src = opts.umbrelLogo;
  }

  // ---------- backdrop: stars, planet limb ----------
  const starGeo = new BufferGeometry();
  {
    const n = 900;
    const p = [];
    const col = [];
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * TWO_PI;
      const r = 300 + Math.random() * 200;
      const s = Math.sqrt(1 - u * u);
      p.push(Math.cos(a) * s * r, Math.abs(u) * r * 0.9 + 4, Math.sin(a) * s * r);
      const b = 0.25 + Math.random() * 0.75;
      col.push(b, b, b);
    }
    starGeo.setAttribute('position', new Float32BufferAttribute(p, 3));
    starGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
  }
  const stars = new Points(starGeo, new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, fog: false, depthWrite: false }));
  stars.renderOrder = -9;
  stars.material.opacity = 0.55;
  stars.visible = !T.light;
  scene.add(stars);

  const planetMat = new ShaderMaterial({
    uniforms: { rim: { value: T.rim.clone() }, bg: { value: T.bg.clone() }, light: { value: new Vector3(-0.45, 0.85, 0.3).normalize() } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 rim; uniform vec3 bg; uniform vec3 light; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0); float l = 0.2 + 0.8 * max(dot(normalize(vN), light), 0.0); vec3 c = mix(bg, rim, clamp(f * l * 1.7, 0.0, 1.0)); gl_FragColor = vec4(c, 1.0); }',
  });
  const planet = new Mesh(new SphereGeometry(95, 96, 64), planetMat);
  planet.position.set(0, -92, -150);
  planet.renderOrder = -10;

  // ---------- ground grid ----------
  const grid = new Group();
  const gridMat = new LineBasicMaterial({ color: T.link, transparent: true, opacity: 0.2 });
  grid.add(new Line(circleLine(2.6), gridMat));
  const orbitRing = new Line(circleLine(1, 200), gridMat);
  grid.add(orbitRing);
  scene.add(grid);

  // ---------- gateway ----------
  const gatewayPos = new Vector3(0, RING_Y[0], 0);
  const gateway = new Group();
  gateway.position.copy(gatewayPos);
  const gwCore = new Mesh(new SphereGeometry(0.42, 40, 28), new MeshBasicMaterial({ color: T.accent.clone() }));
  const gwHalo = new Sprite(new SpriteMaterial({ map: glowTex, color: T.node.clone(), blending: blendNow(), transparent: true, opacity: 0.75, depthWrite: false }));
  gwHalo.scale.setScalar(3);
  const gwRing1 = new Mesh(new TorusGeometry(0.85, 0.012, 8, 120), new MeshBasicMaterial({ color: T.node.clone(), transparent: true, opacity: 0.8 }));
  gwRing1.rotation.x = Math.PI / 2;
  const gwRing2 = new Mesh(new TorusGeometry(1.15, 0.008, 8, 120), new MeshBasicMaterial({ color: T.node.clone(), transparent: true, opacity: 0.45 }));
  gwRing2.rotation.set(Math.PI / 2.6, 0.5, 0);
  gateway.add(gwCore, gwHalo, gwRing1, gwRing2);
  const gwHit = new Mesh(new SphereGeometry(0.9, 12, 8), new MeshBasicMaterial({ visible: false }));
  gwHit.userData.mac = null;
  gateway.add(gwHit);
  scene.add(gateway);

  // ---------- dish and satellites ----------
  const dishPos = new Vector3(0, 6.4, 0);
  const dish = new Group();
  dish.position.copy(dishPos);
  const dishPlate = new Mesh(new CylinderGeometry(0.7, 0.7, 0.05, 48), new MeshBasicMaterial({ color: T.node.clone(), transparent: true, opacity: 0.9 }));
  dishPlate.rotation.x = 0.7;
  const dishRim = new Mesh(new TorusGeometry(0.7, 0.012, 8, 64), new MeshBasicMaterial({ color: T.accent.clone() }));
  dishRim.rotation.x = Math.PI / 2 + 0.7;
  const dishHalo = new Sprite(new SpriteMaterial({ map: glowTex, color: T.node.clone(), blending: blendNow(), transparent: true, opacity: 0.4, depthWrite: false }));
  dishHalo.scale.setScalar(2.6);
  dish.add(dishPlate, dishRim, dishHalo);
  const mastGeo = new BufferGeometry();
  mastGeo.setAttribute('position', new Float32BufferAttribute([0, gatewayPos.y, 0, 0, dishPos.y - 0.3, 0], 3));
  const mast = new Line(mastGeo, new LineBasicMaterial({ color: T.link, transparent: true, opacity: 0.5 }));

  const SATS = 11;
  const satGeo = new BufferGeometry();
  satGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(SATS * 3), 3));
  const sats = new Points(satGeo, new PointsMaterial({ size: 0.28, map: glowTex, color: T.node.clone(), transparent: true, blending: blendNow(), depthWrite: false }));
  const orbitMat = new LineBasicMaterial({ color: T.link, transparent: true, opacity: 0.1 });
  const orbit = new Line(circleLine(30, 220), orbitMat);
  orbit.position.set(0, 12, -6);
  orbit.rotation.set(0.42, 0, 0.12);
  const beamGeo = new BufferGeometry();
  beamGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
  const beam = new Line(beamGeo, new LineBasicMaterial({ color: T.node.clone(), transparent: true, opacity: 0.5 }));

  // ---------- one constellation: a single ring whose order the person sets ----------
  let order = [];
  let curDevs = [];
  let edit = false;
  let drag = null; // { id, moved, slot }
  let arcSig = '';
  let arcs = []; // { line, el, pos }
  const RING_Y1 = 1.0;
  const ringRadius = (n) => Math.max(6.2, Math.min(11, (n * 1.7) / TWO_PI));
  const slotAngle = (i, n) => -Math.PI / 2 + 0.15 + (i / n) * TWO_PI;
  function tagColor(tag) { return new Color().setHSL(hash('tag:' + tag), 0.85, T.light ? 0.42 : 0.62); }

  function orderedMacs() {
    const have = new Map(curDevs.filter((d) => d.role !== 'gateway').map((d) => [d.mac, d]));
    const out = [];
    for (const m of order) if (have.has(m)) { out.push(m); have.delete(m); }
    const rest = [...have.values()].sort((a, b) => a.firstSeen - b.firstSeen || (a.mac < b.mac ? -1 : 1));
    for (const d of rest) out.push(d.mac);
    return out;
  }
  function slotList() {
    let l = orderedMacs();
    if (drag && drag.slot !== null) {
      l = l.filter((m) => m !== drag.id);
      l.splice(Math.min(drag.slot, l.length), 0, drag.id);
    }
    return l;
  }

  function clearArcs() {
    for (const a of arcs) { scene.remove(a.line); a.line.geometry.dispose(); a.line.material.dispose(); a.el.remove(); }
    arcs = [];
  }
  // Colored arcs and names mark runs of devices that share a tag (a room, a person, anything).
  function buildArcs(list, R) {
    const byMac = new Map(curDevs.map((d) => [d.mac, d]));
    const n = list.length;
    const runs = [];
    list.forEach((m, i) => {
      const tag = (byMac.get(m) || {}).group || '';
      if (!tag) return;
      const last = runs[runs.length - 1];
      if (last && last.tag === tag && last.end === i - 1) last.end = i; else runs.push({ tag, start: i, end: i });
    });
    const sig = JSON.stringify([runs, n, T.light]);
    if (sig === arcSig) return;
    arcSig = sig;
    clearArcs();
    const step = TWO_PI / Math.max(1, n);
    for (const r of runs) {
      const a0 = slotAngle(r.start, n) - step * 0.42;
      const a1 = slotAngle(r.end, n) + step * 0.42;
      const segs = Math.max(6, (r.end - r.start + 1) * 6);
      const pts = [];
      for (let k = 0; k <= segs; k++) { const a = a0 + ((a1 - a0) * k) / segs; pts.push(Math.cos(a) * (R + 1), 0.04, Math.sin(a) * (R + 1)); }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pts, 3));
      const col = tagColor(r.tag);
      const line = new Line(g, new LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
      scene.add(line);
      const el = document.createElement('div');
      el.className = 'cs-label tag';
      el.textContent = r.tag;
      el.style.color = '#' + col.getHexString();
      labelsLayer.appendChild(el);
      const am = (a0 + a1) / 2;
      arcs.push({ line, el, pos: new Vector3(Math.cos(am) * (R + 2.1), 0.5, Math.sin(am) * (R + 2.1)) });
    }
  }

  function layoutRing() {
    const list = slotList();
    const n = list.length;
    const R = ringRadius(n);
    list.forEach((mac, i) => {
      const nd = nodes.get(mac);
      if (!nd || (drag && drag.id === mac)) return;
      const a = slotAngle(i, n);
      nd.target.set(Math.cos(a) * R, RING_Y1, Math.sin(a) * R);
      if (nd.born > performance.now() - 50 && nd.pos.lengthSq() === 0) nd.pos.copy(nd.target).multiplyScalar(0.2);
    });
    buildArcs(list, R);
    orbitRing.scale.setScalar(R);
    orbitRing.position.y = 0.04;
  }

  // ---------- device nodes ----------
  const nodes = new Map(); // mac -> node
  const hitList = [gwHit];
  const nodeGeo = new SphereGeometry(1, 24, 16);
  const hitGeo = new SphereGeometry(0.62, 10, 8);
  const linkMat = new LineBasicMaterial({ color: T.link, transparent: true, opacity: 0.3 });
  const stemMat = new LineBasicMaterial({ color: T.link, transparent: true, opacity: 0.16 });

  let internet = { state: 'unknown' };
  let selected = null;
  let hovered = null;
  let options = Object.assign({ labels: true, showOffline: true }, opts.options || {});
  let liftT0 = 0;

  function makeNode(d) {
    const group = new Group();
    const mesh = new Mesh(nodeGeo, new MeshBasicMaterial({ color: T.node.clone(), transparent: true }));
    const halo = new Sprite(new SpriteMaterial({ map: glowTex, color: T.node.clone(), blending: blendNow(), transparent: true, depthWrite: false }));
    const ring = new Sprite(new SpriteMaterial({ map: ringTex, color: T.warn.clone(), transparent: true, depthWrite: false }));
    const hit = new Mesh(hitGeo, new MeshBasicMaterial({ visible: false }));
    hit.userData.mac = d.mac;
    group.add(mesh, halo, ring, hit);
    scene.add(group);
    const link = new Line(new BufferGeometry(), linkMat.clone());
    const stem = new Line(new BufferGeometry(), stemMat.clone());
    scene.add(link, stem);
    const el = document.createElement('div');
    el.className = 'cs-label';
    labelsLayer.appendChild(el);
    hitList.push(hit);
    const n = {
      mac: d.mac, dev: d, group, mesh, halo, ring, hit, link, stem, el,
      pos: new Vector3(), target: new Vector3(), curve: null, phase: hash(d.mac + 'p'), speed: 0.18 + hash(d.mac + 's') * 0.2, dirty: true, born: performance.now(),
    };
    nodes.set(d.mac, n);
    return n;
  }

  function removeNode(n) {
    scene.remove(n.group, n.link, n.stem);
    n.link.geometry.dispose(); n.stem.geometry.dispose();
    n.mesh.material.dispose(); n.halo.material.dispose(); n.ring.material.dispose(); n.link.material.dispose(); n.stem.material.dispose();
    if (n.logo) n.logo.material.dispose();
    n.el.remove();
    hitList.splice(hitList.indexOf(n.hit), 1);
    nodes.delete(n.mac);
  }

  function layout() { layoutRing(); }

  function nodeRadius(d) {
    if (kindOf(d)) return d.online ? 0.38 : 0.2;
    if (!d.online) return 0.13;
    return d.role === 'self' ? 0.3 : d.type === 'server' ? 0.26 : 0.2;
  }

  function restyle(n) {
    const d = n.dev;
    const dim = selected && selected !== n.mac ? 0.38 : 1;
    const hot = selected === n.mac || hovered === n.mac;
    const visible = d.online || options.showOffline;
    n.group.visible = visible; n.link.visible = visible && d.online; n.stem.visible = false;
    const isNew = !d.known && d.online;
    const kind = kindOf(d);
    const um = !!kind;
    const kcol = kind === 'btc' ? BTC : kind === 'wingbits' ? WINGBITS : kind === 'car' ? CAR : UMBREL;
    const col = um ? (d.online ? kcol : kcol.clone().lerp(T.off, 0.65)) : !d.online ? T.off : isNew ? T.warn : T.node;
    const kmap = kind === 'btc' ? btcTex : kind === 'wingbits' ? wbTex : kind === 'car' ? carTex : logoTex;
    if (kind && kmap && (!n.logo || n.logoKind !== kind)) {
      if (n.logo) { n.group.remove(n.logo); n.logo.material.dispose(); }
      n.logo = new Sprite(new SpriteMaterial({ map: kmap, transparent: true, depthWrite: false, depthTest: false }));
      n.logo.renderOrder = 5;
      n.logoKind = kind;
      n.group.add(n.logo);
    }
    if (n.logo) { n.logo.visible = um; n.logo.material.opacity = (d.online ? 1 : 0.5) * dim; }
    n.mesh.material.color.copy(col);
    n.mesh.material.opacity = (d.online ? 1 : 0.8) * dim;
    n.mesh.scale.setScalar(nodeRadius(d));
    n.halo.visible = d.online;
    n.halo.material.color.copy(kind === 'wingbits' && d.online ? WINGBITS_HALO : n.dev.group && d.online && !isNew && !um ? tagColor(n.dev.group) : col);
    n.halo.material.opacity = (T.light ? 0.28 : 0.7) * dim;
    n.halo.material.blending = blendNow();
    n.halo.scale.setScalar(nodeRadius(d) * 7);
    n.ring.visible = isNew || selected === n.mac;
    n.ring.material.color.copy(selected === n.mac ? T.accent : T.warn);
    n.link.material.color.copy(isNew ? T.warn : T.link);
    n.link.material.opacity = hot ? 0.85 : (selected ? 0.05 : 0.11);
    n.stem.material.opacity = (d.online ? 0.18 : 0.08) * dim;
    n.stem.material.color.copy(T.link);
  }

  function rebuildGeometry(n) {
    const p = n.pos;
    n.group.position.copy(p);
    const dist = p.distanceTo(gatewayPos);
    const mid = new Vector3().addVectors(p, gatewayPos).multiplyScalar(0.5);
    mid.y += 0.7 + dist * 0.09;
    n.curve = new QuadraticBezierCurve3(gatewayPos.clone(), mid, p.clone());
    const pts = n.curve.getPoints(28);
    const arr = [];
    for (const q of pts) arr.push(q.x, q.y, q.z);
    n.link.geometry.setAttribute('position', new Float32BufferAttribute(arr, 3));
    n.stem.geometry.setAttribute('position', new Float32BufferAttribute([p.x, p.y, p.z, p.x, 0, p.z], 3));
  }

  // moving pulses along links of online devices (decoration only)
  const MAXP = 256;
  const pulseGeo = new BufferGeometry();
  pulseGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAXP * 3), 3));
  const pulseMat = new PointsMaterial({ size: 0.2, map: glowTex, color: T.node.clone(), transparent: true, blending: blendNow(), depthWrite: false });
  const pulses = new Points(pulseGeo, pulseMat);
  pulses.frustumCulled = false;
  pulses.visible = false;

  // ---------- camera ----------
  const view = Object.assign({}, DEFAULT_VIEW);
  const goal = { dist: DEFAULT_VIEW.dist, target: HOME_TARGET.clone() };
  const target = HOME_TARGET.clone();
  let lastInteract = performance.now();

  function placeCamera() {
    const cp = Math.cos(view.pitch);
    camera.position.set(
      target.x + view.dist * Math.sin(view.yaw) * cp,
      target.y + view.dist * Math.sin(view.pitch),
      target.z + view.dist * Math.cos(view.yaw) * cp,
    );
    camera.lookAt(target);
  }

  // ---------- input ----------
  const ray = new Raycaster();
  const ndc = new Vector2();
  const ptrs = new Map();
  let moved = 0;
  let pinch = 0;
  let pointer = null;
  let inside = false;
  let frame = 0;

  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(hitList, false).filter((h) => h.object.parent.visible);
    return hits.length ? hits[0].object : null;
  }

  const dragPlane = new Plane(new Vector3(0, 1, 0), -RING_Y1);
  const hitPt = new Vector3();
  function groundPoint(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(dragPlane, hitPt) ? hitPt : null;
  }
  function relayout() { layoutRing(); for (const n of nodes.values()) { n.dirty = true; restyle(n); } }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (edit && ptrs.size === 0) {
      const h = pick(e.clientX, e.clientY);
      if (h && h.userData.mac && nodes.has(h.userData.mac)) drag = { id: h.userData.mac, moved: 0, slot: null };
      if (drag) canvas.style.cursor = 'grabbing';
    }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    lastInteract = performance.now();
  });
  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (drag) {
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved < 5) return;
      const pt = groundPoint(e.clientX, e.clientY);
      if (!pt) return;
      const n = nodes.get(drag.id);
      const cnt = orderedMacs().length;
      const R = ringRadius(cnt);
      const a = Math.atan2(pt.z, pt.x);
      if (n) { n.pos.set(Math.cos(a) * R, RING_Y1 + 0.5, Math.sin(a) * R); n.target.copy(n.pos); n.dirty = true; }
      const rel = (((a - slotAngle(0, cnt)) % TWO_PI) + TWO_PI) % TWO_PI;
      drag.slot = Math.round((rel / TWO_PI) * cnt) % cnt;
      relayout();
      lastInteract = performance.now();
      return;
    }
    if (ptrs.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      view.yaw -= dx * 0.0055;
      view.pitch = MathUtils.clamp(view.pitch + dy * 0.0045, 0.14, 1.4);
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) goal.dist = MathUtils.clamp(goal.dist * (pinch / d), 8, 40);
      pinch = d;
      moved += 10;
    }
    lastInteract = performance.now();
  });
  const endPtr = (e) => {
    const was = ptrs.size === 1 && ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    pinch = 0;
    if (drag) {
      const d = drag;
      const list = slotList();
      const moved = d.moved >= 5 && e.type === 'pointerup' && d.slot !== null;
      drag = null;
      canvas.style.cursor = 'grab';
      if (moved) {
        const byMac = new Map(curDevs.map((x) => [x.mac, x]));
        const i = list.indexOf(d.id);
        const n = list.length;
        const tag = (m) => (byMac.get(m) || {}).group || '';
        const tp = tag(list[(i - 1 + n) % n]);
        const tn = tag(list[(i + 1) % n]);
        const old = tag(d.id);
        // dropped between two members of a tag: join it. Dropped beside its own tag: keep it. Otherwise: untagged.
        const next = tp && tp === tn ? tp : old && (tp === old || tn === old) ? old : '';
        order = list.slice();
        const dev = byMac.get(d.id);
        if (dev && next !== old) dev.group = next;
        relayout();
        if (opts.onReorder) opts.onReorder(list, next !== old ? { [d.id]: next } : null, d.id, next);
        return;
      }
      relayout();
      if (e.type === 'pointerup') opts.onSelect && opts.onSelect(d.id);
      return;
    }
    // a plain tap (not an orbit drag): open a device, count gateway taps, or close the popup
    if (was && e.type === 'pointerup' && moved < 6) {
      const h = pick(e.clientX, e.clientY);
      if (h === gwHit) { gatewayTap(); return; }
      if (h && h.userData.mac && nodes.has(h.userData.mac)) { opts.onSelect && opts.onSelect(h.userData.mac); return; }
      if (selected && opts.onSelect) opts.onSelect(null);
    }
  };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('pointerenter', () => { inside = true; });
  canvas.addEventListener('pointerleave', () => { inside = false; setHover(null); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    goal.dist = MathUtils.clamp(goal.dist * Math.exp(e.deltaY * 0.0012), 8, 40);
    lastInteract = performance.now();
  }, { passive: false });

  function setHover(mac) {
    if (mac === hovered) return;
    hovered = mac;
    for (const n of nodes.values()) restyle(n);
    canvas.style.cursor = mac !== null ? 'pointer' : 'grab';
    opts.onHover && opts.onHover(mac, pointer);
  }

  // ---------- sizing ----------
  let W = 1;
  let H = 1;
  function resize() {
    W = Math.max(1, container.clientWidth);
    H = Math.max(1, container.clientHeight);
    renderer.setSize(W, H, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = W / H;
    // keep the whole ring in view on tall/narrow screens
    camera.fov = W / H < 0.8 ? 58 : 42;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---------- frame loop ----------
  const tmp = new Vector3();
  const proj = new Vector3();
  let raf = 0;
  let last = performance.now();
  let running = true;

  function labelFor(n) { return n.dev.label || n.dev.ip; }

  function renderFrame(nowMs) {
    if (document.hidden) { last = nowMs; return; }
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    const t = nowMs / 1000;
    frame++;

    // camera easing and idle drift
    if (!reduced && !selected && !showT0 && nowMs - lastInteract > 5000 && ptrs.size === 0 && hovered === null) view.yaw += dt * 0.045;
    view.dist += (goal.dist - view.dist) * Math.min(1, dt * 5);
    target.lerp(goal.target, Math.min(1, dt * 4));

    // liftoff easter egg: nodes rise with exhaust trails, then settle
    let lift = 0;
    if (liftT0) {
      const e = (nowMs - liftT0) / 1000;
      if (e < 2.4) lift = 0.5 * 5.5 * e * e;
      else if (e < 5.6) lift = 0.5 * 5.5 * 2.4 * 2.4 * Math.pow(1 - (e - 2.4) / 3.2, 2);
      else liftT0 = 0;
      view.pitch = MathUtils.clamp(view.pitch, 0.14, 1.4);
    }

    const showE = showT0 ? (nowMs - showT0) / 1000 : -1;
    if (showT0) updateShow(nowMs, dt);

    // node motion
    let moving = false;
    for (const n of nodes.values()) {
      const k = Math.min(1, dt * 4);
      const before = n.pos.y;
      n.pos.lerp(n.target, k);
      const rip = showE >= 0 ? rippleAt(Math.hypot(n.pos.x, n.pos.z), showE) : 0;
      const ly = (lift ? lift * (0.6 + n.phase * 0.8) : 0) + rip;
      if (n.pos.distanceToSquared(n.target) > 1e-5 || n.dirty || lift || rip || n.rippled || before !== n.pos.y) {
        n.rippled = rip > 0;
        n.dirty = false;
        moving = true;
        const real = n.pos.clone();
        n.pos.y += ly;
        rebuildGeometry(n);
        n.pos.copy(real);
      }
      if (n.ring.visible) {
        const s = nodeRadius(n.dev) * 5 * (1 + 0.12 * Math.sin(t * 3 + n.phase * 6));
        n.ring.scale.setScalar(s);
      }
    }

    // umbrel logos always face the camera, sitting on the front of the globe
    for (const n of nodes.values()) {
      if (!n.logo || !n.logo.visible) continue;
      const r = nodeRadius(n.dev);
      n.logo.position.copy(camera.position).sub(n.group.position).normalize().multiplyScalar(r * 0.98);
      n.logo.scale.setScalar(r * 1.4);
    }

    // gateway and dish
    if (!showT0) {
      const pk = Math.max(0, 1 - (nowMs - gwPulse) / 420);
      gwHalo.scale.setScalar(3 + pk * (0.8 + gwTaps * 0.45));
      gwHalo.material.color.copy(T.node);
    }
    gwRing1.rotation.z = t * 0.5;
    gwRing2.rotation.y = t * 0.35;
    const iColor = internet.state === 'down' ? T.bad : internet.state === 'degraded' ? T.warn : T.node;
    mast.material.color.copy(iColor);
    dishPlate.material.color.copy(iColor);
    dishHalo.material.color.copy(iColor);
    beam.material.color.copy(iColor);
    beam.material.opacity = internet.state === 'down' ? 0.15 : 0.5;

    // satellites on a tilted orbit; nearest one is linked to the dish
    const sp = satGeo.attributes.position;
    let best = 1e9;
    const bestPos = new Vector3();
    for (let i = 0; i < SATS; i++) {
      const a = t * 0.045 + i * 0.075;
      tmp.set(Math.cos(a) * 30, 0, Math.sin(a) * 30);
      tmp.applyAxisAngle(new Vector3(1, 0, 0), 0.42).applyAxisAngle(new Vector3(0, 0, 1), 0.12);
      tmp.add(orbit.position);
      sp.setXYZ(i, tmp.x, tmp.y, tmp.z);
      const d = tmp.distanceTo(dishPos);
      if (d < best) { best = d; bestPos.copy(tmp); }
    }
    sp.needsUpdate = true;
    const bp = beamGeo.attributes.position;
    bp.setXYZ(0, dishPos.x, dishPos.y + 0.2, dishPos.z);
    bp.setXYZ(1, bestPos.x, bestPos.y, bestPos.z);
    bp.needsUpdate = true;

    // pulses
    const pp = pulseGeo.attributes.position;
    let pi = 0;
    if (!reduced) {
      for (const n of nodes.values()) {
        if (!n.dev.online || !n.group.visible || !n.curve || pi >= MAXP) continue;
        const u = (t * n.speed + n.phase) % 1;
        n.curve.getPoint(u, tmp);
        pp.setXYZ(pi++, tmp.x, tmp.y, tmp.z);
      }
    }
    for (let i = pi; i < MAXP; i++) pp.setXYZ(i, 0, -999, 0);
    pp.needsUpdate = true;

    placeCamera();
    if (liftT0) camera.position.x += Math.sin(t * 60) * 0.03;
    if (showShake) { camera.position.x += Math.sin(t * 70) * 0.09 * showShake; camera.position.y += Math.cos(t * 83) * 0.07 * showShake; }

    // hover picking (every other frame)
    if (inside && ptrs.size === 0 && pointer && frame % 2 === 0) {
      const h = pick(pointer.x, pointer.y);
      setHover(h ? h.userData.mac : null);
    }

    renderer.render(scene, camera);

    // HTML labels follow nodes
    const many = nodes.size > 26;
    const r = canvas.getBoundingClientRect();
    const ox = r.left - container.getBoundingClientRect().left;
    const oy = r.top - container.getBoundingClientRect().top;
    const place = (el, wp, show, cls) => {
      if (!show) { el.style.display = 'none'; return; }
      proj.copy(wp).project(camera);
      if (proj.z > 1 || Math.abs(proj.x) > 1.1 || Math.abs(proj.y) > 1.1) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.transform = 'translate(' + Math.round(ox + (proj.x * 0.5 + 0.5) * r.width) + 'px,' + Math.round(oy + (-proj.y * 0.5 + 0.5) * r.height) + 'px)';
      el.className = cls;
    };
    for (const a of arcs) place(a.el, a.pos, true, 'cs-label tag');
    for (const n of nodes.values()) {
      const d = n.dev;
      const isSel = selected === n.mac;
      const isHov = hovered === n.mac;
      const showLabel = n.group.visible && (isSel || isHov || (options.labels && !many && (d.online || options.showOffline)) || (options.labels && many && d.role === 'self'));
      if (n.el.textContent !== labelFor(n)) n.el.textContent = labelFor(n);
      tmp.copy(n.pos); tmp.y += lift ? lift * (0.6 + n.phase * 0.8) : 0; tmp.y -= 0.35;
      place(n.el, tmp, showLabel, 'cs-label' + (d.online ? '' : ' off') + (isSel || isHov ? ' hot' : '') + (!d.known && d.online ? ' new' : ''));
    }
  }

  // ---------- launch show (easter egg): Starlink trains cross the sky, ships lift off the gateway ----------
  const SHOW_LEN = 15;
  const WAVES = [{ at: 0.2, n: 3, gap: 0.3 }, { at: 3.4, n: 4, gap: 0.22 }, { at: 6.6, n: 6, gap: 0.16 }];
  const TRAIN_SPECS = [
    { t0: 0.6, y: 11, dy: -3, d: 56, dir: 1, dur: 8.5 },
    { t0: 2.6, y: 17, dy: 2, d: 72, dir: -1, dur: 9.5 },
    { t0: 5.0, y: 6, dy: -5, d: 48, dir: 1, dur: 8.5 },
    { t0: 7.4, y: 19, dy: -2, d: 76, dir: -1, dur: 9 },
  ];
  const TR_N = 24;
  let showT0 = 0;
  let gwPulse = 0;
  let gwTaps = 0;
  let gwTimer = 0;
  let showShake = 0;
  const showGroup = new Group();
  showGroup.visible = false;
  scene.add(showGroup);

  // satellite trains
  const trGeo = new BufferGeometry();
  const trPos = new Float32Array(TRAIN_SPECS.length * TR_N * 3);
  const trCol = new Float32Array(TRAIN_SPECS.length * TR_N * 3);
  trGeo.setAttribute('position', new BufferAttribute(trPos, 3));
  trGeo.setAttribute('color', new BufferAttribute(trCol, 3));
  const trCore = new Points(trGeo, new PointsMaterial({ size: 1.1, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: blendNow() }));
  const trGlow = new Points(trGeo, new PointsMaterial({ size: 4.6, map: glowTex, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: blendNow() }));
  trCore.frustumCulled = false; trGlow.frustumCulled = false;
  showGroup.add(trGlow, trCore);
  let trains = [];

  // exhaust, smoke and sparks share one particle pool
  const PN = 2600;
  const pPos = new Float32Array(PN * 3);
  const pCol = new Float32Array(PN * 3);
  const pVel = new Float32Array(PN * 3);
  const pLife = new Float32Array(PN);
  const pMax = new Float32Array(PN).fill(1);
  const pKind = new Uint8Array(PN);
  let pHead = 0;
  const pGeo = new BufferGeometry();
  pGeo.setAttribute('position', new BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new BufferAttribute(pCol, 3));
  const pMat = new PointsMaterial({ size: 0.42, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: blendNow() });
  const pPts = new Points(pGeo, pMat);
  pPts.frustumCulled = false;
  showGroup.add(pPts);
  for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -999;
  function emit(x, y, z, vx, vy, vz, life, kind) {
    const i = pHead; pHead = (pHead + 1) % PN;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pLife[i] = life; pMax[i] = life; pKind[i] = kind;
  }
  const PAL = [[1.0, 0.72, 0.28], [0.62, 0.64, 0.7], [1, 1, 0.85]]; // flame, smoke, spark
  function paint(arr, i, c, f) {
    if (T.light) {
      arr[i * 3] = T.bg.r + (c[0] * 0.8 - T.bg.r) * f; arr[i * 3 + 1] = T.bg.g + (c[1] * 0.5 - T.bg.g) * f; arr[i * 3 + 2] = T.bg.b + (c[2] * 0.4 - T.bg.b) * f;
    } else { arr[i * 3] = c[0] * f; arr[i * 3 + 1] = c[1] * f; arr[i * 3 + 2] = c[2] * f; }
  }

  // ships
  const ships = [];
  const shipSilver = () => new MeshBasicMaterial({ color: T.light ? 0x39404d : 0xdfe5ee });
  function makeShip() {
    const grp = new Group();
    const body = new Mesh(new CylinderGeometry(0.1, 0.1, 0.62, 16), shipSilver());
    const nose = new Mesh(new ConeGeometry(0.1, 0.3, 16), shipSilver());
    nose.position.y = 0.46;
    const band = new Mesh(new CylinderGeometry(0.103, 0.103, 0.14, 16), new MeshBasicMaterial({ color: T.light ? 0x111419 : 0x20252d }));
    band.position.y = -0.18;
    const finL = new Mesh(new ConeGeometry(0.05, 0.22, 4), shipSilver()); finL.position.set(-0.13, -0.24, 0); finL.rotation.z = 0.28;
    const finR = new Mesh(new ConeGeometry(0.05, 0.22, 4), shipSilver()); finR.position.set(0.13, -0.24, 0); finR.rotation.z = -0.28;
    const flame = new Mesh(new ConeGeometry(0.09, 1, 14), new MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, blending: blendNow(), depthWrite: false }));
    flame.rotation.x = Math.PI; flame.position.y = -0.34 - 0.5;
    const core = new Mesh(new ConeGeometry(0.05, 0.6, 12), new MeshBasicMaterial({ color: 0xfff3c8, transparent: true, opacity: 0.95, blending: blendNow(), depthWrite: false }));
    core.rotation.x = Math.PI; core.position.y = -0.34 - 0.3;
    const glow = new Sprite(new SpriteMaterial({ map: glowTex, color: 0xffa040, transparent: true, opacity: 0.8, blending: blendNow(), depthWrite: false }));
    glow.scale.setScalar(1.3); glow.position.y = -0.4;
    grp.add(body, nose, band, finL, finR, flame, core, glow);
    grp.scale.setScalar(1.5);
    grp.visible = false;
    showGroup.add(grp);
    return { grp, flame, core, glow, parts: [body, nose, band, finL, finR] };
  }
  const shockGeo = circleLine(1, 120);
  const shocks = [0, 1, 2].map(() => {
    const m = new Group();
    for (const k of [1, 1.025, 1.05]) {
      const ln = new Line(shockGeo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: blendNow(), depthWrite: false }));
      ln.scale.setScalar(k); m.add(ln);
    }
    m.visible = false; showGroup.add(m); return m;
  });

  const sV = new Vector3(); const sUp = new Vector3(0, 1, 0); const sQ = new Quaternion(); const sH = new Vector3(); const sDir = new Vector3();

  function startShow() {
    if (showT0) return;
    showT0 = performance.now();
    showGroup.visible = true;
    // satellite trains are laid out across the screen as the camera sees it right now
    camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const camUp = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const fwd = camera.getWorldDirection(new Vector3());
    trains = TRAIN_SPECS.map((sp) => {
      const half = sp.d * 0.78;
      const start = camera.position.clone().addScaledVector(fwd, sp.d).addScaledVector(right, -sp.dir * half).addScaledVector(camUp, sp.y);
      return { sp, start, dir: right.clone().multiplyScalar(sp.dir), up: camUp.clone(), len: half * 2, gap: sp.d * 0.017 };
    });
    // ships
    const rnd = (a, b) => a + Math.random() * (b - a);
    let k = 0;
    WAVES.forEach((w, wi) => {
      for (let i = 0; i < w.n; i++) {
        let sh = ships[k]; if (!sh) { sh = makeShip(); ships[k] = sh; }
        k++;
        sh.t0 = w.at + i * w.gap;
        sh.az = (k * 2.399963 + wi) % TWO_PI;
        sh.v0 = rnd(1.2, 2.2); sh.a = rnd(1.0, 1.7); sh.k = rnd(0.05, 0.16);
        sh.big = wi === 2 && i === w.n - 1;
        sh.grp.scale.setScalar(sh.big ? 2.3 : 1.35 + wi * 0.12);
        sh.flicker = Math.random() * 10;
        sh.blasted = false;
        sh.grp.visible = false;
      }
    });
    for (let i = 0; i < shocks.length; i++) { shocks[i].visible = false; shocks[i].userData.t0 = WAVES[i].at; }
    if (!selected) { goal.target.set(0, 5.5, 0); goal.dist = 27; }
    lastInteract = performance.now();
  }

  function endShow() {
    showT0 = 0;
    showGroup.visible = false;
    for (const sh of ships) sh.grp.visible = false;
    pLife.fill(0); for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -999;
    pGeo.attributes.position.needsUpdate = true;
    if (!selected) { goal.target.copy(HOME_TARGET); goal.dist = DEFAULT_VIEW.dist; }
    showShake = 0;
  }

  function gatewayTap() {
    gwTaps++;
    gwPulse = performance.now();
    clearTimeout(gwTimer);
    if (gwTaps >= 7) { gwTaps = 0; startShow(); if (opts.onShow) opts.onShow(); return; }
    gwTimer = setTimeout(() => {
      const n = gwTaps; gwTaps = 0;
      if (n > 0 && n < 7 && gwHit.userData.mac && opts.onSelect) opts.onSelect(gwHit.userData.mac);
    }, 850);
  }

  function rippleAt(dist, e) {
    let r = 0;
    for (const w of WAVES) {
      const te = e - w.at;
      if (te < 0 || te > 3.2) continue;
      const front = te * 6.5;
      const x = Math.abs(dist - front);
      if (x < 2.2) r += (1 - x / 2.2) * 0.55 * (1 - te / 3.2);
    }
    return r;
  }

  function updateShow(nowMs, dt) {
    const e = (nowMs - showT0) / 1000;
    if (e > SHOW_LEN) { endShow(); return; }
    const tr = trGeo.attributes.position;
    // satellite trains
    trains.forEach((tn, ti) => {
      const u = (e - tn.sp.t0) / tn.sp.dur;
      const total = tn.len + TR_N * tn.gap;
      for (let k = 0; k < TR_N; k++) {
        const idx = ti * TR_N + k;
        const s = u * total - k * tn.gap;
        if (u < 0 || u > 1 || s < 0 || s > tn.len) { trPos[idx * 3 + 1] = -999; trCol[idx * 3] = trCol[idx * 3 + 1] = trCol[idx * 3 + 2] = 0; continue; }
        const f = s / tn.len;
        const arc = Math.sin(Math.PI * f) * tn.sp.dy * 1.6;
        trPos[idx * 3] = tn.start.x + tn.dir.x * s + tn.up.x * arc;
        trPos[idx * 3 + 1] = tn.start.y + tn.dir.y * s + tn.up.y * arc;
        trPos[idx * 3 + 2] = tn.start.z + tn.dir.z * s + tn.up.z * arc;
        const edge = Math.min(1, f * 7, (1 - f) * 7);
        const tw = (0.8 + 0.2 * Math.sin(e * 9 + k * 1.7)) * edge;
        if (T.light) { trCol[idx * 3] = T.bg.r + (0.08 - T.bg.r) * tw; trCol[idx * 3 + 1] = T.bg.g + (0.12 - T.bg.g) * tw; trCol[idx * 3 + 2] = T.bg.b + (0.32 - T.bg.b) * tw; }
        else { trCol[idx * 3] = 0.82 * tw; trCol[idx * 3 + 1] = 0.9 * tw; trCol[idx * 3 + 2] = 1.0 * tw; }
      }
    });
    tr.needsUpdate = true; trGeo.attributes.color.needsUpdate = true;

    // ships and their exhaust
    let boom = 0;
    for (const sh of ships) {
      const t = e - sh.t0;
      if (t < 0 || t > 7.5) { sh.grp.visible = false; continue; }
      sh.grp.visible = true;
      sH.set(Math.cos(sh.az), 0, Math.sin(sh.az));
      const lift = sh.v0 * t + 0.5 * sh.a * t * t;
      const side = (sh.k * t * t * t) / 3;
      sh.grp.position.set(gatewayPos.x + sH.x * side, gatewayPos.y + 0.3 + lift, gatewayPos.z + sH.z * side);
      sDir.set(sH.x * sh.k * t * t, sh.v0 + sh.a * t, sH.z * sh.k * t * t).normalize();
      sQ.setFromUnitVectors(sUp, sDir);
      sh.grp.quaternion.copy(sQ);
      const fl = 0.85 + 0.35 * Math.sin(nowMs * 0.05 + sh.flicker) + Math.random() * 0.15;
      sh.flame.scale.y = fl * (t < 0.6 ? t / 0.6 + 0.2 : 1) * 1.3;
      sh.flame.position.y = -0.34 - 0.5 * sh.flame.scale.y;
      sh.core.scale.y = fl; sh.core.position.y = -0.34 - 0.3 * fl;
      sh.glow.material.opacity = 0.65 + 0.2 * Math.sin(nowMs * 0.04 + sh.flicker);
      if (t < 1.1 && !sh.blasted) {
        sh.blasted = true;
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * TWO_PI, sp = 1.4 + Math.random() * 3.2;
          emit(gatewayPos.x, 0.1, gatewayPos.z, Math.cos(a) * sp, 0.25 + Math.random() * 0.9, Math.sin(a) * sp, 1.2 + Math.random() * 1.2, 1);
        }
      }
      const tail = sh.grp.position.clone().addScaledVector(sDir, -0.5 * sh.grp.scale.x);
      const nEm = sh.big ? 6 : 3;
      for (let i = 0; i < nEm; i++) {
        const j = 0.25;
        emit(tail.x, tail.y, tail.z, -sDir.x * 3 + (Math.random() - 0.5) * j * 6, -sDir.y * 3 + (Math.random() - 0.5) * j * 6, -sDir.z * 3 + (Math.random() - 0.5) * j * 6, 0.35 + Math.random() * 0.5, 0);
      }
      emit(tail.x, tail.y, tail.z, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 0.9, 1);
      if (Math.random() < 0.35) emit(tail.x, tail.y, tail.z, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5 - 2, (Math.random() - 0.5) * 5, 0.5 + Math.random() * 0.5, 2);
      if (t < 1.6) boom = Math.max(boom, 1 - t / 1.6);
    }

    // particles
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      const f = Math.max(0, pLife[i] / pMax[i]);
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pKind[i] === 1) { pVel[i * 3] *= 0.985; pVel[i * 3 + 2] *= 0.985; pVel[i * 3 + 1] *= 0.99; }
      if (pKind[i] === 2) pVel[i * 3 + 1] -= 4 * dt;
      if (pLife[i] <= 0) { pPos[i * 3 + 1] = -999; continue; }
      const c = PAL[pKind[i]].slice();
      if (pKind[i] === 0) { c[1] = 0.25 + 0.5 * f; c[2] = 0.05 + 0.25 * f; }
      paint(pCol, i, c, pKind[i] === 1 ? f * 0.55 : f);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;

    // shock rings along the ground at each launch wave
    shocks.forEach((m) => {
      const te = e - m.userData.t0;
      if (te < 0 || te > 2.2) { m.visible = false; return; }
      m.visible = true;
      const r = 0.6 + te * 6.5;
      m.scale.setScalar(r); m.position.set(gatewayPos.x, 0.1, gatewayPos.z);
      m.children.forEach((ln, i) => {
        ln.material.opacity = (0.9 - i * 0.25) * (1 - te / 2.2);
        ln.material.color.set(T.light ? 0x5a6270 : 0xcfe0ff);
      });
    });

    // camera and gateway reaction
    showShake = boom;
    let g = 0;
    for (const w of WAVES) { const te = e - w.at; if (te >= 0 && te < 1.4) g = Math.max(g, 1 - te / 1.4); }
    gwHalo.scale.setScalar(3 + g * 4);
    gwHalo.material.color.copy(g > 0.05 ? new Color(0xffc27a) : T.node);
    return e;
  }

  // gateway label and dish label are drawn by the page HUD through anchors
  const anchors = { gateway: new Vector3(0, 0.35 - 0.9, 0), dish: new Vector3(0, 6.4 + 1.1, 0) };
  const gwLabel = document.createElement('div');
  const dishLabel = document.createElement('div');
  gwLabel.className = 'cs-label static';
  dishLabel.className = 'cs-label static';
  labelsLayer.append(gwLabel);
  const staticLabels = () => {
    const r = canvas.getBoundingClientRect();
    const ox = r.left - container.getBoundingClientRect().left;
    const oy = r.top - container.getBoundingClientRect().top;
    for (const [el, a] of [[gwLabel, anchors.gateway]]) {
      proj.copy(a).project(camera);
      if (proj.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.transform = 'translate(' + Math.round(ox + (proj.x * 0.5 + 0.5) * r.width) + 'px,' + Math.round(oy + (-proj.y * 0.5 + 0.5) * r.height) + 'px)';
    }
  };
  function loop(nowMs) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    renderFrame(nowMs);
    if (!document.hidden) staticLabels();
  }
  raf = requestAnimationFrame(loop);

  // ---------- public api ----------
  function update(data) {
    const devs = data.devices || [];
    internet = data.internet || internet;
    if (Array.isArray(data.order) && !drag) order = data.order.slice();
    const seen = new Set();
    for (const d of devs) {
      if (d.role === 'gateway') continue;
      seen.add(d.mac);
      const n = nodes.get(d.mac) || makeNode(d);
      n.dev = d;
    }
    for (const n of [...nodes.values()]) if (!seen.has(n.mac)) removeNode(n);
    curDevs = devs.filter((d) => seen.has(d.mac));
    layoutRing();
    for (const n of nodes.values()) restyle(n);
    const gw = devs.find((d) => d.role === 'gateway');
    gwHit.userData.mac = gw ? gw.mac : null;
    gwLabel.textContent = gw ? 'GATEWAY' : '';
  }

  function select(mac) {
    selected = mac || null;
    const n = selected ? nodes.get(selected) : null;
    if (n) {
      goal.target.copy(n.target).multiplyScalar(0.55).setY(1.1);
      goal.dist = Math.min(goal.dist, 15);
    } else {
      goal.target.copy(HOME_TARGET);
      goal.dist = DEFAULT_VIEW.dist;
    }
    for (const x of nodes.values()) restyle(x);
  }

  function applyTheme() {
    T = readTheme();
    stars.visible = !T.light;
    scene.fog.color.copy(T.bg);
    planetMat.uniforms.rim.value.copy(T.rim);
    planetMat.uniforms.bg.value.copy(T.bg);
    gridMat.color.copy(T.link);
    grid.children.forEach((c) => { if (c.material) c.material.color.copy(T.link); });
    orbitMat.color.copy(T.link);
    gwCore.material.color.copy(T.accent);
    for (const m of [gwHalo.material, gwRing1.material, gwRing2.material, sats.material, pulseMat]) m.color.copy(T.node);
    dishRim.material.color.copy(T.accent);
    gwHalo.material.blending = blendNow();
    gwHalo.material.opacity = T.light ? 0.3 : 0.75;
    gwHalo.material.needsUpdate = true;
    pulseMat.blending = blendNow();
    for (const n of nodes.values()) { n.halo.material.needsUpdate = true; restyle(n); }
  }

  function setEditMode(on) {
    edit = !!on;
    canvas.style.cursor = 'grab';
  }

  function setOptions(o) {
    options = Object.assign(options, o);
    for (const n of nodes.values()) restyle(n);
  }

  function resetView() {
    Object.assign(view, DEFAULT_VIEW);
    goal.dist = DEFAULT_VIEW.dist;
    goal.target.copy(HOME_TARGET);
    selected = null;
    for (const n of nodes.values()) restyle(n);
  }

  function liftoff() { liftT0 = performance.now(); }

  function destroy() {
    running = false;
    cancelAnimationFrame(raf);
    ro.disconnect();
    for (const n of [...nodes.values()]) removeNode(n);
    clearArcs();
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    canvas.remove();
    labelsLayer.remove();
  }

  placeCamera();
  return { supported: true, update, select, applyTheme, setEditMode, setOptions, resetView, liftoff, show: startShow, destroy, canvas };
}

export { create };
