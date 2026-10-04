import { useSwipe } from "./useSwipe";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, monthOffset } from "../domain/dates";
import { money } from "../domain/money";
export function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (v: string) => void;
}) {
  const swipe = useSwipe((direction) =>
    onChange(monthOffset(month, direction === "left" ? 1 : -1)),
  );
  return (
    <div
      className="month-picker"
      {...swipe.bind}
      onClickCapture={(e) => {
        if (swipe.consumeClick()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      title="Swipe left or right to change month"
    >
      <button
        aria-label="Previous month"
        onClick={() => onChange(monthOffset(month, -1))}
      >
        <ChevronLeft size={18} />
      </button>
      <label>
        <span className="sr-only">Selected month</span>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
        <strong aria-hidden>{monthLabel(month)}</strong>
      </label>
      <button
        aria-label="Next month"
        onClick={() => onChange(monthOffset(month, 1))}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
export function Amount({
  value,
  currency,
  signed = false,
}: {
  value: number;
  currency: string;
  signed?: boolean;
}) {
  return <span className="amount">{money(value, currency, signed)}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function Metric({
  label,
  value,
  currency,
}: {
  label: string;
  value: number;
  currency: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        <Amount value={value} currency={currency} />
      </strong>
    </div>
  );
}
