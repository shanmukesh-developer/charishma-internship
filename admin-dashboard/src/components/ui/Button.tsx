"use client";
import { forwardRef } from 'react';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './Feedback';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium select-none transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-xs hover:bg-accent-hover',
  secondary: 'border border-line-strong/80 bg-surface text-fg shadow-xs hover:bg-surface-2 hover:border-line-strong',
  destructive: 'bg-danger text-on-solid shadow-xs hover:bg-danger/90',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  link: 'text-accent-text hover:underline underline-offset-2 px-0 h-auto',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm',
  lg: 'h-10 px-4 text-sm',
};

const iconSizes: Record<ButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

/** Class string for anything that should look like a button (links, labels for file inputs). */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) {
  return cn(base, variants[variant], variant === 'link' ? 'text-sm' : sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and keeps its width. */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, leftIcon, rightIcon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. Also used as the tooltip. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', className, children, type = 'button', title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cn(base, variants[variant], iconSizes[size], 'px-0', className)}
      {...rest}
    >
      {children}
    </button>
  );
});

/** next/link styled as a button. */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  leftIcon,
  rightIcon,
  children,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; leftIcon?: ReactNode; rightIcon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  );
}
