import { h } from './dom';

const PC: [string, string][] = [
  ['시점', '오른쪽 위 🎥/🗺️ 버튼으로 큐 뒤 시점과 위 시점을 바꿉니다. 공이 굴러갈 때는 항상 위에서 봅니다'],
  ['연습 도우미', '연습 모드의 〰️ 궤적 버튼은 수구가 실제로 갈 길을, 📐 시스템 버튼은 3쿠션 파이브 앤 하프 계산을 보여 줍니다'],
  ['조준 (큐 뒤 시점)', '테이블을 누른 채 좌우로 끌면 큐가 돌아갑니다'],
  ['샷 (큐 뒤 시점)', '테이블을 누른 채 아래로 당겼다가 놓기 (많이 당길수록 세게). 파워 막대를 끌어도 됩니다'],
  ['조준 (위 시점)', '마우스를 움직이면 큐가 따라옵니다'],
  ['샷 (위 시점)', '테이블을 누른 채 뒤로 당겼다가 놓기 (많이 당길수록 세게). 파워 막대를 끌어도 됩니다'],
  ['미세 조준', '← → 키 (Shift를 누르면 크게)'],
  ['당점', 'W/A/S/D 키, 또는 공 그림을 클릭 (더블클릭하면 가운데)'],
  ['큐 각도', 'Q(세우기)/E(눕히기) 키, 또는 큐 그림을 위아래로 끌기 (더블클릭하면 수평). 세우고 옆을 치면 공이 휘어요 (마세)'],
  ['프리볼', '흰 공을 끌어서 원하는 곳에 놓기'],
  ['취소', '당기는 중에 Esc'],
];

const PHONE: [string, string][] = [
  ['시점', '🎥/🗺️ 버튼으로 큐 뒤 시점과 위 시점을 바꿉니다. 공이 굴러갈 때는 항상 위에서 봅니다'],
  ['연습 도우미', '연습 모드의 〰️ 궤적 버튼은 수구가 실제로 갈 길을, 📐 시스템 버튼은 3쿠션 파이브 앤 하프 계산을 보여 줍니다'],
  ['조준 (큐 뒤 시점)', '테이블을 손가락으로 좌우로 끌면 큐가 돌아갑니다'],
  ['조준 (위 시점)', '큐에서 떨어진 곳을 손가락으로 누르거나 끌면 그쪽을 겨눕니다'],
  ['미세 조준', '⟲ ⟳ 버튼 (누르고 있으면 계속 돌아갑니다)'],
  ['샷 (큐 뒤 시점)', '테이블을 손가락으로 누른 채 아래로 당겼다가 떼면 칩니다 (많이 끌수록 세게). 아래쪽에 자리가 없으면 위로 끌어도 됩니다'],
  ['샷 (위 시점)', '수구나 큐를 손가락으로 누른 채 끌었다가 떼면 칩니다 (많이 끌수록 세게). 모서리에서는 화면 안쪽으로 끌어도 됩니다'],
  ['파워 막대', '막대를 끌었다 떼어도 칩니다 (보조 조작)'],
  ['취소', '손가락을 처음 누른 자리의 동그라미 안으로 되돌려 떼기, 또는 다른 손가락으로 화면 아무 곳이나 톡 누르기. 파워 막대는 손가락을 막대 밖으로 빼고 떼기'],
  ['당점', '공 그림을 누르거나 끌기 (두 번 누르면 가운데)'],
  ['큐 각도', '큐 그림을 위아래로 끌기 (두 번 누르면 수평). 세우고 옆을 치면 공이 휘어요 (마세)'],
  ['프리볼', '흰 공을 손가락으로 끌어서 놓기'],
];

const table = (rows: [string, string][]) =>
  h('dl.help-list', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

/** 조작법 안내 창 (컴퓨터 + 스마트폰). */
export function showHelp(): void {
  const close = () => {
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const overlay = h(
    'div.overlay',
    { onclick: (e: Event) => e.target === overlay && close() },
    h(
      'div.help-panel',
      {},
      h('div.help-head', {}, h('h2', {}, '조작법'), h('button.btn.ghost', { onclick: close }, '닫기')),
      h('h3', {}, '🖱️ 컴퓨터'),
      table(PC),
      h('h3', {}, '📱 스마트폰'),
      table(PHONE),
    ),
  );
  window.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
}

export function helpButton(label = '조작법'): HTMLButtonElement {
  return h('button.btn.ghost', { onclick: showHelp, title: '조작법 보기' }, label) as HTMLButtonElement;
}
