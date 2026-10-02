// Copper is defined on the bottom face. A cut removes the link BETWEEN
// adjacent pads, leaving both holes available for component leads.
export const cutKey = cut => `${cut.axis}:${cut.col},${cut.row}`;
export const insideBoard = (board, p) => Number.isInteger(p.col) && Number.isInteger(p.row) && p.col >= 0 && p.row >= 0 && p.col < board.cols && p.row < board.rows;
export const adjacent = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
export function cutEnds(cut) {
  return [{ col: cut.col, row: cut.row }, { col: cut.col + (cut.axis === "horizontal" ? 1 : 0), row: cut.row + (cut.axis === "vertical" ? 1 : 0) }];
}
export function activeCut(board, cut) {
  return board.type === "stripboard" && cut.axis === (board.stripDirection || "horizontal") && cutEnds(cut).every(p => insideBoard(board, p));
}
export function nearestCut(board, point) {
  const axis = board.stripDirection || "horizontal";
  return {
    axis,
    col: Math.max(0, Math.min(board.cols - (axis === "horizontal" ? 2 : 1), axis === "horizontal" ? Math.floor(point.col) : Math.round(point.col))),
    row: Math.max(0, Math.min(board.rows - (axis === "vertical" ? 2 : 1), axis === "vertical" ? Math.floor(point.row) : Math.round(point.row)))
  };
}
export function copperLinks(board) {
  if (board.type !== "stripboard") return [];
  const vertical = board.stripDirection === "vertical", cuts = new Set((board.cuts || []).map(cutKey)), links = [];
  for (let row = 0; row < board.rows; row++) for (let col = 0; col < board.cols; col++) {
    const cut = { col, row, axis: vertical ? "vertical" : "horizontal" }, [a, b] = cutEnds(cut);
    if (insideBoard(board, b) && !cuts.has(cutKey(cut))) links.push([a, b]);
  }
  return links;
}
// Long runs make rendering inexpensive even on large boards. Cuts are drawn
// as real gaps here, using the same edge keys as the continuity graph.
export function copperRuns(board) {
  if (board.type !== "stripboard") return [];
  const vertical = board.stripDirection === "vertical", cuts = new Set((board.cuts || []).map(cutKey));
  const lines = vertical ? board.cols : board.rows, length = vertical ? board.rows : board.cols, runs = [];
  const point = (line, offset) => vertical ? { col: line, row: offset } : { col: offset, row: line };
  for (let line = 0; line < lines; line++) {
    let start = -0.35;
    for (let offset = 0; offset < length - 1; offset++) {
      const cut = { ...point(line, offset), axis: vertical ? "vertical" : "horizontal" };
      if (!cuts.has(cutKey(cut))) continue;
      runs.push([point(line, start), point(line, offset + 0.35)]);
      start = offset + 0.65;
    }
    runs.push([point(line, start), point(line, length - 0.65)]);
  }
  return runs;
}

export function pinContactSide(board, pin) {
  // Stripboard through-hole leads are soldered to the copper underside.
  return board.type === "stripboard" && !String(pin.component.kind).startsWith("smd") ? "bottom" : (pin.component.side || "top");
}
