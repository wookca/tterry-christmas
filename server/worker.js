// ─────────────────────────────────────────────
// Tterry Christmas 눈싸움 서버 (Cloudflare Worker + Durable Object)
//
//  /ws?ch=1     → 채널 1에 웹소켓 접속 (꽉 차면 서버가 "full"을 보내고 끊음 → 클라이언트가 다음 채널로)
//  /api/info    → 서버가 살아있는지 확인 (게임이 온라인 모드인지 판단할 때 사용)
//  /api/channels→ 채널별 인원
//
// 게임 파일은 GitHub Pages에 있고, 이 서버는 실시간 통신만 담당.
// 허용할 접속 주소(Origin)는 wrangler.jsonc 의 ALLOWED_ORIGINS 로 설정.
//
// 채널 하나 = Durable Object 하나. 같은 채널 사람들끼리만 서로 보임.
// ─────────────────────────────────────────────
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 50;   // 채널당 최대 인원
const MAX_CHANNELS = 20;  // 채널 수 상한
const WORLD_RADIUS = 30;
const MAX_MSG = 1024;     // 메시지 최대 크기(바이트)

// 접속을 허용할 주소인지 확인 (다른 사이트에서 몰래 붙는 것 방지)
function originAllowed(origin, env) {
  if (!origin) return true; // 브라우저가 아닌 접속(테스트 도구 등)
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (list.length === 0) return true; // 설정 안 했으면 모두 허용
  return list.includes(origin);
}
function cors(res, origin) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin || '*');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (!originAllowed(origin, env)) return new Response('forbidden origin', { status: 403 });

    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } }), origin);
    }

    if (url.pathname === '/api/info') {
      return cors(Response.json({ ok: true, maxPlayers: MAX_PLAYERS, maxChannels: MAX_CHANNELS }), origin);
    }

    if (url.pathname === '/api/channels') {
      const list = [];
      for (let i = 1; i <= MAX_CHANNELS; i++) {
        const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`ch-${i}`));
        const n = await stub.count();
        list.push({ ch: i, players: n });
        if (n === 0) break; // 빈 채널이 나오면 그 뒤는 볼 필요 없음
      }
      return cors(Response.json({ channels: list }), origin);
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const ch = Math.min(MAX_CHANNELS, Math.max(1, parseInt(url.searchParams.get('ch') || '1', 10) || 1));
      const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`ch-${ch}`));
      return stub.fetch(request);
    }

    return cors(new Response('Tterry Christmas server is running. 게임은 GitHub Pages 주소로 접속하세요.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }), origin);
  },
};

// 숫자 정리 (이상한 값이 들어와도 안전하게)
const num = (v, min, max, def = 0) => {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
};
const r2 = (v) => Math.round(v * 100) / 100;

export class Channel extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.nextId = 1;
    // 잠들었다 깨어난 경우, 붙어있는 소켓에서 id 최대값을 복구
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id >= this.nextId) this.nextId = a.id + 1;
    }
  }

  // 현재 인원 (hello까지 끝낸 사람만)
  async count() {
    return this.players().length;
  }

  players() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.joined) out.push({ ws, p: a });
    }
    return out;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const ch = parseInt(url.searchParams.get('ch') || '1', 10) || 1;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    if (this.players().length >= MAX_PLAYERS) {
      server.send(JSON.stringify({ t: 'full', ch }));
      server.close(4001, 'channel full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = this.nextId++;
    server.serializeAttachment({ id, ch, joined: false, lastThrow: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg, exceptId) {
    const s = JSON.stringify(msg);
    for (const { ws, p } of this.players()) {
      if (p.id === exceptId) continue;
      try { ws.send(s); } catch { /* 끊긴 소켓 */ }
    }
  }

  publicState(p) {
    return { id: p.id, name: p.name, char: p.char, x: p.x, z: p.z, yaw: p.yaw, m: p.m, g: p.g, b: p.b, a: p.a, d: p.d || 0 };
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const p = ws.deserializeAttachment();
    if (!p) return;

    switch (msg.t) {
      case 'hello': {
        if (p.joined) return;
        if (this.players().length >= MAX_PLAYERS) {
          ws.send(JSON.stringify({ t: 'full', ch: p.ch }));
          ws.close(4001, 'channel full');
          return;
        }
        p.joined = true;
        p.name = String(msg.name || '').replace(/[<>&"'`]/g, '').trim().slice(0, 12) || `눈사람${p.id}`;
        p.char = String(msg.char || 'potteling').replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
        p.x = num(msg.x, -WORLD_RADIUS, WORLD_RADIUS);
        p.z = num(msg.z, -WORLD_RADIUS, WORLD_RADIUS);
        p.yaw = num(msg.yaw, -10, 10);
        p.m = 0; p.g = 0; p.b = 0; p.a = 0; p.d = 0;
        ws.serializeAttachment(p);
        const others = this.players().filter((o) => o.p.id !== p.id).map((o) => this.publicState(o.p));
        ws.send(JSON.stringify({ t: 'welcome', id: p.id, ch: p.ch, name: p.name, players: others, max: MAX_PLAYERS }));
        this.broadcast({ t: 'join', p: this.publicState(p) }, p.id);
        return;
      }
      case 'state': {
        if (!p.joined) return;
        p.x = r2(num(msg.x, -WORLD_RADIUS, WORLD_RADIUS, p.x));
        p.z = r2(num(msg.z, -WORLD_RADIUS, WORLD_RADIUS, p.z));
        p.yaw = r2(num(msg.yaw, -10, 10, p.yaw));
        p.m = msg.m ? 1 : 0; // 걷는 중
        p.g = msg.g ? 1 : 0; // 눈 모으는 중
        p.b = msg.b ? 1 : 0; // 눈덩이 들고 있음
        p.a = msg.a ? 1 : 0; // 조준 중
        p.d = msg.d === 1 || msg.d === 2 ? msg.d : 0; // 눈에 맞아 쓰러짐 (1: 앞으로, 2: 뒤로)
        ws.serializeAttachment(p);
        this.broadcast({ t: 'state', id: p.id, x: p.x, z: p.z, yaw: p.yaw, m: p.m, g: p.g, b: p.b, a: p.a, d: p.d }, p.id);
        return;
      }
      case 'throw': {
        if (!p.joined) return;
        const now = Date.now();
        if (now - p.lastThrow < 300) return; // 너무 빠른 연속 던지기 방지
        p.lastThrow = now;
        ws.serializeAttachment(p);
        const t = {
          t: 'throw', id: p.id,
          fx: r2(num(msg.fx, -40, 40)), fy: r2(num(msg.fy, 0, 5)), fz: r2(num(msg.fz, -40, 40)),
          vx: r2(num(msg.vx, -40, 40)), vy: r2(num(msg.vy, -10, 30)), vz: r2(num(msg.vz, -40, 40)),
        };
        this.broadcast(t, p.id);
        return;
      }
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong', at: msg.at }));
        return;
    }
  }

  async webSocketClose(ws, code) {
    this.leave(ws);
    try { ws.close(code, 'bye'); } catch { /* 이미 닫힘 */ }
  }

  async webSocketError(ws) {
    this.leave(ws);
  }

  leave(ws) {
    const p = ws.deserializeAttachment();
    if (!p || !p.joined) return;
    p.joined = false;
    try { ws.serializeAttachment(p); } catch { /* 닫힌 소켓 */ }
    this.broadcast({ t: 'leave', id: p.id }, p.id);
  }
}
