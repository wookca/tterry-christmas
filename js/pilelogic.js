// ─────────────────────────────────────────────
// 눈무더기 규칙 (게임과 서버가 같이 씀 → 서버 server/worker.js 도 이 파일을 불러옴)
// - 맵마다 최대 개수만큼 놓임
// - 누가 집으면 사라지고, REGROW 초 뒤 맵 안 다른 빈 자리에서 새로 자라남
// ─────────────────────────────────────────────
export const PILE_MAX_SMALL = 12;  // 숲(홀수 채널) 최대 개수
export const PILE_MAX_BIG = 20;    // 큰 숲(짝수 채널) 최대 개수
export const REGROW_MIN = 20;      // 다시 자라나기까지 (초)
export const REGROW_MAX = 35;
export const PILE_GAP = 3.5;       // 더미 사이 최소 간격
export const PILE_TAKE_RANGE = 3;  // 서버가 '가까이 있다'고 인정하는 거리 (위치 전송 지연 감안해 넉넉히)

export function maxPilesForChannel(ch) { return ch % 2 === 0 ? PILE_MAX_BIG : PILE_MAX_SMALL; }

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 빈 자리 하나 뽑기 (다른 더미·피할 점과 겹치지 않게). 못 찾으면 null
// avoid: [{x, z}] 사람 위치 등 (바로 발밑에서 자라지 않게)
export function placePile(piles, radius, rand, avoid = []) {
  for (let tries = 0; tries < 60; tries++) {
    const r = 3 + Math.sqrt(rand()) * Math.max(1, radius - 5.5);
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (piles.some((p) => p.up && (p.x - x) ** 2 + (p.z - z) ** 2 < PILE_GAP * PILE_GAP)) continue;
    if (avoid.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 4)) continue;
    return {
      x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100,
      s: Math.round((0.55 + Math.pow(rand(), 1.4) * 1.0) * 100) / 100, // 크기 0.55~1.55배 (작은 게 조금 더 많게)
      v: Math.floor(rand() * 3),                                         // 모양 3가지 중 하나
      yaw: Math.round(rand() * 628) / 100,
    };
  }
  return null;
}

export function makePiles(count, radius, rand) {
  const piles = [];
  for (let id = 1; id <= count; id++) {
    const spot = placePile(piles, radius, rand);
    if (spot) piles.push({ id, ...spot, up: true, at: 0 });
  }
  return piles;
}

export function regrowDelay(rand) { return (REGROW_MIN + rand() * (REGROW_MAX - REGROW_MIN)) * 1000; }

// 시간이 된 더미를 새 자리에 다시 놓음. 새로 자란 더미 목록을 돌려줌
export function regrowDue(piles, radius, now, rand, avoid = []) {
  const grown = [];
  for (const p of piles) {
    if (p.up || now < p.at) continue;
    const spot = placePile(piles, radius, rand, avoid);
    if (!spot) { p.at = now + 3000; continue; } // 자리가 없으면 조금 뒤 다시
    Object.assign(p, spot, { up: true, at: 0 });
    grown.push(p);
  }
  return grown;
}

export function publicPile(p) { return { id: p.id, x: p.x, z: p.z, s: p.s, v: p.v, yaw: p.yaw }; }
