// 게임(index.html), 교사용 확인(verify.html), 해시 도구(tools/make-hash.html)가 함께 쓰는 함수
window.EscapeCommon = (function () {
  // SALT를 바꾸면 questions.js의 모든 hash를 다시 만들어야 합니다.
  const SALT = "misul-escape-2026";
  // SECRET을 바꾸면 이전에 발급된 인증 코드는 모두 무효가 됩니다.
  const SECRET = "night-museum-7f3a";

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // "007", " 7 " → "7"
  function normPage(value) {
    const digits = String(value).replace(/\D/g, "");
    if (!digits) return "";
    return String(parseInt(digits, 10));
  }

  function normName(name) {
    return String(name).trim().replace(/\s+/g, " ");
  }

  function answerHash(room, page) {
    return sha256(`${SALT}|${room}|${normPage(page)}`);
  }

  async function escapeCode(name, time) {
    const h = await sha256(`${normName(name)}|${String(time).trim()}|${SECRET}`);
    return h.slice(0, 6).toUpperCase();
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return { sha256, normPage, normName, answerHash, escapeCode, formatTime };
})();
