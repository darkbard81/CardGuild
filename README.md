# CardGuild

PF2e Tactical Adventure의 개발환경 초기화 저장소입니다. 현재 범위는
Node.js, TypeScript, PixiJS, Vite, Vanilla DOM의 실행 기반까지만 포함하며,
게임 규칙과 콘텐츠는 구현하지 않습니다.

## 요구 환경

- Node.js 22.13 이상(22.x) 또는 Node.js 24 이상
- npm 11 이상

## 실행

```bash
npm install
npm run dev
```

정적 검사와 프로덕션 빌드:

```bash
npm run check
npm run build
npm run test:smoke
```

## 현재 경계

- PixiJS는 `#pixi-root` 내부의 전장 캔버스만 소유합니다.
- 정보성 인터페이스는 별도 DOM 영역에 둡니다.
- Rule Engine, 카드, 전투, 서버, WebSocket은 아직 포함하지 않습니다.

설계 기준은 `documents/dev_map_draft_v1.md`를 따릅니다.
