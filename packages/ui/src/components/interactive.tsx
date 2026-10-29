"use client";
/* 상태가 있는 기본 컴포넌트: NumberInput · Switch · Tabs · Dialog · Sheet · Toast · Tooltip. */
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn, formatInt } from "./cn";
import { IconButton, inputBoxClass, type Tone } from "./basic";
import { Icon, type IconName } from "./icons";

/* ---------- NumberInput: mm 접미사, 화살표 키 증감(Shift = 10배), value=null 이면 "여러 값" ---------- */
export function NumberInput({
  id,
  value,
  onChange,
  unit = "mm",
  step = 100,
  min,
  max,
  invalid,
  disabled,
  label,
  className,
}: {
  id?: string;
  value: number | null;
  onChange: (next: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  invalid?: boolean;
  disabled?: boolean;
  /** 화면에 라벨이 따로 없을 때의 접근성 이름 */
  label?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const shown = draft ?? (value === null ? "" : formatInt(value));

  function commit() {
    if (draft === null) return;
    const n = Number(draft.replace(/,/g, ""));
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(n)) onChange(clamp(Math.round(n)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      setDraft(null);
      onChange(clamp((value ?? 0) + delta));
    } else if (e.key === "Enter") {
      commit();
    } else if (e.key === "Escape") {
      setDraft(null);
    }
  }

  return (
    <div className={cn(inputBoxClass(invalid, disabled), className)}>
      <input
        id={id}
        role="spinbutton"
        inputMode="numeric"
        aria-label={label}
        aria-valuenow={value ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={shown}
        placeholder={value === null ? "여러 값" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 bg-transparent text-right text-num tabular-nums outline-none placeholder:text-fg-3 placeholder:italic disabled:cursor-not-allowed"
      />
      <span className="text-caption text-fg-3">{unit}</span>
    </div>
  );
}

/* ---------- Switch ---------- */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-body text-fg", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "focus-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed",
          checked ? "bg-accent" : "bg-input",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-4 rounded-full transition-transform motion-reduce:transition-none",
            checked ? "translate-x-4.5 bg-accent-fg" : "translate-x-0.5 bg-surface",
          )}
        />
      </button>
      {label}
    </label>
  );
}

/* ---------- Tabs (화살표 키 이동, roving tabindex) ---------- */
export type TabItem = { id: string; label: string; content: ReactNode };

export function Tabs({ items, defaultId, label }: { items: TabItem[]; defaultId?: string; label: string }) {
  const base = useId();
  const [active, setActive] = useState(defaultId ?? items[0]?.id ?? "");
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const last = items.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    setActive(item.id);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-gap">
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
        {items.map((item, i) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "focus-ring -mb-px h-control border-b-2 px-3 text-body whitespace-nowrap transition-colors",
                selected ? "border-fg font-semibold text-fg" : "border-transparent text-fg-2 hover:text-fg",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${base}-panel-${item.id}`}
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="focus-ring rounded-control"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

/* ---------- Dialog · Sheet: 네이티브 <dialog> (포커스 가둠·Esc 닫기 기본 제공) ---------- */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return ref;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useModal(open);
  const id = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClose={onClose}
      className="m-auto w-full max-w-lg rounded-panel border border-line bg-surface text-fg shadow-pop backdrop:bg-overlay"
    >
      <div className="flex items-start justify-between gap-gap border-b border-line p-pad">
        <div>
          <h2 id={`${id}-title`} className="text-h2 font-semibold">{title}</h2>
          {description ? <p id={`${id}-desc`} className="text-body text-fg-2">{description}</p> : null}
        </div>
        <IconButton icon="x" label="닫기" size="sm" onClick={onClose} />
      </div>
      <div className="p-pad">{children}</div>
      {footer ? <div className="flex justify-end gap-2 border-t border-line p-pad">{footer}</div> : null}
    </dialog>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
}) {
  const ref = useModal(open);
  const id = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      className="my-0 mr-0 ml-auto h-dvh max-h-dvh w-full max-w-md border-l border-line bg-surface text-fg shadow-pop backdrop:bg-overlay"
    >
      <div className="flex items-center justify-between gap-gap border-b border-line p-pad">
        <h2 id={`${id}-title`} className="text-h2 font-semibold">{title}</h2>
        <IconButton icon="x" label="닫기" size="sm" onClick={onClose} />
      </div>
      <div className="p-pad">{children}</div>
    </dialog>
  );
}

/* ---------- Toast ---------- */
const TOAST_ICON: Record<Exclude<Tone, "neutral" | "envelope">, { icon: IconName; text: string }> = {
  info: { icon: "info", text: "text-info" },
  ok: { icon: "circle-check", text: "text-ok" },
  warn: { icon: "triangle-alert", text: "text-warn" },
  danger: { icon: "circle-x", text: "text-danger" },
};

/** 토스트를 쌓는 영역. 화면당 하나(aria-live). */
export function ToastRegion({ children }: { children: ReactNode }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 md:inset-x-auto md:right-6 md:bottom-6">
      {children}
    </div>
  );
}

export function Toast({
  tone = "info",
  title,
  children,
  onClose,
}: {
  tone?: keyof typeof TOAST_ICON;
  title: string;
  children?: ReactNode;
  onClose?: () => void;
}) {
  const t = TOAST_ICON[tone];
  return (
    <div role="status" className="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-panel border border-line bg-raised p-3 text-fg shadow-pop">
      <Icon name={t.icon} className={cn("mt-0.5", t.text)} />
      <div className="flex-1">
        <p className="text-body font-semibold">{title}</p>
        {children ? <p className="text-caption text-fg-2">{children}</p> : null}
      </div>
      {onClose ? <IconButton icon="x" label="알림 닫기" size="sm" onClick={onClose} /> : null}
    </div>
  );
}

/* ---------- Tooltip: 호버·포커스로 열고 Esc로 닫는다(WCAG 1.4.13) ---------- */
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // 호버로만 연 경우에도 Escape로 닫히게 문서 전체에서 듣는다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {cloneElement(children, { "aria-describedby": id })}
      {/* 바깥 상자는 투명 여백(pb/pt)으로 트리거와 이어져, 포인터가 툴팁 위로 옮겨가도 닫히지 않는다 */}
      <span
        className={cn(
          "absolute left-1/2 z-40 -translate-x-1/2",
          side === "top" ? "bottom-full pb-1.5" : "top-full pt-1.5",
          open ? "visible" : "invisible",
        )}
      >
        <span
          role="tooltip"
          id={id}
          className="flex items-center gap-1.5 rounded-control bg-fg px-2 py-1 text-caption whitespace-nowrap text-bg shadow-pop"
        >
          {content}
        </span>
      </span>
    </span>
  );
}
