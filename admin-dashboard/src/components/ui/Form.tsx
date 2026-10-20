"use client";
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';
import { IconSearch, IconX } from './icons';

/**
 * Label + control + hint/error. The control (one child element) gets id, aria-invalid and
 * aria-describedby wired automatically, so inline validation is announced by screen readers.
 */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  children,
  className,
  id: idProp,
  labelAction,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  optional?: boolean;
  children: ReactElement;
  className?: string;
  id?: string;
  /** Small control at the right end of the label row (e.g. "Generate"). */
  labelAction?: ReactNode;
}) {
  const auto = useId();
  const id = idProp || (children.props as { id?: string }).id || `f${auto.replace(/:/g, '')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy = [errId, hintId, (children.props as { 'aria-describedby'?: string })['aria-describedby']].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : (children.props as { 'aria-invalid'?: boolean })['aria-invalid'],
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      })
    : children;
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
          {required && <span className="ml-0.5 text-danger-text" aria-hidden>*</span>}
          {optional && <span className="ml-1 font-normal text-fg-subtle">(optional)</span>}
        </label>
        {labelAction}
      </div>
      {control}
      {error ? (
        <p id={errId} className="mt-1 text-xs text-danger-text">{error}</p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
  /** Text or icon shown inside the left edge (e.g. ₹). */
  prefix?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, prefix, suffix, invalid, ...rest }, ref) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      className={cn('zv-control', prefix ? 'pl-7' : '', suffix ? 'pr-9' : '', className)}
      {...rest}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-fg-subtle">{prefix}</span>}
      {input}
      {suffix && <span className="absolute inset-y-0 right-2 flex items-center text-sm text-fg-subtle">{suffix}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || rest['aria-invalid'] || undefined} className={cn('zv-control resize-y', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} aria-invalid={invalid || rest['aria-invalid'] || undefined} className={cn('zv-control', className)} {...rest}>
      {children}
    </select>
  );
});

/** Search box with a clear button. `onChange` receives the string. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  className,
  ariaLabel,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <div className={cn('relative w-full sm:w-64', className)}>
      <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onEnter?.();
          if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        className="zv-control pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg">
          <IconX size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * On/off switch. Put what turning it on does for users in `description`, especially for feature
 * flags and anything customers or partners will notice.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id: idProp,
  size = 'md',
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const auto = useId();
  const id = idProp || `sw${auto.replace(/:/g, '')}`;
  const track = size === 'sm' ? 'h-4 w-7' : 'h-5 w-9';
  const knob = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const shift = size === 'sm' ? 'translate-x-3' : 'translate-x-4';
  const btn = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? `${id}-desc` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        track,
        checked ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <span className={cn('rounded-full bg-white shadow-xs transition-transform', knob, checked ? shift : 'translate-x-0')} />
    </button>
  );
  if (!label && !description) return btn;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {label && <label htmlFor={id} className="text-sm font-medium text-fg">{label}</label>}
        {description && <p id={`${id}-desc`} className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      <div className="pt-0.5">{btn}</div>
    </div>
  );
}

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: ReactNode; description?: ReactNode; indeterminate?: boolean }>(
  function Checkbox({ label, description, className, indeterminate, ...rest }, ref) {
    const box = (
      <input
        ref={el => {
          if (el) el.indeterminate = !!indeterminate;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type="checkbox"
        className={cn('h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-[rgb(var(--accent))] disabled:cursor-not-allowed', className)}
        {...rest}
      />
    );
    if (!label) return box;
    return (
      <label className="flex cursor-pointer items-start gap-2">
        <span className="pt-0.5">{box}</span>
        <span className="min-w-0">
          <span className="text-sm text-fg">{label}</span>
          {description && <span className="block text-xs text-fg-muted">{description}</span>}
        </span>
      </label>
    );
  },
);

/** Groups related fields under a heading in long forms. */
export function FormSection({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4', className)}>
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
