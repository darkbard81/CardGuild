import { Point } from "pixi.js";

import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

export type BoardCorners = readonly [Point, Point, Point, Point];

type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index] ?? 0]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) pivot = row;
    }
    const pivotRow = augmented[pivot];
    const currentRow = augmented[column];
    if (!pivotRow || !currentRow || Math.abs(pivotRow[column] ?? 0) < 1e-10) {
      throw new Error("Board perspective quadrilateral is degenerate.");
    }
    augmented[pivot] = currentRow;
    augmented[column] = pivotRow;
    const divisor = pivotRow[column] ?? 1;
    for (let index = column; index <= size; index += 1) pivotRow[index] = (pivotRow[index] ?? 0) / divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const target = augmented[row];
      if (!target) continue;
      const factor = target[column] ?? 0;
      for (let index = column; index <= size; index += 1) {
        target[index] = (target[index] ?? 0) - factor * (pivotRow[index] ?? 0);
      }
    }
  }
  return augmented.map((row) => row[size] ?? 0);
}

function homography(from: readonly Point[], to: readonly Point[]): Matrix3 {
  const matrix: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const source = from[index];
    const target = to[index];
    if (!source || !target) throw new Error("A homography needs four point pairs.");
    matrix.push(
      [source.x, source.y, 1, 0, 0, 0, -target.x * source.x, -target.x * source.y],
      [0, 0, 0, source.x, source.y, 1, -target.y * source.x, -target.y * source.y],
    );
    values.push(target.x, target.y);
  }
  const result = solveLinearSystem(matrix, values);
  return [
    result[0] ?? 0, result[1] ?? 0, result[2] ?? 0,
    result[3] ?? 0, result[4] ?? 0, result[5] ?? 0,
    result[6] ?? 0, result[7] ?? 0, 1,
  ];
}

function transform(matrix: Matrix3, x: number, y: number): Point {
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(denominator) < 1e-10) return new Point(Number.NaN, Number.NaN);
  return new Point(
    (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  );
}

export class BoardProjection {
  private forward: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private inverse: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private columns = 1;
  private rows = 1;
  private boardCorners: BoardCorners = [new Point(), new Point(1, 0), new Point(1, 1), new Point(0, 1)];

  public constructor(private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG) {}

  public update(columns: number, rows: number, corners: BoardCorners): void {
    if (columns <= 0 || rows <= 0) throw new Error("Board dimensions must be positive.");
    this.columns = columns;
    this.rows = rows;
    this.boardCorners = [corners[0].clone(), corners[1].clone(), corners[2].clone(), corners[3].clone()];
    const normalized: readonly Point[] = [new Point(0, 0), new Point(1, 0), new Point(1, 1), new Point(0, 1)];
    this.forward = homography(normalized, corners);
    this.inverse = homography(corners, normalized);
  }

  public gridToScreen(col: number, row: number): Point {
    return transform(this.forward, col / this.columns, row / this.rows);
  }

  public screenToGrid(x: number, y: number): Point {
    const normalized = transform(this.inverse, x, y);
    return new Point(normalized.x * this.columns, normalized.y * this.rows);
  }

  public getCellCorners(col: number, row: number): Point[] {
    return [
      this.gridToScreen(col, row),
      this.gridToScreen(col + 1, row),
      this.gridToScreen(col + 1, row + 1),
      this.gridToScreen(col, row + 1),
    ];
  }

  /**
   * Scale for content standing on `row`: the projected cell width over the width the
   * art was authored for. Perspective foreshortening and camera zoom are already in
   * the projected width, so board content never needs a separate depth factor.
   */
  public getCellScale(row: number): number {
    return this.getProjectedCellWidth(row) / this.config.referenceCellWidth;
  }

  public getProjectedCellWidth(row: number): number {
    const left = this.gridToScreen(0, row);
    const next = this.gridToScreen(1, row);
    return Math.hypot(next.x - left.x, next.y - left.y);
  }

  public get corners(): BoardCorners {
    return this.boardCorners;
  }
}
