// ─────────────────────────────────────────────
// 눈 밟는 "뽀드득" 소리를 숫자로 직접 만들어 냄 (녹음 파일 없음)
// 실제 눈 밟는 소리 = 눌린 눈 알갱이가 수십 개 연달아 부서지는 소리.
//  - 뒤꿈치 → 앞꿈치 두 번에 나눠 눌리고 (두 덩어리)
//  - 덩어리마다 아주 짧은 "딱" 소리(알갱이 깨짐) 수십 개가 불규칙하게 겹치고
//  - 그중 일부는 "뽀득" 하고 울리는 짧은 마찰음(낮은 음이 금방 사라지는 울림)
// 매번 조금씩 다르게 몇 가지를 미리 만들어 두고 번갈아 씀
// ─────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function makeSnowStep(sampleRate, seed = 1) {
  const r = rng(seed * 7919 + 13);
  const dur = 0.26 + r() * 0.08;
  const n = Math.floor(sampleRate * dur);
  const out = new Float32Array(n);

  // 두 번 눌림 (뒤꿈치, 앞꿈치) 세기 곡선
  const humps = [
    { at: 0.012 + r() * 0.01, len: 0.07 + r() * 0.03, amp: 1.0 },
    { at: 0.09 + r() * 0.04, len: 0.11 + r() * 0.05, amp: 0.7 + r() * 0.3 },
  ];
  const env = (t) => {
    let e = 0;
    for (const h of humps) {
      const x = (t - h.at) / h.len;
      if (x > -0.3 && x < 1) e += h.amp * (x < 0 ? (1 + x / 0.3) : Math.pow(1 - x, 1.6));
    }
    return Math.max(0, e);
  };

  // 알갱이 깨지는 소리들
  const dt = 1 / sampleRate;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const e = env(t);
    if (e <= 0) continue;
    // 1초에 최대 약 1400번 정도 "딱"
    if (r() < 1400 * e * dt) {
      const a = e * (0.25 + r() * r() * 0.9);
      if (r() < 0.35) {
        // 뽀득: 짧게 울리는 마찰음 (500~1300Hz, 4~12ms)
        const f = 500 + r() * 800, decay = 0.004 + r() * 0.008;
        const len = Math.min(n - i, Math.floor(decay * 4 * sampleRate));
        const ph = r() * 6.28;
        for (let k = 0; k < len; k++) {
          const tt = k * dt;
          out[i + k] += a * 0.8 * Math.sin(ph + 6.2832 * f * tt * (1 - tt * 8)) * Math.exp(-tt / decay);
        }
      } else {
        // 사각: 아주 짧은 잡음 딱 (0.3~2ms)
        const decay = 0.0003 + r() * 0.0017;
        const len = Math.min(n - i, Math.floor(decay * 5 * sampleRate));
        for (let k = 0; k < len; k++) out[i + k] += a * (r() * 2 - 1) * Math.exp(-(k * dt) / decay);
      }
    }
  }
  // 밑에 깔리는 푹 눌리는 소리 (낮게 걸러낸 잡음)
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += 0.06 * ((r() * 2 - 1) - lp);
    out[i] += lp * env(i * dt) * 0.9;
  }
  // 날카로운 고음 살짝 깎고(디지털 느낌 줄이기), 직류 성분 제거
  let y = 0, hpPrev = 0, hpOut = 0;
  const lpk = 1 - Math.exp(-2 * Math.PI * 5200 / sampleRate);
  const hpk = Math.exp(-2 * Math.PI * 120 / sampleRate);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    y += lpk * (out[i] - y);
    hpOut = hpk * (hpOut + y - hpPrev); hpPrev = y;
    out[i] = hpOut;
    peak = Math.max(peak, Math.abs(hpOut));
  }
  // 끝 부분 살짝 페이드, 크기 맞춤
  const fade = Math.floor(0.01 * sampleRate);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= 0.85 / peak;
  return out;
}
