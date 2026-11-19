// ─────────────────────────────────────────────
// 온라인 접속 (Cloudflare 서버와 웹소켓)
// 서버가 없으면 혼자 하기 모드로 동작
// ─────────────────────────────────────────────
import { serverUrl } from './config.js';

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

export class Net {
  constructor(handlers) {
    this.h = handlers;       // { onWelcome, onJoin, onLeave, onState, onThrow, onStatus }
    this.ws = null;
    this.id = null;
    this.ch = 1;
    this.hello = null;
    this.closedByUs = false;
    this.retry = 0;
  }

  get connected() { return !!(this.ws && this.ws.readyState === 1 && this.id); }

  // 채널 1부터 차례로 시도. 꽉 차 있으면 다음 채널
  join(hello, ch = 1) {
    this.hello = hello;
    this.ch = ch;
    this.closedByUs = false;
    this.open();
  }

  open() {
    const base = serverUrl().replace(/^http/, 'ws'); // https → wss
    const ws = new WebSocket(`${base}/ws?ch=${this.ch}`);
    this.ws = ws;
    this.h.onStatus?.(`채널 ${this.ch} 접속 중…`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', ...this.hello() }));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      switch (m.t) {
        case 'welcome':
          this.id = m.id; this.retry = 0;
          // 살아 있다는 신호: 5초마다 (떼리앙 바꾸는 중처럼 움직임을 안 보낼 때도 연결이 유지되게)
          clearInterval(this.pinger);
          this.pinger = setInterval(() => { if (this.ws === ws && this.connected) ws.send('{"t":"ping"}'); }, 5000);
          if (m.ch) this.ch = m.ch;
          this.h.onWelcome?.(m);
          this.h.onStatus?.(null);
          break;
        case 'full':
          this.ch += 2; this.retry = 0; // 같은 맵의 다음 채널로 (홀수 = 눈밭, 짝수 = 숲)
          break; // 서버가 곧 끊음 → onclose에서 다음 채널로
        case 'join': this.h.onJoin?.(m.p); break;
        case 'leave': this.h.onLeave?.(m.id); break;
        case 'state': this.h.onState?.(m); break;
        case 'throw': this.h.onThrow?.(m); break;
        case 'hit': this.h.onHit?.(m); break;
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
      this.h.onStatus?.(`연결이 끊겼어요. 다시 접속하는 중…`);
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
