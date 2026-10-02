import { cutEnds, activeCut } from "./copper.js";

export const coordinateText = point => `${point.col + 1}, ${point.row + 1}`;
export function assemblySteps(state) {
  return [
    ...(state.board.cuts || []).map((cut, index) => { const [a, b] = cutEnds(cut); return { kind: "Cut", label: `C${index + 1}`, from: a, to: b, side: "bottom", active: activeCut(state.board, cut) }; }),
    ...(state.solderBridges || []).map(bridge => ({ kind: "Solder bridge", label: bridge.id, from: bridge.a, to: bridge.b, side: bridge.layer, active: true }))
  ];
}
export function notebookMarkdown(state) {
  const notebook = state.notebook || { notes: "", tasks: [] };
  return `# ${state.name}\n\n${notebook.notes}\n\n## Assembly checklist\n\n${notebook.tasks.map(t => `- [${t.done ? "x" : " "}] ${t.text}`).join("\n")}\n\n## Copper work\n\nCoordinates below are column, row, counted from 1 in the top view.\n\n${assemblySteps(state).map(s => `- ${s.label}: ${s.kind} (${s.side}) between ${coordinateText(s.from)} and ${coordinateText(s.to)}${s.active ? "" : " — inactive in current board settings"}`).join("\n")}\n`;
}
