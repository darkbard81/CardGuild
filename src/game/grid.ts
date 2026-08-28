import { hasTrait } from "./rules";
import type {
  ActorState,
  BattleMapState,
  GridPosition,
  MovementMode,
  TileState,
} from "./types";

const ORTHOGONAL_DIRECTIONS: readonly GridPosition[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function positionKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

export function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

export function gridDistance(from: GridPosition, to: GridPosition): number {
  return (Math.abs(from.x - to.x) + Math.abs(from.y - to.y)) * 5;
}

export function getTile(map: BattleMapState, position: GridPosition): TileState | undefined {
  return map.tiles[positionKey(position)];
}

export function isInsideMap(map: BattleMapState, position: GridPosition): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < map.width && position.y < map.height;
}

export function movementCost(tile: TileState, mode: MovementMode): number | null {
  if (hasTrait(tile, "blocked")) return null;
  if (mode === "land" && hasTrait(tile, "impassable")) return null;
  if (mode === "land" && hasTrait(tile, "difficult")) return 10;
  return 5;
}

function isOccupied(
  actors: Readonly<Record<string, ActorState>>,
  position: GridPosition,
  ignoredActorId: string,
): boolean {
  return Object.values(actors).some(
    (actor) =>
      actor.id !== ignoredActorId && !actor.defeated && samePosition(actor.position, position),
  );
}

interface SearchNode {
  readonly position: GridPosition;
  readonly cost: number;
  readonly path: readonly GridPosition[];
}

function compareNodes(left: SearchNode, right: SearchNode): number {
  return left.cost - right.cost || left.position.y - right.position.y || left.position.x - right.position.x;
}

export function findReachableTiles(
  map: BattleMapState,
  actors: Readonly<Record<string, ActorState>>,
  actorId: string,
  from: GridPosition,
  maximumCost: number,
  mode: MovementMode,
): ReadonlyMap<string, SearchNode> {
  const visited = new Map<string, SearchNode>();
  const frontier: SearchNode[] = [{ position: from, cost: 0, path: [] }];
  visited.set(positionKey(from), frontier[0] as SearchNode);

  while (frontier.length > 0) {
    frontier.sort(compareNodes);
    const current = frontier.shift() as SearchNode;

    for (const direction of ORTHOGONAL_DIRECTIONS) {
      const position = {
        x: current.position.x + direction.x,
        y: current.position.y + direction.y,
      };
      if (!isInsideMap(map, position) || isOccupied(actors, position, actorId)) continue;
      const tile = getTile(map, position);
      if (!tile) continue;
      const stepCost = movementCost(tile, mode);
      if (stepCost === null) continue;
      const cost = current.cost + stepCost;
      if (cost > maximumCost) continue;

      const key = positionKey(position);
      const existing = visited.get(key);
      const path = [...current.path, position];
      const candidate = { position, cost, path };
      if (!existing || compareNodes(candidate, existing) < 0) {
        visited.set(key, candidate);
        frontier.push(candidate);
      }
    }
  }

  visited.delete(positionKey(from));
  return visited;
}

export function findPath(
  map: BattleMapState,
  actors: Readonly<Record<string, ActorState>>,
  actorId: string,
  from: GridPosition,
  destination: GridPosition,
  maximumCost: number,
  mode: MovementMode,
): SearchNode | null {
  return (
    findReachableTiles(map, actors, actorId, from, maximumCost, mode).get(
      positionKey(destination),
    ) ?? null
  );
}

export function canStepOnto(tile: TileState, mode: MovementMode): boolean {
  return movementCost(tile, mode) === 5 && !hasTrait(tile, "difficult");
}

function supercoverLine(from: GridPosition, to: GridPosition): readonly GridPosition[] {
  const points: GridPosition[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const signX = Math.sign(dx);
  const signY = Math.sign(dy);
  let x = from.x;
  let y = from.y;
  let ix = 0;
  let iy = 0;

  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      if (signX !== 0) points.push({ x: x + signX, y });
      if (signY !== 0) points.push({ x, y: y + signY });
      x += signX;
      y += signY;
      ix += 1;
      iy += 1;
    } else if (decision < 0) {
      x += signX;
      ix += 1;
    } else {
      y += signY;
      iy += 1;
    }
    points.push({ x, y });
  }

  const unique = new Map(points.map((point) => [positionKey(point), point]));
  unique.delete(positionKey(from));
  return [...unique.values()];
}

function lineIsOpen(map: BattleMapState, from: GridPosition, to: GridPosition): boolean {
  return supercoverLine(from, to).every((position) => {
    const tile = getTile(map, position);
    return tile ? !hasTrait(tile, "blocked") : false;
  });
}

export function hasLineOfSight(map: BattleMapState, from: GridPosition, to: GridPosition): boolean {
  return lineIsOpen(map, from, to);
}

export function hasLineOfEffect(map: BattleMapState, from: GridPosition, to: GridPosition): boolean {
  return lineIsOpen(map, from, to);
}
