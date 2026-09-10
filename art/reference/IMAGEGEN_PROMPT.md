# 이미지 프롬프트 규약

생성 프롬프트는 **무엇을 그리는지**와 **어떤 형식으로 내놓는지**만 적습니다. 투영·광원·팔레트
같은 스타일 기준은 프롬프트가 아니라 [`art/STYLE.md`](../STYLE.md)가 소유하고, 프롬프트는
그것을 참조만 합니다.

```text
Reference art/STYLE.md and art/reference/board-standee-layout.png.
<무엇을 그리는가>. <비율>ratio 굵은 외곽선과 투명배경.
```

- Character Standee는 `art/reference/character-standee.png`의 front|back 배치를 함께
  참조합니다 — 한 장에 겹치지 않는 두 시점을 front, back 순서로 넣습니다. 2:3 비율입니다.
- Board Tile은 `art/reference/board-standee-layout.png`의 보드 구성을 참조합니다. 1:1
  비율이고, 인접 타일과 가장자리가 맞아야 합니다.
- 실제로 쓰이는 프롬프트 원문은 이 문서가 아니라 `art/source/generation-plan.json`의
  `prompt` 필드에 있습니다. 그 파일이 생성의 source of truth이고, 이 문서는 규약입니다.

`tools/assets/build-assets.ts`는 시작할 때 이 파일(`promptConvention`)과 style sheet가 실제로
있는지 확인하므로, 경로를 옮기면 plan도 함께 고쳐야 합니다.
