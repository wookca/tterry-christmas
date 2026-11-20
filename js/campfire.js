import * as THREE from 'three';
import { enableOutline, SOFT_PART } from './outline.js';

const FLAME_LAYER = 3; // 불꽃만 따로 그리는 층: 외곽선을 다 그린 뒤 맨 마지막에 그림

// ─────────────────────────────────────────────
// 모닥불: 큰 숲(짝수 채널) 맵 한가운데 (0, 0)
// 돌 테두리 + 장작 + 일렁이는 불꽃(3겹) + 떠오르는 불티 + 바닥에 번지는 주황빛
// 떼리앙은 불 속으로 들어갈 수 없음 (가장자리를 따라 미끄러지듯 돌아감)
// 날아온 눈덩이는 불에 닿으면 부서짐
// ─────────────────────────────────────────────
const SIZE = 1.35;                // 모닥불 전체 크기 배율
export const FIRE_BLOCK_R = 1.6;  // 떼리앙 발 위치가 이 반지름 안으로는 못 들어옴 (돌 테두리 + 몸 두께)
const STONE_R = 0.82;             // 돌 테두리 반지름
export const MELT_R = 2.5;        // 이 안(눈 녹은 땅)에서는 손에 든 눈덩이가 녹고, 눈을 모을 수 없음
const BALL_BLOCK_R = 0.95 * SIZE, BALL_BLOCK_H = 1.3 * SIZE; // 눈덩이가 부서지는 불 크기

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 각진(로우폴리) 불꽃 하나: 아래가 볼록하고 위로 뾰족한 물방울 모양
function flameGeometry(h, r, seg = 6) {
  const pts = [
    new THREE.Vector2(0.0, 0),
    new THREE.Vector2(r * 0.75, h * 0.08),
    new THREE.Vector2(r, h * 0.28),
    new THREE.Vector2(r * 0.72, h * 0.55),
    new THREE.Vector2(r * 0.3, h * 0.82),
    new THREE.Vector2(0.0, h),
  ];
  const g = new THREE.LatheGeometry(pts, seg);
  return g.toNonIndexed();
}

// 바닥 불빛: 가운데가 진하고 바깥으로 사라지는 동그라미
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 눈 녹은 땅: 정원이 아니라 울퉁불퉁한 모양 (반지름이 각도마다 조금씩 다름)
function blobGeometry(radius, wobble, seed, seg = 56) {
  const rand = rng(seed);
  const waves = [2, 3, 5, 7].map((k) => ({ k, a: (rand() - 0.3) * wobble / k * 2, p: rand() * Math.PI * 2 }));
  const shape = new THREE.Shape();
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    let r = 1;
    for (const w of waves) r += w.a * Math.sin(w.k * t + w.p);
    r *= radius * (1 + (rand() - 0.5) * wobble * 0.25);
    if (i === seg) { shape.closePath(); break; }
    const x = Math.cos(t) * r, y = Math.sin(t) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Campfire {
  constructor(scene) {
    const rand = rng(20261120);
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.scale.setScalar(SIZE);
    scene.add(this.group);
    this.time = 0;

    // 돌 테두리
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8e98a4, roughness: 1, flatShading: true });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const STONES = 11;
    for (let i = 0; i < STONES; i++) {
      const a = (i / STONES) * Math.PI * 2 + rand() * 0.2;
      const s = 0.15 + rand() * 0.06;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), stoneMat);
      stone.scale.set(s * 1.25, s * 0.8, s);
      stone.position.set(Math.cos(a) * STONE_R, s * 0.35, Math.sin(a) * STONE_R);
      stone.rotation.set(rand() * 0.6, -a + rand(), rand() * 0.4);
      stone.castShadow = true;
      enableOutline(stone, SOFT_PART); // 환경물: 검은 선 대신 눈더미처럼 연한 회색 선
      this.group.add(stone);
      if (i % 3 === 0) { // 몇 개는 위에 눈이 살짝 쌓임
        const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
        cap.scale.set(s * 0.95, s * 0.32, s * 0.8);
        cap.position.set(stone.position.x, s * 0.35 + s * 0.55, stone.position.z);
        cap.rotation.y = -a;
        enableOutline(cap, SOFT_PART);
        this.group.add(cap);
      }
    }

    // 장작: 가운데로 기대어 세운 원뿔 모양(티피) 5개 + 바닥에 놓인 2개
    const logMat = new THREE.MeshStandardMaterial({ color: 0x8a5634, roughness: 1, flatShading: true });
    const endMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 1, flatShading: true });
    const logGeo = new THREE.CylinderGeometry(0.075, 0.095, 1.0, 6);
    const LOGS = 5;
    for (let i = 0; i < LOGS; i++) {
      const a = (i / LOGS) * Math.PI * 2 + 0.3;
      const log = new THREE.Mesh(logGeo, [logMat, endMat, endMat]);
      const lean = 0.55; // 기울기 (라디안)
      log.position.set(Math.cos(a) * 0.28, 0.43, Math.sin(a) * 0.28);
      log.rotation.order = 'YXZ';
      log.rotation.y = -a + Math.PI / 2;
      log.rotation.x = -lean;
      log.castShadow = true;
      enableOutline(log, SOFT_PART);
      this.group.add(log);
    }
    for (let i = 0; i < 2; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.15, 6), [logMat, endMat, endMat]);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = i ? 1.9 : 0.35;
      log.position.y = 0.085;
      log.castShadow = true;
      enableOutline(log, SOFT_PART);
      this.group.add(log);
    }

    // 불꽃 3겹 (바깥 빨강 → 주황 → 안쪽 노랑). 빛을 받지 않는 재질이라 그늘 없이 늘 밝음
    // 만화처럼 안쪽 겹이 바깥 겹 위에 비쳐 보이도록: 바깥 겹부터 차례로 그리고, 바깥 겹은 깊이를 남기지 않음
    const layers = [
      { color: 0xf0442a, h: 1.45, r: 0.42, n: 4, spread: 0.15 },
      { color: 0xff9a1f, h: 1.0, r: 0.3, n: 3, spread: 0.09 },
      { color: 0xffe14d, h: 0.58, r: 0.18, n: 2, spread: 0.05 },
    ];
    this.flames = [];
    layers.forEach((L, li) => {
      const mat = new THREE.MeshBasicMaterial({ color: L.color, depthWrite: li === layers.length - 1 });
      for (let i = 0; i < L.n; i++) {
        const k = i === 0 ? 1 : 0.62 + rand() * 0.2; // 가운데 하나는 크게, 옆은 작게
        const f = new THREE.Mesh(flameGeometry(L.h * k, L.r * (i === 0 ? 1 : 0.75)), mat);
        const a = rand() * Math.PI * 2, d = i === 0 ? 0 : L.spread + rand() * 0.06;
        f.position.set(Math.cos(a) * d, 0.12, Math.sin(a) * d);
        f.rotation.y = rand() * Math.PI;
        f.renderOrder = 2 + li;
        f.layers.set(FLAME_LAYER); // 불꽃은 선 없음. 선 그리기에 끼지 않으니 장작 선도 불에 따라 바뀌지 않음
        this.group.add(f);
        this.flames.push({ mesh: f, base: f.position.clone(), ph: rand() * 10, sp: 7 + rand() * 4, lean: i === 0 ? 0.05 : 0.18 });
      }
    });

    // 떠오르는 불티
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xffb030 });
    const emberGeo = new THREE.OctahedronGeometry(0.035, 0);
    this.embers = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(emberGeo, emberMat);
      this.group.add(m);
      const e = { mesh: m, t: rand(), life: 1.2 + rand() * 0.8, x: 0, z: 0, vx: 0, vz: 0, rand };
      this.resetEmber(e, true);
      this.embers.push(e);
    }

    // 눈 녹은 땅: 겨울의 차가운 회색빛 언 땅 + 가장자리는 녹다 만 회색 눈 (둘 다 울퉁불퉁한 모양, 선 없음)
    const flat = (color, offset) => new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset });
    const slush = new THREE.Mesh(blobGeometry(MELT_R + 0.35, 0.22, 77), flat(0xd5dde6, -1));
    const dirt = new THREE.Mesh(blobGeometry(MELT_R - 0.05, 0.28, 31), flat(0xb8a690, -2));
    for (const [m, y] of [[slush, 0.001], [dirt, 0.002]]) {
      m.scale.setScalar(1 / SIZE);   // 모양은 실제 크기(m)로 만들었으니 모닥불 배율을 되돌림
      m.position.y = y / SIZE;
      m.receiveShadow = true;
      this.group.add(m);
    }
    // 흙 위 작은 자갈 몇 개
    const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8c7f72, roughness: 1, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2, d = (1.7 + rand() * 0.6) / SIZE;
      const p = new THREE.Mesh(new THREE.DodecahedronGeometry(0.035 + rand() * 0.03, 0), pebbleMat);
      p.position.set(Math.cos(a) * d, 0.01, Math.sin(a) * d);
      p.scale.y = 0.5;
      this.group.add(p);
    }

    // 바닥에 번지는 따뜻한 빛 (흰 눈 위라서 더하기 대신 살짝 물들이는 방식)
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48),
      new THREE.MeshBasicMaterial({ color: 0xffa24a, map: glowTexture(), transparent: true, opacity: 0.42, depthWrite: false, fog: false })
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.008;
    this.glow.renderOrder = 1;
    this.group.add(this.glow);

    // 가까이 온 떼리앙을 주황빛으로 비추는 불빛 (꺼진 맵에서도 빛 개수는 그대로 두어 화면이 멈칫하지 않게)
    this.light = new THREE.PointLight(0xff8a3a, 0, 7, 1.6);
    this.light.position.set(0, 0.9 * SIZE, 0);
    scene.add(this.light);
    this.lightBase = 9;
  }

  resetEmber(e, first) {
    const r = e.rand;
    e.t = first ? r() * e.life : 0;
    e.x = (r() - 0.5) * 0.35; e.z = (r() - 0.5) * 0.35;
    e.vx = (r() - 0.5) * 0.3; e.vz = (r() - 0.5) * 0.3;
    e.life = 1.2 + r() * 0.8;
  }

  setVisible(v) {
    this.group.visible = v;
    if (!v) this.light.intensity = 0;
  }
  get active() { return this.group.visible; }

  update(dt) {
    if (!this.group.visible) return;
    this.time += dt;
    const t = this.time;
    for (const f of this.flames) {
      const n1 = Math.sin(t * f.sp + f.ph), n2 = Math.sin(t * f.sp * 1.7 + f.ph * 2.3);
      const sy = 1 + 0.16 * n1 + 0.07 * n2;
      const sxz = 1 - 0.08 * n1;
      f.mesh.scale.set(sxz, sy, sxz);
      f.mesh.rotation.x = f.lean * Math.sin(t * 2.3 + f.ph) + 0.05 * n2;
      f.mesh.rotation.z = f.lean * Math.cos(t * 1.9 + f.ph);
      f.mesh.rotation.y += dt * 0.8;
    }
    for (const e of this.embers) {
      e.t += dt;
      if (e.t >= e.life) this.resetEmber(e, false);
      const k = e.t / e.life;
      e.mesh.position.set(e.x + e.vx * e.t + Math.sin(t * 3 + e.life * 9) * 0.06, 0.55 + k * 1.9, e.z + e.vz * e.t);
      e.mesh.scale.setScalar(1 - k * 0.8);
      e.mesh.rotation.y += dt * 4;
    }
    const flick = 1 + 0.12 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 17.9 + 1.3);
    this.light.intensity = this.lightBase * flick;
    this.glow.material.opacity = 0.42 * (0.94 + 0.06 * flick);
    this.glow.scale.setScalar(0.97 + 0.03 * flick);
  }

  // 외곽선까지 다 그린 다음 불러서 불꽃을 맨 위에 그림 (앞에 있는 떼리앙·장작에는 가려짐)
  renderFlames(renderer, scene, camera) {
    if (!this.group.visible) return;
    const bg = scene.background, mask = camera.layers.mask, ac = renderer.autoClear, sh = renderer.shadowMap.autoUpdate;
    scene.background = null;
    camera.layers.set(FLAME_LAYER);
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.render(scene, camera);
    scene.background = bg;
    camera.layers.mask = mask;
    renderer.autoClear = ac;
    renderer.shadowMap.autoUpdate = sh;
  }

  // 떼리앙 발 위치를 불 바깥으로 밀어냄 (안으로 들어가려 하면 둘레를 따라 미끄러짐)
  pushOut(v) {
    if (!this.group.visible) return v;
    const d = Math.hypot(v.x, v.z);
    if (d >= FIRE_BLOCK_R) return v;
    if (d < 1e-4) { v.x = FIRE_BLOCK_R; return v; }
    v.x *= FIRE_BLOCK_R / d; v.z *= FIRE_BLOCK_R / d;
    return v;
  }

  // 눈 녹은 땅 위인지 (손에 든 눈덩이가 녹고, 눈을 모을 수 없음)
  inMeltZone(v) {
    return this.group.visible && Math.hypot(v.x, v.z) < MELT_R;
  }

  // 눈덩이가 불에 닿았는지
  hitsBall(pos) {
    return this.group.visible && pos.y < BALL_BLOCK_H && Math.hypot(pos.x, pos.z) < BALL_BLOCK_R;
  }
}
