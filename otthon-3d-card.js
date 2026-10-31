/* otthon-3d-card v0.3.0 — forgatható 3D alaprajz-kártya Home Assistanthoz (three.js).
   Konfig (lásd README): levels[] (name, z, walls/floor/glass/furniture gyűrűk "x,y;x,y;…" méterben, deck),
   points[] (entity, level, x, y, name), wall_h, slab_h, furniture_h, height (CSS), default_level (index vagy 'all'), url_path.
   Szerkesztő mód (admin): címkék húzása, új eszköz a padlóra koppintva, átnevezés/törlés, mentés a dashboard konfigjába (lovelace/config/save).
   A ház geometriája a dashboard konfigjában marad, ez a fájl generikus. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const VERSION = '0.3.0';
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
    this._config = config; this._points = (config.points || []).map(p => ({ ...p }));
    if (this._built) this._rebuild();
  }
  set hass(hass) { const first = !this._hass; this._hass = hass; this._updateLabelText(); if (first && this._editBtn) this._editBtn.style.display = hass.user?.is_admin ? '' : 'none'; }
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
      .lbl{position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;background:rgba(28,30,36,.84);color:#fff;font:600 12px/1.3 Roboto,sans-serif;padding:3px 9px;border-radius:12px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);user-select:none;-webkit-user-select:none}
      .lbl.unavail{opacity:.55}
      .lbl .x{display:none;margin-left:7px;opacity:.85}
      .labels.edit .lbl{cursor:move;touch-action:none;outline:1.5px dashed rgba(255,255,255,.75);outline-offset:1px}
      .labels.edit .lbl .x{display:inline}
      .bar{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:6px;flex-wrap:wrap;pointer-events:none}
      .bar button{pointer-events:auto;font:500 12px Roboto,sans-serif;padding:5px 10px;border-radius:14px;border:0;background:rgba(255,255,255,.92);color:#222;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.3)}
      .bar button.on{background:var(--primary-color,#03a9f4);color:#fff}
      .bar button.save{background:#2e7d32;color:#fff}
      .bar .sp{flex:1}
      .toast{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(28,30,36,.92);color:#fff;padding:6px 12px;border-radius:10px;font:12px Roboto,sans-serif;display:none;white-space:nowrap;max-width:92%;overflow:hidden;text-overflow:ellipsis}
      .ver{position:absolute;right:8px;bottom:6px;font:10px Roboto,sans-serif;color:rgba(0,0,0,.35)}
      .form{position:absolute;left:50%;top:52px;transform:translateX(-50%);background:var(--card-background-color,#fff);color:var(--primary-text-color,#222);border-radius:12px;padding:10px 12px;box-shadow:0 2px 10px rgba(0,0,0,.35);display:none;flex-direction:column;gap:6px;width:min(320px,90%);font:13px Roboto,sans-serif;z-index:3}
      .form.open{display:flex}
      .form input{font:13px Roboto,sans-serif;padding:6px 8px;border:1px solid #bbb;border-radius:8px;width:100%;box-sizing:border-box;background:#fff;color:#222}
      .form .row{display:flex;gap:6px;justify-content:flex-end}
      .form button{font:500 12px Roboto,sans-serif;padding:5px 10px;border-radius:14px;border:0;background:var(--primary-color,#03a9f4);color:#fff;cursor:pointer}
      .form button.sec{background:#ddd;color:#222}
      .form button.del{background:#c62828;margin-right:auto}
    </style>
    <div class="wrap"><canvas></canvas><div class="labels"></div><div class="bar"></div>
      <div class="form"><div class="ttl"></div><input class="ent" list="ents" placeholder="entitás, pl. sensor.nappali_homerseklet" autocomplete="off"><datalist id="ents"></datalist>
        <input class="nm" placeholder="címke neve (üresen: az entitás neve)"><div class="row"><button class="del">Törlés</button><button class="sec">Mégse</button><button class="ok">OK</button></div></div>
      <div class="toast"></div><div class="ver">otthon-3d ${VERSION}</div></div>`;
    this._wrap = root.querySelector('.wrap'); this._canvas = root.querySelector('canvas');
    this._labels = root.querySelector('.labels'); this._bar = root.querySelector('.bar'); this._toast = root.querySelector('.toast');
    this._form = root.querySelector('.form');

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
    this._bindPointer(); this._bindForm();
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
    this._buildBar(); this._makeLabels();
    const dl = cfg.default_level;
    this._show(dl === 'all' || dl == null ? new Set(cfg.levels.map((_, i) => i)) : new Set([clamp(+dl, 0, cfg.levels.length - 1)]), true);
    this._updateLabelText();
  }

  _buildBar() {
    this._bar.innerHTML = '';
    const btn = (txt, on, cls) => { const b = document.createElement('button'); b.textContent = txt; if (cls) b.className = cls; b.addEventListener('click', on); this._bar.appendChild(b); return b; };
    this._lvlBtns = this._config.levels.map((lvl, i) => btn(lvl.name || `Szint ${i + 1}`, () => this._show(new Set([i]))));
    this._allBtn = btn('Mind', () => this._show(new Set(this._config.levels.map((_, i) => i))));
    const sp = document.createElement('div'); sp.className = 'sp'; this._bar.appendChild(sp);
    this._editBtn = btn('✎ Szerkesztés', () => this._setEditing(!this._editing));
    this._editBtn.style.display = this._hass?.user?.is_admin ? '' : 'none';
    this._saveBtn = btn('💾 Mentés', () => this._save(), 'save'); this._saveBtn.style.display = 'none';
    this._cancelBtn = btn('Mégse', () => this._cancelEdit()); this._cancelBtn.style.display = 'none';
    btn('⟲ Nézet', () => this._fit(true));
  }

  _show(set, fitAll = false) {
    this._visible = set;
    this._groups.forEach((g, i) => { g.visible = set.has(i); });
    this._lvlBtns.forEach((b, i) => b.classList.toggle('on', set.size === 1 && set.has(i)));
    this._allBtn.classList.toggle('on', set.size > 1);
    this._fit(fitAll || (set.size > 1) !== this._wasMulti); this._wasMulti = set.size > 1; this._dirty = true;
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

  // ---------- kamera-vezérlés ----------
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
    const up = e => { const p = this._ptrs.get(e.pointerId); this._ptrs.delete(e.pointerId); if (p && !p.moved && this._editing && e.type === 'pointerup') this._newPoint(e); };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { o.r = clamp(o.r * (1 + Math.sign(e.deltaY) * 0.1), 2, 150); this._updateCamera(); e.preventDefault(); }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  _planePoint(e, y) {                                        // a mutató sugara metszve a vízszintes síkkal (magasság y)
    const rect = this._canvas.getBoundingClientRect();
    this._ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this._camera);
    return this._ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
  }

  _floorPoint(e) {                                           // koppintás helye: födém-találat, különben a legfelső látható szint padlósíkja
    const rect = this._canvas.getBoundingClientRect();
    this._ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this._camera);
    const floors = this._groups.filter(g => g.visible && g.userData.floor).map(g => g.userData.floor);
    const hit = this._ray.intersectObjects(floors, false)[0];
    if (hit) return { level: hit.object.userData.level, x: hit.point.x, y: hit.point.z };
    const level = Math.max(...this._visible), pt = this._planePoint(e, this._config.levels[level].z || 0);
    return pt ? { level, x: pt.x, y: pt.z } : null;
  }

  // ---------- címkék ----------
  _makeLabels() {
    this._labels.innerHTML = '';
    this._labelEls = this._points.map(p => {
      const el = document.createElement('div'); el.className = 'lbl';
      el.innerHTML = '<span class="t"></span><span class="x" title="Törlés">✕</span>';
      el.querySelector('.x').addEventListener('pointerdown', ev => { ev.stopPropagation(); ev.preventDefault(); if (this._editing) this._removePoint(p); });
      let drag = null;
      el.addEventListener('pointerdown', ev => { if (!this._editing) return; ev.stopPropagation(); ev.preventDefault(); el.setPointerCapture(ev.pointerId); drag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, moved: false }; });
      el.addEventListener('pointermove', ev => {
        if (!drag || ev.pointerId !== drag.id) return;
        if (Math.abs(ev.clientX - drag.x0) + Math.abs(ev.clientY - drag.y0) > 3) drag.moved = true;
        if (!drag.moved) return;
        const lvl = this._config.levels[p.level], pt = this._planePoint(ev, (lvl.z || 0) + (this._config.wall_h ?? 1.1) + 0.25);
        if (pt) { p.x = +pt.x.toFixed(2); p.y = +pt.z.toFixed(2); this._dirty = true; }
      });
      const end = ev => { if (!drag || ev.pointerId !== drag.id) return; const moved = drag.moved; drag = null; if (!moved) this._openForm(p, false); };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('click', ev => { ev.stopPropagation(); if (!this._editing) this._moreInfo(p.entity); });
      this._labels.appendChild(el); return el;
    });
    this._updateLabelText();
  }

  _updateLabelText() {
    if (!this._hass || !this._labelEls) return;
    this._points.forEach((p, i) => {
      const st = this._hass.states[p.entity], el = this._labelEls[i]; if (!el) return;
      const name = p.name || st?.attributes?.friendly_name || p.entity;
      let val = '?';
      if (st) { try { val = this._hass.formatEntityState ? this._hass.formatEntityState(st) : st.state + (st.attributes.unit_of_measurement ? ' ' + st.attributes.unit_of_measurement : ''); } catch { val = st.state; } }
      el.querySelector('.t').textContent = `${name} · ${val}`; el.classList.toggle('unavail', !st || st.state === 'unavailable');
    });
    this._dirty = true;
  }

  _placeLabels() {
    const w = this._wrap.clientWidth, h = this._wrap.clientHeight, v = new THREE.Vector3(), wallH = this._config.wall_h ?? 1.1;
    this._points.forEach((p, i) => {
      const el = this._labelEls[i], lvl = this._config.levels[p.level];
      if (!el) return;
      if (!lvl || !this._visible.has(p.level)) { el.style.display = 'none'; return; }
      v.set(p.x, (lvl.z || 0) + wallH + 0.25, p.y).project(this._camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { el.style.display = 'none'; return; }
      el.style.display = ''; el.style.left = ((v.x + 1) / 2 * w) + 'px'; el.style.top = ((1 - v.y) / 2 * h) + 'px';
    });
  }

  _moreInfo(entityId) { this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } })); }
  _say(txt, ms = 6000) { this._toast.textContent = txt; this._toast.style.display = txt ? 'block' : 'none'; clearTimeout(this._tt); if (txt && ms) this._tt = setTimeout(() => { this._toast.style.display = 'none'; }, ms); }

  // ---------- szerkesztő mód ----------
  _setEditing(on) {
    this._editing = on;
    this._labels.classList.toggle('edit', on); this._editBtn.classList.toggle('on', on);
    this._saveBtn.style.display = this._cancelBtn.style.display = on ? '' : 'none';
    if (on) { this._snapshot = JSON.stringify(this._points); this._say('Húzd a címkéket · koppints a padlóra: új eszköz · koppints címkére: név, törlés', 0); }
    else { this._form.classList.remove('open'); this._say(''); }
  }
  _cancelEdit() { this._points = JSON.parse(this._snapshot || '[]'); this._makeLabels(); this._setEditing(false); }
  _removePoint(p) { this._points = this._points.filter(q => q !== p); this._makeLabels(); }
  _newPoint(e) { const fp = this._floorPoint(e); if (fp) this._openForm({ entity: '', name: '', level: fp.level, x: +fp.x.toFixed(2), y: +fp.y.toFixed(2) }, true); }

  _bindForm() {
    const f = this._form, ent = f.querySelector('.ent'), nm = f.querySelector('.nm');
    f.addEventListener('pointerdown', ev => ev.stopPropagation());
    f.querySelector('.sec').addEventListener('click', () => f.classList.remove('open'));
    f.querySelector('.del').addEventListener('click', () => { if (!this._formNew) this._removePoint(this._formPoint); f.classList.remove('open'); });
    f.querySelector('.ok').addEventListener('click', () => {
      const id = ent.value.trim(), p = this._formPoint;
      if (!this._hass?.states[id]) { this._say('Nincs ilyen entitás: ' + (id || '(üres)')); return; }
      p.entity = id; p.name = nm.value.trim();
      if (!p.name) delete p.name;
      if (this._formNew) this._points.push(p);
      this._makeLabels(); f.classList.remove('open');
    });
    ent.addEventListener('keydown', ev => { if (ev.key === 'Enter') f.querySelector('.ok').click(); });
    nm.addEventListener('keydown', ev => { if (ev.key === 'Enter') f.querySelector('.ok').click(); });
  }

  _openForm(p, isNew) {
    const f = this._form; this._formPoint = p; this._formNew = isNew;
    f.querySelector('.ttl').textContent = isNew ? `Új eszköz – ${this._config.levels[p.level].name}` : 'Címke szerkesztése';
    f.querySelector('.del').style.display = isNew ? 'none' : '';
    const dl = f.querySelector('datalist');
    if (this._hass && dl.childElementCount !== Object.keys(this._hass.states).length) dl.innerHTML = Object.keys(this._hass.states).sort().map(id => `<option value="${id}">`).join('');
    f.querySelector('.ent').value = p.entity || ''; f.querySelector('.nm').value = p.name || '';
    f.classList.add('open'); f.querySelector(isNew ? '.ent' : '.nm').focus();
  }

  async _save() {
    const hass = this._hass; if (!hass) return;
    const seg = location.pathname.split('/')[1], urlPath = this._config.url_path || (seg && seg !== 'lovelace' ? seg : null);
    try {
      const conf = await hass.callWS({ type: 'lovelace/config', url_path: urlPath, force: false });
      let found = false;
      const visit = n => { if (!n || typeof n !== 'object' || found) return; if (Array.isArray(n)) return n.forEach(visit);
        if (n.type === 'custom:otthon-3d-card') { n.points = this._points.map(p => ({ ...p })); found = true; return; }
        ['views', 'cards', 'sections', 'card'].forEach(k => n[k] && visit(n[k])); };
      visit(conf);
      if (!found) { this._say('Nem találom a kártyát a dashboard konfigjában'); return; }
      await hass.callWS({ type: 'lovelace/config/save', url_path: urlPath, config: conf });
      this._setEditing(false); this._say(`Mentve ✓ (${this._points.length} eszköz)`);
    } catch (e) { this._say('Mentés sikertelen: ' + (e.message || e.code || e)); }
  }

  _loop() {
    if (this._raf) return;
    const tick = () => { this._raf = requestAnimationFrame(tick); if (!this._dirty) return; this._dirty = false; this._renderer.render(this._scene, this._camera); this._placeLabels(); };
    tick();
  }
}

customElements.define('otthon-3d-card', Otthon3DCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'otthon-3d-card', name: 'Otthon 3D', description: 'Forgatható, nagyítható 3D alaprajz élő entitás-címkékkel és szerkesztő móddal.' });
console.info(`%c otthon-3d-card ${VERSION} `, 'background:#03a9f4;color:#fff;border-radius:4px');
