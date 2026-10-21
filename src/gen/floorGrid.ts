/**
 * The one grid over the unrolled floor (and the endcaps' profile beyond it): columns around the axis, wrapping, and rows
 * along it, for filing things by where they lie so a question looks in a few cells (the plan's entrances, the paths'
 * pieces, the places' blocks). A column is at least `cell` wide at the floor's radius (a whole number go around), a row
 * `cell` long. Pure.
 */
import { wrapAngle } from '../blueprint';

export interface FloorGrid {
  /** Columns around the axis, and each one's width at the floor's radius (m). */
  columns: number;
  size: number;
  /** A row's length along the axis (m). */
  cell: number;
  /** A cell's key (any column, wrapped around). */
  key(column: number, row: number): number;
  /** The column of an angle and the row of a place along the axis. */
  column(theta: number): number;
  row(s: number): number;
}

export function floorGrid(radius: number, cell: number): FloorGrid {
  const columns = Math.max(1, Math.floor((2 * Math.PI * radius) / cell)), size = (2 * Math.PI * radius) / columns;
  return {
    columns,
    size,
    cell,
    key: (column, row) => row * columns + (((column % columns) + columns) % columns),
    column: (theta) => Math.min(columns - 1, Math.floor((wrapAngle(theta) * radius) / size)),
    row: (s) => Math.floor(s / cell),
  };
}

/** Files an item under a key of a grid's map (its list made when first needed). */
export function fileUnder<T>(filed: Map<number, T[]>, key: number, item: T): void {
  const list = filed.get(key);
  if (list) list.push(item); else filed.set(key, [item]);
}
