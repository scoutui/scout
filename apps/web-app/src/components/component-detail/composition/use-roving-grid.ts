import { type FocusEvent, type KeyboardEvent, useState } from "react";

type Cell = { key: string; col: number };

const cellOf = (target: EventTarget): { el: HTMLElement; cell: Cell } | null => {
  const el = (target as HTMLElement).closest<HTMLElement>("[data-cell]");
  const row = el?.closest<HTMLElement>("[data-key]");
  const key = row?.getAttribute("data-key");
  if (!el || !key) return null;
  return { el, cell: { key, col: Number(el.getAttribute("data-cell")) } };
};

/**
 * One tab stop for a list of rows. Rows carry `data-key`, and the controls in
 * a row carry `data-cell` with their column. Up and Down move between rows,
 * Left and Right between a row's controls, Home and End to the first and last
 * row. The control last focused keeps the tab stop; before that it is the
 * first control of the `preferred` row, or of the first row.
 */
export function useRovingGrid(keys: readonly string[], preferred: string | null) {
  const [active, setActive] = useState<Cell | null>(null);
  const current: Cell =
    active && keys.includes(active.key)
      ? active
      : { key: preferred !== null && keys.includes(preferred) ? preferred : (keys[0] ?? ""), col: 0 };

  const tabIndexOf = (key: string, col: number) => (key === current.key && col === current.col ? 0 : -1);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const from = cellOf(e.target);
    if (!from) return;
    let row = keys.indexOf(from.cell.key);
    let col = from.cell.col;
    if (e.key === "ArrowDown") row += 1;
    else if (e.key === "ArrowUp") row -= 1;
    else if (e.key === "ArrowRight") col += 1;
    else if (e.key === "ArrowLeft") col -= 1;
    else if (e.key === "Home") row = 0;
    else if (e.key === "End") row = keys.length - 1;
    else return;
    e.preventDefault();
    row = Math.max(0, Math.min(keys.length - 1, row));
    const rowEl = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-key]")].find((r) => r.getAttribute("data-key") === keys[row]);
    const cells = [...(rowEl?.querySelectorAll<HTMLElement>("[data-cell]") ?? [])];
    const next = cells[Math.max(0, Math.min(cells.length - 1, col))];
    if (!next) return;
    setActive({ key: keys[row] as string, col: Number(next.getAttribute("data-cell")) });
    next.focus();
  };

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const at = cellOf(e.target);
    if (at) setActive(at.cell);
  };

  return { tabIndexOf, onKeyDown, onFocus };
}
