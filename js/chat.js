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
    // 한글 입력: 글자를 조합하는 중에 Enter를 누르면 조합이 끝난 뒤에 보냄 (마지막 글자가 빠지거나 남지 않게)
    this.composing = false;
    this.sendAfterCompose = false;
    input.addEventListener('compositionstart', () => { this.composing = true; });
    input.addEventListener('compositionend', () => {
      this.composing = false;
      if (this.sendAfterCompose) { this.sendAfterCompose = false; setTimeout(() => form.requestSubmit(), 0); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.composing) { this.deferSend(); return; }
      const text = cleanChat(input.value);
      if (!text) { if (!this.touch) input.blur(); return; }
      const now = performance.now();
      if (now - this.lastSend < SEND_GAP) return; // 너무 빨리: 글은 그대로 두고 잠깐 뒤에 다시
      this.lastSend = now;
      input.value = '';
      opts.send(text);
      if (!this.touch) input.blur(); // PC: 보내면 다시 방향키로 움직일 수 있게. 폰: 키보드 그대로 (이어서 말하기)
    });
    input.addEventListener('focus', () => { root.classList.add('open'); this.scrollEnd(); opts.onFocus?.(); this.followKeyboard(); });
    input.addEventListener('blur', () => { root.classList.remove('open'); this.scrollEnd(); this.sendAfterCompose = false; });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 글자 치는 동안 WASD·스페이스가 게임 조작으로 가지 않게
      if (e.key === 'Escape') input.blur();
      if (e.key === 'Enter' && (e.isComposing || this.composing)) { e.preventDefault(); this.deferSend(); }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    // 보내기 버튼을 눌러도 입력창 초점(폰 키보드)이 그대로 있게
    form.querySelector('button')?.addEventListener('mousedown', (e) => { if (this.typing) e.preventDefault(); });
    root.addEventListener('pointerdown', () => { this.touch = matchMedia('(pointer: coarse)').matches; });
    // 게임 화면(바닥 등)을 누르면 입력 끝 (폰은 키보드가 내려감)
    document.addEventListener('pointerdown', (e) => { if (this.typing && !root.contains(e.target)) input.blur(); }, true);
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', () => this.fitKeyboard()); vv.addEventListener('scroll', () => this.fitKeyboard()); }
  }

  // 조합 중이면 조합이 끝날 때 보내고, 이미 끝났으면(순서가 반대인 키보드) 바로 보냄
  deferSend() {
    const form = this.o.form;
    setTimeout(() => {
      if (this.composing) this.sendAfterCompose = true;
      else form.requestSubmit();
    }, 0);
  }

  // 폰 키보드가 올라오면 입력창을 키보드 바로 위로: 실제로 보이는 화면(visualViewport)의 아래 끝에 맞춤
  // (키보드가 올라오는 동안·화면이 밀리는 동안 이벤트가 빠지는 폰이 있어서, 입력하는 동안은 매 프레임 맞춤)
  fitKeyboard() {
    const vv = window.visualViewport;
    const root = this.o.root;
    if (!vv) return;
    const kb = this.typing ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    if (kb !== this.kb) { this.kb = kb; root.style.setProperty('--kb', `${kb}px`); }
  }

  followKeyboard() {
    if (this.following) return;
    this.following = true;
    const tick = () => {
      this.fitKeyboard();
      if (this.typing) requestAnimationFrame(tick);
      else { this.following = false; this.fitKeyboard(); setTimeout(() => this.fitKeyboard(), 300); }
    };
    requestAnimationFrame(tick);
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
    b.el.classList.remove('pop', 'out'); void b.el.offsetWidth; b.el.classList.add('pop');
    clearTimeout(b.timer);
    // 머리 위에 오래 남김 (2026-11-25 요청): 6초 + 글자당 0.15초, 최대 14초. 사라질 때는 0.3초 페이드아웃
    const ms = Math.min(14000, 6000 + Array.from(text).length * 150);
    b.timer = setTimeout(() => {
      b.el.classList.add('out');
      b.timer = setTimeout(() => { b.el.remove(); if (this.bubbles.get(id) === b) this.bubbles.delete(id); }, 300);
    }, ms);
  }

  // 채널을 옮기거나 끊기면 말풍선만 지움 (기록은 남겨 둠)
  clearBubbles() {
    for (const b of this.bubbles.values()) { clearTimeout(b.timer); b.el.remove(); }
    this.bubbles.clear();
  }
}
