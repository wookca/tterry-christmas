// ─────────────────────────────────────────────
// 몸 움직임 (내 캐릭터 / 다른 플레이어 공통)
// 모델에 애니메이션이 없어서 코드로 만든 걸음·웅크리기·던지기 모션
// st: { walk, phase, crouch, throwT, dropT } 를 가진 상태 객체
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

  // 던지기: 앞으로 휙
  if (st.throwT < 1) {
    st.throwT = Math.min(1, st.throwT + dt / 0.35);
    const k = Math.sin(st.throwT * Math.PI);
    body.rotation.x += k * 0.4;
    body.rotation.y = -k * 0.5;
  } else {
    body.rotation.y = 0;
  }

  // 등장 연출: 살짝 위에서 통 떨어지기
  if (st.dropT < 1) {
    st.dropT = Math.min(1, st.dropT + dt * 2.2);
    const t = st.dropT;
    const bounce = Math.abs(Math.sin(t * Math.PI * 2.2)) * (1 - t);
    body.position.y += (1 - t) * (1 - t) * 3 + bounce * 0.6;
  }
}
