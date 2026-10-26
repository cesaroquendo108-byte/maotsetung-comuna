import { Modal, StatusBadge } from './UI.jsx';

export default function PaymentVerificationModal({ payment, onClose, onApprove, onReject, role }) {
  if (!payment) return null;

  const isApproved = payment.status === 'verified' || payment.status === 'Validado' || payment.status === 'Aprobado';
  const isFlagged = payment.status === 'flagged' || payment.status === 'Auto-Rechazado';
  const isRejected = payment.status === 'rejected' || payment.status === 'Rechazado';

  let suspicionReasons = [];
  try {
    if (typeof payment.aiSuspicionReasons === 'string') {
      suspicionReasons = JSON.parse(payment.aiSuspicionReasons);
    } else if (Array.isArray(payment.aiSuspicionReasons)) {
      suspicionReasons = payment.aiSuspicionReasons;
    }
  } catch (e) {
    suspicionReasons = [];
  }

  const ai = payment.aiAnalysis || {
    referenceNumber: payment.reference || payment.extraction?.referenceNumber || '',
    amountBs: payment.extraction?.amountBs || null,
    date: payment.time || '',
    suspicious: isFlagged || suspicionReasons.length > 0,
    suspicionReasons
  };

  const bcvRate = payment.bcvRate || null;
  const amountBsNum = payment.amountBs || (payment.amount ? parseFloat(String(payment.amount).replace(/[^0-9,.]/g, '').replace(',', '.')) : null);
  const amountUsd = payment.amountUsd || (bcvRate && amountBsNum ? (amountBsNum / bcvRate).toFixed(2) : null);

  return (
    <Modal open title="Verificación de Pago (Auditoría Óptica)" onClose={onClose}>
      <div className="payment-verification-card">
        <header className="pv-header">
          <div className="pv-badges">
            <StatusBadge tone={isApproved ? 'success' : isFlagged || isRejected ? 'danger' : 'warning'}>
              {isApproved
                ? 'Validado por Administrador'
                : isFlagged
                ? 'Flagged · Auto-Rechazado por IA'
                : isRejected
                ? 'Rechazado por Administrador'
                : 'Pendiente · Acceso Buena Fe Otorgado'}
            </StatusBadge>
            <span className="pv-type-pill">Jornada CLAP</span>
          </div>
        </header>

        <div className="pv-main-amount">
          <h2>{payment.amountFormatted || (amountBsNum !== null ? `Bs ${amountBsNum.toLocaleString('es-VE')}` : '—')}</h2>
          <p className="pv-payer-info">
            {payment.payerEmail || payment.payer || '—'}{payment.time ? ` · ${payment.time}` : ''}
          </p>
          <small className="pv-verified-note">
            {isApproved
              ? '✓ Verificado en banco por un administrador — acceso confirmado.'
              : isFlagged
              ? 'Pago marcado como sospechoso (Auto-Rechazado). Sin acceso hasta revisión humana.'
              : 'Acceso de buena fe otorgado inmediatamente. Pendiente de conciliación bancaria final.'}
          </small>
        </div>

        {/* Razones de Sospecha Detectadas por IA / Regla Determinista */}
        {suspicionReasons.length > 0 && (
          <div className="pv-alert-banner danger">
            <span className="material-symbols-outlined">gpp_bad</span>
            <div>
              <strong>Razones de Sospecha / Auto-Rechazo (Solo Admin)</strong>
              <ul>
                {suspicionReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Recuadro de Lectura de la IA */}
        <section className="pv-ai-box">
          <div className="pv-ai-header">
            <span className="material-symbols-outlined pv-ai-spark">auto_awesome</span>
            <span>Lectura Forense de la IA (OpenRouter Gemini)</span>
            {(isFlagged || ai.suspicious) && <span className="pv-alert-tag">¡Comprobante Flagged!</span>}
          </div>
          <div className="pv-ai-grid">
            <div className="pv-ai-row">
              <span>Referencia leída</span>
              <strong className="mono">{ai.referenceNumber || payment.reference || '—'}</strong>
            </div>
            <div className="pv-ai-row">
              <span>Monto extraído (Bs)</span>
              <strong>{ai.amountBs ? `Bs ${Number(ai.amountBs).toLocaleString('es-VE')}` : '—'}</strong>
            </div>
            <div className="pv-ai-row">
              <span>Fecha extraída</span>
              <strong>{ai.date || '—'}</strong>
            </div>
            <div className="pv-ai-row">
              <span>Veredicto de Fraude</span>
              <strong style={{ color: ai.suspicious ? '#f87171' : '#34d399' }}>
                {ai.suspicious ? 'Sospechoso (Flagged)' : '✓ Limpio (Acceso Buena Fe)'}
              </strong>
            </div>
          </div>
        </section>

        {/* Detalles Financieros y Tasa BCV */}
        <section className="pv-details-box">
          <div className="pv-detail-row">
            <span>Monto USD</span>
            <strong>{amountUsd ? `$${amountUsd}` : '—'}</strong>
          </div>
          <div className="pv-detail-row">
            <span>Tasa BCV</span>
            <strong>{bcvRate ? `${bcvRate.toLocaleString('es-VE', { minimumFractionDigits: 4 })}` : '—'}</strong>
          </div>
          <div className="pv-detail-row">
            <span>Referencia reportada</span>
            <strong className="mono">{payment.reference || ai.referenceNumber || '—'}</strong>
          </div>
          <div className="pv-detail-row">
            <span>Período</span>
            <small>{payment.period || '—'}</small>
          </div>
          {isApproved && (
            <div className="pv-detail-row">
              <span>Revisado</span>
              <small>{payment.reviewedAt || '—'}{payment.reviewedBy ? ` por ${payment.reviewedBy}` : ''}</small>
            </div>
          )}
        </section>

        {/* Captura de Pantalla del Comprobante */}
        {payment.receiptUrl ? (
          <section className="pv-receipt-preview">
            <p className="eyebrow">CAPTURA DEL COMPROBANTE ADJUNTO</p>
            <div className="receipt-image-wrapper">
              <img src={payment.receiptUrl} alt="Comprobante de pago" />
            </div>
          </section>
        ) : (
          <section className="pv-receipt-preview demo-receipt-placeholder">
            <p className="eyebrow">COMPROBANTE</p>
            <div className="receipt-mock-box">
              <span className="material-symbols-outlined">receipt_long</span>
              <div>
                <strong>{payment.method || 'Transferencia / Pago Móvil'}</strong>
                <small>Ref. {payment.reference || ai.referenceNumber || '—'}</small>
              </div>
            </div>
          </section>
        )}

        {/* Botones de acción para administradores (Sobrescritura recuperable) */}
        {role === 'admin' && !isApproved && (
          <div className="pv-actions">
            <button
              className="primary-button full"
              type="button"
              onClick={() => onApprove?.(payment)}
            >
              {isFlagged ? 'Sobrescribir y Aprobar (Confirmado en Banco)' : 'Confirmar y Aprobar Pago'}
            </button>
            <button className="secondary-button danger-link full" type="button" onClick={() => onReject?.(payment)}>
              Rechazar Definitivamente
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
