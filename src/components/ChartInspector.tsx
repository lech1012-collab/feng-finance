import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import { ContextHelp } from "./ContextHelp";
import "./chart-inspector.css";

export interface ChartReading {
  key: string;
  x?: string | number;
  label: string;
  status?: string;
  to?: string;
  values: {
    label: string;
    text: string;
    color?: string;
    /** Chart-axis value; omit for supporting figures such as income share. */
    raw?: number | null;
    mark?: boolean;
  }[];
}

/** Horizontal intent is required before capturing a drag. Native vertical
 * scrolling and pinch zoom remain available; cancellation keeps the reading. */
export function useChartInteraction({
  count,
  index,
  select,
  indexAt,
}: {
  count: number;
  index: number;
  select: (index: number) => void;
  indexAt: (clientX: number) => number | undefined;
}) {
  const gesture = useRef<
    | {
        id: number;
        x: number;
        y: number;
        direction: "pending" | "horizontal" | "vertical";
      }
    | undefined
  >(undefined);
  const choose = (clientX: number) => {
    const next = indexAt(clientX);
    if (next !== undefined && Number.isFinite(next) && count > 0)
      select(Math.max(0, Math.min(count - 1, next)));
  };
  const reset = () => {
    gesture.current = undefined;
  };
  return {
    onMouseDown: (event: MouseEvent<HTMLDivElement>) => {
      // SVG layers carry tabindex=-1 for Recharts portals. Keep the browser's
      // synthetic mouse events after a tap from moving focus into those layers.
      if (event.button === 0) event.preventDefault();
    },
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
    },
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.isPrimary === false || event.button > 0) return;
      gesture.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        direction: "pending",
      };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      if (start.direction === "pending") {
        const dx = Math.abs(event.clientX - start.x);
        const dy = Math.abs(event.clientY - start.y);
        if (Math.max(dx, dy) < 8) return;
        start.direction = dx > dy ? "horizontal" : "vertical";
        if (start.direction === "horizontal") {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
        }
      }
      if (start.direction === "horizontal") choose(event.clientX);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const start = gesture.current;
      if (start?.id === event.pointerId && start.direction !== "vertical") {
        choose(event.clientX);
        event.currentTarget.focus({ preventScroll: true });
      }
      reset();
    },
    onPointerCancel: reset,
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      // Touch starts with implicit capture on a bar/SVG child. Moving capture
      // to the plot emits a bubbling loss on that child, not a finished drag.
      if (event.target === event.currentTarget) reset();
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey || count === 0) return;
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? count - 1
            : event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? Math.max(0, index - 1)
              : event.key === "ArrowRight" || event.key === "ArrowUp"
                ? Math.min(count - 1, index + 1)
                : undefined;
      if (next !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        select(next);
      }
    },
  };
}

function SizingText({ values }: { values: string[] }) {
  return [...new Set(values)].map((value) => (
    <span
      className="chart-reading-sizer"
      aria-hidden="true"
      data-chart-size={value}
      key={value}
    />
  ));
}

/** Values occupy normal document flow above the plot. Invisible text reserves
 * enough space for every reading, including missing values and enlarged text. */
export function ChartReadout({
  readings,
  index,
  label,
  help,
  className = "",
}: {
  readings: readonly ChartReading[];
  index: number;
  label: string;
  help?: { title: string; content: (point: ChartReading) => ReactNode };
  className?: string;
}) {
  const point = readings[index];
  if (!point) return null;
  return (
    <div
      className={`chart-readout ${className}`.trim()}
      role="group"
      aria-label={label}
      aria-live="off"
      data-selected-key={point.key}
    >
      <div className="chart-readout-heading">
        <div className="chart-reading-label">
          {point.to ? (
            <Link
              to={point.to}
              aria-label={`View transactions for ${point.label}`}
            >
              <span>
                {point.label} <span aria-hidden="true">›</span>
              </span>
            </Link>
          ) : (
            <strong>{point.label}</strong>
          )}
          <SizingText
            values={readings.map((item) =>
              item.to ? `${item.label} ›` : item.label,
            )}
          />
        </div>
        {(help || point.status) && (
          <div className="chart-reading-status">
            {help ? (
              <ContextHelp
                title={help.title}
                label={help.title}
                triggerText={point.status}
                tone={
                  point.status &&
                  !["Complete", "Verified"].includes(point.status)
                    ? "warning"
                    : "help"
                }
              >
                {help.content(point)}
              </ContextHelp>
            ) : (
              <span className="ui-chip-visual">{point.status}</span>
            )}
            {[
              ...new Set(
                readings.flatMap((item) => (item.status ? [item.status] : [])),
              ),
            ].map((status) => (
              <span
                className="chart-reading-sizer ui-chip-target"
                aria-hidden="true"
                key={status}
              >
                <span
                  className="ui-chip-visual chart-reading-sizing-content"
                  data-chart-size={status}
                />
              </span>
            ))}
          </div>
        )}
      </div>
      <dl className="chart-readout-values">
        {point.values.map((value, valueIndex) => (
          <div key={value.label}>
            <dt>{value.label}</dt>
            <dd
              style={
                value.color
                  ? ({ "--chart-reading-color": value.color } as CSSProperties)
                  : undefined
              }
            >
              <span>{value.text}</span>
              <SizingText
                values={readings.map(
                  (item) => item.values[valueIndex]?.text ?? "",
                )}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Render inside Recharts so selection uses the real scales and plot bounds. */
export function ChartSelectionMarker({
  readings,
  index,
}: {
  readings: readonly ChartReading[];
  index: number;
}) {
  const area = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!area || !xScale || !yScale) return null;
  const positions = readings.map((point) =>
    xScale(point.x ?? point.key, { position: "middle" }),
  );
  const x = positions[index];
  if (x === undefined || !Number.isFinite(x)) return null;
  return (
    <g
      className="chart-selection-marker"
      data-chart-coordinates={positions
        .map((position) => position ?? "")
        .join(",")}
      data-selected-key={readings[index]?.key}
      aria-hidden="true"
      pointerEvents="none"
    >
      <line x1={x} x2={x} y1={area.y} y2={area.y + area.height} />
      {readings[index]?.values.map((value) => {
        const y =
          value.raw == null || value.mark === false
            ? undefined
            : yScale(value.raw);
        return y === undefined || !Number.isFinite(y) ? null : (
          <circle
            key={value.label}
            cx={x}
            cy={y}
            r={5}
            fill={value.color ?? "var(--accent)"}
          />
        );
      })}
    </g>
  );
}

export function ChartInspector({
  readings,
  label,
  readoutLabel = `Selected ${label.toLowerCase()} values`,
  help,
  children,
}: {
  readings: readonly ChartReading[];
  label: string;
  readoutLabel?: string;
  help?: { title: string; content: (point: ChartReading) => ReactNode };
  children: (index: number) => ReactNode;
}) {
  const id = useId();
  const plot = useRef<HTMLDivElement>(null);
  const scope = readings.map((point) => point.key).join("\n");
  const [selection, setSelection] = useState<{
    scope: string;
    index: number;
  }>();
  const index =
    selection?.scope === scope
      ? selection.index
      : Math.max(0, readings.length - 1);
  const point = readings[index];
  const interaction = useChartInteraction({
    count: readings.length,
    index,
    select: (index) => setSelection({ scope, index }),
    indexAt: (clientX) => {
      const marker = plot.current?.querySelector<SVGGElement>(
        "[data-chart-coordinates]",
      );
      const svg = marker?.ownerSVGElement;
      if (!marker || !svg) return undefined;
      const bounds = svg.getBoundingClientRect();
      const width = svg.viewBox.baseVal.width || bounds.width;
      const x = ((clientX - bounds.left) / Math.max(1, bounds.width)) * width;
      const positions = (marker.dataset.chartCoordinates ?? "").split(",");
      let nearest: number | undefined,
        distance = Infinity;
      positions.forEach((position, index) => {
        const delta =
          position === "" ? Infinity : Math.abs(Number(position) - x);
        if (delta < distance) {
          nearest = index;
          distance = delta;
        }
      });
      return nearest;
    },
  });
  return (
    <div className="chart-inspector">
      <ChartReadout
        readings={readings}
        index={index}
        label={readoutLabel}
        help={help}
      />
      <div
        ref={plot}
        className="chart-inspector-plot"
        role={point ? "slider" : undefined}
        tabIndex={point ? 0 : undefined}
        aria-label={point ? `Inspect ${label.toLowerCase()}` : undefined}
        aria-orientation={point ? "horizontal" : undefined}
        aria-valuemin={point ? 0 : undefined}
        aria-valuemax={point ? Math.max(0, readings.length - 1) : undefined}
        aria-valuenow={point ? index : undefined}
        aria-valuetext={
          point
            ? `${point.label}${point.status ? ` · ${point.status}` : ""}: ${point.values.map((value) => `${value.label}: ${value.text}`).join("; ")}`
            : undefined
        }
        aria-describedby={point ? id : undefined}
        {...interaction}
      >
        {children(index)}
      </div>
      <p className="sr-only" id={id}>
        Tap or drag horizontally to inspect a point. Use arrow keys, Home or End
        with a keyboard. Swipe vertically to scroll the page.
      </p>
    </div>
  );
}
