import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader, StatusBadge, AsyncDataState, ProgressBar } from '../components/UI.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { getTreasuryFundData, submitFundContribution } from '../lib/repository.js';
import { formatBs, formatUsd } from '../lib/finveRates.js';
import {
  COMMUNITY_PAYMENT_ACCOUNT,
  computeFileSha256,
  analyzeFundReceipt,
  classifyFundContribution,
} from '../lib/fundPaymentGateway.js';
import { copyToClipboard } from '../lib/paymentAccount.js';
import { COMMUNITY_CONFIG } from '../config/community.js';

export default function TreasuryFund({ role, onAction }) {
  const { user, household, isDemo } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Lock body scroll and handle Escape key when payment modal is active
  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [modalOpen]);

  // Payment form states
  const [receiptFile, setReceiptFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [sha256Hash, setSha256Hash] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [referenceInput, setReferenceInput] = useState('');
  const [amountInput, setAmountInput] = useState(1000);
  const [copiedKey, setCopiedKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTreasuryFundData();
      setData(res);
    } catch (err) {
      setError(err.message || 'Error cargando los datos del fondo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopy = async (key, val) => {
    const ok = await copyToClipboard(val);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setReceiptFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setAnalyzing(true);
    setSubmitError('');

    try {
      // 1. Compute SHA-256 (Bellas Artes duplicate protection)
      const hash = await computeFileSha256(file);
      setSha256Hash(hash);

      // 2. Optical vision extraction via Gemini Flash
      const ocr = await analyzeFundReceipt(file);
      if (ocr.extraction) {
        setExtractedData(ocr.extraction);
        if (ocr.extraction.reference) setReferenceInput(ocr.extraction.reference);
        if (ocr.extraction.amount) setAmountInput(ocr.extraction.amount);
      }
    } catch (err) {
      setSubmitError('No se pudo extraer automáticamente el texto del comprobante. Ingresa los datos manualmente.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');

    try {
      const classification = classifyFundContribution({
        expectedAmount: 1000,
        extractedAmount: amountInput,
        reference: referenceInput,
      });

      const payload = {
        communityCode: COMMUNITY_CONFIG.code,
        period: data?.fund?.currentPeriod || '2026-10',
        amountBs: amountInput,
        referenceNumber: referenceInput,
        receiptSha256: sha256Hash,
        classification,
      };

      await submitFundContribution(payload);
      setSubmitSuccess(true);
      setTimeout(() => {
        setSubmitSuccess(false);
        setModalOpen(false);
        loadData();
      }, 1800);
    } catch (err) {
      setSubmitError(err.message || 'Error registrando el aporte.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredLedger = useMemo(() => {
    const items = data?.ledger || [];
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((i) => i.location.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q));
  }, [data?.ledger, searchQuery]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="TESORERÍA / FONDO COMUNAL DE INVERSIÓN"
        title="Fondo de Inversión y Desarrollo Vecinal"
        description="Aporte de 1.000 Bs por familia indexado a tasa oficial BCV para obras y desarrollo comunitario."
        actions={
          <button className="primary-button" type="button" onClick={() => setModalOpen(true)}>
            + Reportar aporte mensual (1.000 Bs)
          </button>
        }
      />

      <AsyncDataState loading={loading} error={error} onRetry={loadData} loadingLabel="Cargando datos de tesorería y Finve BVC..." />

      {!loading && data && (
        <>
          {/* Métricas Principales en Tiempo Real */}
          <section className="metrics-grid" aria-label="Resumen de tesorería comunal">
            <article className="metric-card metric-card--accent">
              <span>{formatBs(data.fund.totalCollectedBs)}</span>
              <p>
                <strong>Capital Recaudado ({data.fund.currentPeriod})</strong>
                <small>{formatUsd(data.fund.totalCollectedUsd)} a tasa oficial BCV</small>
              </p>
            </article>

            <article className="metric-card">
              <span>{data.fund.activeContributorsCount} / {data.fund.targetFamilies}</span>
              <p>
                <strong>Familias al Día</strong>
                <small>{data.fund.participationRate}% de participación comunal</small>
              </p>
            </article>

            <article className="metric-card">
              <span>Bs {data.rates.bcvRate.toLocaleString('es-VE')}</span>
              <p>
                <strong>Tasa Oficial BCV</strong>
                <small>USD / VES · Motor Finve BVC</small>
              </p>
            </article>

            <article className="metric-card">
              <span>Bs {data.rates.usdtRate.toLocaleString('es-VE')}</span>
              <p>
                <strong>Tasa Paralela USDT</strong>
                <small>Referencia cambiaria de mercado</small>
              </p>
            </article>

            <article className="metric-card metric-card--warning">
              <span>{formatUsd(data.portfolio.totalProjectedYieldUsd)}</span>
              <p>
                <strong>Rendimiento Proyectado</strong>
                <small>Cupones de renta fija BVC (12.5% - 14% anual)</small>
              </p>
            </article>
          </section>

          {/* Tarjeta de Estado Familiar */}
          <section className="panel" style={{ margin: '1.5rem 0', padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <p className="eyebrow" style={{ color: '#FF9F1C', fontWeight: 800 }}>ESTADO DE CUOTA DEL HOGAR</p>
                <h2 style={{ margin: '0.25rem 0', fontSize: '1.25rem' }}>
                  {household?.code || 'Tu Hogar Censado'} · Periodo {data.fund.currentPeriod}
                </h2>
                <p style={{ color: '#64748B', fontSize: '0.85rem', margin: 0 }}>
                  Cuota reglamentaria: <strong>1.000,00 Bs</strong> ({formatUsd(data.fund.quotaUsd)} a tasa BCV).
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {data.myContribution?.paid ? (
                  <div style={{ textAlign: 'right' }}>
                    <StatusBadge tone="success">Cuota Al Día</StatusBadge>
                    <small style={{ display: 'block', color: '#64748B', marginTop: '0.25rem' }}>
                      Ref: {data.myContribution.referenceNumber}
                    </small>
                  </div>
                ) : (
                  <div style={{ textAlign: 'right' }}>
                    <StatusBadge tone="warning">Cuota Pendiente</StatusBadge>
                    <button
                      type="button"
                      className="primary-button compact"
                      style={{ marginTop: '0.5rem', display: 'block' }}
                      onClick={() => setModalOpen(true)}
                    >
                      Pagar 1.000 Bs
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Portafolio de Renta Fija en la BVC */}
          <section className="panel" style={{ margin: '1.5rem 0' }}>
            <header className="table-toolbar">
              <div>
                <p className="eyebrow">PORTAFOLIO DE INVERSIÓN COMUNAL</p>
                <h2>Títulos de Renta Fija en Custodia Bursátil</h2>
              </div>
              <small style={{ color: '#64748B' }}>
                {data.fund.custodyAccount}
              </small>
            </header>

            {(!data.portfolio?.holdings || data.portfolio.holdings.length === 0) ? (
              <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', background: '#F8FAFC', borderRadius: '14px', border: '1px dashed #CBD5E1', margin: '1rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '2.5rem', color: '#94A3B8', marginBottom: '0.5rem', display: 'block' }}>account_balance</span>
                <strong style={{ color: '#1E293B', fontSize: '1rem', display: 'block' }}>Sin colocaciones bursátiles activas</strong>
                <p style={{ color: '#64748B', fontSize: '0.85rem', maxWidth: '480px', margin: '0.5rem auto 0' }}>
                  Los fondos recaudados se mantendrán en custodia institucional y se colocarán en instrumentos fiduciarios conforme a las decisiones de la asamblea comunal.
                </p>
              </div>
            ) : (
              <>
                <div className="portfolio-desktop-table">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Emisor / Instrumento</th>
                          <th>Ticker / ISIN</th>
                          <th>Monto Colocado</th>
                          <th>Tasa Cupón</th>
                          <th>Vencimiento</th>
                          <th>Estado de Custodia</th>
                          <th>Interés Estimado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.portfolio.holdings.map((sec) => (
                          <tr key={sec.id}>
                            <td>
                              <strong>{sec.issuer}</strong>
                              <small style={{ display: 'block', color: '#64748B' }}>{sec.instrumentType}</small>
                            </td>
                            <td className="mono">
                              <strong>{sec.ticker}</strong>
                              <small style={{ display: 'block', color: '#94A3B8' }}>{sec.isin}</small>
                            </td>
                            <td>
                              <strong>{formatBs(sec.nominalAmountBs)}</strong>
                              <small style={{ display: 'block', color: '#64748B' }}>{formatUsd(sec.nominalAmountUsd)}</small>
                            </td>
                            <td>
                              <StatusBadge tone="accent">{sec.couponRate}% Anual</StatusBadge>
                              <small style={{ display: 'block', color: '#64748B', marginTop: '0.2rem' }}>{sec.indexation}</small>
                            </td>
                            <td>
                              <strong>{sec.maturityDate}</strong>
                              <small style={{ display: 'block', color: '#94A3B8' }}>{sec.custodyProofTitle}</small>
                            </td>
                            <td>
                              <StatusBadge tone="success">{sec.statusLabel}</StatusBadge>
                            </td>
                            <td>
                              <strong style={{ color: '#10B981' }}>+{formatUsd(sec.projectedYieldUsd)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="portfolio-mobile-cards">
                  {data.portfolio.holdings.map((sec) => (
                    <article key={sec.id} className="portfolio-card-item">
                      <header className="portfolio-card-header">
                        <div>
                          <h4 className="portfolio-card-title">{sec.issuer}</h4>
                          <p className="portfolio-card-sub">{sec.instrumentType}</p>
                        </div>
                        <StatusBadge tone="success">{sec.statusLabel}</StatusBadge>
                      </header>

                      <div className="portfolio-card-grid">
                        <div className="portfolio-card-row">
                          <span>Ticker / ISIN</span>
                          <strong className="mono">{sec.ticker}</strong>
                          <small style={{ color: '#94A3B8', fontSize: '0.7rem' }}>{sec.isin}</small>
                        </div>

                        <div className="portfolio-card-row">
                          <span>Monto Colocado</span>
                          <strong>{formatBs(sec.nominalAmountBs)}</strong>
                          <small style={{ color: '#64748B', fontSize: '0.7rem' }}>{formatUsd(sec.nominalAmountUsd)}</small>
                        </div>

                        <div className="portfolio-card-row">
                          <span>Tasa Cupón</span>
                          <strong style={{ color: '#0284C7' }}>{sec.couponRate}% Anual</strong>
                          <small style={{ color: '#64748B', fontSize: '0.7rem' }}>{sec.indexation}</small>
                        </div>

                        <div className="portfolio-card-row">
                          <span>Vencimiento</span>
                          <strong>{sec.maturityDate}</strong>
                          <small style={{ color: '#94A3B8', fontSize: '0.7rem' }}>{sec.custodyProofTitle}</small>
                        </div>
                      </div>

                      <footer className="portfolio-card-footer">
                        <span style={{ color: '#64748B', fontSize: '0.75rem' }}>Interés proyectado</span>
                        <strong style={{ color: '#10B981', fontSize: '0.95rem' }}>+{formatUsd(sec.projectedYieldUsd)}</strong>
                      </footer>
                    </article>
                  ))}
                </div>

                <footer style={{ padding: '0.75rem 1rem', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span>Total portafolio colocado: <strong>{formatBs(data.portfolio.totalNominalBs)}</strong> ({formatUsd(data.portfolio.totalNominalUsd)})</span>
                  <span style={{ color: '#10B981', fontWeight: 800 }}>Rendimiento proyectado total: +{formatUsd(data.portfolio.totalProjectedYieldUsd)}</span>
                </footer>
              </>
            )}
          </section>

          {/* Libro Mayor Público (Ledger Comunal) */}
          <section className="panel">
            <header className="table-toolbar">
              <div>
                <p className="eyebrow">LIBRO MAYOR DE TRANSPARENCIA</p>
                <h2>Aportes de la Comunidad ({data.fund.currentPeriod})</h2>
              </div>
              <div className="toolbar-actions">
                <input
                  aria-label="Buscar aporte"
                  placeholder="Buscar por zona o casa (ej: Casa 1006)…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </header>

            {filteredLedger.length === 0 ? (
              <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', color: '#64748B' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '2.5rem', color: '#94A3B8', marginBottom: '0.5rem', display: 'block' }}>receipt_long</span>
                <strong style={{ color: '#1E293B', display: 'block', fontSize: '1rem' }}>No hay aportes registrados este mes</strong>
                <p style={{ fontSize: '0.85rem', margin: '0.35rem 0 0' }}>Reporta el pago móvil de tu hogar para registrar el primer aporte del periodo.</p>
              </div>
            ) : (
              <>
                <div className="ledger-desktop-table">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Fecha y Hora</th>
                          <th>Vivienda / Hogar</th>
                          <th>Monto</th>
                          <th>Referencia</th>
                          <th>Estado de Conciliación</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLedger.map((item) => (
                          <tr key={item.id}>
                            <td>{item.time}</td>
                            <td><strong>{item.location}</strong></td>
                            <td><strong>{formatBs(item.amountBs)}</strong></td>
                            <td className="mono">{item.ref}</td>
                            <td><StatusBadge tone="success">Verificado</StatusBadge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="ledger-mobile-cards">
                  {filteredLedger.map((item) => (
                    <article key={item.id} className="ledger-card-item">
                      <div>
                        <strong style={{ display: 'block', fontSize: '0.88rem', color: '#0F172A' }}>{item.location}</strong>
                        <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{item.time}</span>
                        <small className="mono" style={{ display: 'block', color: '#94A3B8', fontSize: '0.72rem', marginTop: '2px' }}>
                          Ref: {item.ref}
                        </small>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <strong style={{ display: 'block', fontSize: '0.9rem', color: '#0F172A' }}>{formatBs(item.amountBs)}</strong>
                        <StatusBadge tone="success">Verificado</StatusBadge>
                      </div>
                    </article>
                  ))}
                </div>

                <footer>
                  <span>Mostrando {filteredLedger.length} aportes auditados</span>
                </footer>
              </>
            )}
          </section>
        </>
      )}

      {/* Modal Pasarela de Pago Móvil renderizado vía Portal directo a document.body */}
      {modalOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
          style={{
            position: 'fixed',
            inset: 0,
            top: 0,
            left: 0,
            width: '100vw',
            height: '100dvh',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            className="modal"
            style={{
              maxWidth: '540px',
              width: '100%',
              margin: 'auto',
              maxHeight: '92dvh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: '20px',
              background: '#FFFFFF',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.35)',
              overflow: 'hidden',
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
              <div>
                <p className="eyebrow" style={{ color: '#FF9F1C', fontWeight: 800, margin: 0 }}>PASARELA DE PAGO MÓVIL</p>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0F172A' }}>Reportar Aporte Comunal (1.000 Bs)</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '1.25rem', color: '#94A3B8', cursor: 'pointer', padding: '0.25rem 0.5rem', lineHeight: 1 }}
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </header>

            <div className="modal-body" style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' }}>
              {/* Datos para realizar el Pago Móvil */}
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748B' }}>BANCO RECEPTOR:</span>
                  <strong style={{ fontSize: '0.85rem', color: '#0F172A' }}>{COMMUNITY_PAYMENT_ACCOUNT.bank}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748B' }}>CÉDULA RECEPTOR:</span>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <strong className="mono" style={{ fontSize: '0.85rem' }}>{COMMUNITY_PAYMENT_ACCOUNT.idFormatted || COMMUNITY_PAYMENT_ACCOUNT.idNumber}</strong>
                    <button type="button" className="donate-copy-btn" onClick={() => handleCopy('idNumber', COMMUNITY_PAYMENT_ACCOUNT.idNumber)}>
                      {copiedKey === 'idNumber' ? 'copiado' : 'copiar'}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748B' }}>TELÉFONO PAGO MÓVIL:</span>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <strong className="mono" style={{ fontSize: '0.85rem' }}>{COMMUNITY_PAYMENT_ACCOUNT.phone}</strong>
                    <button type="button" className="donate-copy-btn" onClick={() => handleCopy('phone', COMMUNITY_PAYMENT_ACCOUNT.phone)}>
                      {copiedKey === 'phone' ? 'copiado' : 'copiar'}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #CBD5E1', paddingTop: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748B' }}>MONTO EXACTO:</span>
                  <strong style={{ fontSize: '0.9rem', color: '#0F172A' }}>Bs 1.000,00</strong>
                </div>
              </div>

              <form onSubmit={handlePaymentSubmit}>
                {/* Carga del comprobante */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                    Adjuntar Comprobante de Pago Móvil (JPG, PNG)
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileChange}
                    style={{ width: '100%', fontSize: '0.85rem' }}
                    required
                  />
                </div>

                {analyzing && (
                  <div style={{ padding: '0.75rem', background: '#FFFBEB', color: '#D97706', borderRadius: '0.5rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
                    Lector óptico analizando comprobante con inteligencia artificial...
                  </div>
                )}

                {/* Resultado del lector óptico */}
                {extractedData && (
                  <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
                    <span style={{ color: '#166534', fontWeight: 800, display: 'block', marginBottom: '0.25rem' }}>
                      Lectura Óptica Exitosa:
                    </span>
                    <div>Monto detectado: <strong>Bs {extractedData.amount || 1000}</strong></div>
                    <div>Referencia: <strong className="mono">{extractedData.reference}</strong></div>
                    {sha256Hash && <small style={{ color: '#64748B', display: 'block', marginTop: '0.25rem' }}>Hash SHA-256 verificado: {sha256Hash.slice(0, 16)}…</small>}
                  </div>
                )}

                {/* Campos de confirmación */}
                <div className="reg-grid-2" style={{ marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748B', marginBottom: '0.25rem' }}>
                      Referencia Bancaria
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: 83599136"
                      value={referenceInput}
                      onChange={(e) => setReferenceInput(e.target.value)}
                      required
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748B', marginBottom: '0.25rem' }}>
                      Monto en Bolívares
                    </label>
                    <input
                      type="number"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      required
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                {submitError && (
                  <div className="form-error" style={{ marginBottom: '1rem' }} role="alert">
                    {submitError}
                  </div>
                )}

                {submitSuccess && (
                  <div style={{ padding: '0.75rem', background: '#F0FDF4', color: '#166534', borderRadius: '0.5rem', fontWeight: 700, marginBottom: '1rem', textAlign: 'center' }}>
                    Aporte registrado con éxito. Acceso al fondo actualizado.
                  </div>
                )}

                <div className="reg-actions-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setModalOpen(false)}
                    disabled={submitting}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    style={{ flex: 1, background: '#10B981', color: '#FFFFFF', fontWeight: 800 }}
                    disabled={submitting || analyzing}
                  >
                    {submitting ? 'Verificando aporte...' : 'Confirmar y Registrar Aporte'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
