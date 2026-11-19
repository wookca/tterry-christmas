import { makeSnowStep } from './snowstep.js';

// ─────────────────────────────────────────────
// 소리: 눈 밟는 "뽀드득" 소리를 그때그때 만들어 냄 (소리 파일 없음 → 저작권 걱정 없음)
// 브라우저는 처음 터치/클릭 전엔 소리를 막으니, 첫 입력 때 켬
// ─────────────────────────────────────────────
let ctx = null;
let master = null;
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

// 뽀드득: 미리 만들어 둔 여러 가지 중 하나를, 높낮이를 살짝 바꿔서 재생. volume 0~1
let steps = null;
let lastStep = -1;
export function playStep(volume = 1) {
  if (!on || !ctx || ctx.state !== 'running' || volume <= 0.01) return;
  if (!steps) {
    steps = [];
    for (let i = 0; i < 8; i++) {
      const data = makeSnowStep(ctx.sampleRate, i + 1);
      const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data, 0);
      steps.push(buf);
    }
  }
  let k = Math.floor(Math.random() * steps.length);
  if (k === lastStep) k = (k + 1) % steps.length; // 같은 소리 연속 안 나게
  lastStep = k;
  const src = ctx.createBufferSource();
  src.buffer = steps[k];
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const g = ctx.createGain();
  g.gain.value = 0.55 * volume;
  src.connect(g).connect(master);
  src.start();
}
