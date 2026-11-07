// The 3D network view. Gateway at the centre, devices orbiting on rings by kind,
// a dish above linked to a train of satellites, a planet limb on the horizon.
// Pure presentation: it only draws what the API reports and invents no data.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, Group, Mesh, SphereGeometry, MeshBasicMaterial,
  Sprite, SpriteMaterial, CanvasTexture, AdditiveBlending, NormalBlending, BufferGeometry, Float32BufferAttribute,
  Line, LineBasicMaterial, LineSegments, Points, PointsMaterial, Vector3, QuadraticBezierCurve3,
  TorusGeometry, CylinderGeometry, ShaderMaterial, Raycaster, Vector2, MathUtils, Plane,
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
    n.el.remove();
    hitList.splice(hitList.indexOf(n.hit), 1);
    nodes.delete(n.mac);
  }

  function layout() { layoutRing(); }

  function nodeRadius(d) {
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
    const col = !d.online ? T.off : isNew ? T.warn : T.node;
    n.mesh.material.color.copy(col);
    n.mesh.material.opacity = (d.online ? 1 : 0.8) * dim;
    n.mesh.scale.setScalar(nodeRadius(d));
    n.halo.visible = d.online;
    n.halo.material.color.copy(n.dev.group && d.online && !isNew ? tagColor(n.dev.group) : col);
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
    if (!reduced && !selected && nowMs - lastInteract > 5000 && ptrs.size === 0 && hovered === null) view.yaw += dt * 0.045;
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

    // node motion
    let moving = false;
    for (const n of nodes.values()) {
      const k = Math.min(1, dt * 4);
      const before = n.pos.y;
      n.pos.lerp(n.target, k);
      const ly = lift ? lift * (0.6 + n.phase * 0.8) : 0;
      if (n.pos.distanceToSquared(n.target) > 1e-5 || n.dirty || lift || before !== n.pos.y) {
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

    // gateway and dish
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
  return { supported: true, update, select, applyTheme, setEditMode, setOptions, resetView, liftoff, destroy, canvas };
}

export { create };
