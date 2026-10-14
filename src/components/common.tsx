import { useSwipe } from "./useSwipe";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, monthOffset } from "../domain/dates";
import { money } from "../domain/money";
import { EmptyState, SegmentedControl } from "./UIPrimitives";
export function RangeControl({
  value,
  onChange,
  label = "Time range",
}: {
  value: number | string;
  onChange: (value: number) => void;
  label?: string;
}) {
  return (
    <SegmentedControl
      className="range-control"
      label={label}
      value={Number(value)}
      onChange={onChange}
      options={[1, 3, 6, 12].map((n) => ({
        value: n,
        label: `${n}M`,
        ariaLabel: `${n} month${n === 1 ? "" : "s"}`,
      }))}
    />
  );
}
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
  return <EmptyState title={title}>{children}</EmptyState>;
}
export function Metric({
  label,
  value,
  currency,
  approximate = false,
  partial = false,
  unavailable,
}: {
  label: string;
  value: number;
  currency: string;
  approximate?: boolean;
  partial?: boolean;
  unavailable?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {unavailable ? (
          unavailable
        ) : (
          <>
            <span className="amount">
              {money(value, currency, false, approximate)}
            </span>
            {partial ? "*" : ""}
          </>
        )}
      </strong>
    </div>
  );
}
