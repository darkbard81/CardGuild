# 숲 지형 측면 원본

내장 `image_gen`으로 생성한 불투명 PNG 원본 3종이다. 생성 요청 전문은 [prompts.json](prompts.json)에 보존했다. 실제 생성 크기는 887×1774이며, 전체 이미지를 Lanczos3로 축소해 128×256 lossless WebP로 배포한다. 색 보정, 크롭, 상하 반복은 하지 않는다.

- `forest-grass.png`: 얇은 이끼·풀 가장자리와 뿌리가 있는 갈색 흙층.
- `forest-dirt.png`: 흙길과 같은 황갈색 토양, 자갈과 다져진 흙층.
- `forest-leaves.png`: 얇은 주황색 낙엽 가장자리와 어두운 부식토·뿌리.

연결 파일은 `presentation/m3/terrain-sides.json`, 런타임 파일은 `public/assets/terrain-sides/*.webp`다. 각 면은 높이에 따라 시트 위쪽부터 잘라 사용한다. 한 단계의 면은 위쪽 32픽셀만 표시하므로 표면 장식은 얇게 두었다. 연못 벽은 이웃 육지의 재질로 표시된다.

이 시트는 정사각형 윗면 아틀라스와 별개다. 저장소 루트에서 다음 명령으로 배포 파일을 재생성할 수 있다. 기존 `check-assets.ts`가 연결된 파일의 크기와 형식을 검사한다.

```sh
node --input-type=module <<'JS'
import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';
const { materials } = JSON.parse(await readFile('presentation/m3/terrain-sides.json', 'utf8'));
await mkdir('public/assets/terrain-sides', { recursive: true });
for (const [id, href] of Object.entries(materials)) {
  const name = id.replace(/^terrain\./, '');
  await sharp(`art/source/terrain-sides/${name}.png`)
    .resize(128, 256, { kernel: 'lanczos3' })
    .webp({ lossless: true, effort: 6 })
    .toFile(`public${href}`);
}
JS
npx tsx tools/assets/check-assets.ts
```
