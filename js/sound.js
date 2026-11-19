// ─────────────────────────────────────────────
// 소리: 눈 밟는 "소복" 소리를 그때그때 만들어 냄 (소리 파일 없음 → 저작권 걱정 없음)
// 브라우저는 처음 터치/클릭 전엔 소리를 막으니, 첫 입력 때 켬
// ─────────────────────────────────────────────
let ctx = null;
let master = null;
let noise = null;
let on = true;
try { on = localStorage.getItem('soundOn') !== '0'; } catch {}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = on ? 1 : 0;
  master.connect(ctx.destination);
  // 0.5초짜리 흰 잡음을 한 번 만들어 두고 매번 일부만 꺼내 씀
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}
function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('keydown', unlock);

export function isSoundOn() { return on; }
export function setSoundOn(v) {
  on = v;
  try { localStorage.setItem('soundOn', v ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.02);
}

// 소복: 낮게 눌리는 소리 + 사각거리는 알갱이 몇 개. volume 0~1
export function playStep(volume = 1) {
  if (!on || !ctx || ctx.state !== 'running' || volume <= 0.01) return;
  const t = ctx.currentTime;
  const v = 0.22 * volume;
  // 1) 푹 눌리는 낮은 소리
  hit(t, 0.11, 520 + Math.random() * 180, 1.2, v * 0.9, 'lowpass');
  // 2) 사각사각 알갱이
  const grains = 3 + Math.floor(Math.random() * 3);
  for (let g = 0; g < grains; g++) {
    hit(t + 0.01 + Math.random() * 0.07, 0.025 + Math.random() * 0.03,
      1800 + Math.random() * 2600, 2.5, v * (0.25 + Math.random() * 0.3), 'bandpass');
  }
}
function hit(when, dur, freq, q, gain, type) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + Math.min(0.012, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f).connect(g).connect(master);
  src.start(when, Math.random() * 0.4, dur + 0.02);
}
