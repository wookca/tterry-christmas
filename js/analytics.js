// 구글 애널리틱스(GA4) 게임 이벤트
// - 자주 일어나는 일(눈덩이 던지기, 맞히기 등)은 하나하나 보내지 않고 모아서 play_summary 한 번으로 보냄
// - 처음 한 번만 의미 있는 일(첫 던지기, 첫 맞히기)은 따로 한 번씩 보냄
const gtag = (...args) => { try { window.gtag?.(...args); } catch {} };

export function track(name, params = {}) {
  gtag('event', name, params);
}

const counts = { throws: 0, hits_given: 0, times_hit: 0, pile_pickups: 0, tte: 0, tte_long: 0, chats: 0 };
const once = new Set();
let playMs = 0, playingSince = 0, lastFlushPlay = 0, wantPlaying = false;
let ctx = {}; // 요약에 같이 붙일 정보 (떼리앙, 채널 등)

export function setContext(c) { Object.assign(ctx, c); }

// 처음 한 번만 보내는 이벤트
export function trackOnce(name, params) {
  if (once.has(name)) return;
  once.add(name);
  track(name, { ...ctx, ...params });
}

export function count(key) {
  counts[key] = (counts[key] || 0) + 1;
  if (key === 'throws') trackOnce('first_throw');
  if (key === 'hits_given') trackOnce('first_hit');
}

// 게임 화면에 있는 동안만 노는 시간으로 셈 (선택 화면, 다른 탭에 가 있는 시간은 빼고)
export function setPlaying(on) {
  wantPlaying = on;
  pause(!on || document.visibilityState === 'hidden');
}
function pause(paused) {
  const now = performance.now();
  const on = !paused;
  if (on && !playingSince) playingSince = now;
  if (!on && playingSince) { playMs += now - playingSince; playingSince = 0; }
}

function currentPlayMs() {
  return playMs + (playingSince ? performance.now() - playingSince : 0);
}

// 지금까지 모은 횟수를 보내고 0으로 되돌림 (노는 시간은 지난번 보낸 뒤로 늘어난 만큼)
function flush() {
  const total = currentPlayMs();
  const sec = Math.round((total - lastFlushPlay) / 1000);
  const any = sec > 0 || Object.values(counts).some((n) => n > 0);
  if (!any) return;
  lastFlushPlay = total;
  track('play_summary', { ...ctx, play_seconds: sec, ...counts, transport_type: 'beacon' });
  for (const k in counts) counts[k] = 0;
}

// 창을 닫거나 다른 탭으로 갈 때 보냄. 오래 켜 둔 사람도 있으니 5분마다도 한 번
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { pause(true); flush(); }
  else if (wantPlaying) pause(false);
});
window.addEventListener('pagehide', flush);
setInterval(flush, 5 * 60 * 1000);
