// Opinionated sheet for "list of actions with optional destructive last."
// Replaces window.confirm.

import { Sheet, type SheetState } from "./Sheet";
import { click } from "../../lib/click";

export interface ActionItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  trailing?: "chevron" | null;
  testId?: string;
}

interface Props {
  open: boolean;
  title?: string;
  items: ActionItem[];
  onClose: () => void;
}

export function ActionSheet({ open, title, items, onClose }: Props) {
  const state: SheetState = open ? "expanded" : "closed";
  return (
    <Sheet
      state={state}
      onStateChange={(next) => { if (next !== "expanded") onClose(); }}
      expandedHeight="auto"
    >
      <div className="app-action-sheet">
        {title && <h3>{title}</h3>}
        {items.map((it, i) => {
          const isLast = i === items.length - 1;
          const showSepBefore = it.destructive && !isLast === false && items.some((x) => !x.destructive);
          return (
            <div key={i}>
              {showSepBefore && <hr />}
              <button
                data-destructive={it.destructive || undefined}
                data-testid={it.testId}
                onClick={() => { click(); it.onSelect(); onClose(); }}
              >
                <span>{it.label}</span>
                {it.trailing === "chevron" && <span className="chevron">›</span>}
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
