// ─────────────────────────────────────────────
// 채팅: 아래쪽 입력창 + 왼쪽 아래 대화 기록 + 머리 위 말풍선
// 글은 떼리앙 말투(80% 정도 "떼")로 바뀌어서 보임 (바꾸는 건 서버가 함: js/ttespeak.js)
// ─────────────────────────────────────────────
import { CHAT_MAX, cleanChat } from './ttespeak.js';

const LOG_KEEP = 50;      // 기록에 남겨 둘 줄 수
const LINE_SHOW = 14000;  // 기록 한 줄이 보이는 시간 (그 뒤엔 흐려져 사라짐, 입력창을 누르면 다시 보임)
const SEND_GAP = 800;     // 연속으로 보낼 수 있는 간격 (서버도 막음)

export class Chat {
  // opts: { root, log, form, input, send(text), labelOf(id) → 이름표 DOM, onFocus() }
  constructor(opts) {
    this.o = opts;
    this.lastSend = 0;
    this.bubbles = new Map(); // id → { el, timer }
    const { form, input, root } = opts;
    input.maxLength = CHAT_MAX;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = cleanChat(input.value);
      if (!text) { if (!this.touch) input.blur(); return; }
      const now = performance.now();
      if (now - this.lastSend < SEND_GAP) return; // 너무 빨리: 글은 그대로 두고 잠깐 뒤에 다시
      this.lastSend = now;
      input.value = '';
      opts.send(text);
      if (!this.touch) input.blur(); // PC: 보내면 다시 방향키로 움직일 수 있게. 폰: 키보드 그대로 (이어서 말하기)
    });
    input.addEventListener('focus', () => { root.classList.add('open'); this.scrollEnd(); opts.onFocus?.(); });
    input.addEventListener('blur', () => root.classList.remove('open'));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 글자 치는 동안 WASD·스페이스가 게임 조작으로 가지 않게
      if (e.key === 'Escape') input.blur();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    root.addEventListener('pointerdown', () => { this.touch = matchMedia('(pointer: coarse)').matches; });
    // 게임 화면(바닥 등)을 누르면 입력 끝 (폰은 키보드가 내려감)
    document.addEventListener('pointerdown', (e) => { if (this.typing && !root.contains(e.target)) input.blur(); }, true);
    // 폰 키보드가 올라오면 입력창도 키보드 바로 위로 (화면이 밀리거나 가려지지 않게)
    const vv = window.visualViewport;
    if (vv) {
      const fit = () => {
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        root.style.setProperty('--kb', `${Math.round(kb)}px`);
        if (window.scrollY) window.scrollTo(0, 0);
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }
  }

  get typing() { return document.activeElement === this.o.input; }

  focus() { this.touch = false; this.o.input.focus(); }
  blur() { this.o.input.blur(); }

  scrollEnd() { const l = this.o.log; l.scrollTop = l.scrollHeight; }

  // 글 하나 받음: { id, name, text, mine }
  add(m) {
    const row = document.createElement('div');
    row.className = 'chat-row' + (m.mine ? ' mine' : '');
    const name = document.createElement('b');
    name.textContent = m.name || '';
    const text = document.createElement('span');
    text.textContent = m.text;
    row.append(name, text);
    const log = this.o.log;
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.appendChild(row);
    while (log.children.length > LOG_KEEP) log.firstChild.remove();
    if (atEnd || m.mine) this.scrollEnd();
    setTimeout(() => row.classList.add('old'), LINE_SHOW);
    this.bubble(m.id, m.text);
  }

  // 머리 위 말풍선: 이름표 위에 붙임 (이름표와 같이 움직임). 새 말을 하면 바뀜
  bubble(id, text) {
    const label = this.o.labelOf(id);
    if (!label) return;
    let b = this.bubbles.get(id);
    if (!b || b.label !== label) { b?.el.remove(); b = { el: document.createElement('div'), label }; b.el.className = 'bubble'; this.bubbles.set(id, b); }
    if (b.el.parentNode !== label) label.appendChild(b.el); // 이름표 글자가 바뀌면서 떨어졌으면 다시 붙임
    b.el.textContent = text;
    b.el.classList.remove('pop'); void b.el.offsetWidth; b.el.classList.add('pop');
    clearTimeout(b.timer);
    const ms = Math.min(9000, 3500 + Array.from(text).length * 120);
    b.timer = setTimeout(() => { b.el.remove(); this.bubbles.delete(id); }, ms);
  }

  // 채널을 옮기거나 끊기면 말풍선만 지움 (기록은 남겨 둠)
  clearBubbles() {
    for (const b of this.bubbles.values()) { clearTimeout(b.timer); b.el.remove(); }
    this.bubbles.clear();
  }
}
