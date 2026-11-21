// ─────────────────────────────────────────────
// 온라인 접속 (Cloudflare 서버와 웹소켓)
// 서버가 없으면 혼자 하기 모드로 동작
// ─────────────────────────────────────────────
import { serverUrl, CLIENT_VER } from './config.js';

export async function detectServer() {
  try {
    const base = serverUrl();
    if (!base) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base}/api/info`, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok ? j : null;
  } catch {
    return null;
  }
}

// 이 탭의 임의 번호: 채널 기록에서 내 줄만 빨갛게 (닉네임이 같은 다른 사람은 제외)
export const SESSION_ID = (() => {
  const make = () => Math.random().toString(36).slice(2, 12);
  try { let v = sessionStorage.getItem('tterrySid'); if (!v) { v = make(); sessionStorage.setItem('tterrySid', v); } return v; } catch { return make(); }
})();

export class Net {
  constructor(handlers) {
    this.h = handlers;       // { onWelcome, onJoin, onLeave, onState, onThrow, onStatus }
    this.ws = null;
    this.id = null;
    this.ch = 1;
    this.hello = null;
    this.closedByUs = false;
    this.retry = 0;
    this.watching = false;   // 떼리앙을 고르는 동안 미리 접속해서 채널 모습만 받아 둠 (나는 아직 안 들어감)
  }

  get connected() { return !!(this.ws && this.ws.readyState === 1 && this.id); }

  // 미리 접속: 다른 사람에게는 안 보이고, 채널의 다른 사람·눈무더기만 받아 둠 (떼리앙 고르는 동안)
  watch(ch = 1) {
    this.watching = true;
    this.ch = ch;
    this.closedByUs = false;
    this.open();
  }

  // 채널 1부터 차례로 시도. 꽉 차 있으면 다음 채널
  // 미리 접속해 둔 연결이 있으면 끊지 않고 그 연결로 바로 들어감 (입장이 빠름)
  join(hello, ch = 1) {
    this.hello = hello;
    this.closedByUs = false;
    const ws = this.ws;
    if (this.watching && ws && ws.readyState <= 1 && this.ch === ch) {
      this.watching = false;
      if (ws.readyState === 1) this.sendHello(ws); // 아직 연결 중이면 열리자마자 보냄 (onopen)
      return;
    }
    this.watching = false;
    this.ch = ch;
    this.open();
  }

  sendHello(ws) {
    // re: 이 채널에 바로 전에 쓰던 닉네임 (떼리앙·닉네임 바꾸기나 잠깐 끊겨서 다시 접속할 때) → 서버 기록에서 "나감+들어옴" 대신 "닉네임 변경"으로
    const re = this.lastCh === this.ch ? this.lastName : null;
    ws.send(JSON.stringify({ t: 'hello', ...this.hello(), sid: SESSION_ID, ...(re ? { re } : {}) }));
  }

  startPing(ws) {
    // 살아 있다는 신호: 5초마다 (떼리앙 바꾸는 중·미리 접속 중처럼 움직임을 안 보낼 때도 연결이 유지되게)
    clearInterval(this.pinger);
    this.pinger = setInterval(() => { if (this.ws === ws && ws.readyState === 1) ws.send('{"t":"ping"}'); }, 5000);
  }

  open() {
    const base = serverUrl().replace(/^http/, 'ws'); // https → wss
    const ws = new WebSocket(`${base}/ws?ch=${this.ch}&v=${CLIENT_VER}`);
    this.ws = ws;
    if (!this.watching) this.h.onStatus?.(`채널 ${this.ch} 접속 중…`);
    ws.onopen = () => {
      if (this.watching) { ws.send('{"t":"watch"}'); this.startPing(ws); }
      else this.sendHello(ws);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      switch (m.t) {
        case 'welcome':
          this.id = m.id; this.retry = 0;
          this.startPing(ws);
          if (m.ch) this.ch = m.ch;
          this.lastCh = this.ch; this.lastName = m.name;
          this.h.onWelcome?.(m);
          this.h.onStatus?.(null);
          break;
        case 'peek':
          // 미리 접속: 채널의 다른 사람·눈무더기 (나는 아직 안 들어감)
          this.retry = 0;
          if (m.ch) this.ch = m.ch;
          if (this.watching) this.h.onPeek?.(m);
          break;
        case 'old':
          // 서버가 "옛 화면"이라며 거절 → 다시 접속하지 않고 새로고침 안내
          this.closedByUs = true;
          this.h.onOld?.();
          break;
        case 'full':
          this.ch += 2; this.retry = 0; // 같은 맵의 다음 채널로 (홀수 = 눈밭, 짝수 = 숲)
          break; // 서버가 곧 끊음 → onclose에서 다음 채널로
        case 'join': this.h.onJoin?.(m.p, m.re); break;
        case 'leave': this.h.onLeave?.(m.id); break;
        case 'state': this.h.onState?.(m); break;
        case 'throw': this.h.onThrow?.(m); break;
        case 'hit': this.h.onHit?.(m); break;
        case 'pile': this.h.onPile?.(m); break;
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pinger);
      const wasIn = !!this.id;
      this.id = null;
      if (wasIn) this.h.onDisconnect?.();
      if (this.closedByUs) return;
      // 다시 접속 (꽉 찼으면 바로 다음 채널, 아니면 점점 길게 기다렸다가)
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      if (!this.watching) this.h.onStatus?.(`연결이 끊겼어요. 다시 접속하는 중…`);
      setTimeout(() => { if (!this.closedByUs) this.open(); }, delay);
    };
  }

  // 다른 채널로 옮기기
  switchTo(ch) {
    const old = this.ws;
    this.ws = null; this.id = null; this.ch = ch; this.retry = 0; this.closedByUs = false;
    if (old) { try { old.close(1000, 'switch'); } catch {} }
    this.open();
  }

  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }

  close() {
    clearInterval(this.pinger);
    this.closedByUs = true;
    if (this.ws) this.ws.close();
    this.ws = null;
    this.id = null;
  }
}

// 채널별 인원 [{ ch, players }]
export async function fetchChannels() {
  const base = serverUrl();
  if (!base) return null;
  const res = await fetch(`${base}/api/channels`, { cache: 'no-store' });
  if (!res.ok) return null;
  const j = await res.json();
  return j.channels || null;
}
