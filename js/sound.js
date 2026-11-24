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
  loadVoice();
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
  // 높이: 땅에 따라 0~+8%, 발마다 ±4% (너무 낮게는 안 내려가게)
  const rate = 1.3 * (0.98 + gnd * 0.08) * (0.97 + Math.random() * 0.08);
  src.playbackRate.value = rate;
  // 음색: 폭신한 곳은 고음을 더 깎아서 먹먹하게, 다져진 곳은 또렷하게
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 5500 + gnd * 3500 + Math.random() * 1000;
  tone.Q.value = 0.5;
  // 세기 (2026-11-19 처음의 약 35%로 줄임): 땅에 따라 80~110%, 발마다 80~115%, 가끔(15%) 살짝 디딘 듯 조금 작게 (너무 작아지진 않게)
  let vol = 0.15 * volume * (0.8 + gnd * 0.3) * (0.8 + Math.random() * 0.35);
  if (Math.random() < 0.15) vol *= 0.65;
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

// ─────────────────────────────────────────────
// 눈 뭉치기·눈덩이 깨지기: 발소리와 같은 녹음을 써서 같은 눈 느낌이 나게 (전자음 X)
// ─────────────────────────────────────────────
function crunch({ rate, vol, len, cutoff, delay = 0, fade = 0.04 }) {
  const k = Math.floor(Math.random() * steps.length);
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = steps[k];
  src.playbackRate.value = rate;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = cutoff;
  tone.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.setValueAtTime(vol, t);
  g.gain.setValueAtTime(vol, t + len - fade);
  g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(tone).connect(g).connect(master);
  src.start(t, Math.random() * 0.02, (len + 0.02) * rate);
}
function ready() {
  if (!on || !ctx || ctx.state !== 'running') return false;
  loadSteps();
  return steps.length > 0;
}

// 눈 뭉치기: 손으로 꾹꾹 누르는 소리 (모으는 동안 여러 번). 손 안이라 고음을 깎아 먹먹하고 작게
export function playPack() {
  if (!ready()) return;
  crunch({ rate: 1.6 + Math.random() * 0.3, vol: 0.14 * (0.75 + Math.random() * 0.5), len: 0.1, cutoff: 3800 + Math.random() * 1200 });
}
// 다 뭉쳤을 때: 조금 더 단단하게 한 번 꾹
export function playPackDone() {
  if (!ready()) return;
  crunch({ rate: 1.15, vol: 0.2, len: 0.12, cutoff: 5000 });
  crunch({ rate: 1.7, vol: 0.1, len: 0.08, cutoff: 6000, delay: 0.015 });
}

// 눈덩이가 깨질 때: 낮은 퍽 + 높은 사각, 두 소리를 겹쳐 짧게. volume 0~1 (거리에 따라 줄임)
let shatterVoices = 0;
export function playShatter(volume = 1) {
  if (!ready() || volume <= 0.02 || shatterVoices >= 4) return;
  shatterVoices++;
  setTimeout(() => { shatterVoices--; }, 250);
  const v = 0.32 * volume * (0.85 + Math.random() * 0.3);
  crunch({ rate: 0.85 + Math.random() * 0.1, vol: v, len: 0.2, cutoff: 6500, fade: 0.1 });
  crunch({ rate: 1.45 + Math.random() * 0.2, vol: v * 0.6, len: 0.12, cutoff: 9000, delay: 0.012, fade: 0.06 });
}

// ─────────────────────────────────────────────
// 떼리앙 목소리: "떼" (가이드 음원에서 잘라 둔 짧은 소리 5개) + 길게 누르면 "떼~"
// 빠르게 여러 번 누르면 앞 소리를 아주 짧게 줄이고 바로 다음 "떼" → "떼떼떼"
// ─────────────────────────────────────────────
const TTE_FILES = Array.from({ length: 5 }, (_, i) => `sounds/tte_0${i + 1}.mp3`);
const TTE_LONG_FILE = 'sounds/tte_long.mp3';
let ttes = null, tteLong = null, ouches = null;
// 눈에 맞아 쓰러질 때 "떼엥" (가이드 음원의 떼를 높게 시작해 처지게 속도만 바꾼 것, 3개 중 랜덤)
const OUCH_FILES = Array.from({ length: 3 }, (_, i) => `sounds/ouch_0${i + 1}.mp3`);
function loadVoice() {
  if (ttes || !ctx) return;
  ttes = [];
  const get = (url) => fetch(url).then((r) => r.arrayBuffer())
    .then((b) => new Promise((ok, bad) => ctx.decodeAudioData(b, ok, bad)));
  for (const url of TTE_FILES) get(url).then((buf) => ttes.push(buf)).catch((e) => console.warn('떼 소리 불러오기 실패', url, e));
  ouches = [];
  for (const url of OUCH_FILES) get(url).then((buf) => ouches.push(buf)).catch((e) => console.warn('떼엥 소리 불러오기 실패', url, e));
  get(TTE_LONG_FILE).then((buf) => { tteLong = buf; }).catch((e) => console.warn('떼~ 소리 불러오기 실패', e));
}
window.addEventListener('pointerdown', () => { if (ctx) loadVoice(); }, { passive: true });

const TTE_VOL = 0.55;
const voices = new Map(); // 누구 목소리인지 (내 것: 'me') → 지금 나는 소리. 한 떼리앙은 한 번에 한 소리만
let lastTte = -1, lastOuch = -1;
let remoteTte = 0;
// long: 길게 눌렀다 뗀 "떼~", volume: 0~1 (다른 떼리앙은 거리만큼 줄임), combo: 연달아 누른 횟수 (살짝 높아짐)
export function playTte({ long = false, ouch = false, volume = 1, combo = 0, who = 'me' } = {}) {
  if (!on || !ctx || ctx.state === 'closed' || volume <= 0.02) return; // 막 켜는 중(suspended)이어도 예약해 두면 켜지자마자 남
  loadVoice();
  let buf;
  if (ouch) {
    if (!ouches.length) return;
    let k = Math.floor(Math.random() * ouches.length);
    if (k === lastOuch && ouches.length > 1) k = (k + 1) % ouches.length;
    lastOuch = k;
    buf = ouches[k];
  } else if (long) buf = tteLong;
  else if (ttes.length) {
    let k = Math.floor(Math.random() * ttes.length);
    if (k === lastTte && ttes.length > 1) k = (k + 1) % ttes.length; // 같은 소리 연속 안 나게
    lastTte = k;
    buf = ttes[k];
  }
  if (!buf) return;
  const mine = who === 'me';
  if (!mine && !voices.has(who) && remoteTte >= 4) return; // 다른 떼리앙 소리는 동시에 4개까지
  const t = ctx.currentTime;
  const prev = voices.get(who);
  if (prev) { // 앞 "떼"는 0.025초 만에 줄이고 멈춤 → 또박또박 "떼떼"
    prev.g.gain.cancelScheduledValues(t);
    prev.g.gain.setValueAtTime(prev.g.gain.value, t);
    prev.g.gain.linearRampToValueAtTime(0, t + 0.025);
    try { prev.src.stop(t + 0.03); } catch {}
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // 높이: 매번 ±3%, 연달아 누르면 조금씩 올라감 (최대 +10%). 떼~는 살짝 낮게 시작
  src.playbackRate.value = (long ? 0.97 : 1) * (0.97 + Math.random() * 0.06) * (1 + Math.min(combo, 4) * 0.025);
  const g = ctx.createGain();
  g.gain.value = TTE_VOL * volume * (long ? 1 : 0.9 + Math.random() * 0.15);
  src.connect(g).connect(master);
  src.start(t);
  const v = { src, g };
  if (!mine && !prev) remoteTte++;
  voices.set(who, v);
  src.onended = () => {
    if (voices.get(who) === v) { voices.delete(who); if (!mine) remoteTte--; }
  };
}
