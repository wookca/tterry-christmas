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
const STEP_FILES = Array.from({ length: 4 }, (_, i) => `sounds/snow_step_${String(i + 1).padStart(2, '0')}.mp3`);
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

// 뽀드득: 여러 발소리 중 하나를, 높낮이를 살짝 바꿔서 재생. volume 0~1 (1 = 내 발소리)
// 녹음은 천천히 걷는 소리라 한 발이 길어서, 게임 걸음 박자(한 발 약 0.2초)에 맞게 앞부분만 짧게 쓰고 끝을 빠르게 줄임.
// 내 발소리는 새 발이 나오면 앞 발소리를 바로 줄여서 겹치지 않게 하고, 다른 사람 발소리는 동시에 3개까지만
const PLAY_LEN = 0.13;   // 한 발에 쓰는 길이 (초). 매 발(약 0.2초마다) 짧게 → 가벼운 발걸음
const FADE_LEN = 0.05;   // 끝에서 줄어드는 시간
let lastStep = -1;
let myVoice = null;
let otherVoices = 0;
export function playStep(volume = 1) {
  if (!on || !ctx || ctx.state !== 'running' || volume <= 0.01) return;
  loadSteps();
  if (!steps.length) return;
  const mine = volume >= 1;
  if (!mine && otherVoices >= 3) return;
  let k = Math.floor(Math.random() * steps.length);
  if (k === lastStep && steps.length > 1) k = (k + 1) % steps.length; // 같은 소리 연속 안 나게
  lastStep = k;
  const t = ctx.currentTime;
  if (mine && myVoice) { // 앞 발소리는 0.03초 만에 줄이고 멈춤
    myVoice.g.gain.cancelScheduledValues(t);
    myVoice.g.gain.setValueAtTime(myVoice.g.gain.value, t);
    myVoice.g.gain.linearRampToValueAtTime(0, t + 0.03);
    try { myVoice.src.stop(t + 0.035); } catch {}
  }
  const src = ctx.createBufferSource();
  src.buffer = steps[k];
  const rate = 1.25 + Math.random() * 0.1; // 음을 올려서 가볍게 (작은 발), 매번 살짝 다르게
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  const vol = 0.42 * volume * (0.7 + Math.random() * 0.45); // 발소리는 장식: 은은하게. 발마다 세기를 조금씩 다르게
  g.gain.setValueAtTime(vol, t);
  g.gain.setValueAtTime(vol, t + PLAY_LEN - FADE_LEN);
  g.gain.linearRampToValueAtTime(0, t + PLAY_LEN);
  src.connect(g).connect(master);
  src.start(t, 0, (PLAY_LEN + 0.02) * rate);
  if (mine) {
    const v = { src, g };
    myVoice = v;
    src.onended = () => { if (myVoice === v) myVoice = null; };
  } else {
    otherVoices++;
    src.onended = () => { otherVoices--; };
  }
}
