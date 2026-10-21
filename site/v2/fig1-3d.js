/* Figure 1 as one three.js scene, seen from above at an angle like a strategy game, driven by window.Fig3D.update(state)
   from v2.js (which keeps the SVG version as the fallback when WebGL is missing). The neuron's sum is
   activation = SiLU(gate) x up, and it writes activation x a fixed down vector.
   1. The gate check. A word walks up to a castle gate. The measuring post at the gate reads "you must be at least this X-ish to
      enter": its pointer shows SiLU(gate) (scaled) against the line, and the portcullis rises by the same amount. A word
      below the line is turned away; the gate is soft, so only a trace leaks through, too small to fire.
   2. Up turns the one ballista: to the + target (right) or the - target (left), by its sign, never in between.
   3. The ballista draws back by the push, SiLU(gate) x |up| (scaled), and fires; the bolt lands that far along the
      range line, which has quarter marks and the target at full push.
   The story loops and restarts when the word changes: CYCLE seconds for a word that gets in, TURNED for one turned away.
   Each loop's end is reported (onEnd), so a tour can move on exactly as a story finishes. */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

const BG = 0xf1ece3, ACCENT = 0x8a5a2e, COOL = 0x5f7482, INK = "#1d2226", MUTED = "#5d6770", ACC = "#8a5a2e", COOLS = "#5f7482";
const CYCLE = 8.2, TURNED = 5.8, FIRE = 5.15, SHUT = 0.15;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const outBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const el = (tag, cls) => { const d = document.createElement(tag); if (cls) d.className = cls; return d; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sgn = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d);
function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rr = (g, x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
const SANS = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif", SERIF = "Newsreader, Georgia, serif", MONO = "'IBM Plex Mono', Consolas, monospace";
const fitFont = (g, txt, weight, size, family, maxW, min = 20) => { let fs = size; do { g.font = `${weight} ${fs}px ${family}`; fs -= 4; } while (g.measureText(txt).width > maxW && fs > min); };

/* ---------- textures, all drawn on canvases (no image downloads) ---------- */
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData.canvas = c; return t;
}
function textures() {
  const T = {};
  { // dressed stone blocks, and a matching bump map
    const R = rng(3), S = 512, rows = 8, rh = S / rows, blocks = [];
    for (let r = 0; r < rows; r++) { const x0 = R() * 90; let x = x0; while (x < x0 + S - 1) { const w = Math.min(60 + R() * 100, x0 + S - x); blocks.push([x, r * rh, w, rh, R()]); x += w; } }
    const paint = (bump) => (g) => {
      g.fillStyle = bump ? "#222" : "#9b9182"; g.fillRect(0, 0, S, S);
      for (const [x, y, w, h, v] of blocks) for (const ox of [0, -S]) {
        if (x + ox > S || x + ox + w < 0) continue;
        const c = (190 + v * 50) | 0;
        g.fillStyle = bump ? `rgb(${c},${c},${c})` : `hsl(${30 + v * 10}, ${8 + v * 7}%, ${72 + v * 11}%)`;
        rr(g, x + ox + 2, y + 2, w - 4, h - 4, 5); g.fill();
      }
      const R2 = rng(5);
      for (let i = 0; i < 9000; i++) { const a = R2() > 0.5; g.fillStyle = a ? "rgba(255,250,240,0.10)" : "rgba(50,40,30,0.10)"; g.fillRect(R2() * S, R2() * S, 1 + R2() * 2, 1 + R2() * 2); }
    };
    T.stone = canvasTex(S, S, paint(false)); T.stoneBump = canvasTex(S, S, paint(true), false);
    T.stone.repeat.set(0.42, 0.42); T.stoneBump.repeat.set(0.42, 0.42);
  }
  T.earth = canvasTex(512, 512, (g, w, h) => { // pale packed earth
    g.fillStyle = "#e6decf"; g.fillRect(0, 0, w, h);
    const R = rng(9);
    for (let i = 0; i < 70; i++) {
      const x = R() * w, y = R() * h, r = 20 + R() * 70, c = R() > 0.5 ? "205,193,172" : "244,239,229", a = 0.25 + R() * 0.3;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
      }
    }
    for (let i = 0; i < 14000; i++) { g.fillStyle = R() > 0.5 ? "rgba(120,100,80,0.13)" : "rgba(255,255,255,0.18)"; g.fillRect(R() * w, R() * h, 1 + R() * 1.6, 1 + R() * 1.6); }
  });
  T.earth.repeat.set(10, 10);
  T.cobble = canvasTex(256, 512, (g, w, h) => { // a cobbled path, fading out at the edges
    g.fillStyle = "#b3a895"; g.fillRect(0, 0, w, h);
    const R = rng(4), rows = 16, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -R() * 20;
      while (x < w) { const cw = 22 + R() * 18; g.fillStyle = `hsl(${28 + R() * 12}, 9%, ${66 + R() * 13}%)`; g.beginPath(); g.ellipse(x + cw / 2, r * rh + rh / 2, cw / 2 - 2, rh / 2 - 2.5, (R() - 0.5) * 0.3, 0, 7); g.fill(); x += cw; }
    }
    g.globalCompositeOperation = "destination-in";
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.2, "#000"); gr.addColorStop(0.8, "#000"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalCompositeOperation = "source-over";
  });
  T.cobble.wrapS = THREE.ClampToEdgeWrapping; T.cobble.repeat.set(1, 3.5);
  T.wood = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = "#9a6a40"; g.fillRect(0, 0, w, h);
    const R = rng(8);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = R() > 0.5 ? `rgba(60,35,15,${0.12 + R() * 0.18})` : `rgba(200,150,100,${0.1 + R() * 0.15})`;
      g.lineWidth = 1 + R() * 2.5; g.beginPath(); const x = R() * w;
      for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * 0.02 + i) * 4, y);
      g.stroke();
    }
  });
  T.glow = canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  T.puff = canvasTex(128, 128, (g, w) => {
    const R = rng(2);
    for (let i = 0; i < 9; i++) { const x = w / 2 + (R() - 0.5) * 34, y = w / 2 + (R() - 0.5) * 34, r = 26 + R() * 22; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, w); }
  });
  T.scorch = canvasTex(256, 256, (g, w) => {
    const R = rng(6);
    for (let i = 0; i < 14; i++) { const a = R() * 7, d = R() * 40, x = w / 2 + Math.cos(a) * d, y = w / 2 + Math.sin(a) * d, r = 50 + R() * 50; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(95,78,58,0.35)"); gr.addColorStop(1, "rgba(95,78,58,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, w); }
  });
  T.target = (hex) => canvasTex(512, 512, (g, w) => {
    const c = w / 2, ring = (r, fill, stroke, lw) => { g.beginPath(); g.arc(c, c, r, 0, 7); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); } };
    ring(246, "rgba(255,252,246,0.92)", INK, 7); ring(190, hex + "33", hex, 5); ring(126, "rgba(255,252,246,0.95)", hex, 4); ring(62, hex, null, 0);
    g.strokeStyle = "rgba(29,34,38,0.35)"; g.lineWidth = 3; g.beginPath(); g.moveTo(c, 8); g.lineTo(c, 66); g.moveTo(c, w - 8); g.lineTo(c, w - 66); g.moveTo(8, c); g.lineTo(66, c); g.moveTo(w - 8, c); g.lineTo(w - 66, c); g.stroke();
  }, true);
  T.banner = canvasTex(128, 288, (g, w, h) => { // a bronze banner with a swallowtail
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(w / 2, h - 46); g.lineTo(0, h); g.closePath(); g.fillStyle = ACC; g.fill();
    g.lineWidth = 7; g.strokeStyle = "#6b431f"; g.stroke();
    g.strokeStyle = "#e8d3b8"; g.lineWidth = 6; g.beginPath(); g.moveTo(24, 70); g.lineTo(w / 2, 110); g.lineTo(w - 24, 70); g.moveTo(24, 110); g.lineTo(w / 2, 150); g.lineTo(w - 24, 110); g.stroke();
  });
  return T;
}

/* a soft studio environment for reflections (no download) */
function envFor(renderer) {
  const s = new THREE.Scene(), geo = new THREE.SphereGeometry(20, 32, 16), p = geo.attributes.position, col = [];
  const top = new THREE.Color(0xcfc9be), bot = new THREE.Color(0x5e554a), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(bot).lerp(top, Math.pow(clamp(p.getY(i) / 40 + 0.5), 0.8)); col.push(c.r, c.g, c.b); }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.4) }));
  panel.position.set(-9, 13, 8); panel.lookAt(0, 0, 0); s.add(panel);
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(s, 0.04).texture; pm.dispose(); return tex;
}

/* box and cylinder geometry with UVs in world units, so the stone texture keeps its scale */
function wbox(w, h, d, ox = 0, oy = 0) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] + ox, uv.getY(k) * dims[f][1] + oy); }
  return g;
}
function wcyl(r0, r1, h, seg) {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r1, uv.getY(i) * h);
  return g;
}

/* the world: one scene with its lights, shown through two views */
function world() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(BG);
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a7d69, 0.35));
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
  sun.position.set(-9, 16, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 13, bottom: -13, near: 1, far: 70 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; scene.add(sun);
  return scene;
}

/* a view of the world: its own renderer and camera, a label layer and a caption. A perspective camera at a fixed spot
   (o.pos, o.at), or an angled overhead camera that fits o.halfW across (and, on a narrow screen, zooms in and follows
   the action) */
function stage(host, scene, o) {
  const panel = el("div", "f3d-panel " + o.cls), view = el("div", "f3d-view"), labels = el("div", "f3d-labels"), cap = el("div", "f3d-cap");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.localClippingEnabled = true;
  view.append(renderer.domElement, labels); panel.append(view, cap); host.append(panel);
  const env = envFor(renderer);   // reflections belong to this renderer's context
  const camera = o.ortho ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200) : new THREE.PerspectiveCamera(o.fov, 1, 0.1, 200);
  const dir = new THREE.Vector3(0, Math.cos(o.tilt || 0), Math.sin(o.tilt || 0)), p = new THREE.Vector3();
  const st = { renderer, scene, camera, labels, cap, view, w: 1, h: 1, follow: false, room: 0 };
  st.look = (fx, sx = 0, sz = 0) => {
    if (!o.ortho) { camera.position.set(o.pos[0] + sx, o.pos[1], o.pos[2] + sz); camera.lookAt(o.at[0] + sx, o.at[1], o.at[2] + sz); return; }
    p.set(clamp(fx, -st.room, st.room) + sx, 0, o.lookZ + sz); camera.position.copy(p).addScaledVector(dir, 60); camera.lookAt(p);
  };
  const resize = () => {
    const w = view.clientWidth, h = view.clientHeight; if (!w || !h) return;
    st.w = w; st.h = h; renderer.setSize(w, h, false);
    if (o.ortho) {
      const full = w / (2 * o.halfW), ppu = Math.min(Math.max(full, o.minPpu), h / (2 * o.halfH));
      st.follow = ppu > full * 1.02; st.room = Math.max(0, o.halfW - w / 2 / ppu);
      Object.assign(camera, { left: -w / 2 / ppu, right: w / 2 / ppu, top: h / 2 / ppu, bottom: -h / 2 / ppu });
    } else { camera.aspect = w / h; camera.fov = o.fov * Math.max(1, (o.aspect || 2) / camera.aspect) ** 0.75; }
    camera.updateProjectionMatrix(); st.look(0);
  };
  new ResizeObserver(resize).observe(view); resize();
  const v = new THREE.Vector3();
  st.at = (q) => { v.copy(q).project(camera); return [((v.x + 1) / 2) * st.w, ((1 - v.y) / 2) * st.h, v.z]; };
  st.render = () => { scene.environment = env; renderer.render(scene, camera); };
  return st;
}

/* smoke, dust and sparks: a small pool of sprites */
function particles(scene, T, n = 44) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.puff, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false; scene.add(s); pool.push({ s, age: 0, life: 0 });
  }
  return {
    spawn(pos, vel, s0, s1, life, color, op) {
      const p = pool.find((q) => q.age >= q.life) || pool[0];
      Object.assign(p, { age: 0, life, vel: vel.clone(), s0, s1, op });
      p.s.position.copy(pos); p.s.material.color.set(color); p.s.visible = true;
    },
    step(dt) {
      for (const p of pool) {
        if (p.age >= p.life) { p.s.visible = false; continue; }
        p.age += dt; const u = clamp(p.age / p.life);
        p.s.position.addScaledVector(p.vel, dt); p.vel.multiplyScalar(1 - 2.2 * dt);
        p.s.scale.setScalar(lerp(p.s0, p.s1, outCubic(u))); p.s.material.opacity = p.op * (1 - u) * Math.min(1, u * 8);
      }
    },
    clear() { for (const p of pool) { p.age = p.life = 0; p.s.visible = false; } },
  };
}


/* a flat ribbon along a curve on the ground (the paths) */
function ribbon(pts, width, mat, y) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const n = 64, P = curve.getSpacedPoints(n), L = curve.getLength(), pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = curve.getTangentAt(i / n), len = Math.hypot(t.x, t.z) || 1, nx = -t.z / len, nz = t.x / len;
    for (const s of [-1, 1]) { pos.push(P[i].x + (s * nx * width) / 2, y, P[i].z + (s * nz * width) / 2); uv.push(s < 0 ? 0 : 1, ((i / n) * L) / 3.4); }
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return { mesh: m, curve };
}

/* ---------- the scene ---------- */
function build(scene, A, B, T) {
  const add = (geo, mat, x, y, z, parent = scene) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const st = B, labels = B.labels;   // the target labels, the push tag and the follow camera belong to the ballista view
  const R = rng(21);
  const stoneM = new THREE.MeshStandardMaterial({ map: T.stone, bumpMap: T.stoneBump, bumpScale: 1.4, roughness: 0.95 });
  const trimM = stoneM.clone(); trimM.color.set(0xd6cdbf);
  const darkM = new THREE.MeshStandardMaterial({ color: 0x2e2a25, roughness: 1 });
  const ironM = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.42, metalness: 0.75 });
  const woodM = new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.8 });
  const darkWoodM = woodM.clone(); darkWoodM.color.set(0x8a7a6a);
  const paintM = new THREE.MeshStandardMaterial({ color: 0xeee6d6, roughness: 0.75 });
  const bronzeM = new THREE.MeshStandardMaterial({ color: 0xb07a42, roughness: 0.3, metalness: 0.85 });
  const ropeM = new THREE.MeshStandardMaterial({ color: 0xcdb48c, roughness: 1 });
  const pebbleM = new THREE.MeshStandardMaterial({ color: 0x9a948b, roughness: 0.9, flatShading: true });
  const up = new THREE.Vector3(0, 1, 0);

  const ground = add(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ map: T.earth, roughness: 1 }), 0, 0, 0);
  ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const flat = (geo, color, x, z, op = 1, y = 0.015) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); scene.add(m); return m; };

  // the path: up to the gate, through it, and on to the ballista
  T.cobble.repeat.set(1, 1);
  const pathM = new THREE.MeshStandardMaterial({ map: T.cobble, transparent: true, depthWrite: false, roughness: 0.95, side: THREE.DoubleSide });
  const LANE = -3.7;   // the ballista sits at x = 0 on the lane line z = LANE; - range to the left, + range to the right
  scene.add(ribbon([[0, 11.5], [0, 6], [0, 2.4], [0, -0.6], [0, LANE + 0.6]], 2.2, pathM, 0.012).mesh);
  const yard = flat(new THREE.PlaneGeometry(6, 6), 0xffffff, 0, LANE, 1, 0.011); yard.material = new THREE.MeshBasicMaterial({ map: T.scorch, transparent: true, depthWrite: false, opacity: 0.5 });   // trodden earth

  // the gatehouse: a block with an arched tunnel, two round towers, short curtain walls
  const GZ = 4.0, GD = 1.6, GW = 4.4, GH = 3.0, AW = 1.15, AY = 1.3, LIFT = 2.3;
  const sh = new THREE.Shape();
  sh.moveTo(-GW / 2, 0); sh.lineTo(-AW, 0); sh.lineTo(-AW, AY); sh.absarc(0, AY, AW, Math.PI, 0, true); sh.lineTo(AW, 0); sh.lineTo(GW / 2, 0); sh.lineTo(GW / 2, GH); sh.lineTo(-GW / 2, GH); sh.closePath();
  add(new THREE.ExtrudeGeometry(sh, { depth: GD, bevelEnabled: false, curveSegments: 28 }), stoneM, 0, 0, GZ - GD);
  const vs = new THREE.Shape();
  vs.moveTo(-AW - 0.24, AY); vs.absarc(0, AY, AW + 0.24, Math.PI, 0, true); vs.lineTo(AW, AY); vs.absarc(0, AY, AW, 0, Math.PI, false); vs.closePath();
  add(new THREE.ExtrudeGeometry(vs, { depth: 0.1, bevelEnabled: false, curveSegments: 28 }), trimM, 0, 0, GZ);
  for (const sx of [-1, 1]) add(wbox(0.24, AY, 0.1), trimM, sx * (AW + 0.12), AY / 2, GZ + 0.05);
  add(wbox(GW + 0.2, 0.2, GD + 0.2), trimM, 0, GH - 0.1, GZ - GD / 2);
  const merlon = wbox(0.42, 0.5, 0.3);
  for (let x = -GW / 2 + 0.26; x <= GW / 2 - 0.2; x += 0.69) { add(merlon, trimM, x, GH + 0.25, GZ - 0.05); add(merlon, trimM, x, GH + 0.25, GZ - GD + 0.05); }
  const TR = 0.95, TH = 3.3, TZ = GZ - 0.8, banners = [];
  for (const s of [-1, 1]) {
    const tx = s * (GW / 2 + 0.45);
    add(wcyl(TR, TR * 1.05, TH, 30), stoneM, tx, TH / 2, TZ);
    add(wcyl(TR + 0.16, TR, 0.3, 30), trimM, tx, TH + 0.15, TZ);
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, m = add(merlon, trimM, tx + Math.cos(a) * (TR + 0.02), TH + 0.55, TZ + Math.sin(a) * (TR + 0.02)); m.rotation.y = Math.PI / 2 - a; }
    add(new THREE.BoxGeometry(0.1, 0.5, 0.05), darkM, tx, 1.3, TZ + TR + 0.03);
    const bg = new THREE.PlaneGeometry(0.62, 1.4, 4, 10);
    const b = add(bg, new THREE.MeshStandardMaterial({ map: T.banner, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), tx, 2.4, TZ + TR + 0.08);
    b.userData.base = bg.attributes.position.array.slice(); banners.push(b);
    add(wbox(3.6, 2.3, 1.0, R() * 3, R() * 3), stoneM, s * 5.1, 1.15, TZ + 0.1);
    for (let x = 3.55; x < 6.9; x += 0.7) add(merlon, trimM, s * x, 2.55, TZ + 0.5);
    add(wcyl(0.7, 0.75, 2.8, 22), stoneM, s * 7.0, 1.4, TZ + 0.1);
  }
  for (let i = 0; i < 26; i++) { // stones in the grass, off the paths and lanes
    const x = (R() - 0.5) * 30, z = (R() - 0.5) * 18;
    if (Math.abs(x) < 1.8 && z > -1.5) continue; if (Math.abs(z - LANE) < 1.4 && Math.abs(x) > 2) continue; if (Math.abs(x) < 7.6 && z > 1.6 && z < 4.8) continue;
    const m = add(new THREE.DodecahedronGeometry(0.1 + R() * 0.2), pebbleM, x, 0.05, z); m.scale.y = 0.55; m.rotation.y = R() * 6;
  }

  // the portcullis
  const port = new THREE.Group(); port.position.set(0, 0, GZ - 0.4); scene.add(port);
  const portM = ironM.clone(); portM.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), GH - 0.05)];
  const vbar = new THREE.BoxGeometry(0.085, 2.55, 0.085), spike = new THREE.ConeGeometry(0.055, 0.2, 8), hbar = new THREE.BoxGeometry(2.5, 0.07, 0.07);
  for (let x = -1.05; x <= 1.06; x += 0.3) { add(vbar, portM, x, 0.2 + 2.55 / 2, 0, port); add(spike, portM, x, 0.1, 0, port).rotation.x = Math.PI; }
  for (let y = 0.5; y < 2.8; y += 0.46) add(hbar, portM, 0, y, -0.06, port);

  // the gate check: a measuring post beside the path, "you must be at least this X-ish to enter"; its pointer reads SiLU(gate)
  const post = new THREE.Group(); post.position.set(2.7, 0, 6.1); post.rotation.x = -0.06; post.scale.setScalar(1.3); scene.add(post);
  const B0 = 0.62, SPAN = 1.76, yOf = (o) => B0 + o * SPAN;
  add(wbox(0.16, 3.5, 0.16), woodM, 0, 1.75, -0.1, post);
  const boardTex = canvasTex(256, 1024, () => {}); boardTex.wrapS = boardTex.wrapT = THREE.ClampToEdgeWrapping;
  add(new THREE.BoxGeometry(0.62, 2.0, 0.06), [paintM, paintM, paintM, paintM, new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.75 }), paintM], 0, 1.5, 0, post);
  const headTex = canvasTex(1200, 470, () => {}); headTex.wrapS = headTex.wrapT = THREE.ClampToEdgeWrapping;
  add(new THREE.BoxGeometry(2.45, 0.96, 0.07), [woodM, woodM, woodM, woodM, new THREE.MeshStandardMaterial({ map: headTex, roughness: 0.75 }), woodM], 0, 3.0, 0.01, post);
  add(new THREE.BoxGeometry(2.6, 0.07, 0.16), woodM, 0, 3.5, 0.01, post);
  const fillM = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.5 });
  const fill = add(new THREE.PlaneGeometry(0.15, 1), fillM, 0, B0, 0.034, post); fill.castShadow = false;
  add(new THREE.BoxGeometry(0.42, 0.07, 0.08), ironM, 0.48, yOf(SHUT), 0.02, post);   // the "this" line, standing proud of the board
  const pointer = new THREE.Group(); post.add(pointer);
  add(new THREE.BoxGeometry(0.1, 0.17, 0.12), bronzeM, -0.02, 0, 0, pointer);
  add(new THREE.BoxGeometry(0.42, 0.05, 0.05), bronzeM, -0.27, 0, 0.03, pointer);
  add(new THREE.ConeGeometry(0.085, 0.19, 14), bronzeM, -0.55, 0, 0.03, pointer).rotation.z = Math.PI / 2;
  function drawBoard() {
    const g = boardTex.userData.canvas.getContext("2d"), w = 256, h = 1024, yv = (o) => h - ((yOf(o) - 0.5) / 2.0) * h;
    g.fillStyle = "#f5eee1"; g.fillRect(0, 0, w, h); g.strokeStyle = "#3b342c"; g.lineWidth = 9; g.strokeRect(9, 9, w - 18, h - 18);
    g.fillStyle = "#e3d8c5"; g.fillRect(w / 2 - 22, yv(1), 44, yv(0) - yv(1));
    for (let k = 0; k <= 4; k++) { const y = yv(k / 4), big = k % 4 === 0; g.strokeStyle = INK; g.lineWidth = big ? 6 : 4; g.beginPath(); g.moveTo(w / 2 + 28, y); g.lineTo(w / 2 + (big ? 96 : 66), y); g.stroke(); }
    g.fillStyle = MUTED; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `600 40px ${SANS}`;
    g.fillText("OPEN", w / 2, yv(1) - 34); g.fillText("SHUT", w / 2, yv(0) + 36);
    // the "this tall" line: below it the word is turned away
    const yl = yv(SHUT); g.fillStyle = INK; g.fillRect(18, yl - 7, w - 36, 14);
    g.fillStyle = INK; g.font = `700 38px ${SANS}`; g.textAlign = "left"; g.fillText("THIS", 22, yl - 32);
    boardTex.needsUpdate = true;
  }
  function drawHead(ish) {
    const g = headTex.userData.canvas.getContext("2d"), w = 1200, h = 470;
    g.fillStyle = "#f5eee1"; g.fillRect(0, 0, w, h); g.strokeStyle = "#3b342c"; g.lineWidth = 12; g.strokeRect(12, 12, w - 24, h - 24);
    g.strokeStyle = ACC; g.lineWidth = 4; g.strokeRect(34, 34, w - 68, h - 68);
    g.fillStyle = INK; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 76px ${SANS}`; if ("letterSpacing" in g) g.letterSpacing = "6px";
    fitFont(g, "YOU MUST BE AT LEAST THIS", 700, 76, SANS, w - 100, 40); g.fillText("YOU MUST BE AT LEAST THIS", w / 2, 100); g.font = `700 76px ${SANS}`; g.fillText("TO ENTER", w / 2, h - 98); if ("letterSpacing" in g) g.letterSpacing = "0px";
    fitFont(g, `${ish}-ish`, 600, 172, SERIF, w - 110, 50); g.fillStyle = INK; g.fillText(`${ish}-ish`, w / 2, h / 2 + 4);
    headTex.needsUpdate = true;
  }

  // the word, on a tile
  const tileSide = new THREE.MeshStandardMaterial({ color: 0xe6dac4, roughness: 0.7, transparent: true });
  const tileFace = new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true });
  const TILE_H = 0.5, tile = new THREE.Group(); scene.add(tile);
  const tileBody = add(new THREE.BoxGeometry(1, TILE_H, 0.14), [tileSide, tileSide, tileSide, tileSide, tileFace, tileFace], 0, TILE_H / 2, 0, tile);
  tileBody.rotation.x = -0.3;
  function drawTile(word) {
    const n = Math.max(1, [...word].length), w = clamp(0.45 + n * 0.13, 1.0, 1.5), cw = 1024, ch = Math.round((cw * TILE_H) / w);
    tileBody.scale.x = w;
    const tex = canvasTex(cw, ch, (g) => {
      g.fillStyle = "#fbf7ef"; g.fillRect(0, 0, cw, ch); g.strokeStyle = ACC; g.lineWidth = 16; rr(g, 14, 14, cw - 28, ch - 28, 22); g.stroke();
      // no text here: the word itself is the HTML chip pinned on the tile, so it stays readable at any size
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    if (tileFace.map) tileFace.map.dispose(); tileFace.map = tex; tileFace.needsUpdate = true;
  }

  // one ballista on a turntable; it rests pointing away from the gate and turns to + (right) or - (left) by up
  const SC = 1.6, nockOf = (d) => 0.7 - 1.85 * d, REST = Math.PI / 2;
  const makeBolt = () => {
    const b = new THREE.Group();
    add(new THREE.CylinderGeometry(0.028, 0.028, 1.1, 8), woodM, 0.55, 0, 0, b).rotation.z = Math.PI / 2;
    add(new THREE.ConeGeometry(0.06, 0.22, 10), ironM, 1.2, 0, 0, b).rotation.z = -Math.PI / 2;
    for (const a of [0, Math.PI / 2]) { const f = add(new THREE.PlaneGeometry(0.24, 0.11), new THREE.MeshStandardMaterial({ color: ACCENT, side: THREE.DoubleSide, roughness: 0.9 }), 0.13, 0, 0, b); f.rotation.x = a; }
    return b;
  };
  function ballista() {
    const x = 0, yaw = REST;
    for (const a of [Math.PI / 4, -Math.PI / 4]) add(new THREE.BoxGeometry(2.2, 0.12, 0.2), darkWoodM, x, 0.06, LANE).rotation.y = a;
    add(new THREE.CylinderGeometry(0.4, 0.52, 0.56, 20), darkWoodM, x, 0.28, LANE);
    add(new THREE.TorusGeometry(0.42, 0.03, 8, 28), ironM, x, 0.55, LANE).rotation.x = Math.PI / 2;
    const cat = new THREE.Group(); cat.position.set(x, 0.56, LANE); cat.rotation.y = yaw; cat.scale.setScalar(SC); scene.add(cat);
    add(new THREE.BoxGeometry(2.45, 0.12, 0.22), woodM, -0.1, 0.06, 0, cat);
    add(new THREE.BoxGeometry(2.2, 0.012, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a2a1c }), -0.1, 0.125, 0, cat);
    add(new THREE.BoxGeometry(0.24, 0.36, 0.86), darkWoodM, 0.86, 0.12, 0, cat);
    for (const y of [-0.02, 0.27]) add(new THREE.BoxGeometry(0.26, 0.035, 0.88), ironM, 0.86, y, 0, cat);
    for (const k of [-1, 1]) add(new THREE.CylinderGeometry(0.11, 0.11, 0.44, 14), ropeM, 0.86, 0.13, k * 0.3, cat);
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 12), ropeM, -1.2, 0.08, 0, cat).rotation.x = Math.PI / 2;
    const winch = new THREE.Group(); winch.position.set(-1.2, 0.08, 0); cat.add(winch);
    for (const k of [-1, 1]) for (const a of [0, Math.PI / 2]) add(new THREE.BoxGeometry(0.04, 0.42, 0.04), ironM, 0, 0, k * 0.34, winch).rotation.z = a;
    for (const f of [0.25, 0.5, 0.75, 1]) add(new THREE.BoxGeometry(0.03, 0.02, f === 1 ? 0.34 : 0.28), bronzeM, nockOf(f), 0.13, 0, cat);
    const bows = [-1, 1].map((k) => {
      const g = new THREE.Group(); g.position.set(0.86, 0.2, k * 0.3); cat.add(g);
      add(new THREE.BoxGeometry(0.085, 0.085, 1.0), woodM, 0, 0, k * 0.5, g); add(new THREE.SphereGeometry(0.06, 10, 8), bronzeM, 0, 0, k * 1.0, g);
      return { g, k };
    });
    const strings = bows.map(() => { const m = add(new THREE.CylinderGeometry(0.014, 0.014, 1, 6), ropeM, 0, 0, 0, cat); m.castShadow = false; return m; });
    const claw = add(new THREE.BoxGeometry(0.16, 0.07, 0.16), bronzeM, 0, 0.16, 0, cat);
    const ammo = makeBolt(); ammo.position.y = 0.19; cat.add(ammo);
    function setDraw(d, loaded) {
      const nock = nockOf(d), theta = 0.05 + 0.85 * d;
      winch.rotation.z = -d * 9; claw.position.x = nock; ammo.position.x = nock; ammo.visible = loaded;
      bows.forEach(({ g, k }, i) => {
        g.rotation.y = -k * theta;
        const tip = new THREE.Vector3(-Math.sin(theta), 0, k * Math.cos(theta)).add(g.position), end = new THREE.Vector3(nock, 0.2, 0), span = end.clone().sub(tip), m = strings[i];
        m.scale.set(1, span.length(), 1); m.position.copy(tip).addScaledVector(span, 0.5); m.quaternion.setFromUnitVectors(up, span.normalize());
      });
    }
    setDraw(0, false);
    return { cat, ammo, setDraw };
  }
  const bal = ballista();

  // the two ranges: a number line out from the ballista each way, quarter marks, and a target at full push
  const X0 = 3.9, X1 = 12.2, landX = (s, f) => s * (X0 + f * (X1 - X0));
  const tgts = {};
  for (const s of [-1, 1]) {
    const hex = s > 0 ? ACC : COOLS, col = s > 0 ? ACCENT : COOL;
    for (let x = X0; x < X1 - 1.3; x += 0.42) flat(new THREE.PlaneGeometry(0.22, 0.05), 0xa79a83, s * x, LANE, 0.9);
    for (const f of [0.25, 0.5, 0.75]) flat(new THREE.PlaneGeometry(0.06, f === 0.5 ? 0.9 : 0.6), 0x8f826c, landX(s, f), LANE);
    const decal = flat(new THREE.PlaneGeometry(2.6, 2.6), 0xffffff, s * X1, LANE, 0.6);
    decal.material = new THREE.MeshBasicMaterial({ map: T.target(hex), transparent: true, depthWrite: false, opacity: 0.6 });
    add(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), ironM, s * X1 + 1.15, 0.75, LANE - 0.4);
    const fg = new THREE.PlaneGeometry(0.7, 0.42, 10, 2); fg.translate(0.35, 0, 0);
    const flag = add(fg, new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.85 }), s * X1 + 1.15, 1.25, LANE - 0.4);
    flag.userData.base = fg.attributes.position.array.slice();
    const ring = flat(new THREE.RingGeometry(1.25, 1.42, 64), col, s * X1, LANE, 0, 0.02);
    tgts[s] = { decal, flag, ring };
  }

  const fx = particles(scene, T);
  const scorch = flat(new THREE.PlaneGeometry(2.2, 2.2), 0xffffff, 0, 0, 0, 0.017); scorch.material = new THREE.MeshBasicMaterial({ map: T.scorch, transparent: true, depthWrite: false, opacity: 0 });
  const shock = flat(new THREE.RingGeometry(0.8, 1, 48), 0xcdbfa8, 0, 0, 0, 0.02);
  const aimM = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false });
  const aimLine = flat(new THREE.PlaneGeometry(1, 0.09), 0xffffff, 0, 0, 0, 0.022); aimLine.material = aimM;
  const reticle = new THREE.Group(); reticle.position.y = 0.024; scene.add(reticle);
  for (const geo of [new THREE.RingGeometry(0.42, 0.52, 40), new THREE.PlaneGeometry(1.3, 0.06), new THREE.PlaneGeometry(0.06, 1.3)]) { const m = new THREE.Mesh(geo, aimM); m.rotation.x = -Math.PI / 2; reticle.add(m); }
  const bolt = makeBolt(); bolt.scale.setScalar(SC); bolt.visible = false; scene.add(bolt);

  // HTML labels: the target words, and the push where the bolt lands
  const lab = { [-1]: el("div", "f3d-tgt neg"), [1]: el("div", "f3d-tgt") }, hitLab = el("div", "f3d-hit");
  labels.append(lab[-1], lab[1], hitLab);
  const chip = { A: el("div", "f3d-word"), B: el("div", "f3d-word") }, note = el("div", "f3d-note");   // the word, readable at any size
  A.labels.append(chip.A); B.labels.append(chip.B, note);
  note.textContent = "Turned away at the gate: only a trace leaks through, too small to fire.";
  const anchor = { [-1]: new THREE.Vector3(-X1, 0, LANE - 1.5), [1]: new THREE.Vector3(X1, 0, LANE - 1.5) };

  let word = "", gateIsh = null, shot = null, landed = null, shake = 0, sv = null;
  const v = new THREE.Vector3();
  // the bolt's tip flies a parabola from the ballista to the landing mark and goes in there, nose down
  const BL = 1.31 * SC;   // tail to tip
  function flight(s, reach) {
    const from = new THREE.Vector3(s * (nockOf(0) * SC + BL), 0.56 + 0.19 * SC, LANE), to = new THREE.Vector3(landX(s, reach), -0.1, LANE);
    const D = Math.abs(to.x - from.x); return { s, reach, from, to, h: 0.5 + 0.38 * D, dur: 0.5 + 0.07 * D };
  }
  function boltAt(f, u) {
    const D = Math.abs(f.to.x - f.from.x), x = lerp(f.from.x, f.to.x, u), y = lerp(f.from.y, f.to.y, u) + 4 * f.h * u * (1 - u);
    const pitch = clamp(Math.atan2(f.to.y - f.from.y + 4 * f.h * (1 - 2 * u), D), -1.25, 1.25);
    bolt.rotation.set(0, f.s > 0 ? 0 : Math.PI, pitch);
    bolt.position.set(x - f.s * Math.cos(pitch) * BL, y - Math.sin(pitch) * BL, LANE);
  }
  function release(t, s, reach) {
    const hitP = new THREE.Vector3(landX(s, reach), 0, LANE);
    shot = { t0: t, hitP, ...flight(s, reach) };
    bolt.visible = true; boltAt(shot, 0);
    const front = new THREE.Vector3(s * 0.9 * SC, 0.9, LANE);
    for (let i = 0; i < 6; i++) fx.spawn(front, new THREE.Vector3((R() - 0.5) * 1.2, 0.4, (R() - 0.5) * 1.2), 0.3, 0.9, 0.7, 0xe0d6c4, 0.55);
  }
  function impact() {
    const p = shot.hitP, k = 0.5 + shot.reach;
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + R(); fx.spawn(new THREE.Vector3(p.x, 0.2, p.z), new THREE.Vector3(Math.cos(a) * 2.2 * k, 0.6 + R() * 0.8, Math.sin(a) * 2.2 * k), 0.4, 1.4 * k, 1.3, 0xcbb99d, 0.75); }
    scorch.position.set(p.x, 0.017, p.z); scorch.scale.setScalar(0.5 + 0.6 * shot.reach);
    landed = { t: shot.t0 + shot.dur, p: p.clone() }; shake = 0.2 * k; boltAt(shot, 1);
  }
  const place = (elx, q, ax, ay, view = st) => {   // pin a label to a point, kept inside the view; hidden while its point is off screen
    const [x, y] = view.at(q), w = elx.offsetWidth, h = elx.offsetHeight;
    elx.style.visibility = x < 0 || x > view.w ? "hidden" : "";
    elx.style.left = clamp(x - ax * w, 4, view.w - w - 4) + "px"; elx.style.top = clamp(y - ay * h, 4, view.h - h - 4) + "px";
  };

  return {
    LIFT, TILE_H,
    set(s) {
      sv = s;
      if (s.word !== word) { word = s.word; drawTile(word); }
      const gi = s.gateIsh || s.ish || "";
      if (gi !== gateIsh) { gateIsh = gi; drawHead(gi); }
      const head = (k, ish) => `${k} ${ish ? esc(ish) + "-ish" : '<span class="nl">no label yet</span>'}`;
      lab[1].innerHTML = `<b>${head("+", s.posIsh)}</b><span>pushes towards ${esc(s.plus || "–")}</span>`;
      lab[-1].innerHTML = `<b>${head("−", s.negIsh)}</b><span>pushes towards ${esc(s.minus || "–")}</span>`;
      const open = Math.max(0, s.open), pass = open >= SHUT, side = s.u >= 0 ? "+" : "−", reach = Math.abs(s.launch);
      A.cap.innerHTML = `<span><b>1 · Gate (the ruler)</b> opens <i>${Math.round(open * 100)}%</i>${pass ? ", so the word goes through" : ": below the line, so the word is turned away (the gate is soft, so only a trace leaks through)"}</span>`;
      B.cap.innerHTML = (pass ? `<span><b>2 · Up</b> <i>${sgn(s.u)}</i>, so the ballista turns to ${side}</span>` +
          `<span><b>3 · Push</b> <i>${sgn(s.a, 1)}</i>, ${reach < 0.02 ? "too weak to fire" : `lands ${Math.round(reach * 100)}% of the way to the ${side} target`}</span>` : `<span><b>Turned away at the gate:</b> only a trace leaks through (push <i>${sgn(s.a, 2)}</i>), too small to fire.</span>`) +
        `<span class="ph"><b>${head("+", s.posIsh)}:</b> ${esc(s.plus || "–")}</span><span class="ph"><b>${head("−", s.negIsh)}:</b> ${esc(s.minus || "–")}</span>`;   // phones: the targets are often off screen
      hitLab.textContent = `${Math.round(Math.min(1, Math.abs(s.launch)) * 100)}% of max`; chip.A.textContent = chip.B.textContent = s.word;
    },
    redraw() { drawBoard(); if (gateIsh !== null) drawHead(gateIsh); if (word) drawTile(word); },
    reset() { shot = null; landed = null; bolt.visible = false; fx.clear(); },
    frame(t, dt, cur, pose, time) {
      const open = Math.max(0, cur.open), passes = open >= SHUT, reach = clamp(Math.abs(cur.launch));
      const s = cur.launch !== 0 ? Math.sign(cur.launch) : cur.r >= 0 ? 1 : -1, fires = passes && reach >= 0.02;
      // 1. the gate check
      const back = passes ? 7.2 : TURNED - 1.0;   // when the gate and ruler start to settle back for the next loop
      const gp = pose ? 1 : inOut(seg(t, 1.2, 2.0)) * (1 - inOut(seg(t, back, back + 0.8)));
      port.position.y = open * LIFT * gp;
      const o = open * (pose ? 1 : outBack(seg(t, 1.05, 1.9)) * (1 - inOut(seg(t, back + 0.1, back + 0.8))));
      pointer.position.set(-0.33, yOf(o), 0.02); fill.scale.y = Math.max(0.001, o * SPAN); fill.position.y = B0 + (o * SPAN) / 2;
      fillM.color.set(passes ? ACCENT : 0x9a9188);
      // the word: up to the gate; through it (or turned away, then back); on to the ballista, where it is loaded
      const START = 8.0, STOP = GZ + 1.0, BUMP = GZ + 0.3, LOAD = LANE + 2.5;
      let z = STOP, y = 0, op = 1, sy = 1, wob = 0;
      if (pose) { if (passes) z = LOAD + 0.6; }
      else if (t < 2.1) { const u = seg(t, 0, 1.2); z = lerp(START, STOP, outCubic(u)); if (u < 1) y = Math.abs(Math.sin(u * Math.PI * 6)) * 0.12 * (1 - u); op = seg(t, 0, 0.3); }
      else if (!passes) {
        if (t < 2.35) z = lerp(STOP, BUMP, Math.pow(seg(t, 2.1, 2.35), 2));
        else if (t < 3.3) { z = lerp(BUMP, STOP, outCubic(seg(t, 2.35, 2.8))); wob = Math.sin((t - 2.8) * 22) * 0.35 * seg(t, 2.8, 2.9) * (1 - seg(t, 3.0, 3.3)); }
        else { const u = seg(t, 3.3, 4.9); z = lerp(STOP, START, inOut(u)); y = Math.abs(Math.sin(u * Math.PI * 6)) * 0.1; op = 1 - seg(t, 4.2, 4.9); }
      } else {
        const u = inOut(seg(t, 2.1, 3.7)); z = lerp(STOP, LOAD, u); y = Math.abs(Math.sin(u * Math.PI * 8)) * 0.08;
        if (z < GZ + 0.35 && z > GZ - GD - 0.3) sy = clamp(port.position.y / (1.5 * TILE_H + 0.06), 0.3, 1);
        const k = seg(t, 3.7, 4.0); sy *= 1 - 0.6 * k; op = 1 - k;
      }
      tile.position.set(0, y, z); tile.scale.set(1.5, 1.5 * sy, 1.5); tile.rotation.y = wob;
      tileSide.opacity = tileFace.opacity = op; tile.visible = op > 0.01;
      // 2. up turns the ballista to + (right) or - (left); 3. it draws back by the push, then fires
      const ap = fires ? (pose ? 1 : inOut(seg(t, 3.9, 4.5)) * (1 - inOut(seg(t, 7.2, 8.0)))) : 0;
      bal.cat.rotation.y = lerp(REST, s > 0 ? 0 : Math.PI, ap);
      let draw = fires ? reach * (pose ? 1 : inOut(seg(t, 4.4, 5.0))) : 0;
      if (!pose && fires && !shot && t >= FIRE && t < FIRE + 1) release(t, s, reach);
      if (shot && !pose) { const u = seg(t, FIRE, FIRE + 0.07); draw = reach * (1 - u) - (u >= 1 ? Math.sin((t - FIRE) * 40) * 0.03 * Math.exp(-(t - FIRE) * 7) : 0); }
      else if (draw > 0 && draw < reach) draw += Math.sin(t * 70) * 0.006;
      const loaded = fires && (pose || (t > 3.9 && !shot));
      bal.setDraw(fires ? draw : 0, loaded);
      const aimOn = fires ? (pose ? 1 : seg(t, 4.4, 4.7) * (1 - seg(t, FIRE + 0.6, FIRE + 1.0))) : 0;
      aimM.opacity = 0.75 * aimOn; aimM.color.set(s > 0 ? ACCENT : COOL);
      if (aimOn > 0) {
        const d0 = s * 1.0 * SC, d1 = landX(s, shot && !pose ? reach : Math.max(0, draw));
        aimLine.scale.x = Math.max(0.01, Math.abs(d1 - d0)); aimLine.position.set((d0 + d1) / 2, 0.022, LANE);
        reticle.position.set(d1, 0.024, LANE); reticle.rotation.y = time * 1.5;
      }
      aimLine.visible = reticle.visible = aimOn > 0.01;
      if (shot && !pose) {
        const u = (t - shot.t0) / shot.dur;
        if (u < 1) {
          boltAt(shot, u);
          if (Math.floor(time * 40) % 2 === 0) fx.spawn(bolt.position, new THREE.Vector3(0, 0.05, 0), 0.1, 0.3, 0.4, 0xe2dacd, 0.3);
        } else if (!landed) impact();
        if (landed) bolt.visible = t < 7.9;
      }
      if (pose) {
        bolt.visible = fires;
        if (fires) boltAt(flight(s, reach), 1);
      }
      const hitShown = fires && (pose || !!landed), sp = hitShown ? (pose ? 1 : 1 - seg(t, 7.2, 8.0)) : 0;
      if (pose && fires) { scorch.position.set(landX(s, reach), 0.017, LANE); scorch.scale.setScalar(0.5 + 0.6 * reach); }
      scorch.material.opacity = 0.9 * sp;
      const lu = landed && !pose ? seg(t, landed.t, landed.t + 0.6) : 1;
      shock.visible = !!landed && !pose && lu < 1;
      if (shock.visible) { shock.position.set(landed.p.x, 0.02, landed.p.z); shock.scale.setScalar(0.3 + lu * 2.2 * (0.5 + shot.reach)); shock.material.opacity = 0.6 * (1 - lu); }
      fx.step(dt);
      for (const k of [-1, 1]) {
        const on = hitShown && k === s, g = on ? sp : 0;
        tgts[k].decal.material.opacity = 0.55 + 0.45 * g * reach;
        tgts[k].ring.material.opacity = on ? g * reach * (0.55 + 0.35 * Math.sin(time * 5)) : 0;
        lab[k].classList.toggle("on", on && g > 0.5);
        const p = tgts[k].flag.geometry.attributes.position, b = tgts[k].flag.userData.base;
        for (let i = 0; i < p.count; i++) { const bx = b[i * 3]; p.setZ(i, Math.sin(bx * 7 - time * 6) * 0.06 * bx); }
        p.needsUpdate = true;
      }
      for (const b of banners) {
        const p = b.geometry.attributes.position, base = b.userData.base;
        for (let i = 0; i < p.count; i++) { const bx = base[i * 3], by = base[i * 3 + 1], k = (0.7 - by) / 1.4; p.setZ(i, Math.sin(by * 3.1 + time * 2.1 + bx * 2.4) * 0.06 * k); }
        p.needsUpdate = true; b.geometry.computeVertexNormals();
      }
      // the camera: fixed when the whole scene fits; on a narrow screen it follows the word, then the bolt
      let fxs = 0;
      if (st.follow && passes) {
        const a1 = pose ? 1 : inOut(seg(t, 4.0, 4.8)), a2 = pose ? 1 : fires ? inOut(seg(t, FIRE, FIRE + 0.9)) : 0, back = pose ? 0 : inOut(seg(t, 7.4, 8.1));
        fxs = lerp(0, fires ? landX(s, reach) - s * 2.2 : 0, Math.max(a2, 0.35 * a1 * (fires ? 1 : 0))) * (1 - back);
      }
      let sx = 0, sz = 0;
      if (shake > 0 && !pose) { shake = Math.max(0, shake - dt); sx = (R() - 0.5) * shake * 0.5; sz = (R() - 0.5) * shake * 0.5; }
      st.look(fxs, sx, sz);
      // labels: the word chip in each view (A until it comes out the back of the gate, B from when it goes in), the targets
      const top = new THREE.Vector3(0, y + 0.75 * TILE_H * sy, z), show = tile.visible && op > 0.25;
      chip.A.style.display = show && z > GZ - GD - 0.2 ? "" : "none"; if (chip.A.style.display === "") place(chip.A, top, 0.5, 0.5, A);
      chip.B.style.display = show && z < GZ - 0.3 ? "" : "none"; if (chip.B.style.display === "") place(chip.B, top, 0.5, 0.5, B);
      chip.A.style.opacity = chip.B.style.opacity = op;
      note.style.display = !passes && (pose || t > 2.6) ? "" : "none";
      for (const k of [-1, 1]) place(lab[k], anchor[k], 0.5, 1);
      hitLab.style.display = hitShown && sp > 0.3 ? "" : "none";
      if (hitShown) { hitLab.classList.toggle("neg", s < 0); place(hitLab, new THREE.Vector3(landX(s, reach), 0, LANE + 0.9), 0.5, 0); }
      return passes;
    },
  };
}

function mount(host) {
  host.textContent = "";
  const T = textures(), reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = world();
  const A = stage(host, scene, { cls: "f3d-a", fov: 30, aspect: 2.6, pos: [1.4, 3.9, 19.5], at: [0.5, 2.05, 4.0] });
  const B = stage(host, scene, { cls: "f3d-b", ortho: true, tilt: 0.55, lookZ: -2.5, halfW: 13.6, halfH: 4.4, minPpu: 25 });
  const sc = build(scene, A, B, T);
  const goal = { open: 0, r: 0, launch: 0 }, cur = { ...goal };
  let key = "", t = 0, frozen = false, last = performance.now(), visible = true, raf = 0;
  sc.redraw();
  if (document.fonts) Promise.all(["600 60px Newsreader", "italic 500 60px Newsreader", "500 60px 'IBM Plex Mono'"].map((f) => document.fonts.load(f))).then(() => sc.redraw()).catch(() => {});

  function loop(now) {
    raf = 0; if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!frozen && !reduce) {
      t += dt;
      const len = cur.open >= SHUT ? CYCLE : TURNED;
      if (t >= len) { const k0 = key; if (api.onEnd) api.onEnd(); if (key === k0) { t -= len; sc.reset(); } }   // onEnd may change the word
    }
    const k = 1 - Math.pow(0.003, dt);
    for (const q in goal) cur[q] = lerp(cur[q], goal[q], k);
    const passes = sc.frame(t, dt, cur, reduce, reduce ? 0 : now / 1000);
    show(reduce ? null : passes && t > 2.75 && t < CYCLE - 0.45 ? "B" : "A");
    if (reduce || view !== "B" || fading) A.render();
    if (reduce || view !== "A" || fading) B.render();
    raf = requestAnimationFrame(loop);
  }
  // which view is showing; the two panels sit on top of each other and crossfade (both show when motion is reduced)
  let view = null, fading = 0;
  function show(v) {
    if (v === view) return;
    view = v; host.classList.toggle("f3d-both", !v);
    for (const [st, k] of [[A, "A"], [B, "B"]]) st.view.parentElement.classList.toggle("off", !!v && v !== k);
    clearTimeout(fading); fading = setTimeout(() => { fading = 0; }, 700);
  }
  const kick = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  // coming into view starts the current word's story from the beginning
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { const was = visible; visible = es[0].isIntersecting; if (visible && !was && !frozen) { t = 0; sc.reset(); } kick(); }, { threshold: 0.25 }).observe(host);
  kick();

  const api = {
    update(s) {
      goal.open = Math.max(0, s.open); goal.r = s.r; goal.launch = s.launch;
      const k = s.id + "|" + s.word;
      if (k !== key) { key = k; t = 0; sc.reset(); Object.assign(cur, goal); }
      sc.set(s); kick();
    },
    seek(x, freeze = true) {   // for checking a given moment: replay the timeline up to x, then hold there
      sc.reset(); Object.assign(cur, goal);
      for (t = 0; t < x; t += 1 / 60) sc.frame(t, 1 / 60, cur, false, t);
      t = x; frozen = freeze; const p = sc.frame(t, 0, cur, false, t); host.classList.add("f3d-instant"); view = null; show(p && t > 2.75 && t < CYCLE - 0.45 ? "B" : "A"); void host.offsetWidth; host.classList.remove("f3d-instant"); A.render(); B.render(); kick();
    },
    pause(on = true) { frozen = on; },
    landing(freeze = true) { api.seek(goal.open >= SHUT ? CYCLE - 0.8 : 3.3, freeze); },   // hold the moment that tells the story
    onEnd: null,
  };
  window.Fig3D.active = api;
  return api;
}

window.Fig3D = { mount, CYCLE_MS: CYCLE * 1000 };
window.dispatchEvent(new Event("fig3d-ready"));
