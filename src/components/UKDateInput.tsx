import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import { CalendarDays } from "lucide-react";
import { isoDate } from "../domain/dates";
import "./uk-date-input.css";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max"
> & {
  value: string;
  onChange: (isoValue: string) => void;
  min?: string;
  max?: string;
};

function ukValue(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function isoValue(raw: string) {
  // An ISO paste is unambiguous, and is immediately displayed in UK order.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  // The iPhone numeric keypad has no slash key. Eight digits are also UK order.
  const uk =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw) ||
    /^(\d{2})(\d{2})(\d{4})$/.exec(raw);
  try {
    if (iso) return isoDate(+iso[1], +iso[2], +iso[3]);
    if (uk) return isoDate(+uk[3], +uk[2], +uk[1]);
  } catch {
    // A partial or impossible date must never become a stored date.
  }
  return "";
}

/** UK text entry is independent of the browser OS locale; storage stays ISO. */
export function UKDateInput({
  value,
  onChange,
  min,
  max,
  disabled,
  readOnly,
  id,
  className = "",
  onBlur,
  ...props
}: Props) {
  const generated = useId();
  const text = useRef<HTMLInputElement>(null);
  const calendar = useRef<HTMLInputElement>(null);
  const emitted = useRef(value);
  const [draft, setDraft] = useState(() => ukValue(value));
  const [errorVisible, setErrorVisible] = useState(false);
  const [label, setLabel] = useState("date");
  const parsed = isoValue(draft);
  const problem =
    draft.trim() && !parsed
      ? "Enter a valid date as DD/MM/YYYY."
      : parsed && min && parsed < min
        ? `Use ${ukValue(min)} or later.`
        : parsed && max && parsed > max
          ? `Use ${ukValue(max)} or earlier.`
          : "";
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setDraft(ukValue(value));
      setErrorVisible(false);
    }
  }, [value]);
  useEffect(() => {
    text.current?.setCustomValidity(problem);
  }, [problem]);
  useEffect(() => {
    const input = text.current;
    const visibleLabel = input?.labels?.[0];
    const words =
      visibleLabel &&
      [...visibleLabel.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
        .join(" ");
    setLabel(props["aria-label"] || words || "date");
  }, [props["aria-label"]]);
  function enter(raw: string) {
    const parsed = isoValue(raw);
    const valid =
      parsed && (!min || parsed >= min) && (!max || parsed <= max)
        ? parsed
        : "";
    setDraft(valid ? ukValue(valid) : raw);
    emitted.current = valid;
    onChange(valid);
  }
  function openCalendar() {
    const picker = calendar.current;
    if (!picker) return;
    try {
      if (typeof picker.showPicker === "function") {
        picker.showPicker();
        return;
      }
    } catch {
      // Older Safari opens its native date picker from focus in this user gesture.
    }
    picker.focus({ preventScroll: true });
    picker.click();
  }
  return (
    <span className="uk-date-container">
      <span className="uk-date-field">
        <input
          {...props}
          id={id}
          ref={text}
          className={`uk-date-text ${className}`.trim()}
          type="text"
          lang="en-GB"
          inputMode="numeric"
          placeholder="DD/MM/YYYY"
          autoComplete="off"
          value={draft}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={props["aria-label"] || label}
          aria-invalid={problem ? true : props["aria-invalid"]}
          aria-describedby={[
            props["aria-describedby"],
            `${generated}-format`,
            errorVisible && problem ? `${generated}-error` : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onChange={(event) => enter(event.target.value)}
          onBlur={(event) => {
            setErrorVisible(true);
            onBlur?.(event);
          }}
          onInvalid={() => setErrorVisible(true)}
        />
        {!readOnly && (
          <>
            <button
              type="button"
              className="icon-button uk-date-calendar"
              disabled={disabled}
              aria-label={`Open calendar for ${label}`}
              onClick={openCalendar}
            >
              <CalendarDays size={20} aria-hidden="true" />
            </button>
            <input
              ref={calendar}
              className="sr-only"
              type="date"
              value={parsed}
              min={min}
              max={max}
              disabled={disabled}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                enter(event.target.value);
                text.current?.focus({ preventScroll: true });
              }}
            />
          </>
        )}
      </span>
      <span id={`${generated}-format`} className="sr-only">
        Date format: day/month/year. You can type eight digits without slashes.
      </span>
      {errorVisible && problem && (
        <span id={`${generated}-error`} className="field-error" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
