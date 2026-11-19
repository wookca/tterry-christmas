import * as THREE from 'three';
import { OUTLINE_LAYER } from './outline.js';

// ─────────────────────────────────────────────
// 눈덩이: 던지기(포물선) → 땅에 닿으면 3~5조각으로 부서짐 → 3초 뒤 사라짐
//
// 나중에 여러 명이 같은 맵에서 놀 때(멀티플레이) 동기화하기 쉽게,
// 던진 눈덩이는 { id, owner, from, velocity, startTime } 만 있으면
// 어느 컴퓨터에서든 똑같은 궤적을 다시 계산할 수 있게 만들었다.
// ─────────────────────────────────────────────

export const GRAVITY = 14;           // 중력 (월드 단위/초²)
export const BALL_RADIUS = 0.13;
export const THROW_RANGE = 16;       // 최대 사거리
const CHUNK_LIFETIME = 3;            // 조각이 남아있는 시간(초)

const ballGeo = new THREE.IcosahedronGeometry(BALL_RADIUS, 2);
const CHUNK_R = BALL_RADIUS * 0.65;
const chunkGeo = new THREE.IcosahedronGeometry(CHUNK_R, 0);
// 조각이 바닥에 놓일 높이 (크기 1 기준): 반지름보다 조금 낮게 → 눈에 살짝 박힌 듯, 그림자와 딱 붙음
const CHUNK_REST = CHUNK_R * 0.7;
// 외곽선용 부위 번호 (눈덩이/조각도 만화 선이 그려지게)
ballGeo.setAttribute('partId', new THREE.BufferAttribute(new Float32Array(ballGeo.attributes.position.count).fill(200), 1));
chunkGeo.setAttribute('partId', new THREE.BufferAttribute(new Float32Array(chunkGeo.attributes.position.count).fill(201), 1));
const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
const powderMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
const powderGeo = new THREE.CircleGeometry(0.32, 14);

export function makeBallMesh() {
  const m = new THREE.Mesh(ballGeo, snowMat);
  m.castShadow = true;
  m.layers.enable(OUTLINE_LAYER);
  return m;
}

// 목표 지점에 떨어지도록 초기 속도 계산 (from, to: Vector3)
export function solveThrow(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  let dist = Math.hypot(dx, dz);
  const k = dist > THROW_RANGE ? THROW_RANGE / dist : 1;
  dist *= k;
  const flight = 0.35 + dist / 18;                 // 멀수록 조금 더 오래 날아감
  const vx = (dx * k) / flight, vz = (dz * k) / flight;
  const vy = (to.y - from.y + 0.5 * GRAVITY * flight * flight) / flight;
  return new THREE.Vector3(vx, vy, vz);
}

export class SnowballSystem {
  constructor(scene) {
    this.scene = scene;
    this.flying = [];   // 날아가는 눈덩이
    this.chunks = [];   // 부서진 조각
    this.powders = [];  // 바닥에 남는 눈가루 자국
    this.time = 0;
    this.nextId = 1;
  }

  // 던지기. 네트워크로 받은 눈덩이도 같은 함수로 만들면 된다.
  throwBall({ owner = 'me', from, velocity, startTime = this.time, id = `${owner}-${this.nextId++}` }) {
    const mesh = makeBallMesh();
    mesh.position.copy(from);
    this.scene.add(mesh);
    const ball = { id, owner, from: from.clone(), velocity: velocity.clone(), startTime, mesh };
    this.flying.push(ball);
    return ball;
  }

  update(dt) {
    this.time += dt;

    // 날아가는 눈덩이: 시작점 + 속도 + 중력으로 위치 계산
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const b = this.flying[i];
      const t = this.time - b.startTime;
      const y = b.from.y + b.velocity.y * t - 0.5 * GRAVITY * t * t;
      b.mesh.position.set(b.from.x + b.velocity.x * t, y, b.from.z + b.velocity.z * t);
      b.mesh.rotation.x += dt * 8;
      if (y <= BALL_RADIUS * 0.5) {
        b.mesh.position.y = 0;
        this.burst(b.mesh.position, b.velocity);
        this.scene.remove(b.mesh);
        this.flying.splice(i, 1);
      }
    }

    // 조각: 튀었다가 바닥에 멈추고, 3초 뒤 작아지며 사라짐
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.age += dt;
      if (!c.rest) {
        c.vel.y -= GRAVITY * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.z += c.spin.z * dt;
        if (c.mesh.position.y <= CHUNK_REST * c.size) {
          c.mesh.position.y = CHUNK_REST * c.size;
          if (Math.abs(c.vel.y) < 1.2) c.rest = true;
          c.vel.y *= -0.25;
          c.vel.x *= 0.5; c.vel.z *= 0.5;
        }
      }
      const fade = THREE.MathUtils.clamp((CHUNK_LIFETIME - c.age) / 0.5, 0, 1);
      c.mesh.scale.setScalar(c.size * fade);
      if (c.rest) c.mesh.position.y = CHUNK_REST * c.size * fade; // 작아지며 사라질 때도 바닥에 붙어 있게
      if (c.age >= CHUNK_LIFETIME) {
        this.scene.remove(c.mesh); // 공유 지오메트리/재질이라 dispose 필요 없음
        this.chunks.splice(i, 1);
      }
    }

    for (let i = this.powders.length - 1; i >= 0; i--) {
      const p = this.powders[i];
      p.age += dt;
      const s = Math.min(1, p.age * 8);
      p.mesh.scale.set(s * p.size, s * p.size, 1);
      p.mesh.material.opacity = 0.9 * THREE.MathUtils.clamp((CHUNK_LIFETIME - p.age) / 0.6, 0, 1);
      if (p.age >= CHUNK_LIFETIME) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.powders.splice(i, 1);
      }
    }
  }

  // 날아가는 눈덩이 중 hit(ball, pos)가 true인 것은 그 자리에서 부서짐
  hitTest(hit) {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const b = this.flying[i];
      if (!hit(b, b.mesh.position)) continue;
      this.burst(b.mesh.position, b.velocity);
      this.scene.remove(b.mesh);
      this.flying.splice(i, 1);
    }
  }

  // 퍼석! 3~5조각으로 부서짐
  burst(at, incoming) {
    const n = 3 + Math.floor(Math.random() * 3);
    const dir = new THREE.Vector3(incoming.x, 0, incoming.z).normalize();
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(chunkGeo, snowMat);
      mesh.castShadow = true; // 조각은 작아서 외곽선 없이
      const size = 0.7 + Math.random() * 0.6;
      mesh.scale.setScalar(size);
      mesh.position.set(at.x, Math.max(at.y || 0, CHUNK_REST * size + 0.05), at.z);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      const sp = 0.8 + Math.random() * 1.4;
      const vel = new THREE.Vector3(Math.cos(a) * sp + dir.x * 1.2, 1.5 + Math.random() * 1.8, Math.sin(a) * sp + dir.z * 1.2);
      const spin = new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12);
      this.scene.add(mesh);
      this.chunks.push({ mesh, vel, spin, size, age: 0, rest: false });
    }
    // 바닥 눈가루 자국
    const mesh = new THREE.Mesh(powderGeo, powderMat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, 0.015, at.z);
    this.scene.add(mesh);
    this.powders.push({ mesh, age: 0, size: 0.8 + Math.random() * 0.4 });
  }
}
