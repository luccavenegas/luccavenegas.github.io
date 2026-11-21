/* Interactive Arctos arm built from Arctos Robotics' official URDF (MIT License).
   Meshes were simplified for the web and packed into arctos-model/arctos-meshes.bin.
   Needs three.js r128 (global THREE). Usage: ArctosViewer.mount({ canvas, controls, base: 'assets/arctos-model/' }) */
(function () {
  // Kinematic chain from arctos.urdf (ROS frame, Z up, metres)
  const LINKS = {
    base_link: [0, 0, 0], Link_1_1: [0, -0.000529, -0.111], Link_2_1: [0.05713, 0.020356, -0.289378],
    Link_3_1: [-0.043, 0.019045, -0.550385], Link_4_1: [-1e-6, 0.15874, -0.57209], Link_5_1: [0.039011, 0.279927, -0.570316],
    Link_6_1: [-0.000193, 0.313762, -0.570316], Gripper_1: [-0.000193, 0.319847, -0.570316],
    Left_jaw_1: [-0.007934, 0.359845, -0.599867], Right_jaw_1: [-0.007934, 0.359845, -0.539867]
  };
  const JOINTS = [
    { id: 'j1', parent: 'base_link', child: 'Link_1_1', xyz: [0, 0.000529, 0.111], axis: [0, 0, 1], type: 'rev', label: 'J1 · Base (X)', min: -170, max: 170 },
    { id: 'j2', parent: 'Link_1_1', child: 'Link_2_1', xyz: [-0.05713, -0.020885, 0.178378], axis: [1, 0, 0], type: 'rev', label: 'J2 · Shoulder (Y)', min: -90, max: 90 },
    { id: 'j3', parent: 'Link_2_1', child: 'Link_3_1', xyz: [0.10013, 0.001311, 0.261007], axis: [-1, 0, 0], type: 'rev', label: 'J3 · Elbow (Z)', min: -120, max: 120 },
    { id: 'j4', parent: 'Link_3_1', child: 'Link_4_1', xyz: [-0.042999, -0.139695, 0.021705], axis: [0, 1, 0], type: 'rev', label: 'J4 · Wrist roll (A)', min: -180, max: 180 },
    { id: 'j5', parent: 'Link_4_1', child: 'Link_5_1', xyz: [-0.039012, -0.121187, -0.001774], axis: [-1, 0, 0], type: 'rev', label: 'J5 · Wrist pitch (B)', min: -110, max: 110 },
    { id: 'j6', parent: 'Link_5_1', child: 'Link_6_1', xyz: [0.039204, -0.033835, 0], axis: [0, 1, 0], type: 'rev', label: 'J6 · Wrist rotate (C)', min: -180, max: 180 },
    { id: 'grip', parent: 'Link_6_1', child: 'Gripper_1', xyz: [0, -0.006085, 0], type: 'fixed' },
    { id: 'jawL', parent: 'Gripper_1', child: 'Left_jaw_1', xyz: [0.007741, -0.039998, 0.029551], axis: [0, 0, -1], type: 'jaw' },
    { id: 'jawR', parent: 'Gripper_1', child: 'Right_jaw_1', xyz: [0.007741, -0.039998, -0.030449], axis: [0, 0, 1], type: 'jaw' }
  ];
  const POSES = {
    Home: { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0, g: 0 },
    Reach: { j1: 35, j2: 45, j3: 35, j4: 0, j5: 40, j6: 0, g: 100 },
    'Pick up': { j1: -40, j2: 60, j3: 55, j4: 0, j5: 60, j6: 90, g: 20 },
    Wave: { j1: 0, j2: -10, j3: -60, j4: 90, j5: -40, j6: 0, g: 60 }
  };
  const DEMO = ['Reach', 'Pick up', 'Home', 'Wave', 'Home'];

  const css = `
  .av-ui{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px 22px;margin-top:14px}
  .av-ui label{display:block;font:500 13px Inter,system-ui,sans-serif;color:#444}
  .av-ui label span{float:right;color:#111;font-variant-numeric:tabular-nums}
  .av-ui input[type=range]{width:100%;accent-color:#111}
  .av-bar{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center}
  .av-bar .btn.on{background:#111;color:#fff;border-color:#111}
  .av-load{position:absolute;inset:0;display:grid;place-items:center;font:14px Inter,system-ui,sans-serif;color:#666}`;

  function mount(opts) {
    const THREE = window.THREE;
    if (!THREE || !opts.canvas) return null;
    if (!document.getElementById('av-css')) { const st = document.createElement('style'); st.id = 'av-css'; st.textContent = css; document.head.appendChild(st); }
    const canvas = opts.canvas, base = opts.base || 'assets/arctos-model/';
    const loading = document.createElement('div'); loading.className = 'av-load'; loading.textContent = 'Loading model…';
    canvas.parentElement.style.position = 'relative'; canvas.parentElement.appendChild(loading);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf4f4f2);
    const camera = new THREE.PerspectiveCamera(32, 2, 0.01, 20);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xbdbbb5, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(0.8, 1.6, 1.0); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.1, far: 4 });
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-1, 0.6, -0.8); scene.add(fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 64), new THREE.MeshLambertMaterial({ color: 0xe9e8e3 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(2.4, 48, 0xd8d6cf, 0xe0ded8); grid.position.y = 0.001; scene.add(grid);

    // ROS (Z up) -> three.js (Y up)
    const robot = new THREE.Group(); robot.rotation.x = -Math.PI / 2; scene.add(robot);
    const matBody = new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.62, metalness: 0.08, flatShading: true });
    const matGrip = new THREE.MeshStandardMaterial({ color: 0x3d4046, roughness: 0.5, metalness: 0.15, flatShading: true });
    const matHi = new THREE.MeshStandardMaterial({ color: 0x2f6fde, roughness: 0.55, metalness: 0.1, flatShading: true });

    const frames = { base_link: robot }; // frame each link's mesh hangs from
    const pivots = {};
    const meshes = {};
    // Build joint frames in chain order
    JOINTS.forEach(j => {
      const parentFrame = frames[j.parent];
      const g = new THREE.Group(); g.position.set(j.xyz[0], j.xyz[1], j.xyz[2]); parentFrame.add(g);
      const pivot = new THREE.Group(); g.add(pivot);
      pivots[j.id] = { j, pivot };
      frames[j.child] = pivot;
    });

    const state = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0, g: 0 };
    function apply() {
      JOINTS.forEach(j => {
        const p = pivots[j.id].pivot;
        if (j.type === 'rev') {
          p.quaternion.setFromAxisAngle(new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]), THREE.MathUtils.degToRad(state[j.id]));
        } else if (j.type === 'jaw') {
          const d = 0.015 * state.g / 100;
          p.position.set(j.axis[0] * d, j.axis[1] * d, j.axis[2] * d);
        }
      });
    }

    // UI
    const ui = opts.controls;
    const sliders = {};
    if (ui) {
      const grid = document.createElement('div'); grid.className = 'av-ui';
      JOINTS.filter(j => j.type === 'rev').concat([{ id: 'g', label: 'Gripper open', min: 0, max: 100 }]).forEach(j => {
        const lab = document.createElement('label');
        lab.innerHTML = `${j.label}<span>0${j.id === 'g' ? '%' : '°'}</span>`;
        const r = document.createElement('input'); r.type = 'range'; r.min = j.min; r.max = j.max; r.step = 1; r.value = 0;
        r.setAttribute('aria-label', j.label);
        r.addEventListener('input', () => { stopDemo(); state[j.id] = +r.value; highlight(j.id); syncLabels(); apply(); });
        r.addEventListener('change', () => highlight(null));
        lab.appendChild(r); grid.appendChild(lab); sliders[j.id] = { r, lab };
      });
      const bar = document.createElement('div'); bar.className = 'av-bar';
      const demoBtn = document.createElement('button'); demoBtn.type = 'button'; demoBtn.className = 'btn primary'; demoBtn.textContent = '▶ Play demo';
      demoBtn.onclick = () => demo ? stopDemo() : startDemo();
      bar.appendChild(demoBtn);
      Object.keys(POSES).forEach(n => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = n;
        b.onclick = () => { stopDemo(); goTo(POSES[n]); };
        bar.appendChild(b);
      });
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn'; reset.textContent = 'Reset view';
      reset.onclick = () => { yaw = DEF.yaw; pitch = DEF.pitch; dist = DEF.dist; };
      bar.appendChild(reset);
      ui.appendChild(bar); ui.appendChild(grid);
      ui._demoBtn = demoBtn;
    }
    function syncLabels() {
      Object.entries(sliders).forEach(([id, s]) => { s.r.value = Math.round(state[id]); s.lab.querySelector('span').textContent = Math.round(state[id]) + (id === 'g' ? '%' : '°'); });
    }
    let hiKey = null;
    function highlight(id) {
      hiKey = id;
      Object.entries(meshes).forEach(([name, m]) => {
        const j = JOINTS.find(x => x.child === name);
        const isHi = id && j && j.id === id;
        m.material = isHi ? matHi : (name.includes('jaw') || name === 'Gripper_1' ? matGrip : matBody);
      });
    }

    // Smooth pose transitions and the demo loop
    let tween = null, demo = false, demoIdx = 0, demoWait = 0;
    function goTo(pose, dur) { tween = { from: Object.assign({}, state), to: pose, t0: performance.now(), dur: dur || 1100 }; }
    function startDemo() { demo = true; demoIdx = 0; goTo(POSES[DEMO[0]], 1400); if (ui) { ui._demoBtn.textContent = '❚❚ Pause demo'; ui._demoBtn.classList.add('on'); } }
    function stopDemo() { demo = false; if (ui && ui._demoBtn) { ui._demoBtn.textContent = '▶ Play demo'; ui._demoBtn.classList.remove('on'); } }

    // Camera orbit
    const DEF = { yaw: 0.9, pitch: 0.32, dist: 1.55 };
    let yaw = DEF.yaw, pitch = DEF.pitch, dist = DEF.dist, down = null;
    const target = new THREE.Vector3(0, 0.3, 0);
    canvas.style.touchAction = 'pan-y'; canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', e => {
      if (!down) return;
      yaw -= (e.clientX - down.x) * 0.007; pitch = Math.min(1.35, Math.max(-0.05, pitch + (e.clientY - down.y) * 0.005));
      down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', () => { down = null; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); dist = Math.min(3, Math.max(0.7, dist + e.deltaY * 0.002)); }, { passive: false });

    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight, pr = renderer.getPixelRatio();
      if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    }
    let visible = true, raf = 0, idleSpin = true;
    canvas.addEventListener('pointerdown', () => { idleSpin = false; });
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); }).observe(canvas);
    const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    function frame(now) {
      raf = 0; if (!visible) return;
      resize();
      if (tween) {
        const k = Math.min(1, (now - tween.t0) / tween.dur), e = ease(k);
        Object.keys(tween.to).forEach(id => { state[id] = tween.from[id] + (tween.to[id] - tween.from[id]) * e; });
        apply(); syncLabels();
        if (k >= 1) { tween = null; if (demo) demoWait = now + 500; }
      } else if (demo && now > demoWait) {
        demoIdx = (demoIdx + 1) % DEMO.length; goTo(POSES[DEMO[demoIdx]], 1400);
      }
      if (idleSpin && !down) yaw += 0.0015;
      const dd = dist * (camera.aspect < 1.3 ? Math.min(2.2, 1.3 / camera.aspect) : 1);
      camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dd, target.y + Math.sin(pitch) * dd, target.z + Math.cos(yaw) * Math.cos(pitch) * dd);
      camera.lookAt(target);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }

    // Load meshes
    function loadData() {
      return new Promise((res, rej) => {
        if (window.ARCTOS_MESHES) return res(window.ARCTOS_MESHES);
        const sc = document.createElement('script'); sc.src = base + 'arctos-meshes.js';
        sc.onload = () => res(window.ARCTOS_MESHES); sc.onerror = rej; document.head.appendChild(sc);
      });
    }
    loadData().then(d => {
        const bin = atob(d.data), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const buf = bytes.buffer;
        Object.entries(d.manifest).forEach(([name, m]) => {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, m.vOffset, m.vCount * 3), 3));
          geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, m.iOffset, m.iCount), 1));
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo, name.includes('jaw') || name === 'Gripper_1' ? matGrip : matBody);
          const o = LINKS[name]; mesh.position.set(o[0], o[1], o[2]);
          mesh.castShadow = true; mesh.receiveShadow = true;
          frames[name].add(mesh); meshes[name] = mesh;
        });
        loading.remove(); apply(); syncLabels();
        if (opts.autoDemo !== false) setTimeout(startDemo, 600);
      })
      .catch(() => { loading.textContent = 'The 3D model could not be loaded.'; });

    raf = requestAnimationFrame(frame);
    return { goTo: n => goTo(POSES[n]), startDemo, stopDemo };
  }
  window.ArctosViewer = { mount };
})();
