// ─────────────────────────────────────────────
// 소리: 눈 밟는 소리 (sounds/ 폴더의 녹음을 한 발짝씩 잘라 둔 것, 출처는 sounds/README.md)
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
  loadSteps();
}
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('keydown', unlock);

export function isSoundOn() { return on; }
export function setSoundOn(v) {
  on = v;
  try { localStorage.setItem('soundOn', v ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.02);
}

// 발소리 파일들: 처음 소리를 켤 때 한 번 불러둠
const STEP_FILES = Array.from({ length: 12 }, (_, i) => `sounds/snow_step_${String(i + 1).padStart(2, '0')}.mp3`);
let steps = null;
function loadSteps() {
  if (steps || !ctx) return;
  steps = [];
  for (const url of STEP_FILES) {
    fetch(url).then((r) => r.arrayBuffer())
      .then((b) => new Promise((ok, bad) => ctx.decodeAudioData(b, ok, bad)))
      .then((buf) => steps.push(buf))
      .catch((e) => console.warn('발소리 불러오기 실패', url, e));
  }
}

// 뽀드득: 여러 발소리 중 하나를, 높낮이를 살짝 바꿔서 재생. volume 0~1
let lastStep = -1;
let lastAt = 0;
export function playStep(volume = 1) {
  if (!on || !ctx || ctx.state !== 'running' || volume <= 0.01) return;
  loadSteps();
  if (!steps.length) return;
  if (volume >= 1 && ctx.currentTime - lastAt < 0.12) return; // 너무 촘촘하면 건너뜀
  let k = Math.floor(Math.random() * steps.length);
  if (k === lastStep && steps.length > 1) k = (k + 1) % steps.length; // 같은 소리 연속 안 나게
  lastStep = k;
  if (volume >= 1) lastAt = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = steps[k];
  src.playbackRate.value = 0.93 + Math.random() * 0.14;
  const g = ctx.createGain();
  g.gain.value = 0.6 * volume;
  src.connect(g).connect(master);
  src.start();
}
