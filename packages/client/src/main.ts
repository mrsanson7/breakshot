import './styles.css';
import {
  buildTableGeometry,
  createRng,
  DISCIPLINES,
  eightBallRack,
  PHYSICS,
  Simulation,
  TABLES,
  threeCushionBreak,
  fourBallBreak,
  type DisciplineId,
  type BallPosition,
} from '@breakshot/shared';
import { TableRenderer } from './render/renderer';
import { FixedLoop } from './game/loop';

// Milestone 1 viewer: the three tables, their layouts and the fixed-step loop.
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="m1">
    <header class="m1-bar">
      <strong>Break Shot · M1</strong>
      <span class="tabs"></span>
      <button id="shot">랜덤 샷</button>
      <span id="stats" class="muted"></span>
    </header>
    <div class="stage"><canvas id="table"></canvas></div>
  </div>`;
const tabs = app.querySelector('.tabs')!;
const canvas = app.querySelector<HTMLCanvasElement>('#table')!;
const stats = app.querySelector<HTMLSpanElement>('#stats')!;

let discipline: DisciplineId = 'threeCushion';
let tableId = DISCIPLINES[discipline].defaultTable;
let geom = buildTableGeometry(TABLES[tableId]);
const renderer = new TableRenderer(canvas, geom, DISCIPLINES[discipline].balls);
let sim = new Simulation(geom, PHYSICS.carom, layout());
let prev = sim.balls.map((b) => ({ ...b }));
const rng = createRng(Date.now() & 0xffff);

function layout(): BallPosition[] {
  const spec = TABLES[tableId];
  if (discipline === 'eightBall') return eightBallRack(spec, rng ?? Math.random, PHYSICS.pool.rackGap);
  if (discipline === 'threeCushion') return threeCushionBreak(spec, 'white', 'yellow', 1);
  return fourBallBreak(spec, 'white', 'yellow', 1);
}

function select(d: DisciplineId, t = DISCIPLINES[d].defaultTable) {
  discipline = d;
  tableId = t;
  geom = buildTableGeometry(TABLES[t]);
  renderer.setTable(geom, DISCIPLINES[d].balls);
  sim = new Simulation(geom, PHYSICS[DISCIPLINES[d].physics], layout());
  prev = sim.balls.map((b) => ({ ...b }));
  renderTabs();
}

function renderTabs() {
  tabs.innerHTML = '';
  for (const d of Object.values(DISCIPLINES)) {
    for (const t of d.tables) {
      const b = document.createElement('button');
      b.textContent = d.tables.length > 1 ? `${d.name} · ${TABLES[t].name}` : d.name;
      b.className = d.id === discipline && t === tableId ? 'on' : '';
      b.onclick = () => select(d.id, t);
      tabs.appendChild(b);
    }
  }
}

app.querySelector<HTMLButtonElement>('#shot')!.onclick = () => {
  const cue = discipline === 'eightBall' ? 'cue' : 'white';
  sim = new Simulation(geom, sim.phys, sim.balls.some((b) => b.pocketed && b.id === cue) ? layout() : sim.balls.map((b) => ({ ...b, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0 })));
  sim.strike(cue, { angle: rng() * Math.PI * 2, power: 0.4 + rng() * 0.6, spinX: rng() - 0.5, spinY: rng() - 0.5 });
};

const loop = new FixedLoop(
  PHYSICS.carom.timeStep,
  () => {
    prev = sim.balls.map((b) => ({ ...b }));
    if (sim.isMoving()) sim.step();
  },
  (alpha) => {
    const balls = sim.balls.map((b, i) => ({
      id: b.id,
      pocketed: b.pocketed,
      x: prev[i].x + (b.x - prev[i].x) * alpha,
      y: prev[i].y + (b.y - prev[i].y) * alpha,
    }));
    renderer.draw({ balls });
    stats.textContent = `${Math.round(loop.fps)} fps · 물리 ${loop.stepsLastFrame}스텝/프레임 · t=${sim.time.toFixed(2)}s`;
  },
);

new ResizeObserver(() => renderer.resize()).observe(canvas);
renderTabs();
renderer.resize();
loop.start();
