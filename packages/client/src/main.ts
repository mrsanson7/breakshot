import './styles.css';
import { createRng, DISCIPLINES, eightBallRack, fourBallBreak, PHYSICS, TABLES, threeCushionBreak, type BallPosition, type DisciplineId, type TableId, type AimAssistLevel } from '@breakshot/shared';
import { GameScene } from './game/scene';
import { h } from './ui/dom';

// Milestone 3 sandbox: aim, pull-back power, guide lines and tip offset on every table.
const app = document.getElementById('app')!;
const rng = createRng(Date.now() & 0xffff);
let scene: GameScene | null = null;
let assist: AimAssistLevel = 'full';
const bar = h('header.m1-bar');
const holder = h('div.sandbox');
app.append(h('div.m1', {}, bar, holder));

function layout(d: DisciplineId, t: TableId): BallPosition[] {
  if (d === 'eightBall') return eightBallRack(TABLES[t], rng, PHYSICS.pool.rackGap);
  if (d === 'threeCushion') return threeCushionBreak(TABLES[t], 'white', 'yellow', 1);
  return fourBallBreak(TABLES[t], 'white', 'yellow', 1);
}

function open(d: DisciplineId, t: TableId) {
  scene?.dispose();
  holder.innerHTML = '';
  const cueBall = d === 'eightBall' ? 'cue' : 'white';
  const s: GameScene = new GameScene(t, d, {
    onShoot: async (req) => {
      await s.playShot(s.getBalls(), cueBall, req.input, null);
      const cue = s.getBalls().find((b) => b.id === cueBall)!;
      s.setTurn({ interactive: true, cueBall, ballInHand: cue.pocketed ? 'anywhere' : null, assist });
    },
  });
  scene = s;
  holder.append(s.el);
  s.setBalls(layout(d, t));
  s.setTurn({ interactive: true, cueBall, ballInHand: d === 'eightBall' ? 'kitchen' : null, assist });
  s.start();
  bar.innerHTML = '';
  bar.append(h('strong', {}, 'Break Shot · M3'));
  for (const dd of Object.values(DISCIPLINES))
    for (const tt of dd.tables)
      bar.append(h('button', { className: dd.id === d && tt === t ? 'on' : '', onclick: () => open(dd.id, tt) }, dd.tables.length > 1 ? `${dd.name} · ${TABLES[tt].name}` : dd.name));
  const sel = h('select', { onchange: (e: Event) => { assist = (e.target as HTMLSelectElement).value as AimAssistLevel; open(d, t); } },
    h('option', { value: 'full', selected: assist === 'full' }, '보조선: 길게'),
    h('option', { value: 'short', selected: assist === 'short' }, '보조선: 짧게 (경쟁전)'),
    h('option', { value: 'off', selected: assist === 'off' }, '보조선: 끄기'));
  bar.append(sel, h('span.muted', {}, '마우스로 조준 · 누른 채 뒤로 당겼다 놓기 · 방향키 0.1° (Shift 1°) · W/A/S/D 타점'));
}
open('threeCushion', 'caromLarge');
