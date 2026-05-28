import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  labelledBy?: string;
}

export function Modal({ open, onClose, children, labelledBy }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="app-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="app-modal">{children}</div>
    </div>
  );
}
