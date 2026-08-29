// Lifted click-to-highlight state shared by the question list and answer
// viewer. Covers unmatched answers too, so they can be previewed the same way.
export type Selection =
  | { type: "question"; id: string }
  | { type: "answer"; id: string }
  | null;

export function selectionKeyOf(selection: Selection): string | null {
  return selection ? `${selection.type}:${selection.id}` : null;
}
