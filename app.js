(function () {
  "use strict";

  const C = window.EscapeCommon;
  const ROOMS = window.ROOMS || [];
  const TOTAL = ROOMS.length;
  const STORE_KEY = "artEscape.v2";
  const HINT_AT = [1, 3, 5]; // 오답 몇 회부터 힌트 1·2·3이 열리는지
  const MAX_DIGITS = 3;

  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = matchMedia("(pointer: coarse)").matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function srand(seed) {
    let s = (seed * 2654435761) >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  function fail(msg) {
    document.body.className = "";
    document.body.innerHTML = `<p class="fallback">${msg}</p>`;
  }
  if (!window.THREE) { fail("3D 화면을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요."); return; }

  /* =============== 저장 =============== */
  let S = null; // { name, room, startAt, endAt, wrong[], hints[], seen[], intro[] }
  function fresh(name) {
    return {
      name: C.normName(name), room: 0, startAt: Date.now(), endAt: null,
      wrong: ROOMS.map(() => 0), hints: ROOMS.map(() => 0),
      seen: ROOMS.map(() => false), intro: ROOMS.map(() => false),
    };
  }
  function save() { if (!S) return; try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 저장 불가 */ } }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (s && typeof s.name === "string" && Number.isInteger(s.room) && Array.isArray(s.wrong) && s.wrong.length === TOTAL) return s;
    } catch (e) { /* 무시 */ }
    return null;
  }
  function clearSave() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ } }

  /* =============== 렌더러 =============== */
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: $("gl"), antialias: true }); }
  catch (e) { fail("이 기기에서는 3D 화면(WebGL)을 열 수 없어요. 크롬이나 엣지 최신 버전으로 열어 주세요."); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  camera.rotation.order = "YXZ";
  // 세로 화면(휴대폰)에서는 시야각을 넓혀 가로로 더 많이 보이게 함
  const baseFov = () => (innerWidth / innerHeight < 0.8 ? 92 : 70);
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = baseFov();
    camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  /* =============== 캔버스 텍스처 =============== */
  function canvasTex(w, h, draw) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const x = cv.getContext("2d");
    draw(x, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = ANISO;
    t.userData = { cv, draw };
    return t;
  }
  function redraw(t) {
    const { cv, draw } = t.userData;
    const x = cv.getContext("2d");
    x.clearRect(0, 0, cv.width, cv.height);
    draw(x, cv.width, cv.height);
    t.needsUpdate = true;
  }
  const glowTex = canvasTex(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  });
  const beamTex = canvasTex(8, 128, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,244,214,.9)");
    g.addColorStop(1, "rgba(255,244,214,.05)");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });

  function shade(hex, d) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, d); return "#" + c.getHexString(); }

  function plasterTex(hex, seed) {
    const r = srand(seed);
    // 은은한 회벽 질감: 부드러운 얼룩을 흐리게 겹침
    return canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = hex; x.fillRect(0, 0, w, h);
      x.filter = "blur(4px)";
      for (let i = 0; i < 260; i++) {
        x.fillStyle = r() < 0.5 ? "rgba(255,255,255,.02)" : "rgba(0,0,0,.016)";
        x.beginPath(); x.arc(r() * w, r() * h, 6 + r() * 26, 0, TAU); x.fill();
      }
      x.filter = "none";
      for (let i = 0; i < 500; i++) {
        x.fillStyle = r() < 0.5 ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.035)";
        x.fillRect(r() * w, r() * h, 1.5, 1.5);
      }
    });
  }
  function plankTex(cols, seed) {
    const r = srand(seed);
    return canvasTex(512, 512, (x, w, h) => {
      const rowH = 64;
      for (let y = 0; y < h; y += rowH) {
        let px = -r() * 200;
        while (px < w) {
          const len = 160 + r() * 200;
          x.fillStyle = shade(cols[(r() * cols.length) | 0], (r() - 0.5) * 0.06);
          x.fillRect(px, y, len, rowH);
          x.strokeStyle = "rgba(0,0,0,.08)"; x.lineWidth = 1;
          for (let k = 0; k < 6; k++) {
            const gy = y + 6 + r() * (rowH - 12);
            x.beginPath(); x.moveTo(px, gy); x.bezierCurveTo(px + len * 0.3, gy + r() * 6 - 3, px + len * 0.6, gy + r() * 6 - 3, px + len, gy); x.stroke();
          }
          x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(px, y, 2, rowH);
          px += len;
        }
        x.fillStyle = "rgba(0,0,0,.4)"; x.fillRect(0, y, w, 2);
      }
    });
  }

  // 한국어 줄바꿈 (띄어쓰기 단위, 너무 긴 단어는 글자 단위)
  function wrap(x, text, maxW) {
    const lines = [];
    let line = "";
    for (const word of String(text).split(" ")) {
      const test = line ? line + " " + word : word;
      if (x.measureText(test).width <= maxW) { line = test; continue; }
      if (line) lines.push(line);
      line = "";
      for (const ch of word) {
        if (x.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
        else line += ch;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  const SERIF = "'Nanum Myeongjo', serif";
  const SANS = "'Noto Sans KR', 'Malgun Gothic', sans-serif";
  function roundRect(x, X, Y, W, H, r) {
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
    x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
  }

  /* =============== 전시실 테마 =============== */
  const THEMES = {
    orangerie: { bg: "#151821", wall: "#ece6d8", trim: "#cfc4ab", floor: ["#c9b694", "#bba680", "#d2c19f"], ceil: "#efe9dc", amb: 0.62, frame: "#b8913e", glow: "#bfe0ff", decoys: ["field", "grid", "circles", "stripes"] },
    light: { bg: "#040509", wall: "#30323d", trim: "#191a21", floor: ["#3b3b42", "#33333a", "#2c2c33"], ceil: "#15161c", amb: 0.32, frame: "#111", glow: "#ffd6f0", decoys: ["neon", "neon"] },
    hanji: { bg: "#18120a", wall: "#eadfc4", trim: "#6b4a2b", floor: ["#9a6b3f", "#8a5d34", "#a3744a"], ceil: "#d6c8aa", amb: 0.6, frame: "#4e321b", glow: "#ffe2a8", decoys: ["ink", "ink"] },
    media: { bg: "#03050d", wall: "#1d2346", trim: "#0d1129", floor: ["#23283d", "#1d2235", "#272c43"], ceil: "#0b0e1e", amb: 0.38, frame: "#1c1c22", glow: "#9fe4ff", decoys: ["pixel", "circles"] },
    auction: { bg: "#08111f", wall: "#22476f", trim: "#122a4a", floor: ["#5c3c2a", "#4f3324", "#664430"], ceil: "#1a2e4c", amb: 0.55, frame: "#b08d45", glow: "#ffe9b0", decoys: ["grid", "field", "stripes"] },
  };

  /* =============== 방 구조 =============== */
  const HW = 4.4, Y0 = -1.6, Y1 = 2.3, H = Y1 - Y0, MIDY = 0.35;
  // 각 벽: 방 안쪽을 보는 위치와 회전 (u = 벽을 따라 가로 위치, off = 벽에서 떨어진 거리)
  const WALLS = {
    back: { pos: (u, y, o) => [u, y, -HW + o], ry: 0, yaw: 0 },
    front: { pos: (u, y, o) => [-u, y, HW - o], ry: Math.PI, yaw: Math.PI },
    left: { pos: (u, y, o) => [-HW + o, y, u], ry: Math.PI / 2, yaw: Math.PI / 2 },
    right: { pos: (u, y, o) => [HW - o, y, -u], ry: -Math.PI / 2, yaw: -Math.PI / 2 },
  };
  function place(o, wall, u, y, off, parent) {
    const w = WALLS[wall];
    o.position.set(...w.pos(u, y, off));
    o.rotation.y = w.ry;
    if (parent) parent.add(o);
    return o;
  }
  function wallPos(wall, u, y, off) { return new THREE.Vector3(...WALLS[wall].pos(u, y, off)); }
  function box(w, h, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (parent) parent.add(m);
    return m;
  }
  function phong(opts) { return new THREE.MeshPhongMaterial(Object.assign({ shininess: 6, specular: 0x111111 }, opts)); }
  function additive(color, opacity, map) {
    return new THREE.MeshBasicMaterial({ map: map || glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }

  /* ---------- 장식 그림 (정답과 무관한 미술관 소장품) ---------- */
  const DECOY_SIZE = { field: [1.0, 1.3], grid: [1.1, 1.1], circles: [1.2, 1.0], stripes: [1.3, 0.9], neon: [1.4, 0.8], ink: [0.8, 1.5], pixel: [1.3, 0.85] };
  function decoyTex(kind, seed) {
    const r = srand(seed);
    const [w, h] = DECOY_SIZE[kind];
    return canvasTex(Math.round(w * 300), Math.round(h * 300), (x, W, Hh) => {
      const pick = (a) => a[(r() * a.length) | 0];
      if (kind === "field") {
        x.fillStyle = pick(["#7a1f22", "#2c3e6b", "#3d2a4f"]); x.fillRect(0, 0, W, Hh);
        const c1 = pick(["#e0652e", "#e8b23a", "#c43a3a"]), c2 = pick(["#3a2340", "#1f3350", "#d9a13a"]);
        x.filter = "blur(6px)";
        x.fillStyle = c1; x.fillRect(W * 0.1, Hh * 0.08, W * 0.8, Hh * 0.42);
        x.fillStyle = c2; x.fillRect(W * 0.1, Hh * 0.56, W * 0.8, Hh * 0.36);
        x.filter = "none";
      } else if (kind === "grid") {
        x.fillStyle = "#f4f1e8"; x.fillRect(0, 0, W, Hh);
        const xs = [0, W * (0.2 + r() * 0.15), W * (0.6 + r() * 0.15), W], ys = [0, Hh * (0.25 + r() * 0.2), Hh * (0.65 + r() * 0.15), Hh];
        const cols = ["#d42a20", "#1d4fa0", "#f2c81a", "#f4f1e8", "#f4f1e8", "#f4f1e8"];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { x.fillStyle = pick(cols); x.fillRect(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]); }
        x.fillStyle = "#111";
        xs.slice(1, 3).forEach((v) => x.fillRect(v - 5, 0, 10, Hh));
        ys.slice(1, 3).forEach((v) => x.fillRect(0, v - 5, W, 10));
      } else if (kind === "circles") {
        x.fillStyle = "#f0e6cf"; x.fillRect(0, 0, W, Hh);
        for (let i = 0; i < 9; i++) {
          const cx = r() * W, cy = r() * Hh, rad = 20 + r() * 70;
          for (let k = 3; k > 0; k--) { x.fillStyle = pick(["#1d4fa0", "#d42a20", "#f2c81a", "#2a8a5a", "#5a2a7a", "#111"]); x.beginPath(); x.arc(cx, cy, rad * k / 3, 0, TAU); x.fill(); }
        }
      } else if (kind === "stripes") {
        const cols = ["#e8b23a", "#2c6e8f", "#d9583a", "#f1e7d0", "#2d2d3a"];
        for (let i = -Hh; i < W + Hh; i += 34) { x.fillStyle = pick(cols); x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 34, 0); x.lineTo(i + 34 - Hh * 0.6, Hh); x.lineTo(i - Hh * 0.6, Hh); x.fill(); }
      } else if (kind === "neon") {
        x.fillStyle = "#07070c"; x.fillRect(0, 0, W, Hh);
        x.lineCap = "round"; x.lineJoin = "round";
        for (let k = 0; k < 3; k++) {
          const col = pick(["#ff4fa3", "#4ff0ff", "#ffe74f", "#8a6bff"]);
          x.shadowColor = col; x.shadowBlur = 18; x.strokeStyle = col; x.lineWidth = 6;
          x.beginPath(); x.moveTo(r() * W, r() * Hh);
          for (let i = 0; i < 4; i++) x.quadraticCurveTo(r() * W, r() * Hh, r() * W, r() * Hh);
          x.stroke();
        }
        x.shadowBlur = 0;
      } else if (kind === "ink") {
        x.fillStyle = "#efe4c8"; x.fillRect(0, 0, W, Hh);
        for (let layer = 0; layer < 3; layer++) {
          x.fillStyle = `rgba(30,30,30,${0.18 + layer * 0.22})`;
          x.beginPath(); x.moveTo(0, Hh);
          const base = Hh * (0.35 + layer * 0.18);
          for (let px = 0; px <= W; px += 12) x.lineTo(px, base - Math.abs(Math.sin(px / (40 + layer * 20) + layer * 2 + r())) * Hh * 0.18 - r() * 8);
          x.lineTo(W, Hh); x.fill();
        }
        x.fillStyle = "#b23a2e"; x.fillRect(W * 0.78, Hh * 0.08, 22, 22);
      } else if (kind === "pixel") {
        x.fillStyle = "#05060c"; x.fillRect(0, 0, W, Hh);
        const s = 26;
        for (let i = 0; i < W; i += s) for (let j = 0; j < Hh; j += s) {
          if (r() < 0.55) { x.fillStyle = `hsl(${(i + j) / 2 + r() * 60},90%,${40 + r() * 30}%)`; x.fillRect(i + 2, j + 2, s - 4, s - 4); }
        }
      }
    });
  }

  /* ---------- 안내판 ---------- */
  function boardTex(i) {
    const q = ROOMS[i];
    return canvasTex(1024, 640, (x, w, h) => {
      x.fillStyle = "rgba(10,14,30,.94)"; roundRect(x, 0, 0, w, h, 24); x.fill();
      x.strokeStyle = "rgba(227,194,122,.7)"; x.lineWidth = 4; roundRect(x, 14, 14, w - 28, h - 28, 16); x.stroke();
      x.fillStyle = "#e3c27a"; x.font = `700 30px ${SANS}`; x.fillText(`전시실 ${i + 1} / ${TOTAL}`, 60, 90);
      x.fillStyle = "#f2ecdc"; x.font = `800 72px ${SERIF}`; x.fillText(q.name, 60, 175);
      x.fillStyle = "#c9c1ad"; x.font = `400 32px ${SERIF}`;
      wrap(x, q.scene, w - 120).slice(0, 3).forEach((l, k) => x.fillText(l, 60, 240 + k * 46));
      x.fillStyle = "rgba(227,194,122,.35)"; x.fillRect(60, 390, w - 120, 2);
      x.fillStyle = "#e3c27a"; x.font = `700 32px ${SANS}`; x.fillText("임무", 60, 450);
      x.fillStyle = "#f2ecdc"; x.font = `500 32px ${SANS}`;
      wrap(x, "스포트라이트가 비추는 작품을 찾아 누르세요. 그 작품이 실린 교과서 쪽 번호가 출구 자물쇠의 비밀번호예요.", w - 220)
        .slice(0, 3).forEach((l, k) => x.fillText(l, 160, 450 + k * 46));
    });
  }

  /* ---------- 출구 문 ---------- */
  function makeDoor(th, seed) {
    const g = new THREE.Group();
    const trim = phong({ color: shade(th.trim, -0.05) });
    box(0.12, 2.5, 0.12, trim, -0.67, 1.25, 0.06, g);
    box(0.12, 2.5, 0.12, trim, 0.67, 1.25, 0.06, g);
    box(1.46, 0.12, 0.12, trim, 0, 2.44, 0.06, g);
    const lightPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 2.38), new THREE.MeshBasicMaterial({ color: "#fff3cf" }));
    lightPlane.position.set(0, 1.19, 0.01); g.add(lightPlane);
    const pivot = new THREE.Group(); pivot.position.set(-0.61, 0, 0.04); g.add(pivot);
    const panelTex = canvasTex(256, 512, (x, w, h) => {
      x.fillStyle = shade(th.trim, 0.08); x.fillRect(0, 0, w, h);
      x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = 6;
      x.strokeRect(30, 30, w - 60, h * 0.42); x.strokeRect(30, h * 0.5, w - 60, h * 0.45);
      x.strokeStyle = "rgba(255,255,255,.12)"; x.lineWidth = 3;
      x.strokeRect(36, 36, w - 72, h * 0.42 - 12); x.strokeRect(36, h * 0.5 + 6, w - 72, h * 0.45 - 12);
    });
    const panel = box(1.22, 2.38, 0.06, phong({ map: panelTex }), 0.61, 1.19, 0, pivot);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), phong({ color: "#e3c27a", shininess: 60 }));
    knob.position.set(1.08, 1.1, 0.06); pivot.add(knob);
    // 출구 표시
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.24), new THREE.MeshBasicMaterial({
      map: canvasTex(256, 100, (x, w, h) => {
        x.fillStyle = "#0f8a4a"; roundRect(x, 0, 0, w, h, 12); x.fill();
        x.fillStyle = "#eafff1"; x.font = `700 46px ${SANS}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("출구 EXIT", w / 2, h / 2 + 2);
      }),
    }));
    sign.position.set(0, 2.72, 0.02); g.add(sign);
    const signGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), additive("#3aff9a", 0.25)); signGlow.position.set(0, 2.72, 0.015); g.add(signGlow);
    // 숫자 자물쇠
    const kp = new THREE.Group(); kp.position.set(1.02, 1.3, 0.03); g.add(kp);
    const kpBox = box(0.32, 0.5, 0.06, phong({ color: "#1b1f2c", shininess: 30 }), 0, 0, 0, kp);
    let open = false;
    const screenTex = canvasTex(160, 90, (x, w, h) => {
      x.fillStyle = "#05070f"; x.fillRect(0, 0, w, h);
      x.fillStyle = open ? "#7dffb0" : "#e3c27a"; x.font = `700 34px ${SANS}`; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(open ? "OPEN" : "_ _ _", w / 2, h / 2 + 2);
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.13), new THREE.MeshBasicMaterial({ map: screenTex }));
    screen.position.set(0, 0.14, 0.032); kp.add(screen);
    const keyMat = phong({ color: "#3a4058" });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) box(0.06, 0.045, 0.02, keyMat, -0.075 + c * 0.075, 0.0 - r * 0.06, 0.035, kp);
    const kpGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), additive("#ffd66a", 0)); kpGlow.position.z = -0.01; kp.add(kpGlow);
    const doorData = { type: "door" };
    panel.userData = doorData; kpBox.userData = doorData;
    return {
      g, hits: [panel, kpBox], kpGlow,
      setOpen(instant) {
        if (open) return;
        open = true; redraw(screenTex);
        if (instant) { pivot.rotation.y = -1.55; return; }
        tween(1300, (k) => { pivot.rotation.y = -1.55 * easeOut(k); });
      },
      isOpen: () => open,
    };
  }

  /* ---------- 소품 ---------- */
  function addProps(R, th) {
    const { scene, q } = R;
    const free = ["left", "right", "front"].find((w) => w !== q.art && w !== q.door);
    R.freeWall = free;
    const wood = phong({ color: shade(th.trim, 0.05) });
    if (q.theme === "orangerie") {
      // 작품 앞 긴 의자
      const bench = new THREE.Group();
      box(2.4, 0.1, 0.6, phong({ color: "#e9e2d2" }), 0, 0, 0, bench);
      box(0.12, 0.42, 0.5, phong({ color: "#cfc6b2" }), -1.0, -0.26, 0, bench);
      box(0.12, 0.42, 0.5, phong({ color: "#cfc6b2" }), 1.0, -0.26, 0, bench);
      place(bench, q.art, 0, Y0 + 0.47, 1.45, scene);
      bench.userData = { type: "prop", msg: "관람객이 앉아 쉬는 긴 의자예요. 앉으면 벽의 작품이 한눈에 들어와요." };
      R.hits.push(bench.children[0]); bench.children[0].userData = bench.userData;
    } else if (q.theme === "light") {
      // 바닥의 검은 구멍과 네온 띠
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshBasicMaterial({ color: "#000" }));
      hole.rotation.x = -Math.PI / 2; hole.position.set(1.7, Y0 + 0.01, 1.6); scene.add(hole);
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.05, 48), new THREE.MeshBasicMaterial({ color: "#6a6a72" }));
      rim.rotation.x = -Math.PI / 2; rim.position.set(1.7, Y0 + 0.012, 1.6); scene.add(rim);
      hole.userData = { type: "prop", msg: "발밑의 검은 원… 바닥인지 구멍인지 알 수 없어요. 벽의 작품에 단서가 있어요." };
      R.hits.push(hole);
      const neon = [];
      ["#ff4fa3", "#4ff0ff", "#ffe74f"].forEach((col, k) => {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(HW * 1.6, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: col }));
        place(bar, free, 0, Y1 - 0.25 - k * 0.12, 0.05, scene);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(HW * 1.9, 0.5), additive(col, 0.25));
        place(gl, free, 0, Y1 - 0.25 - k * 0.12, 0.03, scene);
        neon.push(gl);
      });
      R.updaters.push((t) => neon.forEach((m, k) => { m.material.opacity = 0.2 + 0.08 * Math.sin(t * 2 + k * 2); }));
    } else if (q.theme === "hanji") {
      // 병풍
      const screen = new THREE.Group();
      const n = 6, pw = 0.55;
      for (let k = 0; k < n; k++) {
        const pan = new THREE.Mesh(new THREE.BoxGeometry(pw, 1.5, 0.03), [wood, wood, wood, wood,
          new THREE.MeshLambertMaterial({ map: decoyTex("ink", 300 + k) }), wood]);
        const a = k % 2 ? -0.35 : 0.35;
        pan.rotation.y = a;
        pan.position.set((k - (n - 1) / 2) * pw * Math.cos(0.35), 0, (k % 2 ? 0.1 : 0));
        pan.userData = { type: "prop", msg: "먹으로 산을 그린 병풍이에요. 오늘의 단서는 스포트라이트가 비추는 그림이에요." };
        screen.add(pan); R.hits.push(pan);
      }
      place(screen, free, 0, Y0 + 0.75, 0.45, scene);
      // 낮은 탁자
      const table = new THREE.Group();
      box(1.2, 0.06, 0.6, wood, 0, 0, 0, table);
      [[-0.52, -0.24], [0.52, -0.24], [-0.52, 0.24], [0.52, 0.24]].forEach(([a, b]) => box(0.06, 0.3, 0.06, wood, a, -0.18, b, table));
      place(table, q.art, 0, Y0 + 0.36, 1.6, scene);
    } else if (q.theme === "media") {
      // TV 탑
      const tower = new THREE.Group();
      const screens = [];
      const caseMat = phong({ color: "#2a2d36", shininess: 20 });
      for (let L = 0; L < 7; L++) {
        const rad = 1.05 - L * 0.12, cnt = Math.max(6, Math.floor((TAU * rad) / 0.34));
        for (let k = 0; k < cnt; k++) {
          const a = (k / cnt) * TAU;
          const tv = new THREE.Group();
          box(0.28, 0.22, 0.2, caseMat, 0, 0, 0, tv);
          const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.17), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.55) }));
          sc.position.z = 0.101; tv.add(sc); screens.push(sc);
          tv.position.set(Math.sin(a) * rad, L * 0.25, Math.cos(a) * rad);
          tv.rotation.y = a;
          tower.add(tv);
        }
      }
      // 작품·문이 없는 쪽의 뒤 모서리에 세움
      tower.position.set(q.art === "left" || q.door === "left" ? 2.7 : -2.7, Y0 + 0.12, -2.7);
      scene.add(tower);
      const tgl = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), additive("#6fc8ff", 0.18));
      tgl.position.set(tower.position.x, 0.4, tower.position.z); tgl.lookAt(0, 0.4, 0); scene.add(tgl);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.9, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(tower.position.x, Y0 + 0.95, tower.position.z); scene.add(hit);
      hit.userData = { type: "prop", msg: "TV가 탑처럼 쌓여 반짝여요. 어딘가 본 듯한데… 벽에 걸린 사진을 찾아보세요!" };
      R.hits.push(hit);
      let acc = 0;
      R.updaters.push((t, dt) => {
        acc += dt; if (acc < 0.18) return; acc = 0;
        for (let k = 0; k < 14; k++) screens[(Math.random() * screens.length) | 0].material.color.setHSL(Math.random(), 0.85, 0.5 + Math.random() * 0.2);
      });
    } else if (q.theme === "auction") {
      // 경매장 의자와 경매대
      const seat = phong({ color: "#8a1f2b" }), leg = phong({ color: "#2b2b30" });
      for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
        const ch = new THREE.Group();
        box(0.46, 0.06, 0.44, seat, 0, 0, 0, ch);
        box(0.46, 0.5, 0.05, seat, 0, 0.27, 0.2, ch);
        [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]].forEach(([a, b]) => box(0.04, 0.45, 0.04, leg, a, -0.24, b, ch));
        place(ch, q.art, -1.2 + col * 0.8, Y0 + 0.47, 1.7 + row * 0.65, scene);
      }
      const lect = new THREE.Group();
      box(0.7, 1.1, 0.5, phong({ color: "#f2f2f2" }), 0, 0, 0, lect);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.18), new THREE.MeshBasicMaterial({
        map: canvasTex(256, 80, (x, w, h) => { x.fillStyle = "#f2f2f2"; x.fillRect(0, 0, w, h); x.fillStyle = "#22476f"; x.font = `700 40px ${SERIF}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("AUCTION", w / 2, h / 2 + 2); }),
      }));
      plate.position.set(0, 0.32, 0.252); lect.add(plate);
      place(lect, q.art, 2.3, Y0 + 0.55, 0.9, scene);
      lect.children[0].userData = { type: "prop", msg: "경매사가 망치를 두드리는 경매대예요. ‘낙찰!’ 순간의 사진이 벽에 걸려 있어요." };
      R.hits.push(lect.children[0]);
    }
  }

  /* ---------- 방 만들기 ---------- */
  function buildRoom(i) {
    const q = ROOMS[i];
    const th = THEMES[q.theme] || THEMES.orangerie;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(th.bg);
    const R = { i, q, th, scene, hits: [], updaters: [], art: null };

    scene.add(new THREE.AmbientLight(0xffffff, th.amb));
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a1a28, 0.3));
    const center = new THREE.PointLight(0xfff0d8, 0.35, 12, 1.5); center.position.set(0, 1.9, 0); scene.add(center);

    // 바닥, 천장, 벽
    const ftex = plankTex(th.floor, 11 + i); ftex.wrapS = ftex.wrapT = THREE.RepeatWrapping; ftex.repeat.set(3, 3);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HW * 2), phong({ map: ftex, shininess: 20 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = Y0; scene.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HW * 2), phong({ color: th.ceil }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = Y1; scene.add(ceil);
    const wtex = plasterTex(th.wall, 5 + i); wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping; wtex.repeat.set(3, 1.4);
    const wmat = phong({ map: wtex });
    const trim = phong({ color: th.trim });
    Object.keys(WALLS).forEach((k) => {
      place(new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, H), wmat), k, 0, (Y0 + Y1) / 2, 0, scene);
      place(box(HW * 2, 0.16, 0.04, trim, 0, 0, 0), k, 0, Y0 + 0.08, 0.02, scene);
      place(box(HW * 2, 0.1, 0.06, trim, 0, 0, 0), k, 0, Y1 - 0.05, 0.03, scene);
    });
    // 천장 레일 조명
    const rail = phong({ color: "#222", shininess: 40 });
    [-1.6, 1.6].forEach((z) => box(HW * 1.6, 0.04, 0.06, rail, 0, Y1 - 0.03, z, scene));

    // 안내판 (처음 바라보는 벽)
    const bt = boardTex(i);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.31), new THREE.MeshBasicMaterial({ map: bt }));
    place(board, "back", 0, MIDY + 0.1, 0.03, scene);
    board.userData = { type: "board" };
    R.hits.push(board);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redraw(bt));

    // 장식 그림
    const decoyMsg = "미술관 소장품이에요. 오늘의 단서는 스포트라이트가 비추는 작품이에요.";
    const slots = [["back", -2.85], ["back", 2.85]];
    const free = ["left", "right", "front"].find((w) => w !== q.art && w !== q.door);
    if (q.theme !== "hanji") slots.push([free, -2.0], [free, 2.0]);
    slots.push([q.door, -2.4]);
    slots.forEach(([wall, u], k) => {
      const kind = th.decoys[k % th.decoys.length];
      const [w, h] = DECOY_SIZE[kind];
      const g = new THREE.Group();
      box(w + 0.12, h + 0.12, 0.05, phong({ color: shade(th.frame, -0.1) }), 0, 0, 0, g);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: decoyTex(kind, i * 31 + k * 7 + 1) }));
      pic.position.z = 0.03; g.add(pic);
      place(g, wall, u, MIDY + 0.05, 0.03, scene);
      pic.userData = g.children[0].userData = { type: "prop", msg: decoyMsg };
      R.hits.push(pic, g.children[0]);
    });

    // 오늘의 작품 (교과서 그림)
    const artGroup = new THREE.Group();
    place(artGroup, q.art, 0, MIDY, 0.03, scene);
    const artCenter = wallPos(q.art, 0, MIDY, 0.03);
    const lampPos = wallPos(q.art, 0, Y1 - 0.12, 1.5);
    box(0.12, 0.16, 0.12, rail, lampPos.x, lampPos.y, lampPos.z, scene);
    const bulb = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), additive("#fff4d6", 0.8));
    bulb.position.copy(lampPos).add(new THREE.Vector3(0, -0.1, 0)); bulb.lookAt(0, 0, 0); scene.add(bulb);
    const spot = new THREE.SpotLight(0xfff1d6, 1.6, 9, 0.5, 0.55, 1);
    spot.position.copy(lampPos); spot.target = artGroup; scene.add(spot);

    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(th.glow, 0.5));
    glow.position.z = -0.005; artGroup.add(glow);
    R.updaters.push((t) => {
      const seen = S && S.seen[i];
      glow.material.opacity = seen ? 0.32 : 0.45 + 0.25 * Math.sin(t * 2.4);
    });

    loadImage(q.image).then((img) => {
      const aspect = img.naturalWidth / img.naturalHeight;
      let w, h;
      if (aspect >= 1) { w = Math.min(2.8, 1.9 * aspect); h = w / aspect; } else { h = 2.3; w = h * aspect; }
      const tex = new THREE.Texture(img); tex.needsUpdate = true; tex.anisotropy = ANISO; tex.minFilter = THREE.LinearFilter;
      const frame = box(w + 0.26, h + 0.26, 0.08, phong({ color: th.frame, shininess: 50 }), 0, 0, 0, artGroup);
      const mat = box(w + 0.1, h + 0.1, 0.01, new THREE.MeshBasicMaterial({ color: "#0d0d0d" }), 0, 0, 0.042, artGroup);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
      pic.position.z = 0.05; artGroup.add(pic);
      glow.scale.set(w + 1.8, h + 1.6, 1);
      // 작품 아래 명패
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.24), new THREE.MeshBasicMaterial({
        map: canvasTex(440, 96, (x, W, Hh) => {
          x.fillStyle = "#f4efe2"; x.fillRect(0, 0, W, Hh);
          x.fillStyle = "#2a2418"; x.font = `700 30px ${SANS}`; x.textAlign = "center"; x.textBaseline = "middle";
          x.fillText("교과서 ( ? ) 쪽", W / 2, Hh / 2 + 2);
        }),
      }));
      plate.position.set(0, -h / 2 - 0.36, 0.02); artGroup.add(plate);
      const data = { type: "art" };
      frame.userData = mat.userData = pic.userData = plate.userData = data;
      R.hits.push(frame, mat, pic, plate);
      // 스포트라이트 빛줄기
      const dir = new THREE.Vector3().subVectors(lampPos, artCenter);
      const len = dir.length();
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, Math.max(w, h) * 0.6, len, 32, 1, true),
        new THREE.MeshBasicMaterial({ map: beamTex, color: "#fff2d0", transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      cone.position.copy(artCenter).addScaledVector(dir, 0.5);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      scene.add(cone);
    }).catch(() => {
      const ph = box(2, 1.4, 0.06, phong({ color: "#333" }), 0, 0, 0, artGroup);
      ph.userData = { type: "art" }; R.hits.push(ph);
    });

    // 출구 문
    const door = makeDoor(th, i);
    place(door.g, q.door, 0, Y0, 0.02, scene);
    R.door = door;
    R.hits.push(...door.hits);
    R.updaters.push((t) => {
      const ready = S && S.seen[i] && !door.isOpen();
      door.kpGlow.material.opacity = ready ? 0.35 + 0.25 * Math.sin(t * 3) : 0;
    });

    addProps(R, th);
    R.update = (t, dt) => R.updaters.forEach((f) => f(t, dt));
    return R;
  }

  /* =============== 애니메이션 =============== */
  const tweens = [];
  function tween(dur, fn, done, delay) { tweens.push({ t0: performance.now() + (delay || 0), dur: reduce ? Math.min(dur, 200) : dur, fn, done }); }
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  function runTweens(now) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      if (now < tw.t0) continue;
      const k = Math.min(1, (now - tw.t0) / tw.dur);
      tw.fn(k);
      if (k >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); }
    }
  }
  const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  /* =============== 방 이동 =============== */
  const built = [];
  let cur = null;
  const look = { yaw: 0, pitch: 0, vy: 0, vp: 0, drag: false };
  function getRoom(i) { if (!built[i]) built[i] = buildRoom(i); return built[i]; }
  function enterRoom(i) {
    cur = getRoom(i);
    camera.position.set(0, 0, 0);
    look.yaw = 0; look.pitch = -0.02; look.vy = look.vp = 0;
    camera.fov = baseFov(); camera.updateProjectionMatrix();
    renderHUD();
  }
  function fade(mid) {
    const f = $("fade");
    f.classList.add("on");
    setTimeout(() => { mid(); requestAnimationFrame(() => setTimeout(() => f.classList.remove("on"), 80)); }, 620);
  }
  function turnTo(yaw, dur) {
    const from = look.yaw, diff = wrapA(yaw - from), p0 = look.pitch;
    look.vy = look.vp = 0;
    tween(dur, (k) => { const e = easeInOut(k); look.yaw = from + diff * e; look.pitch = p0 * (1 - e); });
  }
  function goRoom(i) {
    closeModal();
    fade(() => {
      enterRoom(i);
      if (!S.intro[i]) { S.intro[i] = true; save(); setTimeout(introCard, 650); }
    });
  }

  /* =============== HUD =============== */
  const playing = () => S && S.room < TOTAL;
  let toastT = 0;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.classList.remove("off");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("off"), 2800);
  }
  function renderHUD() {
    const on = !!S && $("start").hidden;
    ["hud-tl", "hud-tr", "hud-b"].forEach((id) => { $(id).hidden = !on; });
    if (!on) return;
    const done = S.room >= TOTAL;
    const i = cur ? cur.i : 0;
    $("hud-no").textContent = done ? "탈출 성공" : `전시실 ${i + 1} / ${TOTAL}`;
    $("hud-name").textContent = ROOMS[i].name;
    const ol = $("hud-dots"); ol.innerHTML = "";
    for (let k = 0; k < TOTAL; k++) {
      const li = document.createElement("li");
      li.textContent = String(k + 1);
      li.className = k < S.room ? "done" : (k === S.room ? "now" : "");
      ol.appendChild(li);
    }
    const opened = !done && i < S.room; // 이 방의 문은 열렸고 다음 방으로 가기 전
    const seen = !done && S.seen[i];
    $("btn-art").hidden = !seen;
    $("btn-lock").hidden = !(seen || done);
    $("btn-lock").textContent = done ? "결과 보기" : opened ? "다음 전시실로" : "자물쇠";
    $("guide").innerHTML = done
      ? "탈출 성공! 전시실을 자유롭게 둘러보세요."
      : opened
        ? "문이 열렸어요! <b>다음 전시실</b>로 가세요."
        : seen
          ? "교과서에서 이 작품이 실린 쪽을 찾아, <b>출구 문 옆 자물쇠</b>에 입력하세요."
          : "화면을 끌어서 둘러보세요. <b>스포트라이트가 비추는 작품</b>을 찾아 누르세요.";
    updateTimer(true);
  }
  let shownSec = -1;
  function updateTimer(force) {
    if (!S) return;
    const ms = (S.endAt || Date.now()) - S.startAt;
    const s = Math.floor(ms / 1000);
    if (s !== shownSec || force) { shownSec = s; $("timer").textContent = C.formatTime(ms); }
  }

  /* =============== 카드 =============== */
  let modalOpen = false;
  let lockOpen = false;
  function openCard(html, buttons, cls) {
    const card = $("card");
    card.className = "card " + (cls || "");
    card.innerHTML = html + (buttons && buttons.length
      ? '<div class="btn-row">' + buttons.map((b, k) => `<button class="btn small ${b[2] || ""}" type="button" data-i="${k}">${b[0]}</button>`).join("") + "</div>"
      : "");
    card.querySelectorAll(".btn-row button").forEach((b) => { b.onclick = () => buttons[+b.dataset.i][1](); });
    $("modal").hidden = false;
    modalOpen = true; lockOpen = false;
    look.drag = false;
    const first = card.querySelector(".btn-row button:last-child");
    if (first && !touch) first.focus();
  }
  function closeModal() { $("modal").hidden = true; modalOpen = false; lockOpen = false; }
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal") && !lockBusy) closeModal(); });

  function introCard() {
    const i = cur.i, q = ROOMS[i];
    openCard(`<div class="sub">전시실 ${i + 1} / ${TOTAL}</div><h2>${esc(q.name)}</h2>
      <p class="scene">${esc(q.scene)}</p>
      <p class="task"><b>임무</b> · 방을 둘러보며 <b>스포트라이트가 비추는 작품</b>을 찾아 누르세요. 그 작품이 실린 <b>교과서 쪽 번호</b>가 출구 자물쇠의 비밀번호예요.</p>`,
    [["둘러보기 시작", closeModal]]);
  }

  function artCard() {
    const i = cur.i, q = ROOMS[i];
    if (!S.seen[i]) { S.seen[i] = true; save(); renderHUD(); }
    openCard(`<div class="sub">전시실 ${i + 1} · 오늘의 작품</div><h2>이 작품은 교과서 몇 쪽에 있을까?</h2>
      <div class="art-view"><img src="${esc(q.image)}" alt="전시실 ${i + 1}에 걸린 교과서 속 작품"></div>
      <p class="task">교과서를 펼쳐 이 그림을 찾아보세요. 그 쪽 번호가 출구 자물쇠의 비밀번호예요. 목차를 먼저 보면 도움이 돼요.</p>
      <p class="credit">이미지 출처: 미진사 『고등학교 미술 창작』 교과서</p>`,
    [["계속 둘러보기", closeModal, "ghost"], ["자물쇠 열기", lockCard]], "wide");
  }

  /* ---------- 자물쇠 ---------- */
  let input = "";
  let lockBusy = false;
  function lockCard() {
    const i = cur.i, q = ROOMS[i];
    input = "";
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "enter"]
      .map((k) => `<button type="button" data-key="${k}" class="${k === "back" ? "fn" : k === "enter" ? "enter" : ""}">${k === "back" ? "지움" : k === "enter" ? "열기" : k}</button>`).join("");
    openCard(`<div class="sub">출구 자물쇠 · 전시실 ${i + 1}</div>
      <div class="lock-top"><img src="${esc(q.image)}" alt=""><div><h2>쪽 번호를 입력하세요</h2><p class="note" style="margin:0">이 작품이 실린 교과서 쪽</p></div></div>
      <output class="display" id="lk-display" aria-live="polite"></output>
      <div class="keypad" id="lk-keypad" role="group" aria-label="숫자 자물쇠">${keys}</div>
      <p class="msg" id="lk-msg">교과서에서 찾은 쪽 번호를 누르고 ‘열기’를 누르세요.</p>
      <ul class="hint-list" id="lk-hints"></ul>`,
    [["작품 다시 보기", artCard, "ghost"], ["닫기", closeModal, "ghost"]]);
    lockOpen = true;
    $("lk-keypad").addEventListener("click", (e) => { const b = e.target.closest("button[data-key]"); if (b) press(b.dataset.key); });
    renderHints();
  }
  function renderHints() {
    const i = cur.i, q = ROOMS[i], ul = $("lk-hints");
    if (!ul) return;
    const wrong = S.wrong[i], used = S.hints[i];
    ul.innerHTML = q.hints.map((text, n) => {
      if (used > n) return `<li class="open"><span class="tag">힌트 ${n + 1}</span><span>${esc(text)}</span></li>`;
      if (used === n && wrong >= HINT_AT[n]) return `<li><span class="tag">힌트 ${n + 1}</span><span>힌트가 열렸어요.</span><button type="button" data-hint="${n}">보기</button></li>`;
      const left = HINT_AT[n] - wrong;
      const why = left > 0 ? `오답 ${left}회 더 틀리면 열려요` : "앞의 힌트를 먼저 보세요";
      return `<li class="locked"><span class="tag">힌트 ${n + 1}</span><span>${why}</span></li>`;
    }).join("");
    ul.querySelectorAll("button[data-hint]").forEach((b) => {
      b.onclick = () => { const n = +b.dataset.hint; if (S.hints[i] === n && S.wrong[i] >= HINT_AT[n]) { S.hints[i] = n + 1; save(); renderHints(); } };
    });
  }
  function setMsg(text, bad) { const m = $("lk-msg"); if (!m) return; m.textContent = text; m.classList.toggle("bad", !!bad); }
  function press(key) {
    if (!lockOpen || lockBusy) return;
    const d = $("lk-display");
    if (/^\d$/.test(key)) {
      if (input.length >= MAX_DIGITS || (input === "" && key === "0")) return;
      input += key;
    } else if (key === "back") {
      input = input.slice(0, -1);
    } else if (key === "enter") {
      submit(); return;
    }
    d.textContent = input;
  }
  async function submit() {
    if (!input) { setMsg("숫자를 먼저 눌러 주세요.", true); return; }
    const i = cur.i;
    lockBusy = true;
    let ok = false;
    try { ok = (await C.answerHash(i + 1, input)) === ROOMS[i].hash; }
    catch (e) { setMsg("이 브라우저에서는 자물쇠를 열 수 없어요. 크롬이나 엣지로 열어 주세요.", true); lockBusy = false; return; }
    lockBusy = false;
    if (ok) { solved(i, input); return; }
    S.wrong[i] += 1; save();
    const d = $("lk-display");
    d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake");
    const w = S.wrong[i];
    let msg = `${input}쪽이 아니었다. 문이 꿈쩍도 하지 않는다.`;
    if (HINT_AT.includes(w)) msg += " 힌트가 열렸어요!";
    setMsg(msg, true);
    input = ""; d.textContent = "";
    renderHints();
  }
  function solved(i, page) {
    S.room = i + 1;
    if (S.room >= TOTAL) S.endAt = Date.now();
    save();
    closeModal();
    const R = cur;
    turnTo(WALLS[R.q.door].yaw, 900);
    setTimeout(() => R.door.setOpen(false), 650);
    renderHUD();
    const last = S.room >= TOTAL;
    setTimeout(() => {
      openCard(`<div class="sub">철컥!</div><h2>${esc(page)}쪽, 문이 열렸다!</h2>
        <div class="art-view"><img src="${esc(ROOMS[i].image)}" alt=""></div>
        <p>${esc(ROOMS[i].found)}</p>`,
      [[last ? "미술관 밖으로" : "다음 전시실로", () => { if (last) finish(); else goRoom(S.room); }]], "wide");
    }, 2000);
  }

  /* ---------- 탈출 ---------- */
  async function finalCard() {
    const time = C.formatTime(S.endAt - S.startAt);
    const wrong = S.wrong.reduce((a, b) => a + b, 0);
    const hints = S.hints.reduce((a, b) => a + b, 0);
    openCard(`<div class="sub">탈출 성공</div><h2>${esc(S.name)} 님, 미술관을 빠져나왔어요!</h2>
      <dl class="result">
        <div><dt>이름</dt><dd>${esc(S.name)}</dd></div>
        <div><dt>탈출 시간</dt><dd>${time}</dd></div>
        <div><dt>오답</dt><dd>${wrong}회</dd></div>
        <div><dt>힌트 사용</dt><dd>${hints}회</dd></div>
      </dl>
      <p class="code-label">탈출 인증 코드</p>
      <p class="code" id="fin-code">······</p>
      <p class="note" style="text-align:center">이 화면을 선생님께 보여 주세요.</p>
      <div class="gallery">${ROOMS.map((r, k) => `<figure><img src="${esc(r.image)}" alt=""><figcaption>${k + 1}. ${esc(r.name)}</figcaption></figure>`).join("")}</div>`,
    [["처음부터 다시 하기", resetAll, "ghost"], ["전시실 둘러보기", closeModal]], "wide");
    try { $("fin-code").textContent = await C.escapeCode(S.name, time); }
    catch (e) { $("fin-code").textContent = "오류"; }
  }
  function finish() {
    closeModal();
    renderHUD();
    finalCard();
  }

  function resetAll() {
    if (!confirm("처음부터 다시 할까요? 지금까지의 기록이 사라집니다.")) return;
    clearSave();
    location.reload();
  }

  /* =============== 입력: 끌어서 둘러보기, 눌러서 조사 =============== */
  const cv = $("gl");
  const ptrs = new Map();
  let down = null, pinch = null, lastMove = 0;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pd = () => { const a = [...ptrs.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
  cv.addEventListener("pointerdown", (e) => {
    if (modalOpen) return;
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; look.drag = true; look.vy = look.vp = 0; cv.classList.add("drag"); }
    else if (ptrs.size === 2) { pinch = { d: pd(), fov: camera.fov }; down = null; }
  });
  cv.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) { hover(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      const k = (camera.fov * Math.PI / 180 / innerHeight) * 1.1;
      look.yaw += dx * k; look.pitch += dy * k;
      const now = performance.now(), dtm = Math.max(8, now - lastMove) / 1000; lastMove = now;
      look.vy = look.vy * 0.6 + (dx * k / dtm) * 0.4; look.vp = look.vp * 0.6 + (dy * k / dtm) * 0.4;
      if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    } else if (ptrs.size === 2 && pinch) {
      camera.fov = clamp(pinch.fov * pinch.d / pd(), 38, 100); camera.updateProjectionMatrix();
    }
  });
  function up(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) {
      look.drag = false; cv.classList.remove("drag");
      if (performance.now() - lastMove > 90) look.vy = look.vp = 0;
      if (down && down.moved < 10 && performance.now() - down.t < 600 && e.type === "pointerup") tap(e.clientX, e.clientY);
      down = null;
    }
  }
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => { e.preventDefault(); camera.fov = clamp(camera.fov + e.deltaY * 0.03, 38, 80); camera.updateProjectionMatrix(); }, { passive: false });

  function castAt(x, y) {
    if (!cur) return null;
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(cur.hits, false);
    return h.length ? h[0].object.userData : null;
  }
  function tap(x, y) {
    if (!S || modalOpen || !$("start").hidden) return;
    const d = castAt(x, y);
    if (!d || !d.type) return;
    const i = cur.i;
    if (d.type === "art") artCard();
    else if (d.type === "board") introCard();
    else if (d.type === "prop") toast(d.msg);
    else if (d.type === "door") {
      if (S.room >= TOTAL) finalCard();
      else if (S.room > i) goRoom(S.room);
      else if (!S.seen[i]) toast("문에 숫자 자물쇠가 걸려 있어요. 먼저 스포트라이트가 비추는 작품을 찾아보세요.");
      else lockCard();
    }
  }
  let hovT = 0;
  function hover(e) {
    if (!S || touch) return;
    const now = performance.now();
    if (now - hovT < 80) return;
    hovT = now;
    cv.style.cursor = castAt(e.clientX, e.clientY) ? "pointer" : "";
  }

  addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT") return;
    if (e.key === "Escape" && modalOpen && !lockBusy) { closeModal(); return; }
    if (lockOpen) {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
      else if (e.key === "Enter") { e.preventDefault(); press("enter"); }
      return;
    }
    if (modalOpen || !S || !$("start").hidden) return;
    const s = 0.1;
    if (e.key === "ArrowLeft") look.yaw += s;
    else if (e.key === "ArrowRight") look.yaw -= s;
    else if (e.key === "ArrowUp") look.pitch += s;
    else if (e.key === "ArrowDown") look.pitch -= s;
  });

  $("btn-art").onclick = () => { if (!modalOpen) artCard(); };
  $("btn-lock").onclick = () => {
    if (modalOpen) return;
    if (S.room >= TOTAL) finalCard();
    else if (cur.i < S.room) goRoom(S.room);
    else lockCard();
  };

  /* =============== 시작 =============== */
  function hideStart() {
    const st = $("start");
    st.style.opacity = "0";
    setTimeout(() => { st.hidden = true; renderHUD(); }, 800);
  }
  function begin(name) {
    S = fresh(name);
    S.intro[0] = true;
    save();
    hideStart();
    fade(() => { enterRoom(0); setTimeout(introCard, 900); });
  }
  function resume() {
    S = load();
    if (!S) { location.reload(); return; }
    hideStart();
    fade(() => {
      if (S.room >= TOTAL) {
        enterRoom(TOTAL - 1);
        cur.door.setOpen(true);
        setTimeout(finalCard, 900);
      } else {
        enterRoom(S.room);
        if (!S.intro[S.room]) { S.intro[S.room] = true; save(); setTimeout(introCard, 900); }
      }
    });
  }

  $("start-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = C.normName($("player-name").value);
    if (!name) { $("player-name").focus(); return; }
    begin(name);
  });
  $("btn-resume").onclick = resume;
  $("btn-reset-start").onclick = resetAll;

  const saved = load();
  if (saved) {
    $("resume-box").hidden = false;
    $("start-form").hidden = true;
    if (saved.room >= TOTAL) {
      $("resume-text").textContent = `${saved.name} 님은 이미 탈출했어요.`;
      $("btn-resume").textContent = "결과 보기";
    } else {
      $("resume-text").textContent = `${saved.name} 님, ${saved.room + 1}번째 전시실에서 멈춰 있어요.`;
    }
  }

  // 시작 화면 뒤로 첫 전시실이 천천히 돈다
  cur = getRoom(0);
  look.yaw = 0.6; look.pitch = 0.05;

  /* =============== 루프 =============== */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    const idle = !$("start").hidden || (S && S.room >= TOTAL && !modalOpen && !look.drag);
    if (!look.drag) {
      look.yaw += look.vy * dt; look.pitch += look.vp * dt;
      const dec = Math.pow(0.03, dt); look.vy *= dec; look.vp *= dec;
    }
    if (idle) look.yaw += 0.04 * dt;
    look.pitch = clamp(look.pitch, -0.8, 0.8);
    camera.rotation.set(look.pitch, look.yaw, 0);
    runTweens(now);
    if (cur) cur.update(t, dt);
    if (S && $("start").hidden) updateTimer(false);
    if (cur) renderer.render(cur.scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
