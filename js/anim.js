// ─────────────────────────────────────────────
// 몸 움직임 (내 캐릭터 / 다른 플레이어 공통)
// 모델에 애니메이션이 없어서 코드로 만든 걸음·웅크리기·던지기 모션
// st: { walk, phase, crouch, throwT, throwSide, dropT } 를 가진 상태 객체
// ─────────────────────────────────────────────
export function animateBody(body, st, dt, moving, gathering) {
  // ── 걷기 모션 (모델에 애니메이션이 없어서 코드로 만든 걸음) ──
  st.walk += ((moving ? 1 : 0) - st.walk) * Math.min(1, dt * 10);
  st.phase += dt * (3 + 7 * st.walk) * 1.6;
  const w = st.walk;
  const sw = Math.sin(st.phase);
  const step = Math.abs(sw);

  body.position.y = step * 0.16 * w;                       // 통통 튀기
  body.rotation.z = sw * 0.14 * w;                          // 좌우 뒤뚱
  body.rotation.x = 0.1 * w + Math.cos(st.phase * 2) * 0.03 * w; // 앞으로 살짝 기울기
  const squash = 1 - (1 - step) * 0.06 * w;                // 착지할 때 살짝 눌림
  const breathe = 1 + Math.sin(performance.now() * 0.003) * 0.015 * (1 - w); // 가만히 있을 때 숨쉬기
  const wide = 1 / Math.sqrt(squash);
  body.scale.set(wide, squash * breathe, wide);

  // 눈 모으기: 웅크리고 꼼지락꼼지락
  st.crouch += ((gathering ? 1 : 0) - st.crouch) * Math.min(1, dt * 12);
  if (st.crouch > 0.001) {
    const c = st.crouch;
    const t = performance.now() * 0.02;
    body.scale.y *= 1 - 0.16 * c;
    body.scale.x *= 1 + 0.06 * c;
    body.scale.z *= 1 + 0.06 * c;
    body.rotation.x += 0.28 * c;
    body.rotation.z += Math.sin(t) * 0.06 * c;
  }

  // 던지기: 앞으로 휙. throwSide 1: 오른손(모델 -X 쪽), -1: 왼손(모델 +X 쪽) → 몸 비틀기를 좌우 반대로
  if (st.throwT < 1) {
    st.throwT = Math.min(1, st.throwT + dt / 0.35);
    const k = Math.sin(st.throwT * Math.PI);
    const side = st.throwSide === -1 ? -1 : 1;
    body.rotation.x += k * 0.4;
    body.rotation.y = k * 0.5 * side; // 던지는 손 쪽 어깨가 앞으로 나옴
  } else {
    body.rotation.y = 0;
  }

  // 떼리앙 누르기: 누르는 동안 꾹 눌리고, 떼면 띠용 늘어났다 출렁이며 돌아옴
  pokeMotion(body, st, dt);

  // 눈에 맞아 쓰러지기 (fallDir 1: 앞으로, -1: 뒤로). 발을 축으로 눕고, 몸 두께만큼 살짝 띄움
  if (st.fall === undefined) st.fall = 0;
  if (st.fallTarget === undefined) st.fallTarget = 0;
  if (st.fallDir === undefined) st.fallDir = 1;
  const fk = st.fallTarget > st.fall ? 9 : 5;           // 쓰러질 땐 빠르게, 일어날 땐 조금 천천히
  st.fall += (st.fallTarget - st.fall) * Math.min(1, dt * fk);
  if (st.fall > 0.001) {
    const f = st.fall;
    const keep = 1 - f;
    body.rotation.x = body.rotation.x * keep + st.fallDir * f * (Math.PI / 2 - 0.08);
    body.rotation.z *= keep;
    body.position.y = body.position.y * keep + f * 0.32;
    body.scale.set(1 + (body.scale.x - 1) * keep, 1 + (body.scale.y - 1) * keep, 1 + (body.scale.z - 1) * keep);
  }

  // 등장 연출: 살짝 위에서 통 떨어지기
  if (st.dropT < 1) {
    st.dropT = Math.min(1, st.dropT + dt * 2.2);
    const t = st.dropT;
    const bounce = Math.abs(Math.sin(t * Math.PI * 2.2)) * (1 - t);
    body.position.y += (1 - t) * (1 - t) * 3 + bounce * 0.6;
  }
}

// ─────────────────────────────────────────────
// 떼리앙 누르기 모션 (내 떼리앙 / 다른 플레이어 공통)
// st.pokeHold: 누르고 있음, st.pokeHeld: 누른 시간(초)
// pokePress(st) / pokeRelease(st, long) 으로 시작·끝. 용수철처럼 움직임 (s > 0: 눌림, s < 0: 늘어남)
// ─────────────────────────────────────────────
export const LONG_POKE = 0.32; // 이보다 오래 누르면 '길게 누르기' ("떼~")
export function pokePress(st) {
  st.pokeHold = true;
  st.pokeHeld = 0;
  st.pokeV = (st.pokeV || 0) + 1.5; // 누르는 순간 꾹
}
export function pokeRelease(st, long, silent = false) {
  if (!st.pokeHold) return;
  st.pokeHold = false;
  if (silent) return;            // 그냥 놓기 (카메라 돌리기로 바뀜 등): 천천히 돌아옴
  st.pokeLong = long;
  st.pokeWob = long ? 1 : 0.4;    // 떼고 나서 좌우로 흔들리는 정도
  st.pokeWobT = 0;
  st.pokeV = (st.pokeV || 0) - (long ? 4.5 : 2.5); // 띠용 위로 튀어 오름
}
function pokeMotion(body, st, dt) {
  if (st.pokeS === undefined) { st.pokeS = 0; st.pokeV = 0; st.pokeHold = false; st.pokeWob = 0; }
  if (!st.pokeHold && Math.abs(st.pokeS) < 0.001 && Math.abs(st.pokeV) < 0.01 && st.pokeWob < 0.01) { st.pokeS = 0; st.pokeV = 0; return; }
  let target = 0, k, c;
  if (st.pokeHold) {
    st.pokeHeld += dt;
    // 짧게 누르면 0.12만큼, 오래 누를수록 더 깊게(최대 0.2) 꾹 (2026-11-23 너무 젤리 같다고 해서 약하게)
    target = 0.12 + Math.min(1, Math.max(0, st.pokeHeld - 0.15) / 0.6) * 0.08;
    k = 700; c = 40;                     // 누를 땐 묵직하게
  } else if (st.pokeLong) {
    k = 500; c = 28;                     // 길게 누르고 떼면: 조금 더 늘어났다 한두 번 출렁
  } else {
    k = 900; c = 40;                    // 짧게 탭: 톡 튀고 바로 멈춤
  }
  const n = Math.ceil(dt / 0.004);       // 작게 나눠 계산해야 튀지 않음
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    st.pokeV += (-k * (st.pokeS - target) - c * st.pokeV) * h;
    st.pokeS += st.pokeV * h;
  }
  st.pokeS = Math.max(-0.45, Math.min(0.42, st.pokeS));
  const s = st.pokeS;
  // 위아래로 눌리면 옆으로 퍼짐 (부피를 비슷하게)
  body.scale.y *= 1 - s;
  const side = 1 + s * 0.55;
  body.scale.x *= side;
  body.scale.z *= side;
  // 오래 누르고 있으면 힘을 모으듯 부들부들
  if (st.pokeHold && st.pokeHeld > LONG_POKE) {
    const tr = Math.min(1, (st.pokeHeld - LONG_POKE) / 0.4);
    const t = performance.now() * 0.001;
    body.rotation.z += Math.sin(t * 55) * 0.014 * tr;
    body.scale.x *= 1 + Math.sin(t * 47) * 0.006 * tr;
  }
  // 늘어날 때 살짝 붕 떠오름 (길게 누르면 더 높이)
  if (s < 0) body.position.y += -s * (st.pokeLong ? 0.5 : 0.2);
  // 떼고 나서 좌우로 흔들흔들
  if (st.pokeWob > 0.01) {
    st.pokeWobT += dt;
    st.pokeWob *= Math.exp(-dt * (st.pokeLong ? 5 : 9));
    body.rotation.z += Math.sin(st.pokeWobT * (st.pokeLong ? 16 : 22)) * 0.04 * st.pokeWob;
  } else st.pokeWob = 0;
}
