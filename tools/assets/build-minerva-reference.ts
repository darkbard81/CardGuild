import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const expressions = ["Neutral", "Welcome smile", "Joyful laugh", "Wink", "Explaining", "Thinking", "Questioning", "Surprised", "Worried", "Sad", "Tears", "Flustered", "Blushing", "Displeased", "Determined", "Encouraging"];
const cells = expressions.map((label, i) => {
  const x = (i % 4) * 512, y = Math.floor(i / 4) * 512;
  const smile = [1, 2, 3, 15].includes(i);
  return `<g transform="translate(${x} ${y})">
  <rect width="512" height="512" fill="${(i % 4 + Math.floor(i / 4)) % 2 ? "#0000FF" : "#FF00FF"}"/>
  <path d="M134 420V170 Q130 54 256 52 Q382 54 378 170V420" fill="#dce4eb" stroke="#34394a" stroke-width="4"/>
  <path d="M150 185L90 152L154 244M362 185L422 152L358 244" fill="#ffe0ce" stroke="#34394a" stroke-width="4"/>
  <path d="M226 275V321L150 345Q112 367 108 500H404Q400 367 362 345L286 321V275" fill="#fff8df" stroke="#34394a" stroke-width="4"/>
  <path d="M150 345L215 320L235 500H108Q112 370 150 345M362 345L297 320L277 500H404Q400 370 362 345" fill="#174d3e"/>
  <ellipse cx="256" cy="194" rx="101" ry="114" fill="#ffe0ce" stroke="#34394a" stroke-width="4"/>
  <path d="M155 180Q147 63 256 65Q365 63 357 180L311 117L274 157L240 116L196 164Z" fill="#e9eef4" stroke="#34394a" stroke-width="4"/>
  <path d="M187 181L223 ${i > 7 ? 178 : 182}M289 ${i > 7 ? 178 : 182}L325 181" stroke="#34394a" stroke-width="5"/>
  <ellipse cx="207" cy="202" rx="12" ry="${i === 2 ? 3 : 13}" fill="#157455"/>
  <ellipse cx="305" cy="202" rx="12" ry="${i === 3 || i === 2 ? 3 : 13}" fill="#157455"/>
  <path d="M231 255Q256 ${smile ? 280 : i > 7 ? 242 : 257} 281 255" fill="none" stroke="#7a4141" stroke-width="5"/>
  <circle cx="256" cy="338" r="15" fill="#dbb54f"/>
  <path d="M256 28V310M140 194H372" stroke="white" opacity=".3" stroke-dasharray="6 6"/>
  <text x="256" y="32" text-anchor="middle" font-family="sans-serif" font-size="22" fill="white">${i + 1}. ${label}</text>
  <text x="256" y="488" text-anchor="middle" font-family="sans-serif" font-size="16" fill="white">Same face center / chest-up / ears inside cell</text></g>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">${cells.join("")}</svg>`;
await writeFile("art/reference/scenes/minerva.svg", svg);
await sharp(Buffer.from(svg)).png().toFile("art/reference/scenes/minerva.png");
