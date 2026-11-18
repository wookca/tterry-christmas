# Tterry Christmas (프로토타입)

흰 눈밭에서 떼리앙을 골라 걸어다니는 three.js 웹 게임입니다.

## 실행
- `start_game.bat` 더블클릭 → 브라우저가 http://localhost:8000/ 을 엽니다.
  (Python 또는 Node.js 필요. 브라우저 보안 때문에 index.html을 직접 더블클릭하면 모델이 안 불러와집니다.)
- VS Code의 Live Server로 index.html을 열어도 됩니다.

## 조작
- 마우스 왼쪽 짧게 클릭 / 탭: 그 위치로 걸어감 (오른쪽 클릭도 이동)
- 방향키 또는 WASD: 카메라 기준 이동
- 마우스 왼쪽 꾹 누르기 (가만히 서 있을 때): 링 게이지가 1초 차면 눈덩이를 손에 듦. 다 차기 전에 떼면 취소
- 눈덩이를 든 채 왼쪽 꾹 누르기: 마우스 쪽으로 조준선 + 파워 바 (1초면 MAX, 3m~12m) → 떼면 던짐
- 스페이스바: 왼쪽 꾹 누르기와 같음
- 마우스 가운데 드래그 / 한 손가락 드래그: 카메라 회전, 휠 / 핀치: 줌
- 눈덩이는 땅에 닿으면 3~5조각으로 부서지고 3초 뒤 사라짐 (`js/snowball.js`)
- 눈덩이에 맞으면 쓰러짐 (뒤에서 맞으면 앞으로, 앞에서 맞으면 뒤로). 아무 조작이나 하면 일어나고, 일어난 뒤 1초 동안은 안 쓰러짐

## 파일
- `index.html`, `css/style.css`, `js/main.js` : 게임 코드
- `lib/` : three.js r170 (오프라인용으로 포함)
- `models/` : 게임에서 쓰는 떼리앙 모델(glb)과 바꿔 끼우는 텍스처 (`CH_model/lowpoly/color` 정리본에서 가져옴)
- `CH_model/` : 원본 FBX (저장소에는 안 올라감)

## 떼리앙 추가
`js/main.js` 위쪽 `CHARACTERS` 목록에서 `ready: true`, `file: 'models/이름.glb'`, `unitScale: GLB_SCALE`을 채우면 됩니다.
(glb는 Y-up, 얼굴이 +Z. 재질 이름별로 부위가 나뉘어 있으면 부위 사이에 외곽선이 들어갑니다.)

### 같은 모델, 다른 무늬 (예: 양념포떼링 빨강/주황/초록/갈색)
모델 파일은 하나(`models/yangnyeom.glb`)만 쓰고, `variantMaterial: 'M_Card'` 재질의 텍스처만 `variants`의 PNG로 바꿔 끼웁니다.
새 색을 추가하려면 PNG를 `models/`에 넣고 `variants`에 한 줄 추가하면 됩니다.

## 참고
- 검은 외곽선은 화면 공간 방식(`js/outline.js`)이라 끊김 없이 그려지고, 팔·몸통 같은 부위 경계에도 선이 들어갑니다.
- 색은 `CH_guide`의 턴어라운드 시트를 보고 `js/paint.js`에서 부위별로 칠합니다 (FBX에 텍스처가 없어서).
포떼링.fbx 에는 뼈대·애니메이션·텍스처가 없어서 (회색 단일 메시) 걷기 모션은 코드로 만든 통통/뒤뚱 움직임입니다.
모델에 걷기 애니메이션이 들어간 FBX가 오면 그걸 쓰도록 바꿀 수 있습니다.

## 온라인 (여러 명이 같은 맵)
- 게임 파일: **GitHub Pages** → https://wookca.github.io/tterry-christmas/ (저장소: wookca/tterry-christmas)
- 실시간 서버: **Cloudflare Worker + Durable Object** (`server/worker.js`), 주소는 기본 `https://tterry-christmas.<계정>.workers.dev`. 도메인/DNS 설정 없음.
- 채널 하나에 최대 50명, 꽉 차면 다음 채널로 자동 입장. 위치/방향, 걷기·눈 모으기·눈덩이 들기·조준 상태, 던진 눈덩이, 닉네임을 주고받음.
- 서버 주소는 `js/config.js`의 `SERVER_URL`. 비워두면 혼자 하기 모드.

### 배포 순서
1. `deploy.bat` 실행 → Cloudflare 로그인 → 서버 배포. 마지막에 나오는 `https://….workers.dev` 주소를 복사.
2. `js/config.js`의 `SERVER_URL`에 그 주소를 넣기.
3. `wrangler.jsonc`의 `ALLOWED_ORIGINS`는 `https://wookca.github.io` 로 설정됨 → 다른 사이트에서는 서버에 접속 불가.
4. 이 폴더를 GitHub 저장소에 올리고 Settings → Pages → Branch: main / root 로 켜기. (`.gitignore` 때문에 원본 FBX·가이드는 안 올라감)

### 내 PC에서 여러 명 테스트
- `online_test.bat` → 게임 http://localhost:8000 + 서버 http://localhost:8787. 브라우저 창 여러 개로 접속. Node.js 필요.
- `start_game.bat` 은 서버 없이 혼자 하기.
