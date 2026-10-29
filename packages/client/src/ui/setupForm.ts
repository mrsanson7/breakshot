import {
  defaultSettings,
  disciplineOfRuleSet,
  DISCIPLINES,
  RULE_DEFAULTS,
  RULE_LIMITS,
  RULESET_NAMES,
  TABLES,
  type DisciplineId,
  type PbaOpening,
  type RoomSettings,
  type RuleSetId,
  type TableId,
} from '@breakshot/shared';
import { clear, h } from './dom';
import { BREAK_LABELS } from './lobbyScreen';

export type SetupMode = 'online' | 'practice';

export interface SetupResult {
  settings: RoomSettings;
  /** Online: own nickname. Practice: both names. */
  names: [string, string];
  freePlay: boolean;
  /** Practice: who breaks first. */
  firstBreaker: 0 | 1 | 'random';
}

const ALL_RULESETS: RuleSetId[] = ['wpa8', 'umb3c', 'pba3c', 'korean4'];
const ALL_TABLES: TableId[] = ['pool9ft', 'caromLarge', 'caromMedium'];
const FELTS: { label: string; value: string | null }[] = [
  { label: '기본', value: null },
  { label: '초록', value: '#1f7a4a' },
  { label: '파랑', value: '#2c6bc4' },
  { label: '회청', value: '#3f6f8a' },
  { label: '와인', value: '#7a2a3a' },
];

type NumField = { key: string; label: string; min: number; max: number; get: (c: Record<string, unknown>) => number; set: (c: Record<string, unknown>, v: number) => void };
const num = (key: string, label: string, lim: { min: number; max: number }): NumField => ({
  key,
  label,
  min: lim.min,
  max: lim.max,
  get: (c) => c[key] as number,
  set: (c, v) => (c[key] = v),
});
const clockFields: NumField[] = [
  num('shotClock', '샷클락 (초, 0=없음)', RULE_LIMITS.shotClock),
  num('timeouts', '타임아웃(연장) 횟수', RULE_LIMITS.timeouts),
  num('extensionSeconds', '연장 시간 (초)', RULE_LIMITS.extensionSeconds),
];

const FIELDS: Record<RuleSetId, NumField[]> = {
  wpa8: [num('raceTo', '선승 래크 수', RULE_LIMITS.raceTo), ...clockFields],
  umb3c: [num('targetPoints', '목표 점수', RULE_LIMITS.targetPoints), ...clockFields],
  pba3c: [
    num('setPoints', '세트 점수', RULE_LIMITS.setPoints),
    num('finalSetPoints', '마지막 세트 점수', RULE_LIMITS.setPoints),
    num('setsToWin', '선승 세트 수', RULE_LIMITS.setsToWin),
    ...clockFields,
  ],
  korean4: [
    { key: 't0', label: '방장 목표 점수', ...RULE_LIMITS.fourBallTarget, get: (c) => (c.targets as number[])[0], set: (c, v) => ((c.targets as number[])[0] = v) },
    { key: 't1', label: '상대 목표 점수', ...RULE_LIMITS.fourBallTarget, get: (c) => (c.targets as number[])[1], set: (c, v) => ((c.targets as number[])[1] = v) },
    num('foulPenalty', '파울 감점 (0=없음)', RULE_LIMITS.foulPenalty),
    ...clockFields,
  ],
};

/** 방 만들기 / 연습 설정: 종목 → 룰셋 → 테이블 → 경기 설정. */
export function setupForm(mode: SetupMode, onSubmit: (r: SetupResult) => void, onBack: () => void, initialName = ''): HTMLElement {
  let settings: RoomSettings = defaultSettings('threeCushion');
  let freePlay = false;
  let firstBreaker: 0 | 1 | 'random' = 0;
  const names: [string, string] = [initialName || (mode === 'online' ? '' : '플레이어 1'), '플레이어 2'];
  const body = h('div.form-body');
  const root = h(
    'div.screen.setup',
    {},
    h('div.screen-head', {}, h('button.btn.ghost', { onclick: onBack }, '← 뒤로'), h('h2', {}, mode === 'online' ? '방 만들기' : '연습 모드')),
    body,
  );

  const pick = (d: DisciplineId) => {
    settings = defaultSettings(d);
    if (d === 'fourBall' && mode === 'practice') (settings.config as { targets: [number, number] }).targets = [10, 10];
    render();
  };

  function render(): void {
    clear(body);
    const disc = DISCIPLINES[settings.discipline];

    // 1. 종목
    body.append(
      h('h3', {}, '1. 종목'),
      h(
        'div.choices',
        {},
        Object.values(DISCIPLINES).map((d) =>
          h('button.choice', { className: `choice ${d.id === settings.discipline ? 'on' : ''}`, onclick: () => pick(d.id) }, d.name),
        ),
      ),
    );

    // 2. 룰셋 (종목에 따라 활성/비활성)
    body.append(
      h('h3', {}, '2. 룰셋'),
      h(
        'div.choices',
        {},
        ALL_RULESETS.map((r) =>
          h(
            'button.choice',
            {
              className: `choice ${r === settings.ruleSet ? 'on' : ''}`,
              disabled: !disc.ruleSets.includes(r),
              onclick: () => {
                settings = { ...settings, ruleSet: r, config: structuredClone(RULE_DEFAULTS[r]) };
                render();
              },
            },
            `${RULESET_NAMES[r]}`,
            h('small', {}, disciplineOfRuleSet(r).name),
          ),
        ),
      ),
    );

    // 3. 테이블
    body.append(
      h('h3', {}, '3. 테이블 규격'),
      h(
        'div.choices',
        {},
        ALL_TABLES.map((t) =>
          h(
            'button.choice',
            {
              className: `choice ${t === settings.table ? 'on' : ''}`,
              disabled: !disc.tables.includes(t),
              onclick: () => {
                settings = { ...settings, table: t };
                render();
              },
            },
            TABLES[t].name,
            h('small', {}, `${(TABLES[t].length * 1000).toFixed(0)} × ${(TABLES[t].width * 1000).toFixed(0)} mm`),
          ),
        ),
      ),
    );

    // 4. 경기 설정
    const cfg = settings.config as unknown as Record<string, unknown>;
    const grid = h('div.fields');
    for (const f of FIELDS[settings.ruleSet]) {
      const input = h('input', { type: 'number', min: f.min, max: f.max, value: String(f.get(cfg)) });
      input.addEventListener('change', () => {
        const v = Math.round(Number(input.value));
        const clamped = Math.min(f.max, Math.max(f.min, Number.isFinite(v) ? v : f.get(cfg)));
        f.set(cfg, clamped);
        input.value = String(clamped);
      });
      grid.append(h('label.field', {}, h('span', {}, f.label), input));
    }
    if (settings.ruleSet === 'umb3c') grid.append(checkbox('동점 이닝 (UMB 이퀄라이징)', cfg, 'equalizingInning'));
    if (settings.ruleSet === 'pba3c') {
      const bank = cfg.bankShot as Record<string, unknown>;
      grid.append(checkbox('뱅크샷 2점', bank, 'enabled'));
      grid.append(pbaOpeningField(cfg.opening as PbaOpening));
    }
    if (settings.ruleSet === 'wpa8') {
      grid.append(
        select('다음 래크 브레이크', cfg, 'breakRotation', [
          ['alternate', '번갈아'],
          ['winner', '이긴 사람'],
        ]),
      );
    }
    body.append(h('h3', {}, '4. 경기 설정'), grid);

    // 5. 기타
    const misc = h('div.fields');
    misc.append(
      select('조준 보조선', settings as unknown as Record<string, unknown>, 'aimAssist', [
        ['full', '길게'],
        ['short', '짧게 (경쟁전)'],
        ['off', '끄기'],
      ]),
      h(
        'label.field',
        {},
        h('span', {}, '펠트 색'),
        h(
          'select',
          {
            onchange: (e: Event) => {
              const i = Number((e.target as HTMLSelectElement).value);
              settings.felt = FELTS[i].value;
            },
          },
          FELTS.map((f, i) => h('option', { value: String(i), selected: f.value === settings.felt }, f.label)),
        ),
      ),
    );
    if (mode === 'online') {
      misc.append(
        select('선공(초구) 결정', settings as unknown as Record<string, unknown>, 'breakDecision', [
          ['random', BREAK_LABELS.random],
          ['lag', BREAK_LABELS.lag],
          ['host', BREAK_LABELS.host],
          ['guest', BREAK_LABELS.guest],
        ]),
      );
    } else {
      misc.append(
        h(
          'label.field',
          {},
          h('span', {}, '연습 방식'),
          h(
            'select',
            { onchange: (e: Event) => (freePlay = (e.target as HTMLSelectElement).value === 'free') },
            h('option', { value: 'rules', selected: !freePlay }, '규칙대로 (혼자 두 사람 몫)'),
            h('option', { value: 'free', selected: freePlay }, '자유 연습 (항상 내 차례)'),
          ),
        ),
        h(
          'label.field',
          {},
          h('span', {}, '선공(초구)'),
          h(
            'select',
            {
              onchange: (e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                firstBreaker = v === 'random' ? 'random' : (Number(v) as 0 | 1);
              },
            },
            h('option', { value: '0', selected: firstBreaker === 0 }, '플레이어 1'),
            h('option', { value: '1', selected: firstBreaker === 1 }, '플레이어 2'),
            h('option', { value: 'random', selected: firstBreaker === 'random' }, '랜덤'),
          ),
        ),
      );
    }
    body.append(h('h3', {}, '5. 기타'), misc);

    // Names + submit
    const nameInput = h('input', { type: 'text', maxLength: 16, placeholder: '닉네임', value: names[0] });
    nameInput.addEventListener('input', () => (names[0] = nameInput.value));
    const submit = h('button.btn.primary.big', {}, mode === 'online' ? '방 만들기' : '시작');
    const err = h('div.error');
    submit.addEventListener('click', () => {
      const nick = names[0].trim();
      if (mode === 'online' && !nick) {
        err.textContent = '닉네임을 입력하세요.';
        nameInput.focus();
        return;
      }
      onSubmit({ settings: structuredClone(settings), names: [nick || '플레이어 1', names[1]], freePlay, firstBreaker });
    });
    body.append(h('div.submit-row', {}, mode === 'online' ? h('label.field.inline', {}, h('span', {}, '닉네임'), nameInput) : null, submit), err);
  }

  render();
  return root;
}

function checkbox(label: string, obj: Record<string, unknown>, key: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: !!obj[key] });
  input.addEventListener('change', () => (obj[key] = input.checked));
  return h('label.field.check', {}, input, h('span', {}, label));
}

function select(label: string, obj: Record<string, unknown>, key: string, options: [string, string][]): HTMLElement {
  return h(
    'label.field',
    {},
    h('span', {}, label),
    h(
      'select',
      { onchange: (e: Event) => (obj[key] = (e.target as HTMLSelectElement).value) },
      options.map(([v, l]) => h('option', { value: v, selected: obj[key] === v }, l)),
    ),
  );
}

/** PBA 초구 배치: drawn by card after the lag, or fixed spots (수구 1–3, 상대 공 4–6, 빨간 공 7–9). */
function pbaOpeningField(o: PbaOpening): HTMLElement {
  const spotSelect = (i: 0 | 1 | 2, from: number) =>
    h(
      'select',
      { disabled: o.mode === 'draw', onchange: (e: Event) => (o.spots[i] = Number((e.target as HTMLSelectElement).value)) },
      [from, from + 1, from + 2].map((n) => h('option', { value: String(n), selected: o.spots[i] === n }, String(n))),
    );
  const spots = [spotSelect(0, 1), spotSelect(1, 4), spotSelect(2, 7)];
  const mode = h(
    'select',
    {
      onchange: (e: Event) => {
        o.mode = (e.target as HTMLSelectElement).value as PbaOpening['mode'];
        for (const sel of spots) (sel as HTMLSelectElement).disabled = o.mode === 'draw';
      },
    },
    h('option', { value: 'draw', selected: o.mode === 'draw' }, '추첨 (경기마다 한 번)'),
    h('option', { value: 'fixed', selected: o.mode === 'fixed' }, '지정'),
  );
  return h(
    'label.field.pba-opening',
    {},
    h('span', {}, '초구 배치 (수구-상대 공-빨간 공)'),
    mode,
    h('div.row', {}, spots[0], '-', spots[1], '-', spots[2]),
  );
}
