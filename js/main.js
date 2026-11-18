import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintModel, labelParts } from './paint.js';
import { OutlinePass, enableOutline } from './outline.js';
import { animateBody } from './anim.js';
import { Net, detectServer } from './net.js';
import { RemotePlayers } from './remote.js';
import { SnowballSystem, makeBallMesh, solveThrow, GRAVITY } from './snowball.js';

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const WORLD_RADIUS = 30;          // 흰 평지 반지름
const SPAWN_RADIUS = 26;          // 외곽 스폰 거리 (중심에서)
const CHAR_HEIGHT = 1.3;          // 캐릭터 키 (월드 단위)
const MOVE_SPEED = 4.2;           // 초당 이동 거리
const TURN_SPEED = 10;            // 방향 전환 속도
const GATHER_TIME = 1.0;          // 눈 모으는 시간(초)
const CAM_DIST = 8.6, CAM_DIST_MIN = 3.5, CAM_DIST_MAX = 18; // 캐릭터와 카메라 거리
const CAM_PITCH = 0.65, CAM_PITCH_MIN = 0.12, CAM_PITCH_MAX = 1.35; // 내려다보는 각도(라디안)

// 캐릭터 목록. ready:false 는 "준비 중"으로 표시
// modelRotX: 모델이 Z-up으로 저장돼 있으면 -PI/2 로 세워줌
// outline: 검은 외곽선 그리기 여부
// modelYaw: 세운 뒤 얼굴이 +Z(앞)를 보도록 돌리는 각도
// glb 모델(CH_model/lowpoly/color 정리본): Y-up, 얼굴 +Z, 단위 cm → unitScale로 키를 서로 맞춤 (포떼링 124 = CHAR_HEIGHT)
// variants: 모델은 하나만 쓰고 재질 하나(material)의 텍스처만 바꿔 끼우는 버전들
const GLB_SCALE = CHAR_HEIGHT / 124.04;
const CHARACTERS = [
  { id: 'potteling', name: '포떼링', file: 'models/potteling.glb', ready: true, outline: true, unitScale: GLB_SCALE },
  { id: 'yangnyeom', name: '양념포떼링', file: 'models/yangnyeom.glb', ready: true, outline: true, unitScale: GLB_SCALE,
    variantMaterial: 'M_Card',
    variants: [
      { id: 'red', name: '빨강', color: '#d42a24', map: 'models/yangnyeom_card_red.png' },
      { id: 'orange', name: '주황', color: '#ff7a1a', map: 'models/yangnyeom_card_orange.png' },
      { id: 'green', name: '초록', color: '#4cb848', map: 'models/yangnyeom_card_green.png' },
      { id: 'brown', name: '갈색', color: '#8c2418', map: 'models/yangnyeom_card_brown.png' },
    ] },
  { id: 'neo', name: '너떼링', ready: false },
  { id: 'yangneo', name: '양너떼링', ready: false },
  { id: 'longchi', name: '롱치떼링', ready: false },
  { id: 'ppyeo', name: '뼈떼링', ready: false },
  { id: 'sof', name: '솦떼링', file: 'models/sof.glb', ready: true, outline: true, unitScale: GLB_SCALE },
  { id: 'sun', name: '썬떼링', ready: false },
  { id: 'ji', name: '지떼링', ready: false },
  { id: 'jing', name: '징떼링', ready: false },
  { id: 'chi', name: '치떼링', ready: false },
  { id: 'ko', name: '코떼링', ready: false },
  { id: 'cookie', name: '쿠키 토네떼링', ready: false },
  { id: 'ham', name: '햄떼링', ready: false },
  { id: 'hwa', name: '화떼링', ready: false },
  { id: 'wheel', name: '휠떼링', ready: false },
];

// ─────────────────────────────────────────────
// 기본 씬
// ─────────────────────────────────────────────
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);
const outline = new OutlinePass(renderer);

const scene = new THREE.Scene();
const SKY = new THREE.Color(0xe8f0f8);
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 35, 90);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d4e0, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(6, 14, 8);

// 흰 평지
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(WORLD_RADIUS, 96),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// 바깥 눈밭 (경계 밖, 그림자 없이 멀리까지)
const outer = new THREE.Mesh(
  new THREE.RingGeometry(WORLD_RADIUS, 120, 96),
  new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 1 })
);
outer.rotation.x = -Math.PI / 2;
outer.position.y = -0.01;
scene.add(outer);

// 경계 표시 (은은한 선)
const edge = new THREE.Mesh(
  new THREE.RingGeometry(WORLD_RADIUS - 0.12, WORLD_RADIUS, 128),
  new THREE.MeshBasicMaterial({ color: 0xc9d6e3, transparent: true, opacity: 0.8 })
);
edge.rotation.x = -Math.PI / 2;
edge.position.y = 0.005;
scene.add(edge);

// 내리는 눈
const SNOW_COUNT = 900;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(SNOW_COUNT * 3);
for (let i = 0; i < SNOW_COUNT; i++) {
  snowPos[i * 3] = (Math.random() - 0.5) * 50;
  snowPos[i * 3 + 1] = Math.random() * 20;
  snowPos[i * 3 + 2] = (Math.random() - 0.5) * 50;
}
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
  color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false,
}));
scene.add(snow);

// 클릭 목적지 표시
const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.28, 0.4, 40),
  new THREE.MeshBasicMaterial({ color: 0xd6343a, transparent: true, opacity: 0, depthWrite: false })
);
marker.rotation.x = -Math.PI / 2;
marker.position.y = 0.02;
scene.add(marker);

// 스폰 위치 표시 (선택 화면에서 보임)
const spawnGlow = new THREE.Mesh(
  new THREE.RingGeometry(0.5, 0.75, 48),
  new THREE.MeshBasicMaterial({ color: 0xd6343a, transparent: true, opacity: 0.7, depthWrite: false })
);
spawnGlow.rotation.x = -Math.PI / 2;
spawnGlow.position.y = 0.02;
scene.add(spawnGlow);

// ─────────────────────────────────────────────
// 플레이어
// ─────────────────────────────────────────────
// player(위치, 방향) → body(걷기 흔들림) → model
const player = new THREE.Group();
const body = new THREE.Group();
player.add(body);
player.visible = false;
scene.add(player);

const state = {
  playing: false,
  selectedId: null,
  spawn: new THREE.Vector3(),
  camYaw: 0,               // 카메라 방향 (드래그로 회전)
  camPitch: CAM_PITCH,
  camDist: CAM_DIST,
  target: null,            // 클릭 목적지
  keys: new Set(),
  walk: 0,                 // 0(정지) ~ 1(걷는 중)
  phase: 0,
  yaw: 0,
  dropT: 1,                // 등장 연출
  gathering: false,        // 눈 모으는 중
  gather: 0,               // 게이지 0~1
  crouch: 0,               // 웅크리기 모션 0~1
  wantGather: false,       // 모으기 버튼을 누르고 있음 (서 있으면 차오름)
  gatherPaused: false,
  aiming: false,           // 눈덩이 들고 조준 중
  power: 0,                // 던지기 파워 0~1
  hasBall: false,          // 손에 눈덩이를 들고 있음
  throwT: 1,               // 던지기 모션 0~1
};

// 손에 든 눈덩이 (캐릭터 오른손 위치)
const handBall = makeBallMesh();
handBall.position.set(-0.47, 0.34, 0.1);
handBall.visible = false;
body.add(handBall);
enableOutline(handBall, 200);

const snowballs = new SnowballSystem(scene);

function pickSpawn() {
  const a = Math.random() * Math.PI * 2;
  state.spawn.set(Math.cos(a) * SPAWN_RADIUS, 0, Math.sin(a) * SPAWN_RADIUS);
  // 카메라는 바깥쪽에서 중심을 바라보도록
  state.camYaw = Math.atan2(state.spawn.x, state.spawn.z);
  spawnGlow.position.set(state.spawn.x, 0.02, state.spawn.z);
}

// ─────────────────────────────────────────────
// 모델 불러오기
// ─────────────────────────────────────────────
const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
// 주소 끝에 ?lite 를 붙이면 시험용 경량 모델로 불러옴 (HUD 버튼으로 전환)
// 웹(GitHub Pages)에서는 원본 FBX를 올리지 않으므로 항상 경량 모델
let USE_LITE = new URLSearchParams(location.search).has('lite') || !['localhost', '127.0.0.1'].includes(location.hostname);
const modelCache = new Map();

// 버전(variant)이 있는 떼리앙: 모델은 한 번만 불러서 공유하고, 지정한 재질의 텍스처만 바꾼 복제본을 만든다
function defaultVariant(ch) { return ch.variants ? ch.variants[0].id : null; }
function loadCharacter(ch, variantId) {
  if (!ch.variants) return loadBaseCharacter(ch);
  const v = ch.variants.find((x) => x.id === variantId) || ch.variants[0];
  const key = `${ch.id}-${v.id}`;
  if (modelCache.has(key)) return modelCache.get(key);
  const p = Promise.all([loadBaseCharacter(ch), textureLoader.loadAsync(encodeURI(v.map))]).then(([base, tex]) => {
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const model = base.clone(true); // 지오메트리는 공유
    model.traverse((o) => {
      if (o.isMesh && o.material && o.material.name === ch.variantMaterial) {
        o.material = o.material.clone();
        o.material.map = tex;
        o.material.color.set(0xffffff);
      }
    });
    model.userData.clips = base.userData.clips;
    return model;
  });
  modelCache.set(key, p);
  return p;
}
// 네트워크로 주고받는 떼리앙 이름: "yangnyeom-red" 처럼 버전까지
function charCode(ch, variantId) { return ch.variants ? `${ch.id}-${variantId || defaultVariant(ch)}` : ch.id; }
function parseCharCode(code) {
  const [id, variant] = String(code || '').split('-');
  const ch = CHARACTERS.find((c) => c.id === id && c.ready) || CHARACTERS.find((c) => c.ready);
  return { ch, variant };
}

function loadBaseCharacter(ch) {
  if (modelCache.has(ch.id)) return modelCache.get(ch.id);
  const p = new Promise((resolve, reject) => {
    const file = USE_LITE && ch.liteFile ? ch.liteFile : ch.file;
    const isGltf = /\.(glb|gltf)$/i.test(file);
    (isGltf ? gltfLoader : fbxLoader).load(encodeURI(file), async (loaded) => {
     try {
      // 텍스처 이미지 파일을 따로 지정했으면 먼저 불러둠 (카드 썸네일이 까맣게 나오지 않게)
      const liteTex = USE_LITE && ch.liteTexture ? await textureLoader.loadAsync(encodeURI(ch.liteTexture)) : null;
      const fbx = isGltf ? loaded.scene : loaded;
      if (isGltf) fbx.animations = loaded.animations;
      let tris = 0;
      fbx.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      console.info(`[${ch.name}] ${file} · 삼각형 ${Math.round(tris).toLocaleString()}개`);
      ch.loadedInfo = `${USE_LITE && ch.liteFile ? '경량' : '원본'} · 삼각형 ${Math.round(tris).toLocaleString()}개`;
      const wrap = new THREE.Group();
      const turn = new THREE.Group();
      fbx.rotation.x = ch.modelRotX || 0;
      turn.rotation.y = ch.modelYaw || 0;
      turn.add(fbx);
      wrap.add(turn);

      const meshes = [];
      fbx.traverse((o) => { if (o.isMesh) meshes.push(o); });
      let nextPart = 0; // glb: 재질(부위)마다 부위 번호를 이어서 매김 → 부위 사이에 외곽선
      meshes.forEach((o) => {
        o.castShadow = true;
        o.receiveShadow = false; // 자기 그림자로 얼굴이 칙칙해지지 않게 (땅에는 그림자 그대로)
        const old = Array.isArray(o.material) ? o.material[0] : o.material;
        const textured = !!(old && old.map);
        // glb 안에 따로 색이 정해진 부위(눈·입 등)는 그 색 그대로
        const ownColor = isGltf && !textured;
        const painted = !textured && !ownColor && paintModel(ch.id, o); // 텍스처가 없으면 코드로 색 입히기 (정점 색)
        if (isGltf) nextPart += labelParts(o, nextPart);
        if (textured) {
          if (!isGltf) labelParts(o);
          // 텍스처 이미지 파일을 따로 지정했으면 그걸 사용 (이미지만 고쳐도 게임에 바로 반영)
          if (USE_LITE && ch.liteTexture) {
            const t = liteTex;
            t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
            old.map = t;
          }
        }
        o.material = new THREE.MeshStandardMaterial({
          name: old && old.name ? old.name : '',
          color: painted || (textured && !isGltf) ? 0xffffff : (old && old.color ? old.color.clone() : 0x808080),
          map: old && old.map ? old.map : null,
          vertexColors: !!o.geometry.attributes.color,
          roughness: 0.8,
          metalness: 0,
        });
      });

      // 크기 맞추고, 발바닥을 y=0, 가운데를 원점에
      wrap.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(wrap);
      const size = box.getSize(new THREE.Vector3());
      wrap.scale.setScalar(ch.unitScale || CHAR_HEIGHT / size.y);
      wrap.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(wrap);
      const c = box.getCenter(new THREE.Vector3());
      wrap.position.set(-c.x, -box.min.y, -c.z);

      const holder = new THREE.Group();
      holder.add(wrap);
      if (ch.outline) enableOutline(holder);
      holder.userData.clips = fbx.animations || [];
      resolve(holder);
     } catch (err) { reject(err); }
    }, (e) => {
      if (e.lengthComputable) setLoading(`떼리앙 불러오는 중… ${Math.round((e.loaded / e.total) * 100)}%`);
    }, reject);
  });
  modelCache.set(ch.id, p);
  return p;
}

// 카드 썸네일 (모델을 한 번 렌더링해서 이미지로)
function makeThumbnail(model) {
  const size = 176;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0xb8c6d6, 1.8));
  const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(2, 4, 5); s.add(d);
  const clone = model.clone(true);
  clone.rotation.y = -0.45;
  s.add(clone);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  cam.position.set(0, CHAR_HEIGHT * 0.95, CHAR_HEIGHT * 2.6);
  cam.lookAt(0, CHAR_HEIGHT * 0.45, 0);
  r.render(s, cam);
  const url = r.domElement.toDataURL('image/png');
  r.dispose();
  r.forceContextLoss();
  return url;
}

// ─────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const setLoading = (t) => { $('loadingText').textContent = t; };

function buildCards() {
  const wrap = $('cards');
  wrap.innerHTML = '';
  // 지금은 고를 수 있는 캐릭터만 보여줌 (캐릭터가 많아지면 좌우 스크롤 다시 켜기)
  for (const ch of CHARACTERS.filter((c) => c.ready)) {
    const b = document.createElement('button');
    b.className = 'card';
    b.dataset.id = ch.id;
    b.disabled = !ch.ready;
    b.innerHTML = `
      <div class="thumb" ${ch.thumb ? `style="background-image:url(${ch.thumb})"` : ''}>${ch.thumb ? '' : '?'}</div>
      <div class="name">${ch.name}</div>
      <div class="tag">${ch.variants ? '누를수록 색 변경' : '선택 가능'}</div>`;
    // 버전이 있는 떼리앙(양념포떼링)은 이미 고른 상태에서 다시 누를 때마다 다음 색으로
    if (ch.ready) b.addEventListener('click', () => {
      if (ch.variants && state.selectedId === ch.id) {
        const i = ch.variants.findIndex((v) => v.id === state.variant);
        pickVariant(ch, ch.variants[(i + 1) % ch.variants.length].id);
      } else selectCard(ch.id);
    });
    wrap.appendChild(b);
  }
}

function selectCard(id) {
  state.selectedId = id;
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c.dataset.id === id));
  $('startBtn').disabled = false;
  const ch = CHARACTERS.find((c) => c.id === id);
  if (autoName && $('nameInput').value.trim() === '') autoName = null; // 자동 닉네임도 떼리앙 이름에 맞춰 다시
  // 버전(양념포떼링 빨강/주황/초록/갈색)은 카드를 다시 누를 때마다 바뀜
  if (!ch.variants) { state.variant = null; return; }
  if (!ch.variants.some((v) => v.id === state.variant)) state.variant = defaultVariant(ch);
}

async function pickVariant(ch, variantId) {
  state.variant = variantId;
  // 카드 그림도 고른 색으로
  const model = await loadCharacter(ch, variantId);
  const card = document.querySelector(`.card[data-id="${ch.id}"] .thumb`);
  if (card && state.variant === variantId) card.style.backgroundImage = `url(${makeThumbnail(model)})`;
}

function openSelect() {
  state.playing = false;
  state.target = null;
  state.keys.clear();
  endAction(true);
  if (!player.visible) spawnGlow.visible = true;
  $('select').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('guide').classList.add('hidden');
}

async function startGame() {
  const ch = CHARACTERS.find((c) => c.id === state.selectedId);
  if (!ch) return;
  const model = await loadCharacter(ch, state.variant);

  if (state.model) body.remove(state.model);
  state.model = model;
  body.add(model);
  if (model.userData.clips.length) {
    console.info(`[${ch.name}] 모델 애니메이션 ${model.userData.clips.length}개 발견`);
  }

  if (!player.visible) {
    // 첫 입장: 외곽 랜덤 위치에서 중심을 바라보며 등장
    player.position.copy(state.spawn);
    state.yaw = Math.atan2(-state.spawn.x, -state.spawn.z);
    player.rotation.y = state.yaw;
    state.dropT = 0;
    player.visible = true;
  }
  spawnGlow.visible = false;
  $('hudName').textContent = ch.liteFile ? `${ch.name} (${ch.loadedInfo})` : ch.name;
  $('liteBtn').classList.toggle('hidden', !ch.liteFile || state.online);
  myLabel.textContent = myName();
  if (state.online) {
    $('hudName').textContent = `${ch.name} · ${myName()}`;
    connectOnline(ch);
  }
  $('liteBtn').textContent = USE_LITE ? '원본 모델로 보기' : '경량 모델로 보기';
  $('select').classList.add('hidden');
  $('hud').classList.remove('hidden');
  state.playing = true;
  applyGuide();
}

$('startBtn').addEventListener('click', startGame);

// 조작 가이드 켜기/끄기 (선택은 기억해 둠)
let guideOn = true;
try { guideOn = localStorage.getItem('guideOn') !== '0'; } catch {}
function applyGuide() {
  $('guide').classList.toggle('hidden', !guideOn || !state.playing);
  $('guideBtn').textContent = guideOn ? '가이드 끄기' : '가이드 보기';
}
function setGuide(on) {
  guideOn = on;
  try { localStorage.setItem('guideOn', on ? '1' : '0'); } catch {}
  applyGuide();
}
$('guideBtn').addEventListener('click', () => setGuide(!guideOn));
$('guideClose').addEventListener('click', () => setGuide(false));
$('changeBtn').addEventListener('click', openSelect);
$('liteBtn').addEventListener('click', () => {
  const q = new URLSearchParams(location.search);
  if (USE_LITE) q.delete('lite'); else q.set('lite', '');
  location.search = q.toString().replace(/=$/, '').replace(/=&/g, '&');
});

// ─────────────────────────────────────────────
// 입력 (마우스 / 터치)
//  마우스 왼쪽   : 짧게 클릭 → 그 자리로 이동
//                  꾹 누르기 → 눈 모으기(링 게이지) / 눈덩이를 들고 꾹 누르기 → 조준 + 파워(바) → 떼면 던지기
//  마우스 가운데 : 드래그로 카메라 회전
//  마우스 오른쪽 : 클릭한 곳으로 이동 (보조)
//  휠            : 줌
//  터치          : 왼쪽 클릭과 같음 + 한 손가락 드래그 카메라, 핀치 줌
// ─────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let press = null;             // 지금 누르고 있는 버튼 정보
const pointers = new Map();   // 화면을 누르고 있는 포인터 (멀티터치용)
let pinchDist = 0;
const HOLD_DELAY = 0.2;  // 이보다 오래 누르면 '클릭'이 아니라 '꾹 누르기'
const cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2, has: false }; // 마지막 마우스 위치

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // 가운데 버튼 자동 스크롤 막기

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cursor.x = e.clientX; cursor.y = e.clientY; cursor.has = true;
  if (pointers.size >= 2) {
    // 두 손가락: 핀치 줌. 하던 동작은 취소
    endAction(true);
    press = null;
    pinchDist = pinchLength();
    return;
  }
  if (!state.playing) return;
  const touch = e.pointerType === 'touch';
  let kind;
  if (e.button === 1) kind = 'camera';
  else if (e.button === 2) kind = 'move';
  else kind = 'snow';
  press = { kind, touch, x: e.clientX, y: e.clientY, t: performance.now(), dragging: false, started: false };
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' || pointers.has(e.pointerId)) { cursor.x = e.clientX; cursor.y = e.clientY; cursor.has = true; }
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  prev.x = e.clientX; prev.y = e.clientY;

  if (pointers.size >= 2) {
    const d = pinchLength();
    if (pinchDist > 0) zoomCamera(pinchDist / d);
    pinchDist = d;
    return;
  }
  if (!press || !state.playing) return;
  if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
    press.dragging = true;
    // 터치로 꾹 누르기 전에 끌면 → 카메라 회전으로 전환
    if (press.touch && press.kind === 'snow' && !press.started) press.kind = 'camera';
  }
  if (press.kind === 'camera' && press.dragging) {
    state.camYaw -= dx * 0.006;
    state.camPitch = THREE.MathUtils.clamp(state.camPitch + dy * 0.004, CAM_PITCH_MIN, CAM_PITCH_MAX);
  }
});

function endPointer(e, cancelled) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  const p = press;
  press = null;
  if (!p || !state.playing) return;
  if (p.kind === 'snow') {
    if (p.started) endAction(cancelled);                        // 꾹 누르기 끝 → 던지기/모으기 취소
    else if (!cancelled && (!p.dragging || !p.touch)) moveTo(e.clientX, e.clientY); // 짧은 클릭 → 이동
  } else if (p.kind === 'move' && !p.dragging && !cancelled) {
    moveTo(e.clientX, e.clientY);
  }
}
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));

function groundPointAt(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}

function moveTo(x, y) {
  const hit = groundPointAt(x, y);
  if (!hit) return;
  clampToWorld(hit);
  state.target = hit;
  marker.material.color.set(0xd6343a);
  marker.position.set(hit.x, 0.02, hit.z);
  marker.material.opacity = 1;
  marker.scale.setScalar(1.4);
}

// ─────────────────────────────────────────────
// 눈 모으기 / 조준 / 던지기
// ─────────────────────────────────────────────
const THROW_MIN = 3;   // 파워 0일 때 거리
const THROW_MAX = 12;  // 파워 MAX일 때 거리 (너무 멀지 않게)
const POWER_TIME = 1;  // 1초 누르면 파워 MAX

// 왼쪽 버튼(또는 스페이스)을 누르기 시작
function beginSnowAction() {
  if (state.hasBall) {
    state.aiming = true;
    state.power = 0;
    $('power').classList.remove('hidden');
  } else {
    state.wantGather = true;   // 가만히 있으면 모으기 시작
    state.target = null;       // 오른쪽 클릭 이동 중이었다면 멈춤
  }
}
// 왼쪽 버튼(또는 스페이스)을 뗌
function endAction(cancelled) {
  if (state.aiming) {
    if (cancelled) { state.aiming = false; $('power').classList.add('hidden'); hideAim(); }
    else throwNow();
  }
  cancelGather();
}

function cancelGather() {
  state.wantGather = false;
  state.gathering = false;
  state.gather = 0;
  $('ring').classList.add('hidden');
}
function finishGather() {
  state.wantGather = false;
  state.gathering = false;
  state.gather = 1;
  state.hasBall = true;
  handBall.visible = true;
  handBall.scale.setScalar(0.01);
  $('ring').classList.add('hidden');
}

// 조준 방향: 마우스(손가락)가 가리키는 땅 쪽. 없으면 바라보는 방향
const aimDir = new THREE.Vector3();
function updateAimDir() {
  const hit = cursor.has ? groundPointAt(cursor.x, cursor.y) : null;
  if (hit) {
    aimDir.set(hit.x - player.position.x, 0, hit.z - player.position.z);
    if (aimDir.lengthSq() > 0.04) { aimDir.normalize(); return; }
  }
  aimDir.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
}

const handWorld = new THREE.Vector3();
function landingPoint(out) {
  const dist = THROW_MIN + (THROW_MAX - THROW_MIN) * state.power;
  return out.copy(player.position).addScaledVector(aimDir, dist).setY(0);
}

function throwNow() {
  updateAimDir();
  state.yaw = Math.atan2(aimDir.x, aimDir.z);
  player.rotation.y = state.yaw;
  player.updateMatrixWorld(true);
  handBall.getWorldPosition(handWorld);
  const target = landingPoint(new THREE.Vector3());
  const velocity = solveThrow(handWorld, target);
  snowballs.throwBall({ from: handWorld, velocity });
  net?.send({ t: 'throw', fx: handWorld.x, fy: handWorld.y, fz: handWorld.z, vx: velocity.x, vy: velocity.y, vz: velocity.z });
  state.hasBall = false;
  state.aiming = false;
  state.power = 0;
  handBall.visible = false;
  state.throwT = 0;
  $('power').classList.add('hidden');
  hideAim();
}

// 조준선 (점선 포물선) + 떨어질 자리 표시
const AIM_POINTS = 28;
const aimLine = new THREE.Line(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(AIM_POINTS * 3), 3)),
  new THREE.LineDashedMaterial({ color: 0x3a8ee6, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.9 })
);
aimLine.frustumCulled = false;
aimLine.visible = false;
scene.add(aimLine);
const aimRing = new THREE.Mesh(
  new THREE.RingGeometry(0.3, 0.42, 40),
  new THREE.MeshBasicMaterial({ color: 0x3a8ee6, transparent: true, opacity: 0.85, depthWrite: false })
);
aimRing.rotation.x = -Math.PI / 2;
aimRing.visible = false;
scene.add(aimRing);
function hideAim() { aimLine.visible = false; aimRing.visible = false; }

const aimTarget = new THREE.Vector3();
function updateAimPreview() {
  if (!state.aiming) return;
  player.updateMatrixWorld(true);
  handBall.getWorldPosition(handWorld);
  landingPoint(aimTarget);
  const v = solveThrow(handWorld, aimTarget);
  const flight = 0.35 + Math.hypot(aimTarget.x - handWorld.x, aimTarget.z - handWorld.z) / 18;
  const arr = aimLine.geometry.attributes.position.array;
  for (let i = 0; i < AIM_POINTS; i++) {
    const t = (i / (AIM_POINTS - 1)) * flight;
    arr[i * 3] = handWorld.x + v.x * t;
    arr[i * 3 + 1] = Math.max(0.02, handWorld.y + v.y * t - 0.5 * GRAVITY * t * t);
    arr[i * 3 + 2] = handWorld.z + v.z * t;
  }
  aimLine.geometry.attributes.position.needsUpdate = true;
  aimLine.computeLineDistances();
  aimLine.visible = true;
  aimRing.position.set(aimTarget.x, 0.025, aimTarget.z);
  aimRing.visible = true;
}

// 마우스 휠: 줌
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.playing) zoomCamera(Math.exp(e.deltaY * 0.001));
}, { passive: false });

function pinchLength() {
  const [a, b] = [...pointers.values()];
  return b ? Math.hypot(a.x - b.x, a.y - b.y) || 1 : 1;
}
function zoomCamera(factor) {
  state.camDist = THREE.MathUtils.clamp(state.camDist * factor, CAM_DIST_MIN, CAM_DIST_MAX);
}

// ─────────────────────────────────────────────
// 입력: 방향키 / WASD, 스페이스(= 마우스 왼쪽 누르기)
// ─────────────────────────────────────────────
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
let spaceDown = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.playing) {
    e.preventDefault();
    if (e.repeat || spaceDown) return;
    spaceDown = true;
    beginSnowAction();
    return;
  }
  const k = KEYMAP[e.code];
  if (!k || !state.playing) return;
  e.preventDefault();
  state.keys.add(k);
  state.target = null; // 키보드를 쓰면 클릭 목적지는 취소
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    if (spaceDown && state.playing) endAction(false);
    spaceDown = false;
    return;
  }
  const k = KEYMAP[e.code];
  if (k) state.keys.delete(k);
});
window.addEventListener('blur', () => { state.keys.clear(); if (spaceDown) { spaceDown = false; endAction(true); } });

function clampToWorld(v) {
  const max = WORLD_RADIUS - 0.8;
  const d = Math.hypot(v.x, v.z);
  if (d > max) { v.x *= max / d; v.z *= max / d; }
  v.y = 0;
  return v;
}

// ─────────────────────────────────────────────
// 업데이트
// ─────────────────────────────────────────────
const tmp = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const RING_LEN = 2 * Math.PI * 20; // SVG 원 둘레 (r=20)
function placeOverHead(el, height) {
  tmp.copy(player.position).setY(height).project(camera);
  el.style.left = `${(tmp.x * 0.5 + 0.5) * window.innerWidth}px`;
  el.style.top = `${(-tmp.y * 0.5 + 0.5) * window.innerHeight}px`;
}

function updateSnowAction(dt) {
  // 왼쪽 버튼을 움직이지 않고 꾹 누르면 눈덩이 동작 시작
  // (마우스는 움직이면서 눌러도 OK. 터치는 끌면 카메라 회전이라 제외)
  if (press && press.kind === 'snow' && !press.started && (!press.dragging || !press.touch) &&
      performance.now() - press.t > HOLD_DELAY * 1000) {
    press.started = true;
    beginSnowAction();
  }
  // 눈 모으기: 누르고 있고, 가만히 서 있을 때만 차오름
  if (state.wantGather && !state.hasBall) {
    const still = state.keys.size === 0 && !state.target;
    if (still && !state.gathering) {
      state.gathering = true;
      $('ring').classList.remove('hidden');
    }
    if (state.gathering && still) {
      state.gather = Math.min(1, state.gather + dt / GATHER_TIME);
      if (state.gather >= 1) finishGather();
    }
    state.gatherPaused = !still;
  }
  if (!$('ring').classList.contains('hidden')) {
    $('ringFill').style.strokeDashoffset = `${RING_LEN * (1 - state.gather)}`;
    $('ring').classList.toggle('paused', !!state.gatherPaused);
    placeOverHead($('ring'), 1.65);
  }

  // 조준 + 파워
  if (state.aiming) {
    state.power = Math.min(1, state.power + dt / POWER_TIME);
    $('powerFill').style.width = `${state.power * 100}%`;
    $('power').classList.toggle('max', state.power >= 1);
    placeOverHead($('power'), 1.75);
    updateAimDir();
    if (state.keys.size === 0 && !state.target) {
      state.yaw = angleLerp(state.yaw, Math.atan2(aimDir.x, aimDir.z), Math.min(1, dt * 14));
      player.rotation.y = state.yaw;
    }
    updateAimPreview();
  }
  if (handBall.visible && handBall.scale.x < 1) handBall.scale.setScalar(Math.min(1, handBall.scale.x + dt * 6));
}

function updatePlayer(dt) {
  const move = new THREE.Vector3();

  if (state.playing && !state.gathering) { // 모으는 동안엔 멈춤 (방향키를 누르면 모으기가 잠시 멈춤)
    // 방향키: 화면 기준 위/아래/좌/우
    if (state.keys.size) {
      forward.set(-Math.sin(state.camYaw), 0, -Math.cos(state.camYaw));
      right.set(Math.cos(state.camYaw), 0, -Math.sin(state.camYaw));
      if (state.keys.has('up')) move.add(forward);
      if (state.keys.has('down')) move.sub(forward);
      if (state.keys.has('right')) move.add(right);
      if (state.keys.has('left')) move.sub(right);
    } else if (state.target) {
      tmp.subVectors(state.target, player.position).setY(0);
      const dist = tmp.length();
      if (dist < 0.08) {
        state.target = null;
      } else {
        move.copy(tmp).divideScalar(dist);
        if (dist < MOVE_SPEED * dt) move.multiplyScalar(dist / (MOVE_SPEED * dt));
      }
    }
  }

  const moving = move.lengthSq() > 1e-6;
  if (moving) {
    const len = Math.min(move.length(), 1);
    const dir = move.clone().normalize();
    player.position.addScaledVector(dir, MOVE_SPEED * len * dt);
    clampToWorld(player.position);
    const want = Math.atan2(dir.x, dir.z);
    state.yaw = angleLerp(state.yaw, want, Math.min(1, TURN_SPEED * dt));
    player.rotation.y = state.yaw;
  }

  animateBody(body, state, dt, moving, state.gathering);
}

function updateCamera(dt, time) {
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.camYaw);
  if (state.playing || player.visible) {
    camTarget.copy(player.position);
    camPos.set(0, Math.sin(state.camPitch), Math.cos(state.camPitch))
      .multiplyScalar(state.camDist).applyQuaternion(yawQ).add(camTarget);
    const k = 1 - Math.exp(-dt * 10);
    camera.position.lerp(camPos, k);
    lookAt.lerp(tmp.copy(camTarget).setY(0.6), k);
  } else {
    // 선택 화면: 스폰 지점 주변을 천천히 도는 미리보기
    const a = state.camYaw + Math.sin(time * 0.15) * 0.5;
    camPos.set(state.spawn.x + Math.sin(a) * 11, 6.5, state.spawn.z + Math.cos(a) * 11);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 2));
    lookAt.lerp(tmp.set(state.spawn.x * 0.8, 0, state.spawn.z * 0.8), 1 - Math.exp(-dt * 2));
  }
  camera.lookAt(lookAt);

  // 그림자 카메라가 캐릭터를 따라다니게
  const focus = player.visible ? player.position : state.spawn;
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);
}

function updateEffects(dt, time) {
  // 눈 내리기 (카메라 주변에서 반복)
  const p = snowGeo.attributes.position.array;
  const cx = camera.position.x, cz = camera.position.z;
  for (let i = 0; i < SNOW_COUNT; i++) {
    const ix = i * 3;
    p[ix + 1] -= dt * (0.8 + (i % 7) * 0.12);
    p[ix] += Math.sin(time * 0.7 + i) * dt * 0.15;
    if (p[ix + 1] < 0) {
      p[ix + 1] = 18 + Math.random() * 2;
      p[ix] = cx + (Math.random() - 0.5) * 50;
      p[ix + 2] = cz + (Math.random() - 0.5) * 50;
    }
  }
  snowGeo.attributes.position.needsUpdate = true;

  if (marker.material.opacity > 0) {
    marker.material.opacity = Math.max(0, marker.material.opacity - dt * (state.target ? 0.4 : 2.5));
    marker.scale.setScalar(Math.max(1, marker.scale.x - dt * 2));
  }
  spawnGlow.scale.setScalar(1 + Math.sin(time * 3) * 0.12);
}

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  updateSnowAction(dt);
  updatePlayer(dt);
  snowballs.update(dt);
  remotes.update_frame(dt);
  updateMyLabel();
  sendState();
  updateCamera(dt, time);
  updateEffects(dt, time);
  renderer.render(scene, camera);
  // 만화 외곽선: 가까울수록 살짝 두껍게
  outline.setThickness(THREE.MathUtils.clamp(2.4 * Math.sqrt(CAM_DIST / camera.position.distanceTo(lookAt)), 1.2, 3.2));
  outline.render(scene, camera);
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  outline.setSize();
});

// ─────────────────────────────────────────────
// 온라인 (같은 채널 사람들과 위치/눈덩이 주고받기)
// ─────────────────────────────────────────────
let net = null;
const remotes = new RemotePlayers(scene, camera, (code) => {
  const { ch, variant } = parseCharCode(code);
  return loadCharacter(ch, variant);
}, $('labels'));

// 닉네임을 비워두면 "형용사 + 캐릭터 이름" (예: 바삭한 포떼링). 형용사는 4글자 이하 (서버 12자 제한)
const NAME_WORDS = ['눅눅한', '차가운', '바삭한', '따끈한', '짭짤한', '달콤한', '고소한', '촉촉한', '쫄깃한', '매콤한',
  '말랑한', '포근한', '든든한', '새콤한', '배고픈', '졸린', '신난', '들뜬', '수줍은', '용감한', '행복한', '반짝이는', '꽁꽁 언', '눈 덮인'];
let autoName = null;
// 랜덤 버튼: 누를 때마다 다음 형용사 (한 바퀴 돌 때까지 겹치지 않게 섞어서)
let wordDeck = [];
function nextRandomName() {
  const ch = CHARACTERS.find((c) => c.id === state.selectedId) || CHARACTERS[0];
  const current = $('nameInput').value.trim();
  for (let tries = 0; tries < 3; tries++) {
    if (!wordDeck.length) wordDeck = [...NAME_WORDS].sort(() => Math.random() - 0.5);
    const name = `${wordDeck.pop()} ${ch.name}`;
    if (name !== current) return name;
  }
  return current;
}
$('randomNameBtn').addEventListener('click', () => {
  $('nameInput').value = nextRandomName();
});
function savedName() {
  try { return localStorage.getItem('snowName') || ''; } catch { return ''; }
}
function myName() {
  const typed = $('nameInput') ? $('nameInput').value.trim().slice(0, 12) : '';
  if (typed) { try { localStorage.setItem('snowName', typed); } catch {} return typed; }
  try { localStorage.removeItem('snowName'); } catch {}
  const ch = CHARACTERS.find((c) => c.id === state.selectedId) || CHARACTERS[0];
  if (!autoName || autoName.char !== ch.id) {
    autoName = { char: ch.id, name: `${NAME_WORDS[Math.floor(Math.random() * NAME_WORDS.length)]} ${ch.name}` };
  }
  return autoName.name;
}

// 내 머리 위 이름표
const myLabel = document.createElement('div');
myLabel.className = 'name-tag me';
myLabel.style.display = 'none';
$('labels').appendChild(myLabel);
const labelPos = new THREE.Vector3();
function updateMyLabel() {
  if (!state.playing || !player.visible || !myLabel.textContent) { myLabel.style.display = 'none'; return; }
  labelPos.copy(player.position).setY(1.45).project(camera);
  const visible = labelPos.z < 1 && Math.abs(labelPos.x) < 1.1 && Math.abs(labelPos.y) < 1.1;
  myLabel.style.display = visible ? '' : 'none';
  if (visible) myLabel.style.transform = `translate(${(labelPos.x * 0.5 + 0.5) * window.innerWidth}px, ${(-labelPos.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
}

function setNetStatus(text) {
  const el = $('netStatus');
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}
function updateOnlineHud() {
  if (!net || !net.connected) { $('online').classList.add('hidden'); return; }
  $('online').textContent = `채널 ${net.ch} · ${remotes.count + 1}명`;
  $('online').classList.remove('hidden');
}

function connectOnline(ch) {
  if (net) return;
  net = new Net({
    onWelcome: (m) => {
      remotes.clear();
      m.players.forEach((p) => remotes.add(p));
      if (m.name) { $('hudName').textContent = `${ch.name} · ${m.name}`; myLabel.textContent = m.name; }
      lastSent = null;
      updateOnlineHud();
    },
    onJoin: (p) => { remotes.add(p); updateOnlineHud(); },
    onLeave: (id) => { remotes.remove(id); updateOnlineHud(); },
    onState: (m) => remotes.update(m),
    onThrow: (m) => {
      remotes.thrown(m.id);
      snowballs.throwBall({ owner: String(m.id), from: new THREE.Vector3(m.fx, m.fy, m.fz), velocity: new THREE.Vector3(m.vx, m.vy, m.vz) });
    },
    onDisconnect: () => { remotes.clear(); updateOnlineHud(); },
    onStatus: setNetStatus,
  });
  net.join(() => ({
    name: myName(), char: charCode(ch, state.variant),
    x: player.position.x, z: player.position.z, yaw: state.yaw,
  }));
}

// 내 상태를 0.1초마다 (바뀌었을 때만, 아니면 2초마다) 보냄
let lastSent = null, lastSendAt = 0;
function sendState() {
  if (!net || !net.connected || !state.playing) return;
  const now = performance.now();
  if (now - lastSendAt < 100) return;
  const st = {
    t: 'state',
    x: Math.round(player.position.x * 100) / 100, z: Math.round(player.position.z * 100) / 100,
    yaw: Math.round(state.yaw * 100) / 100,
    m: state.walk > 0.5 ? 1 : 0, g: state.gathering ? 1 : 0, b: state.hasBall ? 1 : 0, a: state.aiming ? 1 : 0,
  };
  const key = JSON.stringify(st);
  if (key === lastSent && now - lastSendAt < 2000) return;
  net.send(st);
  lastSent = key;
  lastSendAt = now;
}

// ─────────────────────────────────────────────
// 시작
// ─────────────────────────────────────────────
async function init() {
  pickSpawn();
  camera.position.set(state.spawn.x * 1.4, 8, state.spawn.z * 1.4);
  lookAt.copy(state.spawn);
  loop();

  // 서버(Cloudflare)에서 열었으면 온라인 모드
  const server = await detectServer();
  state.online = !!server;
  $('nameRow').classList.remove('hidden');
  $('nameInput').value = savedName();
  if (state.online) {
    USE_LITE = true;
    $('select').querySelector('.sub').textContent = '닉네임을 정하고, 함께 눈밭을 걸을 친구를 골라주세요';
  }

  const first = CHARACTERS.find((c) => c.ready);
  try {
    await Promise.all(CHARACTERS.filter((c) => c.ready).map(async (c) => {
      c.thumb = makeThumbnail(await loadCharacter(c, defaultVariant(c)));
    }));
  } catch (err) {
    console.error(err);
    setLoading('떼리앙 모델을 불러오지 못했어요. 로컬 서버로 열었는지 확인해 주세요.');
    return;
  }
  buildCards();
  selectCard(first.id);
  $('loading').classList.add('hidden');
  openSelect();

  // 디버그/테스트용
  window.__game = { state, player, CHARACTERS, snowballs, remotes, get net() { return net; } };
}
init();
