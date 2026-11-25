import { Select as BaseSelect } from "@base-ui/react/select";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "text";
  size?: "default" | "compact";
  shape?: "pill" | "control";
  danger?: boolean;
}

export function Button({
  variant = "primary",
  size = "default",
  shape = "pill",
  danger = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const base = variant === "text" ? "text-button" : variant;
  const classes = [
    base,
    size === "compact" && variant !== "text" ? "compact" : "",
    shape === "control" && variant !== "text" ? "control" : "",
    danger && variant === "text" ? "danger" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}

export interface TabOption<T extends string = string> {
  value: T;
  label: string;
}

export function SegmentedTabs<T extends string = string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: TabOption<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <RadioGroup className="segments" aria-label={label} value={value} onValueChange={onChange}>
      {options.map((opt) => (
        <Radio.Root key={opt.value} value={opt.value}>
          {opt.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export interface ChipOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export function FilterChips<T extends string = string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ChipOption<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <RadioGroup className="chips" aria-label={label} value={value} onValueChange={onChange}>
      {options.map((opt) => (
        <Radio.Root key={opt.value} value={opt.value}>
          {opt.label}
          {opt.count !== undefined && <span>{opt.count}</span>}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search",
  clearLabel = "Clear search",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  clearLabel?: string;
}) {
  return (
    <div className="searchbar">
      <Search size={18} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          className="clear"
          aria-label={clearLabel}
          onClick={() => onChange("")}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function ToggleSwitch({
  id,
  checked,
  onChange,
  label,
}: {
  id?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label className="setting" htmlFor={inputId}>
      <span>{label}</span>
      <input
        id={inputId}
        className="switch"
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

/** Custom accessible select using @base-ui/react/select (never native <select>). */
export function Select<T extends string = string>({
  label,
  value,
  options,
  onChange,
  appearance = "control",
  hideLabel = false,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  appearance?: "control" | "inline" | "pill";
  hideLabel?: boolean;
}) {
  const id = useId();
  const active = options.find((o) => o.value === value);
  const triggerClass =
    appearance === "inline"
      ? "select-trigger inline"
      : appearance === "pill"
        ? "select-trigger pill"
        : "select-trigger";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <label id={id} htmlFor={`${id}-trigger`} className={hideLabel ? "sr-only" : "muted"}>
        {label}
      </label>
      <BaseSelect.Root<T>
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <BaseSelect.Trigger id={`${id}-trigger`} aria-labelledby={id} className={triggerClass}>
          <BaseSelect.Value>{active?.label ?? value}</BaseSelect.Value>
          <BaseSelect.Icon aria-hidden="true">
            <ChevronDown size={15} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner
            sideOffset={6}
            alignItemWithTrigger={false}
            className="select-positioner"
          >
            <BaseSelect.Popup className="select-popup">
              <BaseSelect.List>
                {options.map((opt) => (
                  <BaseSelect.Item key={opt.value} value={opt.value} className="select-option">
                    <BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator aria-hidden="true">
                      <Check size={14} />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  );
}

export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="section-group" aria-labelledby={id}>
      <h2 id={id} className="group-label">
        {label}
      </h2>
      {children}
    </section>
  );
}
