import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { COMMUNITY_CONFIG } from '../config/community.js';

export function StatusBadge({ children, tone = 'neutral', dot = true }) {
  return <span className={`status status--${tone}`}>{dot && <i aria-hidden="true" />}{children}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Metric({ label, value, detail, tone = 'default' }) {
  return (
    <article className={`metric metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

export function ProgressBar({ value, max = 100, label, detail }) {
  const percentage = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div className="progress-block">
      {(label || detail) && <div className="progress-label"><span>{label}</span><strong>{detail || `${percentage}%`}</strong></div>}
      <div className="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percentage}>
        <span style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ symbol = '—', title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">{symbol}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function AsyncDataState({ loading, error, onRetry, loadingLabel = 'Cargando datos…', errorTitle = 'No pudimos cargar los datos' }) {
  if (!loading && !error) return null;

  if (loading) {
    return (
      <div className="async-data-state" role="status" aria-live="polite">
        <span className="async-data-spinner" aria-hidden="true" />
        <div><strong>{loadingLabel}</strong><p>Espera un momento mientras consultamos la información actual.</p></div>
      </div>
    );
  }

  return (
    <div className="async-data-state async-data-state--error" role="alert">
      <span className="async-data-symbol" aria-hidden="true">!</span>
      <div><strong>{errorTitle}</strong><p>{error}</p></div>
      {onRetry && <button className="secondary-button" type="button" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function Modal({ open, title, description, onClose, children, size = 'medium' }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const focusDialog = requestAnimationFrame(() => {
      const firstControl = dialogRef.current?.querySelector(focusableSelector);
      (firstControl || dialogRef.current)?.focus();
    });
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll(focusableSelector)]
        .filter((element) => element.getClientRects().length > 0);
      if (!controls.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(focusDialog);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex="-1" className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>
          <div>
            <p className="eyebrow">{COMMUNITY_CONFIG.name}</p>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    document.body
  );
}

export function Field({ label, hint, children, required = false, error = '', group = false }) {
  if (group) {
    return (
      <fieldset className={`field field--group ${error ? 'field--error' : ''}`}>
        <legend>{label}{required && <b aria-hidden="true"> *</b>}</legend>
        {children}
        {(error || hint) && <small>{error || hint}</small>}
      </fieldset>
    );
  }
  return (
    <label className={`field ${error ? 'field--error' : ''}`}>
      <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
      {children}
      {(error || hint) && <small>{error || hint}</small>}
    </label>
  );
}

export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, 4200);
    return () => clearTimeout(timer);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.tone || 'success'}`} role="status">
      <span aria-hidden="true">{toast.tone === 'error' ? '!' : '✓'}</span>
      <div><strong>{toast.title}</strong>{toast.message && <p>{toast.message}</p>}</div>
      <button type="button" onClick={onClose} aria-label="Cerrar aviso">×</button>
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => {
        const item = typeof option === 'string' ? { value: option, label: option } : option;
        const selected = value === item.value;
        return <button key={item.value} type="button" aria-pressed={selected} className={selected ? 'active' : ''} onClick={() => onChange(item.value)}>{item.label}</button>;
      })}
    </div>
  );
}

export function SkeletonLine({ width = '100%', height = '18px', style = {} }) {
  return <span className="skeleton skeleton-line" style={{ width, height, ...style }} aria-hidden="true" />;
}

export function SkeletonCard({ rows = 3 }) {
  return (
    <div className="skeleton-card" role="status" aria-label="Cargando contenido">
      <SkeletonLine width="40%" height="24px" />
      <SkeletonLine width="80%" height="16px" />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} width={`${90 - i * 15}%`} height="14px" />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page" role="status" aria-label="Cargando página">
      <div style={{ marginBottom: '28px' }}>
        <SkeletonLine width="20%" height="14px" style={{ marginBottom: '10px' }} />
        <SkeletonLine width="45%" height="32px" style={{ marginBottom: '10px' }} />
        <SkeletonLine width="60%" height="16px" />
      </div>
      <div className="metrics-grid" style={{ marginBottom: '24px' }}>
        <SkeletonCard rows={2} />
        <SkeletonCard rows={2} />
        <SkeletonCard rows={2} />
        <SkeletonCard rows={2} />
      </div>
      <SkeletonCard rows={5} />
    </div>
  );
}

