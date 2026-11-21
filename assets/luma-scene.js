/* RFID -> Proto Luma proof of concept, interactive 3D scene.
   Needs three.js r128 (global THREE). Usage:
     const api = LumaScene.mount({ canvas, video?, autoDemo: true });
     api.scan();      // trigger a badge read now (used for video sync)
     api.replay();    // restart the walk-up demo
     api.resetView(); api.zoom(+1 / -1);
*/
(function () {
  const INFO = {
    badge: { n: 1, name: 'Badge', title: 'UHF RFID badge',
      body: 'A passive EPC Gen 2 tag with no battery. The reader picks it up from a few feet away, so there is nothing to tap or scan.' },
    reader: { n: 2, name: 'FXR90 reader', title: 'Zebra FXR90 reader + antenna',
      body: 'Fixed UHF reader with one antenna enabled at 25–30 dBm. Every read (tag ID + signal strength) is published as a small JSON message over MQTT.' },
    zone: { n: null, name: 'Trigger zone', title: 'Trigger zone, about 5 ft',
      body: 'Reads weaker than −70 dBm are ignored, so only a deliberate walk-up triggers a greeting. If two badges are in range, the stronger (closer) one wins.' },
    laptop: { n: 3, name: 'Middleware', title: 'Python middleware',
      body: 'Runs the Mosquitto broker and four modules: the RFID listener, the closest-person logic, the display controller and a health monitor. Validated at 100% over 25 trials.' },
    luma: { n: 4, name: 'Proto Luma', title: 'Proto Luma holographic display',
      body: 'A life-size holographic display (88 × 50 × 24 in, 86-inch screen). The test ran on a laptop screen; the software was built so the same middleware can drive a Luma over HDMI, with greetings filmed as a subject on a black background.' }
  };

  const css = `
  .lz-wrap{position:relative}
  .lz-label{position:absolute;z-index:2;transform:translate(-50%,-100%);font:600 12px/1 Inter,system-ui,sans-serif;background:#fff;color:#111;border:1px solid #d9d9d6;border-radius:999px;padding:6px 10px 6px 6px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(0,0,0,.08);transition:background .15s,color .15s}
  .lz-label i{font-style:normal;width:18px;height:18px;border-radius:50%;background:#111;color:#fff;display:grid;place-items:center;font-size:11px}
  .lz-label.plain{padding:6px 10px}
  .lz-label:hover,.lz-label.on{background:#111;color:#fff;border-color:#111}
  .lz-label:hover i,.lz-label.on i{background:#fff;color:#111}
  .lz-card{position:absolute;z-index:5;left:12px;bottom:12px;max-width:340px;background:rgba(255,255,255,.97);border:1px solid #e2e2df;border-radius:10px;padding:14px 16px;font:14px/1.5 Inter,system-ui,sans-serif;color:#444;box-shadow:0 6px 24px rgba(0,0,0,.08);display:none}
  .lz-card b{display:block;color:#111;font-size:15px;margin-bottom:4px}
  .lz-card button{position:absolute;top:6px;right:8px;border:0;background:none;font-size:18px;color:#888;cursor:pointer}
  .lz-hint{position:absolute;right:12px;top:10px;font:12px Inter,system-ui,sans-serif;color:#666;background:rgba(255,255,255,.85);padding:5px 9px;border-radius:6px;pointer-events:none}
  .lz-status{position:absolute;left:12px;top:10px;font:600 12px Inter,system-ui,sans-serif;color:#111;background:rgba(255,255,255,.9);padding:6px 10px;border-radius:6px;pointer-events:none;display:flex;align-items:center;gap:8px}
  .lz-status s{width:8px;height:8px;border-radius:50%;background:#9aa0a6;text-decoration:none}
  .lz-status.on s{background:#22c55e}
  @media (max-width:640px){.lz-label{font-size:11px;padding:4px 8px 4px 4px}.lz-label i{width:16px;height:16px}.lz-hint{display:none}.lz-card{right:12px;max-width:none}}`;
  function injectCSS() {
    if (document.getElementById('lz-css')) return;
    const s = document.createElement('style'); s.id = 'lz-css'; s.textContent = css; document.head.appendChild(s);
  }

  function mount(opts) {
    const THREE = window.THREE;
    if (!THREE || !opts.canvas) return null;
    injectCSS();
    const canvas = opts.canvas, wrap = canvas.parentElement;
    wrap.classList.add('lz-wrap');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f4f2);
    scene.fog = new THREE.Fog(0xf4f4f2, 13, 24);
    const camera = new THREE.PerspectiveCamera(36, 2, 0.1, 60);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcac8c2, 0.78));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const L = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
    function mk(geo, mat, parent, p, r, s) {
      const m = new THREE.Mesh(geo, mat);
      if (p) m.position.set(p[0], p[1], p[2]);
      if (r) m.rotation.set(r[0], r[1], r[2]);
      if (s) m.scale.set(s[0], s[1], s[2]);
      m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    }
    const tag = (obj, key) => { obj.traverse(o => { o.userData.key = key; }); return obj; };
    const pickables = [];

    // ---------- Floor ----------
    const floor = mk(new THREE.PlaneGeometry(40, 40), L(0xeceae5), scene, [0, 0, 0], [-Math.PI / 2, 0, 0]);
    floor.castShadow = false;
    const grid = new THREE.GridHelper(40, 80, 0xdddbd5, 0xe3e1db); grid.position.y = 0.002; scene.add(grid);

    // ---------- Cabinet, reader, antenna, laptop (front faces +x) ----------
    const station = new THREE.Group(); scene.add(station);
    const cabMat = L(0x9ea4aa);
    mk(new THREE.BoxGeometry(0.5, 1.0, 0.9), cabMat, station, [0, 0.5, 0]);
    for (let i = 0; i < 3; i++) {
      mk(new THREE.BoxGeometry(0.012, 0.28, 0.84), L(0xa9afb5), station, [0.256, 0.18 + i * 0.31, 0]);
      mk(new THREE.BoxGeometry(0.03, 0.02, 0.22), L(0x5b6066), station, [0.275, 0.27 + i * 0.31, 0]);
    }
    const readerG = new THREE.Group(); station.add(readerG);
    mk(new THREE.BoxGeometry(0.2, 0.06, 0.26), L(0x2b2d31), readerG, [-0.02, 1.03, -0.28]);
    mk(new THREE.SphereGeometry(0.008, 8, 8), new THREE.MeshBasicMaterial({ color: 0x22c55e }), readerG, [0.081, 1.04, -0.2]);
    mk(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), L(0x555a60), readerG, [0.16, 1.13, 0.0]);
    const antenna = mk(new THREE.BoxGeometry(0.035, 0.27, 0.27), L(0x2f6fde), readerG, [0.19, 1.32, 0.0], [0, 0, -0.18]);
    tag(readerG, 'reader'); pickables.push(readerG);
    station.children.slice(0, 7).forEach(o => { tag(o, 'reader'); pickables.push(o); });

    // Laptop running the middleware
    const lap = new THREE.Group(); lap.position.set(-0.02, 1.0, 0.27); station.add(lap);
    mk(new THREE.BoxGeometry(0.24, 0.016, 0.33), L(0xd7d9dc), lap, [0, 0.008, 0]);
    const lidG = new THREE.Group(); lidG.position.set(-0.12, 0.016, 0); lidG.rotation.z = -0.32; lap.add(lidG);
    mk(new THREE.BoxGeometry(0.012, 0.22, 0.33), L(0xd7d9dc), lidG, [0, 0.11, 0]);
    const lapTexC = document.createElement('canvas'); lapTexC.width = 256; lapTexC.height = 170;
    const lapCtx = lapTexC.getContext('2d'); const lapTex = new THREE.CanvasTexture(lapTexC);
    const lapScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), new THREE.MeshBasicMaterial({ map: lapTex }));
    lapScreen.position.set(0.0075, 0.112, 0); lapScreen.rotation.y = Math.PI / 2; lidG.add(lapScreen);
    tag(lap, 'laptop'); pickables.push(lap);
    const logLines = ['lobby.main running', 'mqtt: connected (tevents)', 'waiting for badge…'];
    function drawLaptop() {
      lapCtx.fillStyle = '#0e1116'; lapCtx.fillRect(0, 0, 256, 170);
      lapCtx.font = '12px monospace'; lapCtx.fillStyle = '#7ee2a8';
      logLines.slice(-8).forEach((l, i) => lapCtx.fillText(l, 10, 22 + i * 18));
      lapTex.needsUpdate = true;
    }
    drawLaptop();

    // ---------- Trigger zone ----------
    const R = 1.52; // ~5 ft
    const zoneC = new THREE.Vector3(0.25, 0, 0);
    const zone = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x9ec5ff, transparent: true, opacity: 0.1, depthWrite: false }));
    zone.position.copy(zoneC); scene.add(zone); tag(zone, 'zone'); pickables.push(zone);
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.025, R, 96), new THREE.MeshBasicMaterial({ color: 0x2f6fde, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(zoneC.x, 0.006, 0); scene.add(ring); tag(ring, 'zone'); pickables.push(ring);

    // ---------- Person builder (stylized, roughly human proportions, 1.78 m) ----------
    function curlPositions() {
      const pts = []; let k = 0;
      for (let row = 0; row < 4; row++) {
        const phi = 0.15 + row * 0.33, n = [5, 9, 11, 12][row];
        for (let i = 0; i < n; i++) {
          const th = (i / n) * Math.PI * 2 + row * 0.4;
          if (row === 3 && Math.cos(th) > 0.55) continue; // keep the face clear
          pts.push([Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th), k++]);
        }
      }
      return pts;
    }
    const CURLS = curlPositions();
    function buildPerson(m) {
      const g = new THREE.Group();
      const parts = {};
      // legs
      ['L', 'R'].forEach((side, i) => {
        const x = i === 0 ? -0.1 : 0.1;
        const hip = new THREE.Group(); hip.position.set(x, 0.92, 0); g.add(hip);
        mk(new THREE.CylinderGeometry(0.078, 0.066, 0.46, 14), m.pants, hip, [0, -0.22, 0]);
        const knee = new THREE.Group(); knee.position.set(0, -0.44, 0); hip.add(knee);
        mk(new THREE.CylinderGeometry(0.064, 0.052, 0.44, 14), m.pants, knee, [0, -0.21, 0]);
        mk(new THREE.BoxGeometry(0.105, 0.07, 0.27), m.shoe, knee, [0, -0.445, 0.045]);
        mk(new THREE.BoxGeometry(0.108, 0.018, 0.275), m.sole, knee, [0, -0.47, 0.045]);
        parts['hip' + side] = hip; parts['knee' + side] = knee;
      });
      // pelvis, belt, torso
      mk(new THREE.CylinderGeometry(0.175, 0.17, 0.2, 18), m.pants, g, [0, 0.98, 0], null, [1, 1, 0.66]);
      mk(new THREE.CylinderGeometry(0.178, 0.178, 0.04, 18), m.belt, g, [0, 1.08, 0], null, [1, 1, 0.68]);
      mk(new THREE.CylinderGeometry(0.205, 0.175, 0.44, 18), m.shirt, g, [0, 1.3, 0], null, [1, 1, 0.62]);
      mk(new THREE.SphereGeometry(0.205, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.shirt, g, [0, 1.515, 0], null, [1, 0.42, 0.62]);
      // neck, head, ears, nose, hair
      mk(new THREE.CylinderGeometry(0.048, 0.052, 0.09, 12), m.skin, g, [0, 1.6, 0.005]);
      const head = mk(new THREE.SphereGeometry(0.112, 22, 18), m.skin, g, [0, 1.72, 0.01], null, [0.9, 1.1, 1]);
      mk(new THREE.SphereGeometry(0.026, 10, 8), m.skin, g, [-0.1, 1.72, 0.0], null, [0.6, 1, 1]);
      mk(new THREE.SphereGeometry(0.026, 10, 8), m.skin, g, [0.1, 1.72, 0.0], null, [0.6, 1, 1]);
      mk(new THREE.ConeGeometry(0.018, 0.04, 8), m.skin, g, [0, 1.705, 0.125], [Math.PI / 2, 0, 0]);
      mk(new THREE.SphereGeometry(0.116, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2.1), m.hair, g, [0, 1.74, 0.0], null, [0.93, 1.05, 1.02]);
      CURLS.forEach(([x, y, z, k]) => {
        const r = 0.036 + (k % 3) * 0.006;
        mk(new THREE.SphereGeometry(r, 8, 6), m.hair, g, [x * 0.112, 1.745 + y * 0.12, z * 0.115 - 0.005]);
      });
      parts.head = head;
      // arms
      ['L', 'R'].forEach((side, i) => {
        const x = i === 0 ? -0.235 : 0.235;
        const sh = new THREE.Group(); sh.position.set(x, 1.47, 0); g.add(sh);
        mk(new THREE.SphereGeometry(0.068, 12, 10), m.shirt, sh, [0, 0, 0]);
        mk(new THREE.CylinderGeometry(0.064, 0.058, 0.17, 12), m.shirt, sh, [0, -0.08, 0]);
        mk(new THREE.CylinderGeometry(0.046, 0.042, 0.15, 12), m.skin, sh, [0, -0.22, 0]);
        const el = new THREE.Group(); el.position.set(0, -0.29, 0); sh.add(el);
        mk(new THREE.CylinderGeometry(0.041, 0.034, 0.26, 12), m.skin, el, [0, -0.13, 0]);
        mk(new THREE.SphereGeometry(0.045, 12, 10), m.skin, el, [0, -0.29, 0.005], null, [0.75, 1.15, 0.55]);
        parts['sh' + side] = sh; parts['el' + side] = el;
      });
      return { g, parts };
    }

    // The visitor (white shirt, black pants, white shoes: as in the test video)
    const human = buildPerson({
      skin: L(0xd3a98c), shirt: L(0xfbfbfb), pants: L(0x1c1e23), belt: L(0x3b2a20),
      shoe: L(0xf2f2f0), sole: L(0xcfcfcb), hair: L(0x2a1c15)
    });
    const person = human.g; scene.add(person);
    const badge = mk(new THREE.BoxGeometry(0.056, 0.086, 0.006), L(0xffffff), human.parts.elR, [0, -0.33, 0.04]);
    mk(new THREE.BoxGeometry(0.057, 0.02, 0.007), L(0x2f6fde), badge, [0, 0.03, 0]);
    tag(person, 'badge'); pickables.push(person);

    // ---------- Proto Luma: 88 x 50 x 24 in = 2.23 x 1.27 x 0.60 m ----------
    const luma = new THREE.Group(); luma.position.set(-1.3, 0, -1.55); luma.rotation.y = 0.35; scene.add(luma);
    const W = 1.27, H = 2.23, D = 0.6;
    const shell = L(0x1b1c1f);
    mk(new THREE.BoxGeometry(W, 0.13, D), shell, luma, [0, 0.065, 0]);
    mk(new THREE.BoxGeometry(W, 0.12, D), shell, luma, [0, H - 0.06, 0]);
    mk(new THREE.BoxGeometry(0.07, H - 0.25, D), shell, luma, [-W / 2 + 0.035, H / 2, 0]);
    mk(new THREE.BoxGeometry(0.07, H - 0.25, D), shell, luma, [W / 2 - 0.035, H / 2, 0]);
    mk(new THREE.BoxGeometry(W - 0.14, H - 0.25, 0.03), new THREE.MeshBasicMaterial({ color: 0x050506 }), luma, [0, H / 2, -D / 2 + 0.015]);
    mk(new THREE.BoxGeometry(W - 0.14, 0.01, D - 0.04), new THREE.MeshBasicMaterial({ color: 0x0b0b0d }), luma, [0, 0.135, 0]);
    const strip = mk(new THREE.BoxGeometry(W - 0.2, 0.015, 0.03), new THREE.MeshBasicMaterial({ color: 0xffffff }), luma, [0, H - 0.13, D / 2 - 0.08]);
    const glass = mk(new THREE.PlaneGeometry(W - 0.14, H - 0.25),
      new THREE.MeshBasicMaterial({ color: 0xa8b8c8, transparent: true, opacity: 0.07, depthWrite: false }), luma, [0, H / 2, D / 2 - 0.005]);
    glass.castShadow = false;
    // hologram presenter inside
    const holoMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const holo = buildPerson({ skin: holoMat, shirt: holoMat, pants: holoMat, belt: holoMat, shoe: holoMat, sole: holoMat, hair: holoMat });
    holo.g.scale.setScalar(0.92); holo.g.position.set(0, 0.14, -0.06); luma.add(holo.g);
    holo.g.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    holo.parts.shR.rotation.z = 0.2; holo.parts.shL.rotation.z = -0.2;
    // caption + idle glow
    const capC = document.createElement('canvas'); capC.width = 512; capC.height = 128;
    const capCtx = capC.getContext('2d'); const capTex = new THREE.CanvasTexture(capC);
    capCtx.textAlign = 'center'; capCtx.fillStyle = '#ffffff'; capCtx.font = '600 52px Inter, system-ui, sans-serif';
    capCtx.fillText('Welcome back', 256, 64); capCtx.fillStyle = '#9fdcff'; capCtx.font = '26px Inter, system-ui, sans-serif';
    capCtx.fillText('personalized greeting', 256, 104); capTex.needsUpdate = true;
    const capMat = new THREE.MeshBasicMaterial({ map: capTex, transparent: true, opacity: 0, depthWrite: false });
    const caption = mk(new THREE.PlaneGeometry(0.95, 0.24), capMat, luma, [0, 0.42, 0.2]); caption.castShadow = false;
    const idleMat = new THREE.MeshBasicMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const idleRing = mk(new THREE.TorusGeometry(0.22, 0.008, 8, 64), idleMat, luma, [0, 1.25, 0]); idleRing.castShadow = false;
    const idleRing2 = mk(new THREE.TorusGeometry(0.14, 0.006, 8, 64), idleMat, luma, [0, 1.25, 0]); idleRing2.castShadow = false;
    tag(luma, 'luma'); pickables.push(luma);

    // ---------- HDMI cable laptop -> Luma, and data pulses ----------
    luma.updateMatrixWorld(true); station.updateMatrixWorld(true);
    const lumaIn = luma.localToWorld(new THREE.Vector3(0.45, 0.03, -0.1));
    const cable = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.12, 1.01, 0.3), new THREE.Vector3(-0.27, 0.95, 0.3), new THREE.Vector3(-0.27, 0.05, 0.3),
      new THREE.Vector3(-0.32, 0.012, 0.0), new THREE.Vector3(-0.75, 0.012, -0.6), lumaIn]);
    mk(new THREE.TubeGeometry(cable, 80, 0.009, 6, false), L(0x2a2b2e), scene).castShadow = false;
    const pulseMat = () => new THREE.MeshBasicMaterial({ color: 0x2f6fde, transparent: true });
    const pulses = [];
    function spawn(kind, delay) {
      setTimeout(() => {
        const geo = kind === 'radio' ? new THREE.TorusGeometry(0.05, 0.012, 8, 28) : new THREE.SphereGeometry(0.03, 12, 10);
        const m = new THREE.Mesh(geo, pulseMat()); scene.add(m); pulses.push({ m, kind, t: 0 });
      }, delay);
    }

    // ---------- Labels and info card ----------
    const labels = {};
    const card = document.createElement('div'); card.className = 'lz-card';
    card.innerHTML = '<button aria-label="Close">×</button><b></b><span></span>';
    wrap.appendChild(card);
    const status = document.createElement('div'); status.className = 'lz-status'; status.innerHTML = '<s></s><span>Idle: waiting for a badge</span>';
    wrap.appendChild(status);
    const hint = document.createElement('div'); hint.className = 'lz-hint'; hint.textContent = 'Drag to rotate · click any part';
    wrap.appendChild(hint);
    let selected = null;
    function select(key) {
      selected = key;
      Object.entries(labels).forEach(([k, el]) => el.classList.toggle('on', k === key));
      if (!key) { card.style.display = 'none'; return; }
      card.querySelector('b').textContent = INFO[key].title;
      card.querySelector('span').textContent = INFO[key].body;
      card.style.display = 'block';
    }
    card.querySelector('button').onclick = () => select(null);
    Object.keys(INFO).forEach(k => {
      const b = document.createElement('button'); b.type = 'button';
      b.className = 'lz-label' + (INFO[k].n ? '' : ' plain');
      b.innerHTML = (INFO[k].n ? `<i>${INFO[k].n}</i>` : '') + INFO[k].name;
      b.onclick = e => { e.stopPropagation(); select(selected === k ? null : k); };
      wrap.appendChild(b); labels[k] = b;
    });
    const anchors = {
      badge: () => person.localToWorld(new THREE.Vector3(0, 2.15, 0)),
      reader: () => new THREE.Vector3(0.18, 1.62, -0.25),
      laptop: () => new THREE.Vector3(-0.1, 1.28, 0.5),
      luma: () => luma.localToWorld(new THREE.Vector3(0, H + 0.18, 0)),
      zone: () => new THREE.Vector3(zoneC.x + R * 0.55, 0.05, R * 0.83)
    };

    // ---------- Camera orbit, zoom, picking ----------
    const DEF = { yaw: -0.12, pitch: 0.22, dist: 6.3 };
    let yaw = DEF.yaw, pitch = DEF.pitch, dist = DEF.dist, down = null, moved = 0;
    const target = new THREE.Vector3(-0.1, 1.0, -0.45);
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; moved = 0; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y; moved += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 0.006; pitch = Math.min(1.25, Math.max(0.08, pitch + dy * 0.004)); down = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    });
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function pickAt(e) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(pickables, true).filter(h => h.object.userData.key);
      const solid = hits.find(h => h.object.userData.key !== 'zone');
      return (solid || hits[0] || {}).object;
    }
    canvas.addEventListener('pointerup', e => {
      canvas.style.cursor = 'grab';
      if (down && moved < 6) { const o = pickAt(e); select(o ? o.userData.key : null); }
      down = null;
    });
    canvas.addEventListener('mousemove', e => { if (!down) { const o = pickAt(e); canvas.style.cursor = o ? 'pointer' : 'grab'; } });
    canvas.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); dist = Math.min(13, Math.max(3.2, dist + e.deltaY * 0.01)); }, { passive: false });

    // ---------- State and timeline ----------
    const clock = () => performance.now() / 1000;
    const PATH_START = 4.8, PATH_STOP = 1.0, Z_PATH = 0.08;
    let cycleStart = clock(), greetStart = -99, armUntil = -99, lastScanAt = -99, scanned = false;
    const video = opts.video || null;
    function doScan() {
      const now = clock(); lastScanAt = now; armUntil = now + 1.4;
      for (let i = 0; i < 3; i++) spawn('radio', 150 + i * 110);
      spawn('wire', 620);
      greetStart = now + 1.25;
      logLines.push('read: RSSI above -70 dBm', '-> closest badge: greeting');
      drawLaptop();
    }
    const syncing = () => video && !video.paused && !video.ended;

    function ease(x) { return x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 2); }
    let walkPhase = 0, lastX = PATH_START, visible = true, raf = 0;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); }).observe(canvas);
    }

    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight, pr = renderer.getPixelRatio();
      if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      }
    }

    const tmp = new THREE.Vector3();
    function frame() {
      raf = 0;
      if (!visible) return;
      resize();
      const now = clock();
      let x, facing = -Math.PI / 2, walking = false, arm = 0;

      if (syncing()) {
        x = PATH_STOP;
        cycleStart = now - 5; scanned = true; // demo resumes from "standing at the reader"
      } else if (opts.autoDemo !== false) {
        const t = now - cycleStart, T = 15;
        if (t > T) { cycleStart = now; scanned = false; }
        if (t < 3.6) { x = PATH_START + (PATH_STOP - PATH_START) * ease(t / 3.6); walking = t < 3.4; }
        else if (t < 13.2) { x = PATH_STOP; }
        else { x = PATH_STOP + (PATH_START - PATH_STOP) * ease((t - 13.2) / 1.8); facing = Math.PI / 2; walking = true; }
        if (t >= 3.9 && !scanned) { scanned = true; doScan(); }
      } else { x = PATH_STOP; }

      // walking cycle
      walkPhase += Math.abs(x - lastX) * 7.5; lastX = x;
      const sw = walking ? Math.sin(walkPhase) : 0;
      person.position.set(x, 0, Z_PATH); person.rotation.y = facing;
      const P = human.parts;
      P.hipL.rotation.x = sw * 0.45; P.hipR.rotation.x = -sw * 0.45;
      P.kneeL.rotation.x = Math.max(0, -sw) * 0.6; P.kneeR.rotation.x = Math.max(0, sw) * 0.6;
      P.shL.rotation.x = -sw * 0.35;
      arm = now < armUntil ? 1 : 0;
      const targetR = arm ? -1.15 : sw * 0.35;
      P.shR.rotation.x += (targetR - P.shR.rotation.x) * 0.16;
      P.elR.rotation.x += ((arm ? -0.35 : -0.12) - P.elR.rotation.x) * 0.16;
      P.elL.rotation.x = -0.12;
      person.position.y = walking ? Math.abs(Math.sin(walkPhase)) * 0.015 : 0;

      // greeting on the Luma (8 s)
      const gt = now - greetStart;
      const g = gt < 0 || gt > 8 ? 0 : Math.min(1, gt / 0.5, (8 - gt) / 0.5);
      holoMat.opacity = 0.5 * g * (0.92 + 0.08 * Math.sin(now * 23));
      capMat.opacity = g;
      idleMat.opacity = 0.4 * (1 - g);
      idleRing.rotation.y = now * 0.8; idleRing2.rotation.x = now * 1.1;
      holo.g.position.y = 0.14 + Math.sin(now * 1.6) * 0.008;
      holo.parts.shR.rotation.x = -0.25 + Math.sin(now * 2.2) * 0.12 * g;
      zone.material.opacity = 0.1 + 0.06 * g;
      status.classList.toggle('on', g > 0);
      status.querySelector('span').textContent = g > 0 ? 'Greeting playing on the Proto Luma' : (now - lastScanAt < 1.3 ? 'Badge read…' : 'Idle: waiting for a badge');

      // pulses
      const from = new THREE.Vector3(); badge.getWorldPosition(from);
      const to = new THREE.Vector3(); antenna.getWorldPosition(to);
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]; p.t += p.kind === 'radio' ? 0.04 : 0.016;
        if (p.kind === 'radio') { p.m.position.copy(from).lerp(to, p.t); p.m.lookAt(to); p.m.scale.setScalar(1 + p.t * 2.2); }
        else { p.m.position.copy(cable.getPointAt(Math.min(1, p.t))); }
        p.m.material.opacity = p.kind === 'radio' ? 1 - p.t : 1;
        if (p.t >= 1) { scene.remove(p.m); pulses.splice(i, 1); }
      }

      // camera
      camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist,
        target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(target);
      renderer.render(scene, camera);

      // labels
      const w = canvas.clientWidth, h = canvas.clientHeight;
      Object.entries(anchors).forEach(([k, fn]) => {
        tmp.copy(fn()).project(camera);
        const el = labels[k];
        if (tmp.z > 1) { el.style.display = 'none'; return; }
        el.style.display = 'flex';
        const hw = el.offsetWidth / 2 + 8, eh = el.offsetHeight;
        el.style.left = Math.min(w - hw, Math.max(hw, (tmp.x + 1) / 2 * w)) + 'px';
        el.style.top = Math.min(h - 8, Math.max(eh + 44, (1 - tmp.y) / 2 * h)) + 'px';
      });

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      scan() { doScan(); },
      replay() { cycleStart = clock(); scanned = false; lastScanAt = -99; greetStart = -99; select(null); },
      resetView() { yaw = DEF.yaw; pitch = DEF.pitch; dist = DEF.dist; },
      zoom(d) { dist = Math.min(13, Math.max(3.2, dist - d * 0.9)); },
      select
    };
  }

  window.LumaScene = { mount };
})();
