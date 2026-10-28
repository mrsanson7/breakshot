# Break Shot — 구현 계획

기획 명세 v2를 기준으로 한 설계와 작업 순서입니다. 구현 중 바뀐 점은 이 문서와 README에 함께 반영합니다.

## 1. 모노레포 폴더 구조

```
breakshot/
├─ package.json            # 루트 스크립트: dev / build / test / typecheck
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ vitest.config.ts        # 3개 패키지 테스트를 한 번에 실행
├─ README.md               # 실행법, 가정, "확인 필요" 목록, 물리 수치 변경 이력
├─ docs/PLAN.md
└─ packages/
   ├─ shared/              # 렌더링·네트워크 의존성 없음 (순수 TS)
   │  ├─ src/config/       # tables.ts, physics.ts, rules.ts, disciplines.ts  ← 모든 수치는 여기만
   │  ├─ src/math/         # vec2, 결정적 난수(rng)
   │  ├─ src/physics/      # 공 상태, 큐 타격, 충돌 검출(TOI), 시뮬레이션, 샷 이벤트 로그
   │  ├─ src/rules/        # RuleSet 인터페이스 + 8볼/UMB/PBA/4구 구현 + 레지스트리
   │  ├─ src/game/         # 상태 머신 정의, 경기 진행 엔진(Match), 초구 배치
   │  ├─ src/aim/          # 조준 보조선 예측(레이캐스트)
   │  ├─ src/net/          # 메시지 타입 + zod 스키마
   │  └─ test/
   ├─ client/              # Vite + Canvas 2D
   │  └─ src/  render/ input/ ui/(화면들) session/(연습·온라인) net/ audio/
   └─ server/              # Node + ws
      └─ src/  index.ts rooms/(Room, RoomManager) clock.ts  + test/
```

## 2. 핵심 모듈과 책임

| 모듈 | 책임 |
|---|---|
| `shared/config/tables.ts` | 종목별 테이블 크기, 공 지름·질량, 포켓 입구, 다이아몬드 위치, 펠트 색. 불확실한 값은 `TODO(확인 필요)` |
| `shared/config/physics.ts` | 타임스텝(1/240s), 반발계수, 미끄럼/구름/회전 마찰, 쿠션 접촉 높이, 최대 큐 속도 등 종목별 물리 프로필 |
| `shared/config/rules.ts` | 룰셋별 기본값(목표 점수, 세트, 샷클락, 타임아웃, 뱅크샷 기준, 4구 감점 옵션…) |
| `shared/physics` | 고정 스텝 시뮬레이션. 공-공/공-쿠션(선분+모서리점) 연속 충돌 검사(TOI)로 터널링 방지. 미끄럼→구름 전환, 상하·좌우 스핀. 결과로 **샷 이벤트 로그** 생성 |
| `shared/rules` | `RuleSet.evaluate(이벤트 로그, 경기 상태) → 득점·파울·턴 유지/교대·프리볼·세트/경기 종료`. 새 룰은 RuleSet 하나 + config 하나만 추가 |
| `shared/game` | 서버·클라 공용 상태 머신 `WaitingPlayers → Aiming → Shooting → Simulating → Resolving → (BallInHand) → Aiming / SetOver / GameOver`, 경기 진행(Match) |
| `shared/net` | 클라↔서버 메시지 정의와 zod 스키마 (서버에서 검증) |
| `client/render` | 테이블 크기에 맞춘 자동 스케일, 다이아몬드·포켓·공·큐·보조선 그리기 |
| `client/input` | 마우스 조준, 누른 채 당겨서 파워, 타점 위젯, 방향키 0.1° 미세 조준, 프리볼 드래그 |
| `client/session` | `PracticeSession`(로컬에서 Match 실행)과 `OnlineSession`(서버 결과 재생)이 같은 인터페이스 |
| `server/rooms` | 방 코드 발급, 참가/대기실, 입력 검증, 서버 권위 시뮬레이션·판정, 샷클락, 재접속, 몰수, 빈 방 정리 |

## 3. 클라이언트-서버 통신 흐름 (서버 권위)

```
A(내 턴)                         Server                              B(상대)
  │ createRoom/joinRoom ───────▶ │ 방 코드·세션 토큰 발급            │
  │ ◀──────── roomState(전체 스냅샷) ─────────────────────────────▶ │
  │ ready ─────────────────────▶ │ 둘 다 준비 → 선공 결정 → Aiming  │
  │ aim(각도·파워·타점) 10~20Hz ─▶ │ ─────── aim(중계) ─────────────▶ │ 상대 큐 미리보기
  │ shoot{seq, 각도, 파워, 타점, 프리볼 위치} ▶│
  │                              │ 검증: 내 턴? 단계? 범위? 프리볼 겹침?  (실패 → error)
  │                              │ shared 물리로 시뮬레이션 → RuleSet 판정 → 상태 갱신
  │ ◀── shotResult{입력, 시작 배치, 최종 위치, 이벤트, 판정, 다음 상태} ──▶ │
  │ 로컬에서 같은 입력으로 재생(애니메이션) → 끝나면 서버 최종 위치로 보정        │
  │                              │ 샷클락: 서버 기준 deadline, 초과 시 서버가 턴 처리
  │ (연결 끊김) ··· 자동 재접속 hello{세션 토큰} ▶│ roomState 전체 재전송
  │                              │ 60초 내 미복귀 → 상대에게 "몰수승 / 더 기다리기" 선택
```

- 세션 토큰은 탭 단위(sessionStorage)로 저장 → 새로고침해도 같은 자리로 복귀, 같은 브라우저 두 탭으로도 테스트 가능
- 결정성: 시뮬레이션은 같은 코드·같은 순서로 실행하고 난수는 서버가 시드로 생성(배치 등). 그래도 엔진 간 삼각함수 차이가 있을 수 있어 최종 위치는 서버 값이 기준

## 4. 마일스톤 계획

| # | 내용 | 확인 방법 |
|---|---|---|
| 1 | 모노레포, 세 테이블 렌더링(다이아몬드·포켓), 고정 타임스텝 루프 | `pnpm dev` → 종목 전환 시 테이블 스케일·다이아몬드 확인 |
| 2 | 물리 엔진 + 단위 테스트 | `pnpm test`: 에너지 감소, 겹침·관통 없음, 결정성, 스핀 효과 |
| 3 | 조준·파워·보조선·타점·미세 조준 | 브라우저에서 샌드박스 샷 |
| 4 | 룰 엔진 4종 + 득점·파울·종료 테스트 | `pnpm test` |
| 5 | 오프라인 연습 모드에서 세 종목 플레이 (중간 MVP) | 타이틀 → 연습 모드 |
| 6 | 게임 서버: 방, 서버 권위 샷, 동기화, 샷클락 + 서버 테스트 | `pnpm test`, 스크립트로 두 클라이언트 접속 |
| 7 | 로비·대기실·상대 조준 미리보기·재접속 (온라인 MVP) | 브라우저 두 개로 방 코드 접속 |
| 8 | 사운드, 이펙트, 결과 화면, 리플레이 | 브라우저 |
| 9 | Dockerfile, 환경변수, 모바일 터치 | `docker build`, 모바일 폭 테스트 |

각 마일스톤은 커밋 하나 이상으로 정리합니다.

## 5. 주요 가정 (README에 계속 갱신)

- 좌표계: 테이블 왼쪽 아래 쿠션 코(nose) 교차점이 원점, x는 긴 쪽, y는 위쪽, 단위 m
- 큐는 수평 타격만 모델링(마세·점프 없음), 스쿼트(큐볼 편향) 없음
- 8볼은 콜샷 없이 진행(옵션으로 남김), 브레이크 스크래치·비합법 브레이크는 상대 프리볼로 단순화
- 4구 초구 배치와 감점 여부는 지역 차가 있어 config 옵션으로 둠
- 뱅킹(레그)은 각자 헤드 스트링에서 한 번씩 쳐서 헤드 쿠션에 더 가까이 멈춘 쪽이 선공
