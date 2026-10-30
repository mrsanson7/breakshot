import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AimPrediction, BallDef, BallState, TableGeometry, Vec2 } from '@breakshot/shared';
import { GUIDE, MODELS, RENDER3D } from '../config';
import { loadModel } from './models';
import { buildTable, type TableMeshes, type TablePalette } from './table';
import { ballTexture } from './textures';
import type { CameraMode, CueOverlay, FloatingText, GuideOverlay, RenderFrame, ScreenMapper } from './types';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 0, 1);

/**
 * three.js table view. World frame = physics frame: x along the table, y across, z up (m).
 * Two cameras: straight-down "top" (upright on tall screens) and "cue" (behind the cue ball, rising
 * to an overview while the balls roll). A transparent 2D canvas on top carries the floating texts.
 */
export class Renderer3D implements ScreenMapper {
  readonly overlay: HTMLCanvasElement;
  readonly palette: TablePalette;
  cameraMode: CameraMode = 'cue';
  /** While the balls roll: straight down from above (항공) or the tilted view behind the shot. */
  /** 항공 보기: look straight down while aiming too (cue view keeps its drag-to-turn aim). */
  aerialAim = false;

  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private octx: CanvasRenderingContext2D;
  private table: TableMeshes;
  private R: number;
  private balls = new Map<string, THREE.Mesh>();
  private highlight: THREE.Mesh;
  private placement: THREE.Mesh;
  private ghost: THREE.Group;
  private cue: THREE.Group;
  private cueMaterials: THREE.MeshStandardMaterial[] = [];
  private aimMeshes: THREE.Mesh[];
  private guideMeshes: { path: THREE.Mesh; system: THREE.Mesh; arrival: THREE.Mesh; dots: THREE.Mesh[] };
  private lastGuide: GuideOverlay | undefined | null = null;
  private lastAim: AimPrediction | undefined | null = null;
  private ringPool: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private ballPlane: THREE.Plane;
  private sun: THREE.DirectionalLight;
  /** Hall around the table; hidden whenever the camera looks straight down. Null until loaded. */
  private room: THREE.Group | null = null;
  /** Lamp and cord meshes inside the room, and the lamp's bounds (without the cords). */
  private lampParts: THREE.Object3D[] = [];
  private lampBox = new THREE.Box3();
  private disposed = false;

  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private portrait = false;
  private lastTime = 0;
  private cam = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 0, 1), ready: false };
  private want = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 0, 1) };
  /** Last cue aim, for the overview camera while the balls roll. */
  private lastCue: { at: Vec2; angle: number } | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly geom: TableGeometry,
    ballDefs: BallDef[],
    private readonly maxTipOffset: number,
  ) {
    this.R = geom.spec.ball.diameter / 2;
    this.palette = { ...geom.spec.colors };
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.95;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;

    this.overlay = document.createElement('canvas');
    this.overlay.className = 'overlay-canvas';
    this.octx = this.overlay.getContext('2d')!;

    this.scene.background = new THREE.Color('#0c1115');
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    const L = geom.length;
    const W = geom.width;
    const span = Math.max(L, W) / 2 + geom.spec.railWidth;
    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x1a1a1a, 0.45));
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.9);
    sun.position.set(L / 2 - 0.35, W / 2 + 0.25, 3);
    sun.target.position.set(L / 2, W / 2, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(RENDER3D.shadowMapSize, RENDER3D.shadowMapSize);
    const sc = sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = 5;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.002;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    this.table = buildTable(geom, this.palette);
    this.scene.add(this.table.group);
    void this.loadModels();

    const sphere = new THREE.SphereGeometry(this.R, RENDER3D.ballSegments.width, RENDER3D.ballSegments.height);
    for (const def of ballDefs) {
      const mat = new THREE.MeshPhysicalMaterial({ map: ballTexture(def, this.gl), roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.06 });
      const m = new THREE.Mesh(sphere, mat);
      m.castShadow = true;
      m.visible = false;
      this.balls.set(def.id, m);
      this.scene.add(m);
    }

    const flat = (inner: number, outer: number, color: number, opacity: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.renderOrder = 2;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.highlight = flat(this.R * 1.15, this.R * 1.27, 0xffffff, 0.85);
    this.placement = flat(this.R * 1.3, this.R * 1.45, 0x78ffa0, 0.95);

    this.ghost = new THREE.Group();
    this.ghost.add(new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false })));
    const ghostRing = new THREE.Mesh(new THREE.RingGeometry(this.R * 0.94, this.R, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    ghostRing.position.z = -this.R + RENDER3D.aimLine.lift;
    this.ghost.add(ghostRing);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.cue = this.buildCue();
    this.scene.add(this.cue);

    const aimMat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.aimMeshes = [aimMat(0xffffff, 0.75), aimMat(0xffd666, 0.9), aimMat(0x8cc8ff, 0.9)].map((m) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      return mesh;
    });

    const guideMesh = (color: number, opacity: number) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), aimMat(color, opacity));
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      return mesh;
    };
    const arrival = new THREE.Mesh(new THREE.RingGeometry(this.R * 0.9, this.R * 1.25, 40), aimMat(0xff9ad5, 0.95));
    arrival.visible = false;
    arrival.renderOrder = 2;
    this.scene.add(arrival);
    const dotGeom = new THREE.CircleGeometry(this.R * 0.35, 20);
    const dots = Array.from({ length: GUIDE.maxCushions }, () => {
      const m = new THREE.Mesh(dotGeom, aimMat(0xff7ad9, 1));
      m.visible = false;
      m.renderOrder = 2;
      this.scene.add(m);
      return m;
    });
    this.guideMeshes = { path: guideMesh(0xff7ad9, 0.85), system: guideMesh(0xffa64d, 0.9), arrival, dots };

    for (let i = 0; i < RENDER3D.ringPool; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 3;
      this.ringPool.push(m);
      this.scene.add(m);
    }

    this.camera = new THREE.PerspectiveCamera(RENDER3D.fovDeg, 1, 0.01, 50);
    this.camera.up.copy(UP);
    this.ballPlane = new THREE.Plane(UP.clone(), -this.R);
  }

  /** The game is already playable; each model simply appears when it arrives. */
  private async loadModels(): Promise<void> {
    const { length: L, width: W } = this.geom;
    const [room, legs, cue] = await Promise.all([
      loadModel(MODELS.room, { cast: false, receive: true }),
      loadModel(MODELS.legs[this.geom.spec.id], { cast: false, receive: false }),
      loadModel(MODELS.cue, { cast: true, receive: false }),
    ]);
    if (this.disposed) return;
    if (legs) this.scene.add(legs);
    if (cue) this.useCueModel(cue);
    if (room) {
      // The room's origin is the table centre.
      room.position.set(L / 2, W / 2, 0);
      this.scene.add(room);
      this.room = room;
      room.updateWorldMatrix(true, true);
      room.traverse((o) => {
        if (o.name.startsWith('Lamp')) this.lampBox.expandByObject(o);
        if (o.name.startsWith('Lamp') || o.name.startsWith('Cord')) this.lampParts.push(o);
      });
      const s = MODELS.lampSun;
      this.sun.position.set(L / 2 + s.offsetX, W / 2 + s.offsetY, s.height);
    }
  }

  setFelt(color: string | null): void {
    this.palette.felt = color ?? this.geom.spec.colors.felt;
    this.table.felt.color.set(this.palette.felt);
  }

  /** Match the drawing buffers to the canvas' CSS size. Call on container resize. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, RENDER3D.maxPixelRatio);
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(this.cssW, this.cssH, false);
    this.overlay.width = Math.round(this.cssW * this.dpr);
    this.overlay.height = Math.round(this.cssH * this.dpr);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();
    const L = this.geom.length + 2 * this.geom.spec.railWidth;
    const W = this.geom.width + 2 * this.geom.spec.railWidth;
    const a = this.camera.aspect;
    this.portrait = Math.min(a / W, 1 / L) > Math.min(a / L, 1 / W) * RENDER3D.portraitGain;
  }

  dispose(): void {
    this.disposed = true;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.scene.environment?.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }

  /** Turn the balls by their angular velocity (called once per physics step while animating). */
  spinBalls(balls: readonly BallState[], dt: number): void {
    const axis = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const b of balls) {
      if (b.pocketed) continue;
      const w = Math.hypot(b.wx, b.wy, b.wz);
      if (w < 1e-6) continue;
      const m = this.balls.get(b.id);
      if (!m) continue;
      axis.set(b.wx / w, b.wy / w, b.wz / w);
      q.setFromAxisAngle(axis, w * dt);
      m.quaternion.premultiply(q);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Screen mapping (input)

  toWorld(p: Vec2): Vec2 {
    const ndc = new THREE.Vector2((p.x / this.cssW) * 2 - 1, -(p.y / this.cssH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.ballPlane, hit)) return { x: hit.x, y: hit.y };
    // Above the horizon: a far point in the same direction.
    const d = this.raycaster.ray.direction;
    const o = this.raycaster.ray.origin;
    return { x: o.x + d.x * 100, y: o.y + d.y * 100 };
  }

  toScreen(p: Vec2, z = this.R): Vec2 {
    const v = new THREE.Vector3(p.x, p.y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.cssW, y: ((1 - v.y) / 2) * this.cssH };
  }

  // -------------------------------------------------------------------------------------------

  draw(frame: RenderFrame): void {
    // Layout can change without a resize notification (HUD lines appearing); keep the camera honest.
    if (Math.abs(this.canvas.clientWidth - this.cssW) > 0.5 || Math.abs(this.canvas.clientHeight - this.cssH) > 0.5) this.resize();
    const now = performance.now();
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    const R = this.R;
    const lift = RENDER3D.aimLine.lift;

    for (const m of this.balls.values()) m.visible = false;
    for (const b of frame.balls) {
      const m = this.balls.get(b.id);
      if (!m || b.pocketed) continue;
      m.visible = true;
      m.position.set(b.x, b.y, R);
    }

    const hl = frame.highlight ? frame.balls.find((b) => b.id === frame.highlight && !b.pocketed) : undefined;
    this.highlight.visible = !!hl && !frame.animating;
    if (hl) this.highlight.position.set(hl.x, hl.y, lift);

    this.placement.visible = !!frame.placement;
    if (frame.placement) {
      this.placement.position.set(frame.placement.at.x, frame.placement.at.y, lift * 1.5);
      (this.placement.material as THREE.MeshBasicMaterial).color.set(frame.placement.valid ? 0x78ffa0 : 0xff5a64);
    }

    this.updateAim(frame.aim);
    this.updateGuide(frame.animating ? undefined : frame.guide);
    this.updateCue(frame.cue);

    let i = 0;
    for (const r of frame.rings ?? []) {
      const m = this.ringPool[i++];
      if (!m) break;
      m.visible = true;
      const s = R * (1 + r.age * 2.2);
      m.scale.set(s, s, 1);
      m.position.set(r.at.x, r.at.y, lift * 2);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.set(r.color.startsWith('rgba') ? r.color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)') : r.color);
      mat.opacity = Math.max(0, 1 - r.age);
    }
    for (; i < this.ringPool.length; i++) this.ringPool[i].visible = false;

    if (frame.cue) this.lastCue = { at: frame.cue.at, angle: frame.cue.angle };
    this.updateCamera(frame, dt);
    this.gl.render(this.scene, this.camera);
    this.drawOverlay(frame.texts ?? [], frame.animating ? undefined : frame.guide);
  }

  // -------------------------------------------------------------------------------------------
  // Camera

  private updateCamera(frame: RenderFrame, dt: number): void {
    const g = this.geom;
    const L = g.length;
    const W = g.width;
    const centre = new THREE.Vector3(L / 2, W / 2, 0);
    // Rolling balls are always watched from straight above so the whole path shows.
    const aerial = frame.animating || (this.aerialAim && !frame.holdCamera);
    const overhead = this.cameraMode === 'top' || !this.lastCue || aerial;
    if (overhead) {
      const ex = L / 2 + g.spec.railWidth;
      const ey = W / 2 + g.spec.railWidth;
      const tanV = Math.tan((RENDER3D.fovDeg / 2) * DEG);
      const vert = this.portrait ? ex : ey;
      const horiz = this.portrait ? ey : ex;
      const d = Math.max(vert / tanV, horiz / (tanV * this.camera.aspect)) * (1 + RENDER3D.topViewMargin) + this.table.railTop;
      this.want.pos.set(centre.x, centre.y, d);
      this.want.target.copy(centre);
      // Portrait: table x runs down the screen (screen-up = −x).
      this.want.up.set(this.portrait ? -1 : 0, this.portrait ? 0 : 1, 0);
    } else if (frame.holdCamera) {
      // keep the previous target pose
    } else if (frame.cue && !frame.animating) {
      const { at, angle } = frame.cue;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const v = RENDER3D.cueView;
      // A raised cue would fill the screen: lift the camera and step a little to the side with it.
      const lift = Math.sin((frame.cue.elevation ?? 0) * DEG);
      const side = v.raisedSideStep * lift;
      this.want.pos.set(at.x - dx * v.distance + dy * side, at.y - dy * v.distance - dx * side, v.height + v.raisedLift * lift);
      this.want.target.set(at.x + dx * v.lookAhead, at.y + dy * v.lookAhead, 0);
      this.want.up.copy(UP);
    } else if (frame.animating && this.lastCue) {
      // Pull back and up until the whole table (rails included) fits, looking along the shot.
      const dx = Math.cos(this.lastCue.angle);
      const dy = Math.sin(this.lastCue.angle);
      const ex = L / 2 + g.spec.railWidth;
      const ey = W / 2 + g.spec.railWidth;
      const along = Math.abs(dx) * ex + Math.abs(dy) * ey;
      const across = Math.abs(dy) * ex + Math.abs(dx) * ey;
      const tanV = Math.tan((RENDER3D.fovDeg / 2) * DEG);
      const tilt = RENDER3D.overview.tiltDeg * DEG;
      // The tilt foreshortens the table along the view; cos(tilt) is enough for these angles.
      const d = Math.max((along * Math.cos(tilt)) / tanV, across / (tanV * this.camera.aspect)) * (1 + RENDER3D.overview.margin);
      this.want.pos.set(centre.x - dx * d * Math.sin(tilt), centre.y - dy * d * Math.sin(tilt), d * Math.cos(tilt));
      this.want.target.copy(centre);
      this.want.up.copy(UP);
    }

    if (!this.cam.ready) {
      this.cam.pos.copy(this.want.pos);
      this.cam.target.copy(this.want.target);
      this.cam.up.copy(this.want.up);
      this.cam.ready = true;
    } else {
      const k = 1 - Math.exp(-RENDER3D.cameraFollowRate * dt);
      this.cam.pos.lerp(this.want.pos, k);
      this.cam.target.lerp(this.want.target, k);
      this.cam.up.lerp(this.want.up, k);
      if (this.cam.up.lengthSq() < 1e-6) this.cam.up.copy(this.want.up);
    }
    this.camera.position.copy(this.cam.pos);
    this.camera.up.copy(this.cam.up).normalize();
    this.camera.lookAt(this.cam.target);
    this.camera.updateMatrixWorld();
    this.updateRoomVisibility(overhead);
  }

  /** Keep the room out of overhead views and camera moves, and never let the camera run into the lamp. */
  private updateRoomVisibility(overhead: boolean): void {
    if (!this.room) return;
    const pos = this.camera.position;
    this.room.visible = !overhead && pos.z <= MODELS.roomMaxCameraHeight;
    const lampVisible = this.lampBox.distanceToPoint(pos) >= MODELS.lampClearance;
    for (const part of this.lampParts) part.visible = lampVisible;
  }

  // -------------------------------------------------------------------------------------------
  // Cue stick

  private buildCue(): THREE.Group {
    const c = RENDER3D.cue;
    const mat = (color: number, rough = 0.35) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05, transparent: true });
      this.cueMaterials.push(m);
      return m;
    };
    // Built along +y from the tip, then laid along −x (towards the butt).
    const parts: [number, number, number, THREE.Material][] = [
      // length, radius at tip end, radius at butt end, material
      [0.012, c.tipRadius, c.tipRadius, mat(0x3f8fe0, 0.9)],
      [0.022, c.tipRadius, c.tipRadius * 1.02, mat(0xf4f1e6, 0.4)],
      [c.length * 0.62, c.tipRadius * 1.02, c.buttRadius * 0.78, mat(0xe2c99a)],
      [0.02, c.buttRadius * 0.78, c.buttRadius * 0.8, mat(0x1c1c1c, 0.3)],
      [c.length * 0.34, c.buttRadius * 0.8, c.buttRadius * 0.95, mat(0x2a160b, 0.3)],
    ];
    const used = parts.reduce((s, p) => s + p[0], 0);
    parts.push([c.length - used, c.buttRadius * 0.95, c.buttRadius, mat(0x101010, 0.5)]);
    const inner = new THREE.Group();
    let y = 0;
    for (const [len, r0, r1, m] of parts) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 20), m);
      mesh.position.y = y + len / 2;
      mesh.castShadow = true;
      inner.add(mesh);
      y += len;
    }
    inner.rotation.z = Math.PI / 2; // +y → −x
    const g = new THREE.Group();
    g.rotation.order = 'ZYX';
    g.add(inner);
    g.visible = false;
    return g;
  }

  /** Swap the built-in cylinders for the model; `updateCue` keeps moving the same outer group. */
  private useCueModel(model: THREE.Group): void {
    const inner = this.cue.children[0];
    for (const part of [...inner.children]) {
      inner.remove(part);
      (part as THREE.Mesh).geometry.dispose();
    }
    for (const m of this.cueMaterials) m.dispose();
    // Clones, all transparent: the opponent's cue is drawn see-through.
    this.cueMaterials = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      m.transparent = true;
      mesh.material = m;
      this.cueMaterials.push(m);
    });
    inner.add(model);
  }

  private updateCue(cue: CueOverlay | undefined): void {
    if (!cue) {
      this.cue.visible = false;
      return;
    }
    const c = RENDER3D.cue;
    const R = this.R;
    const dx = Math.cos(cue.angle);
    const dy = Math.sin(cue.angle);
    const pull = c.gap + cue.pull * c.maxPull;
    let sx = cue.spinX ?? 0;
    let sy = cue.spinY ?? 0;
    const sl = Math.hypot(sx, sy);
    if (sl > 1) {
      sx /= sl;
      sy /= sl;
    }
    // Raise the butt at least enough to clear the rail behind the cue ball.
    let elev = Math.max(c.minElevationDeg, cue.elevation ?? 0) * DEG;
    const toRail = this.distanceToRail(cue.at, -dx, -dy) - R - pull;
    const rise = this.table.railTop + c.railClearance - R;
    if (toRail > 0.01 && rise > 0) elev = Math.max(elev, Math.atan2(rise, toRail));
    elev = Math.min(elev, 85 * DEG);
    // Same geometry as Simulation.strike: cue axis c, tip offset ê ⟂ c, contact on the sphere.
    const ca = Math.cos(elev);
    const sa = Math.sin(elev);
    const axis = new THREE.Vector3(dx * ca, dy * ca, -sa);
    const up = new THREE.Vector3(dx * sa, dy * sa, ca);
    const right = new THREE.Vector3(dy, -dx, 0);
    const e = right.multiplyScalar(sx * this.maxTipOffset).addScaledVector(up, sy * this.maxTipOffset);
    const n = Math.sqrt(Math.max(0, 1 - e.lengthSq()));
    const tip = new THREE.Vector3(cue.at.x, cue.at.y, R)
      .addScaledVector(e, R)
      .addScaledVector(axis, -(R * n + pull));
    this.cue.position.copy(tip);
    this.cue.rotation.set(0, elev, cue.angle);
    this.cue.visible = true;
    for (const m of this.cueMaterials) m.opacity = cue.ghost ? 0.45 : 1;
  }

  /** Distance from p along (dx, dy) to the outer edge of the cushions. */
  private distanceToRail(p: Vec2, dx: number, dy: number): number {
    const cw = this.geom.spec.cushionWidth;
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (this.geom.length + cw - p.x) / dx);
    if (dx < -1e-9) t = Math.min(t, (-cw - p.x) / dx);
    if (dy > 1e-9) t = Math.min(t, (this.geom.width + cw - p.y) / dy);
    if (dy < -1e-9) t = Math.min(t, (-cw - p.y) / dy);
    return t;
  }

  // -------------------------------------------------------------------------------------------
  // Aim guide

  private updateAim(aim: AimPrediction | undefined): void {
    if (aim === this.lastAim) return;
    this.lastAim = aim;
    const a = RENDER3D.aimLine;
    const [path, obj, defl] = this.aimMeshes;
    path.geometry.dispose();
    obj.geometry.dispose();
    defl.geometry.dispose();
    path.geometry = ribbon(aim?.cuePath ?? [], a.width * 0.8, a.lift, true);
    obj.geometry = ribbon(aim?.objectPath ?? [], a.width, a.lift, false);
    defl.geometry = ribbon(aim?.deflectPath ?? [], a.width, a.lift, false);
    this.ghost.visible = !!aim?.ghost;
    if (aim?.ghost) this.ghost.position.set(aim.ghost.x, aim.ghost.y, this.R);
  }

  // -------------------------------------------------------------------------------------------
  // Practice guide

  private updateGuide(guide: GuideOverlay | undefined): void {
    if (guide === this.lastGuide) return;
    this.lastGuide = guide;
    const g = this.guideMeshes;
    const a = RENDER3D.aimLine;
    g.path.geometry.dispose();
    g.system.geometry.dispose();
    g.path.geometry = ribbon(guide?.trajectory ?? [], a.width, a.lift * 1.5, false);
    g.system.geometry = ribbon(guide?.systemLine ?? [], a.width * 0.8, this.table.railTop + 0.001, true);
    g.arrival.visible = !!guide?.arrival;
    if (guide?.arrival) g.arrival.position.set(guide.arrival.x, guide.arrival.y, a.lift * 2);
    g.dots.forEach((m, i) => {
      const p = guide?.cushions?.[i];
      m.visible = !!p;
      if (p) m.position.set(p.x, p.y, a.lift * 2.5);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Floating texts (2D overlay)

  private drawOverlay(texts: FloatingText[], guide: GuideOverlay | undefined): void {
    const ctx = this.octx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (texts.length === 0 && !guide?.labels?.length) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of guide?.labels ?? []) {
      const p = this.toScreen(l.at, l.onRail ? this.table.railTop : 0.001);
      if (p.x < -20 || p.y < -20 || p.x > this.cssW + 20 || p.y > this.cssH + 20) continue;
      ctx.font = `${l.bold ? 700 : 500} ${l.bold ? 13 : 11}px "IBM Plex Sans KR", system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(l.text, p.x, p.y);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, p.x, p.y);
    }
    for (const t of texts) {
      const p = this.toScreen(t.at);
      const size = t.size ?? 28;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t.age * t.age);
      ctx.font = `${size}px "Black Han Sans", "IBM Plex Sans KR", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const y = p.y - 30 - t.age * 24;
      ctx.strokeText(t.text, p.x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, p.x, y);
      ctx.restore();
    }
  }
}

/** Flat strip on the cloth along a polyline (optionally dashed). */
function ribbon(points: readonly Vec2[], width: number, z: number, dashed: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const quad = (a: Vec2, b: Vec2) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return;
    const nx = (-dy / l) * (width / 2);
    const ny = (dx / l) * (width / 2);
    pos.push(a.x + nx, a.y + ny, z, a.x - nx, a.y - ny, z, b.x + nx, b.y + ny, z);
    pos.push(b.x + nx, b.y + ny, z, a.x - nx, a.y - ny, z, b.x - nx, b.y - ny, z);
  };
  const { dash, gap } = RENDER3D.aimLine;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!dashed) {
      quad(a, b);
      continue;
    }
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s < l; s += dash + gap) {
      const e = Math.min(l, s + dash);
      quad({ x: a.x + ((b.x - a.x) * s) / l, y: a.y + ((b.y - a.y) * s) / l }, { x: a.x + ((b.x - a.x) * e) / l, y: a.y + ((b.y - a.y) * e) / l });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
