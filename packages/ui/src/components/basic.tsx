/* 기본 컴포넌트(상태 없는 것). 색·크기는 tokens.css 유틸리티만 쓴다(hex·px 금지). */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
} from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type Tone = "neutral" | "info" | "ok" | "warn" | "danger" | "envelope";

/* ---------- Button ---------- */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-input bg-surface text-fg hover:bg-raised",
  ghost: "text-fg hover:bg-raised",
  danger: "bg-danger text-danger-fg hover:opacity-90",
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-control-sm gap-1.5 px-3 text-caption",
  md: "h-control gap-2 px-4 text-body",
};

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconName;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "focus-ring inline-flex shrink-0 items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/* ---------- IconButton: 글자 없는 버튼은 label(aria-label) 필수 ---------- */
export function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  pressed,
  className,
  type = "button",
  ref,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  icon: IconName;
  label: string;
  size?: ButtonSize;
  variant?: "ghost" | "secondary";
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "focus-ring inline-flex shrink-0 items-center justify-center rounded-control text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-raised aria-pressed:text-fg",
        size === "sm" ? "size-control-sm" : "size-control",
        variant === "secondary" && "border border-input bg-surface",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

/* ---------- Field: 라벨·도움말·오류 묶음 ---------- */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-caption font-medium text-fg-2">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="flex items-center gap-1 text-caption text-danger">
          <Icon name="circle-x" className="size-3.5" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-caption text-fg-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ---------- Input: 단위 접미사(suffix) 지원 ---------- */
export function inputBoxClass(invalid?: boolean, disabled?: boolean) {
  return cn(
    "focus-ring-within flex h-control w-full items-center gap-2 rounded-control border bg-surface px-3 text-body text-fg",
    invalid ? "border-danger" : "border-input",
    disabled && "cursor-not-allowed opacity-50",
  );
}

export function Input({
  suffix,
  invalid,
  className,
  disabled,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { suffix?: string; invalid?: boolean }) {
  return (
    <div className={cn(inputBoxClass(invalid, disabled), className)}>
      <input
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3 disabled:cursor-not-allowed"
        {...rest}
      />
      {suffix ? <span className="text-caption text-fg-3">{suffix}</span> : null}
    </div>
  );
}

/* ---------- Select (네이티브) ---------- */
export function Select({
  invalid,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className={cn("relative", className)}>
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          "focus-ring h-control w-full appearance-none rounded-control border bg-surface pr-9 pl-3 text-body text-fg disabled:cursor-not-allowed disabled:opacity-50",
          invalid ? "border-danger" : "border-input",
        )}
        {...rest}
      >
        {children}
      </select>
      <Icon name="chevron-down" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-fg-3" />
    </div>
  );
}

/* ---------- Checkbox ---------- */
export function Checkbox({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-body text-fg has-disabled:cursor-not-allowed has-disabled:opacity-50", className)}>
      <span className="relative inline-flex size-4 shrink-0">
        <input
          type="checkbox"
          className="focus-ring peer size-4 cursor-pointer appearance-none rounded-sm border border-input bg-surface checked:border-accent checked:bg-accent disabled:cursor-not-allowed"
          {...rest}
        />
        <Icon name="check" className="pointer-events-none absolute inset-0 size-4 p-0.5 text-accent-fg opacity-0 peer-checked:opacity-100" />
      </span>
      {label}
    </label>
  );
}

/* ---------- Badge ---------- */
const TONE_SOLID: Record<Tone, string> = {
  neutral: "border border-line bg-raised text-fg-2",
  info: "bg-info text-info-fg",
  ok: "bg-ok text-ok-fg",
  warn: "bg-warn text-warn-fg",
  danger: "bg-danger text-danger-fg",
  envelope: "bg-envelope text-envelope-fg",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-caption font-medium whitespace-nowrap",
        TONE_SOLID[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} className="size-3.5" /> : null}
      {children}
    </span>
  );
}

/* ---------- Kbd ---------- */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-raised px-1 font-mono text-caption text-fg-2">
      {children}
    </kbd>
  );
}

/* ---------- Banner ---------- */
const BANNER_TONE: Record<Exclude<Tone, "neutral" | "envelope">, { border: string; icon: IconName; text: string }> = {
  info: { border: "border-l-info", icon: "info", text: "text-info" },
  ok: { border: "border-l-ok", icon: "circle-check", text: "text-ok" },
  warn: { border: "border-l-warn", icon: "triangle-alert", text: "text-warn" },
  danger: { border: "border-l-danger", icon: "circle-x", text: "text-danger" },
};

export function Banner({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof BANNER_TONE;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = BANNER_TONE[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-gap rounded-control border border-l-4 border-line bg-surface p-pad md:flex-row md:items-start",
        t.border,
        className,
      )}
    >
      <Icon name={t.icon} className={cn("mt-0.5", t.text)} />
      <div className="flex-1">
        <p className="text-body font-semibold text-fg">{title}</p>
        {children ? <div className="text-body text-fg-2">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ---------- Progress: value 없으면 진행률 미상 ---------- */
export function Progress({ value, label }: { value?: number; label: string }) {
  const pct = value === undefined ? undefined : Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-caption text-fg-2">
        <span>{label}</span>
        {pct !== undefined ? <span className="tabular-nums">{Math.round(pct)}%</span> : null}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
      >
        <div
          className={cn("h-full rounded-full bg-accent", pct === undefined && "w-1/3 animate-pulse motion-reduce:animate-none")}
          style={pct === undefined ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ---------- Skeleton ---------- */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-control bg-raised motion-reduce:animate-none", className)} />;
}

/* ---------- EmptyState ---------- */
export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-panel border border-dashed border-line p-pad py-10 text-center">
      <Icon name={icon} className="size-8 text-fg-3" />
      <p className="text-h2 font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-sm text-body text-fg-2">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ---------- Table (컴팩트, 좁은 화면은 카드 안 가로 스크롤) ---------- */
export type Column = { key: string; header: string; numeric?: boolean };

export function Table({
  columns,
  rows,
  caption,
}: {
  columns: Column[];
  rows: Array<Record<string, ReactNode> & { id: string }>;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface">
      <table className="w-full border-collapse text-body">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="h-row border-b border-line bg-raised text-caption text-fg-2">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-3 font-medium whitespace-nowrap", c.numeric ? "text-right" : "text-left")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="h-row border-b border-line last:border-b-0 hover:bg-raised">
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 whitespace-nowrap text-fg", c.numeric && "text-right text-num tabular-nums")}>
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
