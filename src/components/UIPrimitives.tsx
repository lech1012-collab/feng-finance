import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import "./ui-primitives.css";

/** Shared chrome keeps status and action controls out of the page's data area. */
export function AppHeader({
  children,
  actions,
  className = "",
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`ui-app-header ${className}`.trim()}>
      <div className="ui-app-header-main">{children}</div>
      {actions && <div className="ui-app-header-actions">{actions}</div>}
    </header>
  );
}

export function StatusChip({
  children,
  tone = "neutral",
  icon,
  onClick,
  ariaLabel,
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "complete" | "warning" | "error";
  icon?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const content = (
    <span className={`ui-chip-visual ui-chip-visual--${tone}`}>
      {icon && (
        <span className="ui-chip-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </span>
  );
  return onClick ? (
    <button
      type="button"
      className={`ui-chip-target ${className}`.trim()}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  ) : (
    <span
      className={`ui-status-chip ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {content}
    </span>
  );
}

export function DemoChip({
  to,
  onClick,
  ariaLabel = "Demo data settings",
}: {
  to?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const content = <span className="ui-chip-visual">Demo</span>;
  return to ? (
    <Link
      className="ui-chip-target ui-demo-chip"
      to={to}
      aria-label={ariaLabel}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className="ui-chip-target ui-demo-chip"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  );
}

export function ListRow({
  title,
  meta,
  amount,
  icon,
  to,
  onClick,
  className = "",
}: {
  title: ReactNode;
  meta?: ReactNode;
  amount?: ReactNode;
  icon?: ReactNode;
  to?: string;
  onClick?: () => void;
  className?: string;
}) {
  const rowClass =
    `ui-list-row${meta ? " ui-list-row--two-lines" : ""} ${className}`.trim();
  const content = (
    <>
      {icon && (
        <span className="ui-list-row-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="ui-list-row-text">
        <span className="ui-list-row-title">{title}</span>
        {meta && (
          <>
            {" "}
            <span className="ui-list-row-meta">{meta}</span>
          </>
        )}
      </span>
      {amount != null && (
        <>
          {" "}
          <span className="ui-list-row-amount">{amount}</span>
        </>
      )}
    </>
  );
  return to ? (
    <Link to={to} className={rowClass} data-list-row>
      {content}
    </Link>
  ) : onClick ? (
    <button type="button" className={rowClass} onClick={onClick} data-list-row>
      {content}
    </button>
  ) : (
    <div className={rowClass} data-list-row>
      {content}
    </div>
  );
}

export function KeyValueRow({
  label,
  value,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ui-key-value-row ${className}`.trim()}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

interface CheckRowProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  id,
}: CheckRowProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  return (
    <label className="switch-row ui-switch-row" htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        aria-labelledby={`${inputId}-label`}
        aria-describedby={description ? `${inputId}-description` : undefined}
      />
      <span>
        <span id={`${inputId}-label`}>{label}</span>
        {description && (
          <small id={`${inputId}-description`}>{description}</small>
        )}
      </span>
    </label>
  );
}

export function CheckboxRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  id,
}: CheckRowProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  return (
    <label className="ui-checkbox-row" htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        aria-labelledby={`${inputId}-label`}
        aria-describedby={description ? `${inputId}-description` : undefined}
      />
      <span>
        <span id={`${inputId}-label`}>{label}</span>
        {description && (
          <small id={`${inputId}-description`}>{description}</small>
        )}
      </span>
    </label>
  );
}

export function SegmentedControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: readonly {
    value: T;
    label: ReactNode;
    ariaLabel?: string;
    disabled?: boolean;
  }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`segmented-control ui-segmented-control ${className}`.trim()}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={String(value) === String(option.value)}
          aria-label={option.ariaLabel}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          <span className="ui-segment-visual">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  footer,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section
      className={`card ui-section-card ${className}`.trim()}
      id={id}
      aria-labelledby={title ? headingId : undefined}
    >
      {(title || actions) && (
        <header className="ui-section-card-heading">
          {title && <h2 id={headingId}>{title}</h2>}
          {actions}
        </header>
      )}
      {description && (
        <p className="ui-section-card-description">{description}</p>
      )}
      <div className="ui-section-card-content">{children}</div>
      {footer && <footer className="ui-section-card-footer">{footer}</footer>}
    </section>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty ui-empty-state">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function WarningBox({
  title,
  children,
  severity,
  actions,
}: {
  title: string;
  children: ReactNode;
  severity: "warning" | "error";
  actions?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      className={`ui-warning-box ui-warning-box--${severity}`}
      aria-labelledby={headingId}
    >
      <h3 id={headingId}>{title}</h3>
      <div>{children}</div>
      {actions && <div className="ui-warning-actions">{actions}</div>}
    </section>
  );
}

export function StickyFooter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ui-sticky-footer ${className}`.trim()}>{children}</div>
  );
}

export function Stepper({
  steps,
  current,
  label = "Progress",
}: {
  steps: readonly string[];
  current: number;
  label?: string;
}) {
  return (
    <ol className="ui-stepper" aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? "step" : undefined}
          data-complete={index < current || undefined}
        >
          <span className="ui-stepper-mark" aria-hidden="true" />
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}
