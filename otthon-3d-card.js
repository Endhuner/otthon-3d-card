/* otthon-3d-card v0.2.0 — forgatható 3D alaprajz-kártya Home Assistanthoz (three.js).
   Konfig (lásd README): levels[] (name, z, walls/floor/glass/furniture gyűrűk "x,y;x,y;…" méterben, deck), points[] (entity, level, x, y, name),
   wall_h, slab_h, furniture_h, origin (pt, a koordináta-módhoz), height (CSS), default_level (index vagy 'all'). A ház geometriája a dashboard konfigjában marad, ez a fájl generikus. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const VERSION = '0.2.0';
const PT_PER_M = 28.35;
const COL = { wallTop: 0xf5f5f7, wallSide: 0xb9bec7, slabTop: 0xe9e3d7, slabSide: 0xcfc7b8, deck: 0xd8b78c, deckSide: 0xb8956a, glass: 0x8fc4e8, edge: 0x7b8290, furnTop: 0xd2b48c, furnSide: 0xb08d63 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const parseRing = s => (typeof s === 'string' ? s.split(';').map(p => p.split(',').map(Number)) : s);
const area = r => r.reduce((a, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + x * y2 - x2 * y; }, 0) / 2;
const inside = ([px, py], r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; };

// Gyűrűk → three.js Shape-ek lyukakkal. A generátor szerint az anyag a bejárási irány jobbján van (y lefelé),
// ezért a külső gyűrűk előjeles területe pozitív, a lyukaké negatív.
function shapesFromRings(rings) {
  const outer = [], holes = [];
  for (const r of rings.map(parseRing)) (area(r) > 0 ? outer : holes).push(r);
  const shapes = outer.map(r => ({ shape: new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, -y))), ring: r }));
  for (const h of holes) { const s = shapes.find(o => inside(h[0], o.ring)); if (s) s.shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, -y)))); }
  return shapes.map(s => s.shape);
}

// Kihúzás: a Shape síkja XY → elforgatva XZ lesz, a mélység +Y (felfelé); shape.y = -terv_y, így világ z = terv_y (dél).
function extrude(rings, depth, matTop, matSide, y0 = 0) {
  const shapes = shapesFromRings(rings || []);
  if (!shapes.length) return null;
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false }), [matTop, matSide]);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = y0;
  return mesh;
}

class Otthon3DCard extends HTMLElement {
  static getStubConfig() { return { levels: [], points: [] }; }
  setConfig(config) {
    if (!config || !Array.isArray(config.levels) || !config.levels.length) throw new Error('otthon-3d-card: a "levels" lista hiányzik');
    this._config = config; this._points = config.points || [];
    if (this._built) this._rebuild();
  }
  set hass(hass) { this._hass = hass; this._updateLabelText(); }
  getCardSize() { return 12; }
  connectedCallback() { if (!this._built) this._build(); this._loop(); }
  disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = null; this._ro?.disconnect(); }

  _build() {
    this._built = true;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{display:block}
      .wrap{position:relative;width:100%;height:${this._config.height || 'min(calc(100vh - 110px), 820px)'};overflow:hidden;border-radius:var(--ha-card-border-radius,12px);background:var(--card-background-color,#fff)}
      canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}
      .labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}
      .lbl{position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;background:rgba(28,30,36,.84);color:#fff;font:600 12px/1.3 Roboto,sans-serif;padding:3px 9px;border-radius:12px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)}
      .lbl.unavail{opacity:.55}
      .bar{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:6px;flex-wrap:wrap;pointer-events:none}
      .bar button{pointer-events:auto;font:500 12px Roboto,sans-serif;padding:5px 10px;border-radius:14px;border:0;background:rgba(255,255,255,.92);color:#222;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.3)}
      .bar button.on{background:var(--primary-color,#03a9f4);color:#fff}
      .bar .sp{flex:1}
      .toast{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(28,30,36,.92);color:#fff;padding:6px 12px;border-radius:10px;font:12px Roboto,sans-serif;display:none;white-space:nowrap}
      .ver{position:absolute;right:8px;bottom:6px;font:10px Roboto,sans-serif;color:rgba(0,0,0,.35)}
    </style>
    <div class="wrap"><canvas></canvas><div class="labels"></div><div class="bar"></div><div class="toast"></div><div class="ver">otthon-3d ${VERSION}</div></div>`;
    this._wrap = root.querySelector('.wrap'); this._canvas = root.querySelector('canvas');
    this._labels = root.querySelector('.labels'); this._bar = root.querySelector('.bar'); this._toast = root.querySelector('.toast');

    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this._scene.add(new THREE.HemisphereLight(0xffffff, 0x99a3ad, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(6, 14, 9); this._scene.add(sun);
    const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
    this._mats = { wallTop: lam(COL.wallTop), wallSide: lam(COL.wallSide), slabTop: lam(COL.slabTop, { side: THREE.DoubleSide }), slabSide: lam(COL.slabSide), deck: lam(COL.deck), deckSide: lam(COL.deckSide),
      glass: lam(COL.glass, { transparent: true, opacity: 0.45, depthWrite: false }), edge: new THREE.LineBasicMaterial({ color: COL.edge }),
      furnTop: lam(COL.furnTop), furnSide: lam(COL.furnSide) };
    this._ray = new THREE.Raycaster(); this._ptrs = new Map(); this._orbit = { theta: Math.PI / 4, phi: 0.95, r: 20, target: new THREE.Vector3() };
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this._wrap);
    this._bindPointer();
    this._rebuild();
  }

  _rebuild() {
    for (const g of this._groups || []) this._scene.remove(g);
    const cfg = this._config, wallH = cfg.wall_h ?? 1.1, slabH = cfg.slab_h ?? 0.25, m = this._mats;
    this._groups = cfg.levels.map((lvl, i) => {
      const g = new THREE.Group(); g.position.y = lvl.z || 0; g.userData.level = i;
      const floor = extrude(lvl.floor, slabH, m.slabTop, m.slabSide, -slabH);
      if (floor) { floor.userData.level = i; g.add(floor); g.userData.floor = floor; }
      if (lvl.deck) { const d = extrude([lvl.deck], 0.08, m.deck, m.deckSide, -0.08); if (d) g.add(d); }
      const walls = extrude(lvl.walls, wallH, m.wallTop, m.wallSide);
      if (walls) { g.add(walls); const e = new THREE.LineSegments(new THREE.EdgesGeometry(walls.geometry, 25), m.edge); e.rotation.copy(walls.rotation); g.add(e); }
      const furn = extrude(lvl.furniture, cfg.furniture_h ?? 0.55, m.furnTop, m.furnSide);
      if (furn) { g.add(furn); const e = new THREE.LineSegments(new THREE.EdgesGeometry(furn.geometry, 25), m.edge); e.rotation.copy(furn.rotation); g.add(e); }
      const glass = extrude(lvl.glass, wallH * 0.95, m.glass, m.glass); if (glass) { glass.renderOrder = 2; g.add(glass); }
      this._scene.add(g); return g;
    });
    this._labels.innerHTML = '';
    this._labelEls = this._points.map(p => { const el = document.createElement('div'); el.className = 'lbl'; el.addEventListener('click', ev => { ev.stopPropagation(); this._moreInfo(p.entity); }); this._labels.appendChild(el); return el; });
    this._buildBar();
    const dl = cfg.default_level;
    this._show(dl === 'all' || dl == null ? new Set(cfg.levels.map((_, i) => i)) : new Set([Math.min(Math.max(+dl, 0), cfg.levels.length - 1)]), true);
    this._updateLabelText();
  }

  _buildBar() {
    this._bar.innerHTML = '';
    const btn = (txt, on) => { const b = document.createElement('button'); b.textContent = txt; b.addEventListener('click', on); this._bar.appendChild(b); return b; };
    this._lvlBtns = this._config.levels.map((lvl, i) => btn(lvl.name || `Szint ${i + 1}`, () => this._show(new Set([i]))));
    this._allBtn = btn('Mind', () => this._show(new Set(this._config.levels.map((_, i) => i))));
    const sp = document.createElement('div'); sp.className = 'sp'; this._bar.appendChild(sp);
    this._editBtn = btn('📍 Koordináta', () => { this._edit = !this._edit; this._editBtn.classList.toggle('on', this._edit); this._say(this._edit ? 'Koppints a padlóra: kiírja és vágólapra teszi az x,y-t' : ''); });
    btn('⟲ Nézet', () => this._fit(true));
  }

  _show(set, fitAll = false) {
    this._visible = set;
    this._groups.forEach((g, i) => { g.visible = set.has(i); });
    this._lvlBtns.forEach((b, i) => b.classList.toggle('on', set.size === 1 && set.has(i)));
    this._allBtn.classList.toggle('on', set.size > 1);
    this._fit(fitAll || set.size > 1 !== this._wasMulti); this._wasMulti = set.size > 1; this._dirty = true;
  }

  _fit(resetAngles) {
    const box = new THREE.Box3();
    this._groups.forEach(g => { if (g.visible) box.expandByObject(g); });
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const o = this._orbit; o.target.copy(c);
    if (resetAngles) { o.theta = Math.PI / 4; o.phi = this._visible.size > 1 ? 1.2 : 0.95; o.r = Math.max(size.x, size.z, size.y * 1.5) * 1.35 + 2; }
    this._updateCamera();
  }

  _updateCamera() {
    const o = this._orbit, sp = Math.sin(o.phi);
    this._camera.position.set(o.target.x + o.r * sp * Math.sin(o.theta), o.target.y + o.r * Math.cos(o.phi), o.target.z + o.r * sp * Math.cos(o.theta));
    this._camera.lookAt(o.target); this._dirty = true;
  }

  _resize() {
    const w = this._wrap.clientWidth, h = this._wrap.clientHeight; if (!w || !h) return;
    this._renderer.setSize(w, h, false); this._camera.aspect = w / h; this._camera.updateProjectionMatrix(); this._dirty = true;
  }

  _bindPointer() {
    const c = this._canvas, o = this._orbit;
    const dist = () => { const [a, b] = [...this._ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false }); if (this._ptrs.size === 2) this._pinch = dist(); e.preventDefault(); });
    c.addEventListener('pointermove', e => {
      const p = this._ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 2) p.moved = true; p.x = e.clientX; p.y = e.clientY;
      if (this._ptrs.size === 1) {
        if (e.buttons & 2 || e.shiftKey) {                                   // jobb gomb / shift: tolás
          const right = new THREE.Vector3().setFromMatrixColumn(this._camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(this._camera.matrixWorld, 1);
          o.target.addScaledVector(right, -dx * o.r * 0.0015).addScaledVector(up, dy * o.r * 0.0015);
        } else { o.theta -= dx * 0.006; o.phi = clamp(o.phi - dy * 0.006, 0.12, 1.45); }
        this._updateCamera();
      } else if (this._ptrs.size === 2) { const d = dist(); if (d > 0 && this._pinch) o.r = clamp(o.r * this._pinch / d, 2, 150); this._pinch = d; this._updateCamera(); }
    });
    const up = e => { const p = this._ptrs.get(e.pointerId); this._ptrs.delete(e.pointerId); if (p && !p.moved && this._edit && e.type === 'pointerup') this._pick(e); };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { o.r = clamp(o.r * (1 + Math.sign(e.deltaY) * 0.1), 2, 150); this._updateCamera(); e.preventDefault(); }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  _pick(e) {
    const rect = this._canvas.getBoundingClientRect();
    this._ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this._camera);
    const floors = this._groups.filter(g => g.visible && g.userData.floor).map(g => g.userData.floor);
    let hit = this._ray.intersectObjects(floors, false)[0], lvlIdx = hit && hit.object.userData.level, pt = hit && hit.point;
    if (!hit) {                                            // a födémen kívül (terasz, beugró): a legfelső látható szint padlósíkja
      lvlIdx = Math.max(...this._visible); const z = this._config.levels[lvlIdx].z || 0;
      pt = this._ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -z), new THREE.Vector3());
      if (!pt) return;
    }
    const [cx, cy] = this._config.origin || [0, 0], lvl = this._config.levels[lvlIdx];
    const xm = pt.x, ym = pt.z, xpt = Math.round(xm * PT_PER_M + cx), ypt = Math.round(ym * PT_PER_M + cy);
    const txt = `${lvl.name}: x ${xpt}, y ${ypt}  (${xm.toFixed(2)} m, ${ym.toFixed(2)} m)`;
    this._say(txt); navigator.clipboard?.writeText(`"x": ${xpt}, "y": ${ypt}`).catch(() => {});
  }

  _say(txt) { this._toast.textContent = txt; this._toast.style.display = txt ? 'block' : 'none'; clearTimeout(this._tt); if (txt) this._tt = setTimeout(() => { this._toast.style.display = 'none'; }, 6000); }

  _moreInfo(entityId) { this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } })); }

  _updateLabelText() {
    if (!this._hass || !this._labelEls) return;
    this._points.forEach((p, i) => {
      const st = this._hass.states[p.entity], el = this._labelEls[i];
      const name = p.name || st?.attributes?.friendly_name || p.entity;
      let val = '?';
      if (st) { try { val = this._hass.formatEntityState ? this._hass.formatEntityState(st) : st.state + (st.attributes.unit_of_measurement ? ' ' + st.attributes.unit_of_measurement : ''); } catch { val = st.state; } }
      el.textContent = `${name} · ${val}`; el.classList.toggle('unavail', !st || st.state === 'unavailable');
    });
    this._dirty = true;
  }

  _placeLabels() {
    const w = this._wrap.clientWidth, h = this._wrap.clientHeight, v = new THREE.Vector3(), wallH = this._config.wall_h ?? 1.1;
    this._points.forEach((p, i) => {
      const el = this._labelEls[i], lvl = this._config.levels[p.level];
      if (!lvl || !this._visible.has(p.level)) { el.style.display = 'none'; return; }
      v.set(p.x, (lvl.z || 0) + wallH + 0.25, p.y).project(this._camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { el.style.display = 'none'; return; }
      el.style.display = ''; el.style.left = ((v.x + 1) / 2 * w) + 'px'; el.style.top = ((1 - v.y) / 2 * h) + 'px';
    });
  }

  _loop() {
    if (this._raf) return;
    const tick = () => { this._raf = requestAnimationFrame(tick); if (!this._dirty) return; this._dirty = false; this._renderer.render(this._scene, this._camera); this._placeLabels(); };
    tick();
  }
}

customElements.define('otthon-3d-card', Otthon3DCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'otthon-3d-card', name: 'Otthon 3D', description: 'Forgatható, nagyítható 3D alaprajz élő entitás-címkékkel.' });
console.info(`%c otthon-3d-card ${VERSION} `, 'background:#03a9f4;color:#fff;border-radius:4px');
