/** Geometry is presentation only. Paging keeps each overlapping card's exposed strip touchable. */
export function handLayout(count: number, width: number): { capacity: number; cards: readonly { x: number; y: number; angle: number }[] } {
  const capacity = Math.max(1, Math.min(8, 1 + Math.floor((width - 144) / 44)));
  const visible = Math.min(count, capacity);
  const step = visible > 1 ? Math.min(76, Math.max(44, (width - 144) / (visible - 1))) : 0;
  return { capacity, cards: Array.from({ length: visible }, (_, index) => {
    const offset = index - (visible - 1) / 2;
    const normalized = visible > 1 ? offset / ((visible - 1) / 2) : 0;
    return { x: offset * step, y: normalized * normalized * 20, angle: normalized * 10 };
  }) };
}
