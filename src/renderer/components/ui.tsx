import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  startIcon?: React.ReactNode
  endIcon?: React.ReactNode
  loading?: boolean
}

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <span className={cx('ui-spinner', className)} style={{ width: size, height: size }} aria-hidden="true" />
}

export function Button({
  variant = 'primary',
  size = 'md',
  startIcon,
  endIcon,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      className={cx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)}
    >
      {loading || startIcon ? (
        <span className="ui-button__icon">{loading ? <Spinner size={15} /> : startIcon}</span>
      ) : null}
      <span className="ui-button__label">{children}</span>
      {!loading && endIcon ? <span className="ui-button__icon">{endIcon}</span> : null}
    </button>
  )
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'default' | 'accent' | 'danger'
  loading?: boolean
}

export function IconButton({
  tone = 'default',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      className={cx('ui-icon-button', `ui-icon-button--${tone}`, className)}
    >
      {loading ? <Spinner size={15} /> : children}
    </button>
  )
}

export function Surface({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx('ui-surface', className)}>
      {children}
    </div>
  )
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  className?: string
  children: React.ReactNode
}) {
  return <span className={cx('ui-badge', `ui-badge--${tone}`, className)}>{children}</span>
}

export function AlertBanner({
  tone = 'info',
  className,
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  className?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className={cx('ui-alert', `ui-alert--${tone}`, className)} role="alert">
      <div className="ui-alert__content">{children}</div>
      {action ? <div className="ui-alert__action">{action}</div> : null}
    </div>
  )
}

export function Field({
  label,
  className,
  children,
}: {
  label: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={cx('ui-field', className)}>
      <span className="ui-field__label">{label}</span>
      {children}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: React.ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cx('ui-toggle', disabled && 'ui-toggle--disabled')}>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="ui-toggle__track" aria-hidden="true"><span /></span>
      <span className="ui-toggle__label">{label}</span>
    </label>
  )
}

export function ProgressBar({
  value,
  indeterminate = false,
  tone = 'accent',
}: {
  value?: number | null
  indeterminate?: boolean
  tone?: 'accent' | 'success' | 'warning' | 'danger'
}) {
  const safeValue = Math.max(0, Math.min(100, value ?? 0))

  return (
    <div
      className={cx('ui-progress', `ui-progress--${tone}`, indeterminate && 'ui-progress--indeterminate')}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : safeValue}
    >
      <span className="ui-progress__bar" style={indeterminate ? undefined : { width: `${safeValue}%` }} />
    </div>
  )
}

interface DialogProps {
  open: boolean
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  onClose?: () => void
  dismissible?: boolean
  width?: 'sm' | 'md' | 'lg'
}

export function Dialog({
  open,
  title,
  children,
  footer,
  onClose,
  dismissible = true,
  width = 'md',
}: DialogProps) {
  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (dismissible && event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dismissible, onClose, open])

  if (!open) return null

  return createPortal(
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose?.()
      }}
    >
      <div className={cx('ui-dialog', `ui-dialog--${width}`)} role="dialog" aria-modal="true">
        <div className="ui-dialog__header">
          <h3 className="ui-dialog__title">{title}</h3>
          {dismissible && onClose ? (
            <IconButton onClick={onClose} aria-label="关闭对话框" title="关闭" className="ui-dialog__close">
              <span aria-hidden="true">×</span>
            </IconButton>
          ) : null}
        </div>
        <div className="ui-dialog__body">{children}</div>
        {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
