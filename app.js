(function () {
  "use strict";

  const C = window.EscapeCommon;
  const ROOMS = window.ROOMS || [];
  const TOTAL = ROOMS.length;
  const STORE_KEY = "artEscape.v1";
  const MAX_DIGITS = 3;
  const HINT_AT = [2, 4]; // 오답 몇 회부터 힌트 1, 2가 열리는지

  const $ = (id) => document.getElementById(id);
  const screens = {
    intro: $("screen-intro"),
    room: $("screen-room"),
    escape: $("screen-escape"),
  };

  let state = null; // { name, room, startAt, endAt, wrong[], hints[] }
  let input = "";
  let busy = false;
  let timerId = null;

  /* ---------- 저장 ---------- */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (s && typeof s.name === "string" && Number.isInteger(s.room)) return s;
    } catch (e) { /* 무시 */ }
    return null;
  }
  function clear() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ }
  }

  function newState(name) {
    return {
      name: C.normName(name),
      room: 0,
      startAt: Date.now(),
      endAt: null,
      wrong: ROOMS.map(() => 0),
      hints: ROOMS.map(() => 0),
    };
  }

  /* ---------- 화면 전환 ---------- */
  function show(name) {
    Object.entries(screens).forEach(([k, el]) => { el.hidden = k !== name; });
    window.scrollTo(0, 0);
  }

  function showIntro() {
    const saved = load();
    const box = $("resume-box");
    if (saved && saved.room < TOTAL) {
      $("resume-text").textContent = `${saved.name} 님, ${saved.room + 1}번째 전시실에서 멈춰 있어요.`;
      box.hidden = false;
    } else if (saved && saved.room >= TOTAL) {
      $("resume-text").textContent = `${saved.name} 님은 이미 탈출했어요.`;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    // 진행 중인 기록이 있으면 새 입장 양식은 숨기고 "이어 하기 / 처음부터"만 보여 줌
    $("start-form").hidden = !box.hidden;
    stopTimer();
    show("intro");
  }

  function startTimer() {
    stopTimer();
    const tick = () => { $("timer").textContent = C.formatTime(Date.now() - state.startAt); };
    tick();
    timerId = setInterval(tick, 1000);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  /* ---------- 전시실 ---------- */
  function renderProgress() {
    const ol = $("progress");
    ol.innerHTML = "";
    for (let i = 0; i < TOTAL; i++) {
      const li = document.createElement("li");
      li.textContent = String(i + 1);
      if (i < state.room) li.className = "done";
      else if (i === state.room) li.className = "now";
      ol.appendChild(li);
    }
  }

  function renderHints() {
    const i = state.room;
    const wrong = state.wrong[i];
    const used = state.hints[i];
    const r = ROOMS[i];
    [1, 2].forEach((n) => {
      const btn = $(`btn-hint${n}`);
      const need = HINT_AT[n - 1];
      const open = wrong >= need && used >= n - 1;
      btn.disabled = !open || used >= n;
      btn.classList.toggle("used", used >= n);
      if (used >= n) btn.textContent = `힌트 ${n} 사용함`;
      else if (wrong < need) btn.textContent = `힌트 ${n} · 오답 ${need - wrong}회 더`;
      else btn.textContent = `힌트 ${n} 보기`;
    });
    const list = $("hint-list");
    list.innerHTML = "";
    if (used >= 1) addHint(list, r.hint1);
    if (used >= 2) addHint(list, r.hint2);
  }
  function addHint(list, text) {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  }

  function renderRoom() {
    const i = state.room;
    const r = ROOMS[i];
    $("room-no").textContent = `전시실 ${i + 1} / ${TOTAL}`;
    $("room-name").textContent = r.name;
    $("room-scene").textContent = r.scene;
    $("room-question").textContent = r.question;
    input = "";
    renderInput();
    setMessage("교과서에서 찾은 쪽 번호를 입력하세요.");
    renderProgress();
    renderHints();
    show("room");
    startTimer();
  }

  function renderInput() { $("display").textContent = input; }

  function setMessage(text, bad) {
    const m = $("message");
    m.textContent = text;
    m.classList.toggle("bad", !!bad);
  }

  function press(key) {
    if (busy || screens.room.hidden || !$("door").hidden) return;
    if (/^\d$/.test(key)) {
      if (input.length >= MAX_DIGITS) return;
      if (input === "" && key === "0") return;
      input += key;
      renderInput();
    } else if (key === "back") {
      input = input.slice(0, -1);
      renderInput();
    } else if (key === "enter") {
      submit();
    }
  }

  async function submit() {
    if (!input) { setMessage("숫자를 먼저 눌러 주세요.", true); return; }
    busy = true;
    setKeypadDisabled(true);
    const i = state.room;
    let ok = false;
    try {
      ok = (await C.answerHash(i + 1, input)) === ROOMS[i].hash;
    } catch (e) {
      setMessage("이 브라우저에서는 자물쇠를 열 수 없어요. 크롬이나 엣지로 열어 주세요.", true);
      busy = false;
      setKeypadDisabled(false);
      return;
    }
    if (ok) {
      openDoor();
    } else {
      state.wrong[i] += 1;
      save();
      const card = $("room-card");
      card.classList.remove("shake");
      void card.offsetWidth; // 애니메이션 재시작
      card.classList.add("shake");
      const w = state.wrong[i];
      const next = HINT_AT.find((n) => n > w);
      let msg = `${input}쪽이 아니었다. 문이 꿈쩍도 하지 않는다.`;
      if (HINT_AT.includes(w)) msg += " 힌트가 열렸어요!";
      else if (next) msg += ` (힌트까지 오답 ${next - w}회)`;
      setMessage(msg, true);
      input = "";
      renderInput();
      renderHints();
    }
    busy = false;
    setKeypadDisabled(false);
  }

  function setKeypadDisabled(v) {
    document.querySelectorAll("#keypad button").forEach((b) => { b.disabled = v; });
  }

  function openDoor() {
    const i = state.room;
    const last = i === TOTAL - 1;
    $("door-title").textContent = last ? "마지막 문이 열렸다!" : `${input}쪽, 문이 열렸다!`;
    $("door-found").textContent = ROOMS[i].found;
    $("btn-next").textContent = last ? "미술관 밖으로" : "다음 전시실로";
    state.room += 1;
    if (state.room >= TOTAL) state.endAt = Date.now();
    save();
    $("door").hidden = false;
    $("btn-next").focus();
  }

  function next() {
    $("door").hidden = true;
    if (state.room >= TOTAL) showEscape();
    else renderRoom();
  }

  /* ---------- 탈출 ---------- */
  async function showEscape() {
    stopTimer();
    const time = C.formatTime((state.endAt || Date.now()) - state.startAt);
    const wrong = state.wrong.reduce((a, b) => a + b, 0);
    const hints = state.hints.reduce((a, b) => a + b, 0);
    $("r-name").textContent = state.name;
    $("r-time").textContent = time;
    $("r-wrong").textContent = `${wrong}회`;
    $("r-hints").textContent = `${hints}회`;
    $("r-code").textContent = "······";
    show("escape");
    try {
      $("r-code").textContent = await C.escapeCode(state.name, time);
    } catch (e) {
      $("r-code").textContent = "오류";
    }
  }

  function resetAll() {
    if (!confirm("처음부터 다시 할까요? 지금까지의 기록이 사라집니다.")) return;
    clear();
    state = null;
    $("door").hidden = true;
    $("player-name").value = "";
    showIntro();
  }

  function resume() {
    state = load();
    if (!state) { showIntro(); return; }
    if (state.room >= TOTAL) showEscape();
    else renderRoom();
  }

  /* ---------- 이벤트 ---------- */
  $("start-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = C.normName($("player-name").value);
    if (!name) { $("player-name").focus(); return; }
    state = newState(name);
    save();
    renderRoom();
  });

  $("btn-resume").addEventListener("click", resume);
  ["btn-reset-intro", "btn-reset-room", "btn-reset-escape"].forEach((id) => $(id).addEventListener("click", resetAll));
  $("btn-next").addEventListener("click", next);

  $("keypad").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (btn) press(btn.dataset.key);
  });

  [1, 2].forEach((n) => {
    $(`btn-hint${n}`).addEventListener("click", () => {
      const i = state.room;
      if (state.hints[i] !== n - 1 || state.wrong[i] < HINT_AT[n - 1]) return;
      state.hints[i] = n;
      save();
      renderHints();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT") return;
    if (!$("door").hidden && e.key === "Enter") { e.preventDefault(); next(); return; }
    if (screens.room.hidden) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
    else if (e.key === "Enter") { e.preventDefault(); press("enter"); }
  });

  /* ---------- 시작 ---------- */
  showIntro(); // 저장된 진행이 있으면 "이어 하기 / 처음부터"를 함께 보여 줌
})();
