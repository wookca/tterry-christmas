// ─────────────────────────────────────────────
// 온라인 서버 주소 설정
// Cloudflare에 서버를 배포하면 나오는 주소(…workers.dev)를 SERVER_URL에 넣어 주세요.
//   예) 'https://tterry-christmas.내계정.workers.dev'
// 비워두면 혼자 하기 모드. 내 PC(localhost)에서 열면 로컬 테스트 서버(8787)를 먼저 찾아봄.
// ─────────────────────────────────────────────
export const SERVER_URL = 'https://tterry-christmas.aepluginstorage.workers.dev';

// 게임 화면 버전 (서버 server/worker.js MIN_CLIENT 와 맞춤). 서버가 이보다 높은 버전을 요구하면 접속이 거절되고 새로고침 안내가 뜸
export const CLIENT_VER = 2;

export function serverUrl() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local) return 'http://localhost:8787';
  return SERVER_URL.replace(/\/+$/, '');
}
