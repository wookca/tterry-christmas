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

// 땅 상태: 위치마다 천천히 바뀌는 값(0~1). 같은 곳은 같은 느낌, 몇 걸음 가면 바뀜
// (어떤 곳은 쌓인 눈이 폭신해서 낮고 작게, 어떤 곳은 다져진 눈이라 높고 또렷하게)
function hash(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
function smooth(t) { return t * t * (3 - 2 * t); }
function ground(x, z) {
  const fx = Math.floor(x), fz = Math.floor(z), u = smooth(x - fx), v = smooth(z - fz);
  const a = hash(fx, fz), b = hash(fx + 1, fz), c = hash(fx, fz + 1), d = hash(fx + 1, fz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// 뽀드득: 여러 발소리 중 하나를 골라 재생. volume 0~1 (1 = 내 발소리), pos = 밟은 위치
// 녹음은 천천히 걷는 소리라 앞부분만 짧게 쓰고 끝을 빠르게 줄임.
// 같은 소리가 같은 박자로 반복되면 메아리처럼 들려서, 매 발 높이·세기·음색·시작점·박자를 조금씩 흔듦
const PLAY_LEN = 0.13;   // 한 발에 쓰는 길이 (초)
const FADE_LEN = 0.05;   // 끝에서 줄어드는 시간
let lastStep = -1;
let myVoice = null;
let otherVoices = 0;
export function playStep(volume = 1, pos = null) {
  if (!on || !ctx || ctx.state !== 'running' || volume <= 0.01) return;
  loadSteps();
  if (!steps.length) return;
  const mine = volume >= 1;
  if (!mine && otherVoices >= 3) return;
  let k = Math.floor(Math.random() * steps.length);
  if (k === lastStep && steps.length > 1) k = (k + 1 + Math.floor(Math.random() * (steps.length - 1))) % steps.length; // 같은 소리 연속 안 나게
  lastStep = k;
  const gnd = pos ? ground(pos.x * 0.35, pos.z * 0.35) : Math.random(); // 약 3m마다 땅 느낌이 바뀜
  const t = ctx.currentTime + Math.random() * 0.03; // 박자를 0~30ms 흔들어서 기계적인 반복 느낌을 없앰
  if (mine && myVoice) { // 앞 발소리는 0.03초 만에 줄이고 멈춤
    myVoice.g.gain.cancelScheduledValues(t);
    myVoice.g.gain.setValueAtTime(myVoice.g.gain.value, t);
    myVoice.g.gain.linearRampToValueAtTime(0, t + 0.03);
    try { myVoice.src.stop(t + 0.035); } catch {}
  }
  const src = ctx.createBufferSource();
  src.buffer = steps[k];
  // 높이: 땅에 따라 ±8%, 발마다 ±6%
  const rate = 1.3 * (0.92 + gnd * 0.16) * (0.94 + Math.random() * 0.12);
  src.playbackRate.value = rate;
  // 음색: 폭신한 곳은 고음을 더 깎아서 먹먹하게, 다져진 곳은 또렷하게
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 3500 + gnd * 5500 + Math.random() * 1500;
  tone.Q.value = 0.5;
  // 세기: 땅에 따라 60~110%, 발마다 65~115%, 가끔(15%) 살짝 디딘 듯 아주 작게
  let vol = 0.42 * volume * (0.6 + gnd * 0.5) * (0.65 + Math.random() * 0.5);
  if (Math.random() < 0.15) vol *= 0.35;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.setValueAtTime(vol, t);
  g.gain.setValueAtTime(vol, t + PLAY_LEN - FADE_LEN);
  g.gain.linearRampToValueAtTime(0, t + PLAY_LEN);
  src.connect(tone).connect(g).connect(master);
  const offset = Math.random() * 0.025; // 시작점도 조금씩 다르게
  src.start(t, offset, (PLAY_LEN + 0.02) * rate);
  if (mine) {
    const v = { src, g };
    myVoice = v;
    src.onended = () => { if (myVoice === v) myVoice = null; };
  } else {
    otherVoices++;
    src.onended = () => { otherVoices--; };
  }
}
