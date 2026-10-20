import { useEffect, useMemo, useState } from 'react';
import { can } from '../lib/permissions.js';
import { demoCycle, demoPickupAuthorizations } from '../lib/demoData.js';
import { AsyncDataState, PageHeader, ProgressBar, Segmented, StatusBadge } from '../components/UI.jsx';

function parseAllocationMeta(allocation, importedRecord) {
  const code = String(importedRecord?.expand?.matchedHousehold?.code || allocation || '').trim();
  const legacySeq = importedRecord?.expand?.matchedHousehold?.legacySequence;

  // Pattern: URP-[ZONE]-[HOUSE] (ej: URP-PG-1006 o URP-RF1-1007-PA)
  const match = code.match(/URP-([A-Za-z0-9]+)-([A-Za-z0-9]+)/i);
  if (match) {
    const zone = match[1].toUpperCase();
    const houseStr = match[2];
    const num = Number(legacySeq) || parseInt(houseStr.replace(/\D/g, ''), 10) || 0;
    return { zone, houseNumber: houseStr, sequence: num, isMatched: true };
  }

  // Fallback para Casa 1006 o números aislados
  const numMatch = code.match(/\b(\d{2,6})\b/);
  if (numMatch) {
    return { zone: 'URP', houseNumber: numMatch[1], sequence: parseInt(numMatch[1], 10), isMatched: true };
  }

  return { zone: 'SIN_ASIGNAR', houseNumber: '', sequence: 999999, isMatched: false };
}
import PaymentVerificationModal from '../components/PaymentVerificationModal.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { getPaymentOperationData } from '../lib/repository.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { formatCurrencyTotals } from '../lib/formatters.js';

const DEMO_TRANSACTIONS = [];

export default function Clap({ role, onAction }) {
  const { membership, household, isDemo } = useAuth();
  const operator = can(role, 'payments.operate');
  const hasHousehold = Boolean(isDemo || membership?.household);
  const [view, setView] = useState(operator ? 'operation' : 'mine');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [sortOrder, setSortOrder] = useState('recent');
  const [selectedZone, setSelectedZone] = useState('all');
  useEffect(() => {
    if (!operator) setView('mine');
    else if (!hasHousehold && view === 'mine') setView('operation');
  }, [operator, hasHousehold, view]);
  const live = useAsyncData(
    () => isDemo ? Promise.resolve(null) : getPaymentOperationData(membership, { householdOnly: view === 'mine' }),
    [isDemo, membership?.id, view],
  );
  const cycle = isDemo ? demoCycle : live.data?.cycle;
  const importedCycle = cycle?.source === 'payment_import_staging';
  const reportedTransactions = isDemo ? DEMO_TRANSACTIONS.map((record) => ({ ...record, payer: 'Pagador de demostración' })) : (live.data?.reports || []).map((record) => ({
    id: record.id,
    time: new Date(record.created).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }),
    amount: new Intl.NumberFormat('es-VE', { style: 'currency', currency: record.currency || 'VES' }).format(Number(record.amount || 0)),
    payer: 'Reporte desde la app',
    allocation: 'Pendiente de conciliación',
    status: record.status === 'verified' ? 'Validado' : record.status === 'rejected' ? 'Rechazado' : 'En revisión',
    tone: record.status === 'verified' ? 'success' : record.status === 'rejected' ? 'danger' : 'warning',
  }));
  const importedTransactions = isDemo ? [] : (live.data?.importedPayments || []).map((record) => ({
    id: `import-${record.id}`,
    time: `${String(record.rawReference || '').slice(0, 16) || `Fila ${record.sourceRow}`} · Excel`,
    amount: new Intl.NumberFormat('es-VE', { style: 'currency', currency: record.currency || 'VES' }).format(Number(record.amount || 0)),
    payer: record.payerName || 'Sin nombre en el archivo',
    allocation: record.expand?.matchedHousehold?.code || 'Sin hogar asignado',
    status: record.status === 'matched' ? 'Conciliado' : record.status === 'imported' ? 'Importado' : 'Por identificar',
    tone: ['matched', 'imported'].includes(record.status) ? 'success' : 'warning',
    importedRecord: record,
  }));
  const transactions = [...reportedTransactions, ...importedTransactions];
  const pickupAuthorizations = isDemo ? demoPickupAuthorizations : [];
  const reportCount = isDemo ? 0 : (live.data?.totalReports || 0);
  const allocationCount = isDemo ? 0 : (live.data?.allocations || 0);
  const householdAllocationCount = isDemo ? 0 : allocationCount;
  const totals = isDemo ? { VES: 0, USD: 0 } : (live.data?.totals || { VES: 0, USD: 0 });
  const livePickupAuthorizations = isDemo ? pickupAuthorizations : (live.data?.pickupAuthorizations || []).map((item) => ({
    id: item.id,
    household: item.expand?.household?.code || 'Hogar autorizado',
    collector: item.collectorIdNumber ? `Recolector ••••${String(item.collectorIdNumber).replace(/\D/g, '').slice(-4)}` : 'Recolector registrado',
    bags: Number(item.bags || 0),
    status: item.status === 'active' ? 'Confirmada' : item.status,
  }));
  const latestPayment = transactions[0];
  const normalizedPaymentSearch = paymentSearch.trim().toLocaleLowerCase('es');

  const processedTransactions = useMemo(() => {
    return transactions.map((item) => {
      const meta = parseAllocationMeta(item.allocation, item.importedRecord);
      return {
        ...item,
        zone: meta.zone,
        houseNumber: meta.houseNumber,
        sequence: meta.sequence,
        isMatched: meta.isMatched,
      };
    });
  }, [transactions]);

  const availableZones = useMemo(() => {
    const zoneSet = new Set();
    processedTransactions.forEach((t) => {
      if (t.zone && t.zone !== 'SIN_ASIGNAR') zoneSet.add(t.zone);
    });
    return Array.from(zoneSet).sort();
  }, [processedTransactions]);

  const visibleTransactions = useMemo(() => {
    let list = processedTransactions;

    if (selectedZone !== 'all') {
      list = list.filter((t) => t.zone === selectedZone);
    }

    if (normalizedPaymentSearch) {
      list = list.filter((item) =>
        [item.time, item.amount, item.payer, item.allocation, item.status, item.houseNumber, item.zone].some(
          (value) => String(value || '').toLocaleLowerCase('es').includes(normalizedPaymentSearch)
        )
      );
    }

    if (sortOrder === 'route') {
      return [...list].sort((a, b) => {
        if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
        return a.sequence - b.sequence;
      });
    }

    if (sortOrder === 'amount') {
      const parseAmount = (s) => parseFloat(String(s).replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
      return [...list].sort((a, b) => parseAmount(b.amount) - parseAmount(a.amount));
    }

    return list;
  }, [processedTransactions, selectedZone, normalizedPaymentSearch, sortOrder]);
  const paymentLabel = latestPayment?.status || 'Sin pago reportado';
  const delivery = live.data?.delivery;
  const deliveryConfirmed = Boolean(delivery?.deliveredAt || delivery?.delivered === true);
  const deliveryLabel = isDemo ? 'Por confirmar' : deliveryConfirmed ? 'Entregada' : delivery?.delivered === false ? 'Reportada como no recibida' : 'Por confirmar';
  const cycleStart = cycle?.paymentOpensAt || cycle?.distributionStartsAt || cycle?.startsAt;
  const cutoffLabel = isDemo ? 'CORTE AL 21 DE JULIO' : cycleStart ? `JORNADA ABIERTA ${new Date(cycleStart).toLocaleDateString('es-VE')}` : 'JORNADA ACTUAL';

  return (
    <div className="page">
      <PageHeader
        eyebrow="OPERACIÓN / DISTRIBUCIÓN"
        title="Jornada CLAP"
        description="Cobro, conciliación y preparación de entrega de bolsas."
        actions={hasHousehold && <button className="primary-button" type="button" onClick={() => onAction('payment')}>+ Reportar pago</button>}
      />

      {operator && hasHousehold && <Segmented value={view} onChange={setView} label="Vista de jornada" options={[{ value: 'operation', label: 'Operativo' }, { value: 'mine', label: 'Mi hogar' }]} />}

      {!isDemo && <AsyncDataState loading={live.loading} error={live.error} onRetry={live.reload} loadingLabel="Cargando la jornada CLAP…" />}

      {(isDemo || (!live.loading && !live.error)) && (view === 'mine' ? (
        <div className="clap-resident-grid">
          <article className="panel bag-card">
            <header><div><p className="eyebrow">MI ASIGNACIÓN</p><h2>{cycle?.name || 'Sin jornada CLAP'}</h2></div><StatusBadge tone={cycle ? 'warning' : 'neutral'}>{cycle ? (importedCycle ? 'Cobro activo' : 'En preparación') : 'Sin asignación'}</StatusBadge></header>
            <div className="bag-illustration" aria-hidden="true"><span>{cycle ? householdAllocationCount : 0}</span><small>{householdAllocationCount === 1 ? 'BOLSA' : 'BOLSAS'}</small></div>
            <div className="bag-details">
              <div><span>Hogar</span><strong>{household?.code || 'Por vincular'}</strong></div>
              <div><span>Pago</span><strong>{paymentLabel}</strong></div>
              <div><span>Entrega</span><strong>{deliveryLabel}</strong></div>
            </div>
            <div className="button-row">
              <button className="primary-button" type="button" onClick={() => onAction('payment')}>Reportar pago</button>
              <button className="secondary-button" type="button" onClick={() => onAction('delivery')}>Reportar entrega</button>
            </div>
          </article>

          <article className="panel pickup-card">
            <header><div><p className="eyebrow">RETIRO SOLIDARIO</p><h2>Autorizaciones emitidas</h2></div><StatusBadge tone="success">Máx. 17 por retiro</StatusBadge></header>
            <p>Autoriza a una persona de confianza para retirar la asignación de tu hogar. Operaciones valida la cédula y el límite físico.</p>
            <div className="authorization-list">
              {livePickupAuthorizations.map((item) => <div key={item.id}><span>{item.bags}</span><p><strong>{item.collector || item.household}</strong><small>{item.status} · {item.bags === 1 ? '1 bolsa' : `${item.bags} bolsas`}</small></p><i>✓</i></div>)}
              {!livePickupAuthorizations.length && <p className="empty-inline">Aún no has emitido autorizaciones para esta jornada.</p>}
            </div>
            <button className="secondary-button full" type="button" onClick={() => onAction('pickup')}>+ Autorizar a un recolector</button>
          </article>

          <article className="panel delivery-proof">
            <p className="eyebrow">DOBLE CONFIRMACIÓN</p>
            <h2>La entrega oficial y tu casilla son registros distintos.</h2>
            <p>El operador registra la salida. Tú puedes confirmar si efectivamente recibiste la bolsa o avisar que no llegó.</p>
            <button className="link-button" type="button" onClick={() => onAction('delivery')}>Reportar estado <span>→</span></button>
          </article>
        </div>
      ) : (
        <>
          <section className="operation-summary">
            <article className="operation-lead">
              <p className="eyebrow">{cutoffLabel}</p>
              <h2>{formatCurrencyTotals(totals)}</h2>
              <p>{reportCount} movimientos recibidos; {live.data?.statusCounts?.verified || 0} ya tienen hogar identificado.</p>
              <ProgressBar value={live.data?.statusCounts?.verified || 0} max={reportCount || 1} label="Movimientos conciliados" detail={reportCount ? `${Math.round(((live.data?.statusCounts?.verified || 0) / reportCount) * 100)}%` : 'Sin movimientos'} />
            </article>
            <article><span>{reportCount}</span><p><strong>movimientos del archivo</strong><small>Excel CLAP 20 de julio</small></p></article>
            <article><span>{isDemo ? 0 : (live.data?.statusCounts?.verified || 0)}</span><p><strong>hogares identificados</strong><small>Coincidencia conservadora con el censo</small></p></article>
            <article className="warning"><span>{isDemo ? transactions.filter((item) => item.tone === 'warning').length : (live.data?.statusCounts?.pending_review || 0) + (live.data?.statusCounts?.needs_info || 0)}</span><p><strong>por identificar</strong><small>Requieren revisión humana</small></p></article>
          </section>

          <section className="panel transaction-panel">
            <header className="table-toolbar">
              <div><p className="eyebrow">DISTRIBUCIÓN Y COBRO</p><h2>Reportes de pago</h2></div>
              <div className="toolbar-actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  aria-label="Buscar pago"
                  placeholder="Buscar por cédula, nombre, casa o monto…"
                  value={paymentSearch}
                  onChange={(event) => setPaymentSearch(event.target.value)}
                />
                <label className="filter-select" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <span>Zona</span>
                  <select
                    value={selectedZone}
                    onChange={(e) => setSelectedZone(e.target.value)}
                    aria-label="Filtrar por zona"
                  >
                    <option value="all">Todas las zonas</option>
                    {availableZones.map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </label>
                <label className="filter-select" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <span>Orden</span>
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    aria-label="Ordenar listado"
                  >
                    <option value="recent">Cronológico (Recientes)</option>
                    <option value="route">Ruta Puerta a Puerta (Casa 1006 → 1007...)</option>
                    <option value="amount">Monto mayor</option>
                  </select>
                </label>
              </div>
            </header>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Pagador</th><th>Monto</th><th>Hogar / Ruta de entrega</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>{visibleTransactions.map((item) => (
                  <tr key={item.id}>
                    <td>{item.time}</td>
                    <td><strong>{item.payer}</strong></td>
                    <td><strong>{item.amount}</strong></td>
                    <td className="mono">
                      {item.isMatched && item.houseNumber ? (
                        <div>
                          <strong style={{ display: 'block', color: '#0F172A', fontSize: '0.85rem' }}>
                            Zona {item.zone} · Casa {item.houseNumber}
                          </strong>
                          <small style={{ color: '#64748B' }}>{item.allocation}</small>
                        </div>
                      ) : (
                        item.allocation
                      )}
                    </td>
                    <td><StatusBadge tone={item.tone}>{item.status}</StatusBadge></td>
                    <td>
                      <div className="row-actions">
                        {item.importedRecord && role === 'admin' && item.importedRecord.status === 'unmatched' && (
                          <button className="secondary-button compact" type="button" onClick={() => onAction('paymentMatch', item.importedRecord)}>Asignar hogar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <footer><span>Mostrando {visibleTransactions.length} de {reportCount} movimientos</span>{paymentSearch && <button className="link-button" type="button" onClick={() => setPaymentSearch('')}>Limpiar búsqueda</button>}</footer>
          </section>

          <section className="courtesy-strip">
            <div><span>C</span><p><strong>Bolsas de cortesía</strong><small>Requieren motivo, aprobación administrativa y auditoría.</small></p></div>
            <button className="secondary-button" type="button" disabled={!can(role, 'courtesy.manage')} onClick={() => onAction('courtesy')}>{can(role, 'courtesy.manage') ? 'Gestionar cortesías' : 'Solo administrador'}</button>
          </section>
        </>
      ))}

      {selectedPayment && (
        <PaymentVerificationModal
          payment={selectedPayment}
          role={role}
          onClose={() => setSelectedPayment(null)}
          onApprove={(pay) => {
            pay.status = 'Aprobado';
            pay.tone = 'success';
            setSelectedPayment(null);
          }}
          onReject={(pay) => {
            pay.status = 'Rechazado';
            pay.tone = 'danger';
            setSelectedPayment(null);
          }}
        />
      )}
    </div>
  );
}
