import { click } from "../../lib/click";

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

interface Props<V extends string> {
  options: SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  fullWidth?: boolean;
  testId?: string;
}

export function SegmentedControl<V extends string>({
  options, value, onChange, fullWidth, testId,
}: Props<V>) {
  return (
    <div className={`app-segmented${fullWidth ? " full" : ""}`} data-testid={testId} role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-pressed={value === opt.value}
          aria-checked={value === opt.value}
          onClick={() => { click(); onChange(opt.value); }}
          data-testid={testId ? `${testId}-${opt.value}` : undefined}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
