interface Props {
  label: string;
  value: string;
  unit?: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const toneColor: Record<NonNullable<Props["tone"]>, string> = {
  default: "text-neutral-100",
  success: "text-[var(--accent-green)]",
  warning: "text-[var(--accent-amber)]",
  danger: "text-[var(--accent-red)]",
};

export function Stat({ label, value, unit, tone = "default" }: Props) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </span>
      <span className={`cockpit text-2xl font-semibold tabular-nums ${toneColor[tone]}`}>
        {value}
        {unit && <span className="ml-1 text-sm text-neutral-500 font-normal">{unit}</span>}
      </span>
    </div>
  );
}

export function StatusDot({ tone }: { tone: "online" | "offline" | "warning" | "danger" }) {
  const colors = {
    online: "bg-[var(--accent-green)] text-[var(--accent-green)]",
    offline: "bg-neutral-600 text-neutral-600",
    warning: "bg-[var(--accent-amber)] text-[var(--accent-amber)]",
    danger: "bg-[var(--accent-red)] text-[var(--accent-red)]",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full pulse-dot ${colors[tone]}`}
      aria-hidden
    />
  );
}
