# 이미지 프롬프트 규약

생성 프롬프트는 **무엇을 그리는지**와 **어떤 형식으로 내놓는지**만 적습니다. 투영·광원·팔레트
같은 스타일 기준은 프롬프트가 아니라 [`art/STYLE.md`](../STYLE.md)가 소유하고, 프롬프트는
그것을 참조만 합니다.

```text
Reference art/STYLE.md and art/reference/board-standee-layout.png.
<무엇을 그리는가>. <비율>ratio 굵은 외곽선과 투명배경.
```

- Character Standee는 **앞면을 먼저 생성한 뒤, 완성된 앞면 이미지를 실제 레퍼런스로 첨부해 뒷면을 별도로 생성**합니다. 각 생성 요청은 2:3 비율의 전신 한 시점만 출력합니다. 앞·뒷면을 한 번의 요청으로 생성하지 않습니다.
- 앞면에서 캐릭터·머리·의상·장비를 확정하고, 뒷면은 같은 디자인의 실제 후면을 그립니다. 장비를 든 해부학적 좌우를 유지하며 앞면을 좌우 반전해 대체하지 않습니다. 앞면 디자인을 수정하면 수정된 앞면을 참조해 뒷면도 다시 생성합니다.
- 두 원본을 검토한 후 `art/reference/character-standee.png`의 front|back 배치에 맞춰 빌드 입력 시트로 정리합니다. 앞면은 왼쪽, 뒷면은 오른쪽이며 같은 크기의 셀·발 기준선·투명 여백을 유지합니다. 시트 포장과 이미지 생성 순서는 별개입니다.
- Board Tile은 `art/reference/board-standee-layout.png`의 보드 구성을 참조합니다. 1:1
  비율이고, 인접 타일과 가장자리가 맞아야 합니다.
- 실제로 쓰이는 프롬프트 원문은 이 문서가 아니라 `art/source/generation-plan.json`의
  `prompt` 필드에 있습니다. 그 파일이 생성의 source of truth이고, 이 문서는 규약입니다.

스탠디의 신규 생성·재생성에는 다음 두 프롬프트를 순서대로 사용합니다. 뒷면 요청 전에 앞면 파일을 직접 확인하고 이미지 레퍼런스로 전달합니다.

```text
앞면:
Reference art/STYLE.md and art/reference/character-standee.png for character style.
<캐릭터 설명>. Single full-body FRONT view only. 2:3 ratio, thick pure white outer outline, transparent background.

뒷면 (앞면 이미지 첨부):
Reference art/STYLE.md and the attached finished front image <앞면 원본 경로>.
The SAME character, single full-body BACK view only. Preserve hairstyle, costume, equipment, proportions and anatomical equipment handedness from the reference. True rear view, not a mirrored front. 2:3 ratio, thick pure white outer outline, transparent background.
```

앞면·뒷면 원본은 각각 `art/source/actors/<key>-front.png`, `<key>-back.png`로 보존하고, 빌드 입력은 기존 `<key>-front-back.png` 경로를 사용합니다. 해당 source의 `prompt`에는 앞면·뒷면 프롬프트와 뒷면 생성에 사용한 앞면 경로를 함께 기록합니다. 기존 이미지의 과거 프롬프트를 새 방식으로 생성한 것처럼 소급 변경하지 않습니다.

`tools/assets/build-assets.ts`는 시작할 때 이 파일(`promptConvention`)과 style sheet가 실제로
있는지 확인하므로, 경로를 옮기면 plan도 함께 고쳐야 합니다.
