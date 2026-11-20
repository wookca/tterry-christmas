// ─────────────────────────────────────────────
// 채널 기록 창 (왼쪽 위 버튼): 누가 언제 들어왔는지, 닉네임을 어떻게 바꿨는지, 언제 나갔는지
// 서버(v7 이상)는 들어올 때 이 채널의 최근 기록을 같이 보내줌. 옛 서버면 내가 들어온 뒤의 일만 보임
// ─────────────────────────────────────────────
const RE_WINDOW = 15000; // 이 안에 같은 사람이 다시 접속하면 "나감"을 지우고 "닉네임 변경"으로 (서버와 같은 값)
const LEAVE_HOLD = 2500; // 나감은 잠깐 기다렸다 보여줌 (떼리앙·닉네임을 바꾸면 나갔다 바로 다시 들어오기 때문)
const MAX = 200;

const pad = (n) => String(n).padStart(2, '0');
function timeText(at) {
  const d = new Date(at), now = new Date();
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return d.toDateString() === now.toDateString() ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`;
}

export class JoinLog {
  constructor({ button, panel, list, title, close, myName }) {
    this.btn = button; this.panel = panel; this.list = list; this.title = title;
    this.myName = myName;
    this.entries = [];
    this.pending = new Map(); // 닉네임 → 나감 대기 타이머
    this.ch = 0;
    this.online = false;
    button.addEventListener('click', () => this.setOpen(this.panel.classList.contains('hidden')));
    close.addEventListener('click', () => this.setOpen(false));
    // 창 안을 눌러도 게임(이동·눈 모으기)에 전달되지 않게
    for (const ev of ['pointerdown', 'pointerup', 'wheel', 'touchstart']) panel.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    this.setupScrollbar(panel.querySelector('.log-track'));
    this.render();
  }

  // 오른쪽 스크롤바 (직접 그린 것): 위치 표시 + 끌거나 눌러서 이동
  setupScrollbar(track) {
    if (!track) return;
    const thumb = track.firstElementChild, list = this.list;
    this.updateBar = () => {
      const ratio = list.clientHeight / Math.max(1, list.scrollHeight);
      track.style.visibility = ratio >= 1 ? 'hidden' : '';
      const h = Math.max(24, track.clientHeight * ratio);
      const max = list.scrollHeight - list.clientHeight;
      thumb.style.height = `${h}px`;
      thumb.style.transform = `translateY(${max > 0 ? (list.scrollTop / max) * (track.clientHeight - h) : 0}px)`;
    };
    list.addEventListener('scroll', this.updateBar, { passive: true });
    window.addEventListener('resize', this.updateBar);
    const scrollTo = (clientY, grabOffset) => {
      const r = track.getBoundingClientRect(), h = thumb.offsetHeight;
      const t = Math.min(1, Math.max(0, (clientY - r.top - grabOffset) / Math.max(1, r.height - h)));
      list.scrollTop = t * (list.scrollHeight - list.clientHeight);
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const tr = thumb.getBoundingClientRect();
      const grab = e.target === thumb ? e.clientY - tr.top : thumb.offsetHeight / 2;
      scrollTo(e.clientY, grab);
      track.classList.add('dragging');
      track.setPointerCapture(e.pointerId);
      const move = (ev) => scrollTo(ev.clientY, grab);
      const up = () => { track.classList.remove('dragging'); track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
    });
  }

  get isOpen() { return !this.panel.classList.contains('hidden'); }
  setOpen(on) {
    this.panel.classList.toggle('hidden', !on);
    this.btn.classList.toggle('on', on);
    if (on) { this.btn.classList.remove('unread'); this.scrolled = false; this.render(); }
  }

  // 채널에 들어옴(또는 다시 접속함). serverLog가 있으면 서버 기록으로 채움
  welcome(ch, serverLog, serverNow, myName) {
    this.online = true;
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    if (Array.isArray(serverLog)) {
      const shift = Number.isFinite(serverNow) ? Date.now() - serverNow : 0; // 내 컴퓨터 시계와 서버 시계 차이
      this.entries = serverLog.filter((e) => e && e.k && e.n).map((e) => ({ k: e.k, n: String(e.n), o: e.o ? String(e.o) : '', at: (e.at || Date.now()) + shift }));
    } else if (ch !== this.ch) {
      this.entries = [{ k: 'join', n: myName, at: Date.now() }];
    } else if (this.lastMine && this.lastMine !== myName) {
      this.push({ k: 'rename', o: this.lastMine, n: myName });
    }
    this.ch = ch;
    this.lastMine = myName;
    this.render();
  }

  // 다른 사람이 들어옴. re = 그 사람이 바로 전에 쓰던 닉네임 (다시 접속한 경우)
  join(name, re, hadSameName) {
    let back = false;
    if (re) {
      if (this.pending.has(re)) { clearTimeout(this.pending.get(re)); this.pending.delete(re); back = true; }
      if (!back) {
        const now = Date.now();
        for (let i = this.entries.length - 1; i >= 0; i--) {
          const e = this.entries[i];
          if (now - e.at > RE_WINDOW) break;
          if (e.k === 'leave' && e.n === re) { this.entries.splice(i, 1); back = true; break; }
        }
      }
      if (!back) back = hadSameName; // 옛 연결이 아직 안 정리됨
    }
    if (!back) this.push({ k: 'join', n: name });
    else if (re !== name) this.push({ k: 'rename', o: re, n: name });
    else this.render();
  }

  // 다른 사람이 나감 (같은 닉네임이 아직 남아 있으면 끊긴 옛 연결이 정리된 것뿐이라 안 남김)
  leave(name, stillHere) {
    if (!name || stillHere) return;
    const at = Date.now();
    clearTimeout(this.pending.get(name));
    this.pending.set(name, setTimeout(() => { this.pending.delete(name); this.push({ k: 'leave', n: name, at }); }, LEAVE_HOLD));
  }

  offline() { this.online = false; this.render(); }

  push(e) {
    e.at ||= Date.now();
    this.entries.push(e);
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
    this.render();
  }

  render() {
    this.title.textContent = this.ch ? `채널 ${this.ch} 기록` : '채널 기록';
    if (!this.isOpen) return;
    const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 30;
    this.list.textContent = '';
    if (!this.entries.length) {
      const d = document.createElement('div');
      d.className = 'log-empty';
      d.textContent = this.online || this.ch ? '아직 기록이 없어요.' : '혼자 하기 모드예요. 온라인으로 접속하면 기록이 남아요.';
      this.list.appendChild(d);
      this.updateBar?.();
      return;
    }
    const me = this.myName();
    const b = (name) => { const s = document.createElement('b'); s.textContent = name; if (name === me) s.className = 'mine'; return s; };
    for (const e of this.entries) {
      const row = document.createElement('div');
      row.className = `log-row log-${e.k}`;
      const t = document.createElement('span');
      t.className = 'log-time';
      t.textContent = timeText(e.at);
      const msg = document.createElement('span');
      msg.className = 'log-msg';
      if (e.k === 'rename') msg.append(b(e.o), ' → ', b(e.n), ' 닉네임 변경');
      else msg.append(b(e.n), e.k === 'join' ? ' 들어옴' : ' 나감');
      row.append(t, msg);
      this.list.appendChild(row);
    }
    if (atBottom || !this.scrolled) { this.list.scrollTop = this.list.scrollHeight; this.scrolled = true; }
    this.updateBar?.();
  }
}
