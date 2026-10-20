import { useEffect, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { Field, Modal, Segmented, StatusBadge } from './UI.jsx';
import LocationPickerMap from './LocationPickerMap.jsx';
import { analyzeReceiptImage, fileToBase64 } from '../lib/openrouter.js';
import { OFFICIAL_PAYMENT_ACCOUNT, copyToClipboard } from '../lib/paymentAccount.js';
import { useAuth } from '../state/AuthContext.jsx';
import {
  analyzePaymentProof,
  answerGasSurvey,
  createCourtesyAllocation,
  createIncident,
  createPickupAuthorization,
  createResident,
  createResidentChangeRequest,
  createToyCampaign,
  deactivateResident,
  getActiveCycle,
  lookupHistoricalCensus,
  matchImportedPayment,
  newRequestKey,
  reportDelivery,
  reportPayment,
  runCneBulkLookup,
  syncChildrenCensus,
  updateCommunityReportStatus,
  updateResident,
} from '../lib/repository.js';
import { formatPersonName } from '../lib/formatters.js';
import pb, { API_BASE } from '../lib/pocketbase.js';

const titles = {
  payment: ['Reportar un pago', 'El validador automático se conectará después. Por ahora el reporte queda “en revisión”.'],
  delivery: ['Reportar la entrega', 'Tu confirmación complementa el registro oficial del operador.'],
  pickup: ['Autorizar retiro solidario', 'La persona autorizada podrá retirar hasta 17 bolsas en una misma entrega.'],
  incident: ['Nuevo reporte comunitario', 'Describe una avería de agua, luz, gas u otra situación de la zona.'],
  safety: ['Canal protegido', 'Este reporte será privado y solo podrá verlo personal expresamente autorizado.'],
  gas: ['Encuesta de gas', 'Registra intención y volumen. Esto no constituye un pago.'],
  resident: ['Agregar persona al censo', 'La fecha de nacimiento permite calcular segmentos sin guardar edades desactualizadas.'],
  addFamilyMember: ['Agregar integrante a mi hogar', 'La persona quedará vinculada a tu hogar. La junta revisará el nuevo registro.'],
  residentUpdate: ['Actualizar datos del habitante', 'Edita los datos del integrante en el censo comunitario.'],
  residentDeactivate: ['Dar de baja del censo', 'El registro se conserva para auditoría, pero deja de contar como residente activo.'],
  cne: ['Consulta del registro electoral', 'La consulta requiere consentimiento y conserva la fuente y la fecha del resultado.'],
  cneBulk: ['Actualizar centros electorales', 'Procesa registros del censo sin centro electoral y resume resultados por centro de votación.'],
  syncChildren: ['Sincronizar Niños al Censo', 'Carga los 108 niños del censo con sus fechas de nacimiento y segmentos de edad.'],
  courtesy: ['Bolsa de cortesía', 'Solo el administrador puede aprobarla y debe indicar un motivo.'],
  toy: ['Nueva campaña de juguetes', 'Define un corte de edad transparente; la asignación individual se revisa antes de entregar.'],
  reportReview: ['Revisar reporte', 'Marca el caso como revisado y deja una nota para el historial.'],
  reportResolve: ['Resolver reporte', 'Registra qué se hizo antes de cerrar el caso.'],
  paymentMatch: ['Conciliar pago importado', 'Asigna el movimiento al hogar correcto después de comprobar el censo.'],
};

const initial = {
  payment: { amount: '', currency: 'VES', method: 'Pago móvil', reference: '', receipt: null, aiLoading: false, receiptUrl: '', proofToken: null, extractedAmountBs: null, extractedRef: null },
  delivery: { delivered: 'yes', notes: '' },
  pickup: { collectorIdNumber: '', bags: 1, note: '' },
  incident: { category: 'Agua', title: '', description: '', zone: '', privacy: 'community', urgent: false, lat: null, lng: null, useGps: false },
  safety: { category: 'Violencia intrafamiliar', title: 'Solicitud de atención privada', description: '', zone: '', privacy: 'private', urgent: true },
  gas: { provider: 'Gas Comunal / PDVSA', wantsRefill: 'yes', cylinders: 1, size: '10 kg', notes: '' },
  resident: { householdCode: '', firstName: '', lastName: '', idNumber: '', nationality: 'V', birthDate: '', sex: '', phone: '', relationship: '', gasProvider: '', housingTenure: 'propia', votingCenterName: '', communityTrade: '', rifNumber: '', conditionAffection: 'ninguna', chronicDiseases: '', notes: '' },
  addFamilyMember: { firstName: '', lastName: '', idNumber: '', nationality: 'V', birthDate: '', sex: '', phone: '', relationship: '', gasProvider: '', housingTenure: 'propia', votingCenterName: '', communityTrade: '', rifNumber: '', conditionAffection: 'ninguna', chronicDiseases: '', notes: '' },
  residentUpdate: { firstName: '', lastName: '', idNumber: '', nationality: 'V', birthDate: '', sex: '', phone: '', relationship: '', gasProvider: '', gasCylindersCount: '1', housingTenure: 'propia', votingCenterName: '', communityTrade: '', rifNumber: '', conditionAffection: 'ninguna', chronicDiseases: '', notes: '', field: 'Teléfono', requestedValue: '' },
  residentDeactivate: { reason: '' },
  cne: { idNumber: '', consent: false },
  cneBulk: { limit: 20, confirmCommunityConsent: false },
  courtesy: { householdCode: '', quantity: 1, reason: '', notes: '' },
  toy: { name: 'Jornada de juguetes', cutoffDate: '', minAge: 0, maxAge: 12, notes: '' },
  reportReview: { message: '' },
  reportResolve: { message: '' },
  paymentMatch: { householdCode: '', notes: '' },
};

function parseMoney(value) {
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    throw new Error('Escribe un monto positivo válido.');
  }
  return Math.round(amount * 100) / 100;
}

function normalizeBirthDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmyMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }
  const ymdMatch = raw.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return raw;
}

export default function ActionModal({ type, payload, onClose, onToast }) {
  const isOnline = useOnlineStatus();
  const { membership, user, isDemo, community, role } = useAuth();
  const [form, setForm] = useState(initial[type] || {});
  const [state, setState] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [requestKey, setRequestKey] = useState(() => newRequestKey());

  useEffect(() => {
    let payloadForm = {};
    if (type === 'residentUpdate' && payload) {
      const nameParts = String(payload.name || `${payload.firstName || ''} ${payload.lastName || ''}`).trim().split(/\s+/);
      const firstName = payload.firstName || nameParts[0] || '';
      const lastName = payload.lastName || nameParts.slice(1).join(' ') || '';
      const rawId = String(payload.idNumber || '').trim();
      const nationality = rawId.startsWith('E-') ? 'E' : (rawId.startsWith('V-') ? 'V' : (payload.nationality || 'V'));
      const idNumber = rawId.replace(/^[VE]-?/, '');

      let rawBirthDate = String(payload.birthDate || '').split('T')[0].split(' ')[0].trim();
      if (rawBirthDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawBirthDate)) {
        rawBirthDate = normalizeBirthDateInput(rawBirthDate);
      }
      if (rawBirthDate === 'null' || rawBirthDate === 'undefined') {
        rawBirthDate = '';
      }

      let rawGas = String(payload.gasProvider || payload.gas || '').trim();
      if (rawGas === 'Sin definir') rawGas = '';
      if (/comunal|pdvsa/i.test(rawGas)) rawGas = 'Gas Comunal / PDVSA';
      else if (/caracas/i.test(rawGas)) rawGas = 'Gas Caracas';
      else if (/otro/i.test(rawGas)) rawGas = 'Otro';
      else if (/sin servicio/i.test(rawGas)) rawGas = 'Sin servicio';

      payloadForm = {
        firstName,
        lastName,
        nationality,
        idNumber: idNumber === 'Sin cedula' ? '' : idNumber,
        birthDate: rawBirthDate,
        sex: payload.sex || '',
        phone: payload.phone || '',
        relationship: payload.relationship === 'Integrante' ? '' : (payload.relationship || ''),
        gasProvider: rawGas,
        gasCylindersCount: payload.cylinders || payload.rawRecord?.gasCylindersCount || payload.rawRecord?.sourceValues?.rawInput?.gasCylindersCount || '1',
        housingTenure: payload.housingTenure || payload.rawRecord?.housingTenure || payload.rawRecord?.sourceValues?.rawInput?.housingTenure || payload.rawRecord?.sourceValues?.housingTenure || 'propia',
        votingCenterName: payload.center || payload.rawRecord?.votingCenterName || payload.rawRecord?.sourceValues?.votingCenterName || payload.rawRecord?.sourceValues?.rawInput?.votingCenterName || '',
        communityTrade: payload.communityTrade || payload.trade || payload.rawRecord?.communityTrade || payload.rawRecord?.sourceValues?.communityTrade || '',
        rifNumber: payload.rifNumber || payload.rawRecord?.rifNumber || payload.rawRecord?.sourceValues?.rifNumber || '',
        conditionAffection: payload.conditionAffection || payload.rawRecord?.conditionAffection || payload.rawRecord?.sourceValues?.conditionAffection || 'ninguna',
        chronicDiseases: payload.chronicDiseases || payload.rawRecord?.chronicDiseases || payload.rawRecord?.sourceValues?.chronicDiseases || '',
        notes: payload.notes || payload.rawRecord?.notes || '',
        field: 'Teléfono',
        requestedValue: '',
      };
    }
    setForm({
      ...(initial[type] || {}),
      ...payloadForm,
      ...(['incident', 'safety'].includes(type) && payload?.category ? { category: payload.category } : {}),
    });
    setState('idle');
    setResult(null);
    setError('');
    setRequestKey(newRequestKey());
  }, [type, payload]);

  const meta = titles[type] || ['', ''];
  const [modalLookupLoading, setModalLookupLoading] = useState(false);
  const [modalLookupFeedback, setModalLookupFeedback] = useState(null);

  const set = (key, value) => {
    if (key === 'idNumber' && modalLookupFeedback) {
      setModalLookupFeedback(null);
    }
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleModalLookup = async () => {
    const rawId = String(form.idNumber || '').replace(/\D/g, '');
    if (!rawId || rawId.length < 4) {
      setModalLookupFeedback({ error: 'Ingresa al menos 4 dígitos de cédula.' });
      return;
    }
    setModalLookupLoading(true);
    setModalLookupFeedback(null);
    try {
      const res = await lookupHistoricalCensus({
        idNumber: rawId,
        nationality: form.nationality || 'V',
        communityCode: membership?.community || 'URP-001',
      });
      if (res.found && res.data) {
        const d = res.data;
        setForm((prev) => ({
          ...prev,
          firstName: formatPersonName(d.firstName) || prev.firstName,
          lastName: formatPersonName(d.lastName) || prev.lastName,
          birthDate: d.birthDate || prev.birthDate,
          sex: d.sex || prev.sex,
          phone: d.phone || prev.phone,
          ...(d.gasProvider && !prev.gasProvider ? { gasProvider: d.gasProvider } : {}),
          ...(d.housingTenure && !prev.housingTenure ? { housingTenure: d.housingTenure } : {}),
          ...(d.votingCenterName && !prev.votingCenterName ? { votingCenterName: d.votingCenterName } : {}),
        }));
        setModalLookupFeedback({ success: `Datos cargados: ${d.firstName} ${d.lastName}` });
      } else {
        setModalLookupFeedback({ notFound: 'Cédula no encontrada en el histórico.' });
      }
    } catch (err) {
      setModalLookupFeedback({ error: 'No se pudo consultar el censo previo.' });
    } finally {
      setModalLookupLoading(false);
    }
  };

  const successful = (title, message) => {
    window.dispatchEvent(new CustomEvent('maotsetung:data-changed'));
    window.dispatchEvent(new CustomEvent('uroprofin:data-changed'));
    onToast({ title, message, tone: 'success' });
    onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!isOnline && !isDemo) {
      setError('Estás sin conexión a internet. Conéctate a una red para enviar la información.');
      return;
    }
    setError('');
    setState('sending');
    try {
      if (type === 'cne') {
        if (!form.consent) throw new Error('Confirma el consentimiento antes de consultar.');
        if (isDemo) {
          setResult({ status: 'verified', registered: true, center: 'Centro de votación de demostración', address: 'Dirección electoral protegida', source: 'demo' });
          setState('done');
          return;
        }
        if (!membership) throw new Error('Tu cuenta todavía no está vinculada con un consejo.');
        const response = await fetch(`${API_BASE}/api/cne/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pb.authStore.token}` }, body: JSON.stringify({ idNumber: form.idNumber, consent: true, communityId: membership.community }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No fue posible completar la consulta.');
        setResult(data);
        window.dispatchEvent(new CustomEvent('maotsetung:data-changed'));
        window.dispatchEvent(new CustomEvent('uroprofin:data-changed'));
        setState('done');
        return;
      }

      if (type === 'cneBulk') {
        if (role !== 'admin') throw new Error('Solo un administrador puede ejecutar consultas por lote.');
        if (!form.confirmCommunityConsent) throw new Error('Confirma la autorizacion comunitaria antes de consultar.');
        if (isDemo) {
          setResult({ scanned: 0, alreadyProfiled: 0, withoutBirthDate: 0, knownMinors: 0, candidates: 0, checked: 0, failed: 0, centerStats: {}, rows: [] });
          setState('done');
          return;
        }
        if (!membership) throw new Error('Tu cuenta todavía no está vinculada con un consejo.');
        const data = await runCneBulkLookup({ membership, limit: form.limit, confirmCommunityConsent: true });
        setResult(data);
        window.dispatchEvent(new CustomEvent('maotsetung:data-changed'));
        window.dispatchEvent(new CustomEvent('uroprofin:data-changed'));
        setState('done');
        return;
      }

      if (!isDemo) {
        if (!membership) throw new Error('Tu cuenta todavía no está vinculada con un consejo.');
        if (['payment', 'delivery', 'pickup', 'gas'].includes(type) && !membership.household) {
          throw new Error('Esta acción requiere que la cuenta tenga un hogar vinculado.');
        }
        const cycle = ['payment', 'delivery', 'pickup', 'courtesy'].includes(type)
          ? await getActiveCycle(membership.community)
          : null;
        if (type === 'payment') {
          if (form.receipt && form.receipt.size > 8 * 1024 * 1024) throw new Error('El comprobante no puede superar 8 MB.');
          const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf'];
          if (form.receipt && !allowedTypes.includes(form.receipt.type)) throw new Error('El comprobante debe ser PNG, JPG o PDF.');
          await reportPayment({ membership, cycle, ...form, amount: parseMoney(form.amount), proofToken: form.proofToken, expectedBsAmount: form.amount, requestKey });
        } else if (type === 'delivery') {
          await reportDelivery({ membership, cycle, delivered: form.delivered === 'yes', notes: form.notes, requestKey });
        } else if (type === 'pickup') {
          await createPickupAuthorization({ membership, cycle, ...form, requestKey });
        } else if (type === 'incident' || type === 'safety') {
          await createIncident({ membership, ...form });
        } else if (type === 'gas') {
          await answerGasSurvey({ membership, ...form, wantsRefill: form.wantsRefill === 'yes', requestKey });
        } else if (type === 'resident') {
          await createResident({
            community: membership.community,
            householdCode: form.householdCode,
            createdBy: user.id,
            firstName: form.firstName.trim(), lastName: form.lastName.trim(), idNumber: form.idNumber.trim(),
            nationality: form.nationality, birthDate: form.birthDate || null, sex: form.sex,
            phone: form.phone.trim(), relationship: form.relationship, gasProvider: form.gasProvider,
            housingTenure: form.housingTenure || 'propia',
            votingCenterName: (form.votingCenterName || '').trim(),
            communityTrade: (form.communityTrade || '').trim(),
            rifNumber: (form.rifNumber || '').trim().toUpperCase(),
            conditionAffection: form.conditionAffection || 'ninguna',
            chronicDiseases: (form.chronicDiseases || '').trim(),
            notes: form.notes.trim(), status: 'active',
          });
        } else if (type === 'addFamilyMember') {
          const householdCode = membership?.expand?.household?.code;
          if (!householdCode) throw new Error('Tu cuenta no tiene un hogar vinculado. Contacta al administrador.');
          await createResident({
            community: membership.community,
            householdCode,
            createdBy: user.id,
            firstName: form.firstName.trim(), lastName: form.lastName.trim(), idNumber: form.idNumber.trim(),
            nationality: form.nationality, birthDate: form.birthDate || null, sex: form.sex,
            phone: form.phone.trim(), relationship: form.relationship, gasProvider: form.gasProvider,
            housingTenure: form.housingTenure || 'propia',
            votingCenterName: (form.votingCenterName || '').trim(),
            communityTrade: (form.communityTrade || '').trim(),
            rifNumber: (form.rifNumber || '').trim().toUpperCase(),
            conditionAffection: form.conditionAffection || 'ninguna',
            chronicDiseases: (form.chronicDiseases || '').trim(),
            notes: form.notes.trim(), status: 'active',
          });
        } else if (type === 'residentUpdate') {
          if (!payload?.id) throw new Error('No se identificó el registro a actualizar.');
          const updateData = {
            firstName: (form.firstName || '').trim(),
            lastName: (form.lastName || '').trim(),
            nationality: form.nationality || 'V',
            idNumber: (form.idNumber || '').trim(),
            birthDate: form.birthDate ? form.birthDate.split('T')[0].split(' ')[0] : null,
            sex: form.sex || '',
            relationship: form.relationship || '',
            phone: (form.phone || '').trim(),
            gasProvider: form.gasProvider || '',
            gasCylindersCount: form.gasCylindersCount || '1',
            housingTenure: form.housingTenure || 'propia',
            votingCenterName: (form.votingCenterName || '').trim(),
            communityTrade: (form.communityTrade || '').trim(),
            rifNumber: (form.rifNumber || '').trim().toUpperCase(),
            conditionAffection: form.conditionAffection || 'ninguna',
            chronicDiseases: (form.chronicDiseases || '').trim(),
            notes: (form.notes || '').trim(),
          };
          try {
            await updateResident(payload.id, updateData);
          } catch (err) {
            console.warn('Actualización directa no permitida, enviando solicitud de cambio:', err);
            await createResidentChangeRequest({
              membership,
              residentId: payload.id,
              requestedBy: user.id,
              field: 'Actualización general',
              currentValue: payload.name || '',
              requestedValue: JSON.stringify(updateData),
              notes: (form.notes || '').trim() || 'Modificación enviada desde la app',
            });
          }
        } else if (type === 'residentDeactivate') {
          const isFromOwnHousehold = payload?.rawRecord?.household === membership?.household;
          if (role !== 'admin' && !isFromOwnHousehold) throw new Error('Solo un administrador o el jefe de hogar puede dar de baja registros.');
          await deactivateResident({ id: payload?.id || payload?.rawRecord?.id, updatedBy: user.id, reason: form.reason });
        } else if (type === 'syncChildren') {
          if (role !== 'admin') throw new Error('Solo un administrador puede sincronizar los niños.');
          const res = await syncChildrenCensus(membership);
          setResult({ type: 'syncChildren', createdCount: res.createdCount || 0, message: res.message || 'Niños sincronizados exitosamente.' });
          setState('done');
          return;
        } else if (type === 'courtesy') {
          if (role !== 'admin') throw new Error('Solo un administrador puede aprobar bolsas de cortesía.');
          await createCourtesyAllocation({ membership, cycle, ...form });
        } else if (type === 'toy') {
          if (!['admin', 'collaborator'].includes(role)) throw new Error('Solo el equipo de gestión puede crear campañas.');
          if (!form.cutoffDate) throw new Error('Indica la fecha de corte de la campaña.');
          if (Number(form.minAge) > Number(form.maxAge)) throw new Error('La edad mínima no puede superar la máxima.');
          await createToyCampaign({ membership, ...form });
        } else if (type === 'reportReview' || type === 'reportResolve') {
          await updateCommunityReportStatus({
            membership,
            report: payload,
            status: type === 'reportReview' ? 'triage' : 'resolved',
            message: form.message,
          });
        } else if (type === 'paymentMatch') {
          await matchImportedPayment({ membership, payment: payload, ...form });
        } else {
          throw new Error('Esta acción todavía no está implementada.');
        }
      }

      const messages = {
        payment: ['Pago reportado', 'Quedó pendiente de validación; no lo envíes de nuevo.'],
        delivery: ['Estado recibido', 'La junta podrá comparar tu reporte con la entrega oficial.'],
        pickup: ['Autorización creada', 'Se comprobará nuevamente al momento de retirar.'],
        incident: ['Reporte registrado', 'Ya aparece en la cola de seguimiento.'],
        safety: ['Reporte privado recibido', 'Solo el equipo autorizado podrá abrirlo.'],
        gas: ['Respuesta guardada', 'La encuesta no registra ni cobra dinero.'],
        resident: ['Persona agregada', 'El nuevo registro quedó trazado en el censo.'],
        addFamilyMember: ['Integrante agregado', 'El nuevo miembro de tu hogar quedó registrado en el censo.'],
        residentUpdate: ['Datos actualizados', 'La información del habitante quedó guardada en el censo.'],
        residentDeactivate: ['Registro dado de baja', 'Se conserva la trazabilidad y dejó de contar como activo.'],
        courtesy: ['Cortesía registrada', 'Quedó asociada al motivo y al administrador aprobador.'],
        toy: ['Campaña creada', 'Quedó en planificación para revisar población y asignaciones.'],
        reportReview: ['Reporte en revisión', 'El cambio quedó registrado en el historial.'],
        reportResolve: ['Reporte resuelto', 'La resolución quedó registrada en el historial.'],
        paymentMatch: ['Pago conciliado', 'El movimiento quedó asociado al hogar indicado.'],
      };
      successful(...(messages[type] || ['Guardado', 'La información se registró correctamente.']));
    } catch (e) {
      setError(e?.message || 'No fue posible guardar. Revisa los datos e intenta de nuevo.');
      setState('error');
    }
  };

  if (!type) return null;
  return (
    <Modal open title={meta[0]} description={meta[1]} onClose={onClose} size={['resident', 'incident', 'safety'].includes(type) ? 'large' : 'medium'}>
      <form className="action-form" onSubmit={submit}>
        {type === 'payment' && <>
          <div className="official-account-card">
            <div className="oac-title">
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--primary)' }}>account_balance_wallet</span>
              <strong>Datos de Pago Móvil Oficial (Copia Rápida)</strong>
            </div>
            <div className="oac-grid">
              <div className="oac-row">
                <div><span>Banco:</span> <strong>BDV Banco de Venezuela (0102)</strong></div>
                <button
                  type="button"
                  className="copy-chip"
                  onClick={async () => {
                    const ok = await copyToClipboard(OFFICIAL_PAYMENT_ACCOUNT.bankCode);
                    if (ok) { set('copiedTag', 'bank'); setTimeout(() => set('copiedTag', null), 2000); }
                  }}
                >
                  {form.copiedTag === 'bank' ? '✓ Copiado' : 'Copiar Banco'}
                </button>
              </div>
              <div className="oac-row">
                <div><span>Teléfono:</span> <strong className="mono">04125656452</strong></div>
                <button
                  type="button"
                  className="copy-chip"
                  onClick={async () => {
                    const ok = await copyToClipboard(OFFICIAL_PAYMENT_ACCOUNT.phone);
                    if (ok) { set('copiedTag', 'phone'); setTimeout(() => set('copiedTag', null), 2000); }
                  }}
                >
                  {form.copiedTag === 'phone' ? '✓ Copiado' : 'Copiar Teléfono'}
                </button>
              </div>
              <div className="oac-row">
                <div><span>Cédula / RIF:</span> <strong className="mono">V-6218460</strong></div>
                <button
                  type="button"
                  className="copy-chip"
                  onClick={async () => {
                    const ok = await copyToClipboard(OFFICIAL_PAYMENT_ACCOUNT.idNumber);
                    if (ok) { set('copiedTag', 'id'); setTimeout(() => set('copiedTag', null), 2000); }
                  }}
                >
                  {form.copiedTag === 'id' ? '✓ Copiado' : 'Copiar Cédula'}
                </button>
              </div>
            </div>
          </div>

          <div className="form-grid two"><Field label="Monto" required><input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="800,00" required /></Field><Field label="Moneda" required><select value={form.currency} onChange={(e) => set('currency', e.target.value)}><option value="VES">Bolívares</option><option value="USD">USD</option></select></Field></div>
          <Field label="Método" required><select value={form.method} onChange={(e) => set('method', e.target.value)}><option>Pago móvil</option><option>Transferencia</option><option>Efectivo</option><option>Otro</option></select></Field>
          <Field label="Referencia" hint="Escribe los últimos dígitos o la referencia completa." required><input value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Referencia bancaria" required /></Field>
          <Field label="Comprobante con IA" hint="Sube la captura de tu Pago Móvil para auto-verificar los datos.">
            <input
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                set('receipt', file);
                set('aiLoading', true);
                try {
                  const res = await analyzePaymentProof({ file, expectedBsAmount: form.amount, membership });
                  set('receiptUrl', res.receiptUrl);
                  set('proofToken', res.proofToken);
                  set('extractedAmountBs', res.extraction?.amountBs);
                  set('extractedRef', res.extraction?.referenceNumber);

                  if (res.extraction?.referenceNumber) {
                    set('reference', res.extraction.referenceNumber);
                  }
                  if (res.extraction?.amountBs) {
                    set('amount', String(res.extraction.amountBs));
                  }
                } catch (err) {
                  console.error('Error procesando comprobante:', err);
                } finally {
                  set('aiLoading', false);
                }
              }}
            />
          </Field>
          {form.aiLoading && (
            <div className="info-box" style={{ background: 'rgba(59, 130, 246, 0.1)', borderColor: 'var(--primary)' }}>
              <span className="material-symbols-outlined spin" style={{ fontSize: '16px' }}>auto_awesome</span>
              <p><strong>Gemini AI (OpenRouter)</strong> está leyendo los datos de tu comprobante de Pago Móvil…</p>
            </div>
          )}
          {form.proofToken && !form.aiLoading && (
            <div className="info-box" style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'var(--success)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--success)' }}>
                task_alt
              </span>
              <div>
                <p><strong>Comprobante escaneado por IA</strong></p>
                <small>Ref: <code>{form.extractedRef || form.reference || 'N/A'}</code> {form.extractedAmountBs ? `· Monto leído: Bs ${Number(form.extractedAmountBs).toLocaleString('es-VE')}` : ''}</small>
              </div>
            </div>
          )}
          {form.extractedAmountBs != null && form.amount && Math.abs(Math.round(Number(form.amount)) - Math.round(Number(form.extractedAmountBs))) > 1 && (
            <div className="info-box" style={{ background: 'rgba(245, 158, 11, 0.1)', borderColor: 'var(--gold)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--gold)' }}>warning</span>
              <p><strong>Diferencia de monto detectada</strong></p>
              <small>El monto en el comprobante ({Math.round(form.extractedAmountBs)} Bs) no coincide exactamente con lo ingresado ({Math.round(form.amount)} Bs).</small>
            </div>
          )}
          <div className="info-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>info</span><p>El sistema detectará pagos duplicados por referencia. Los montos agrupados se distribuyen entre hogares sin alterar la transacción original.</p></div>
        </>}

        {type === 'delivery' && <>
          <Field group label="¿Recibiste tu bolsa?" required><Segmented value={form.delivered} onChange={(value) => set('delivered', value)} label="Estado de entrega" options={[{ value: 'yes', label: 'Sí, entregada' }, { value: 'no', label: 'No la recibí' }]} /></Field>
          <Field label="Observación" hint="No incluyas datos sensibles de otras personas."><textarea rows="4" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Cuéntanos qué ocurrió…" /></Field>
        </>}

        {type === 'pickup' && <>
          <Field label="Cédula de quien retira" hint="La identidad se valida el día de la entrega." required><input value={form.collectorIdNumber} onChange={(e) => set('collectorIdNumber', e.target.value)} placeholder="V-12.345.678" required /></Field>
          <Field label="Cantidad de bolsas" hint="Máximo 17 por persona y entrega." required><input type="number" min="1" max="17" value={form.bags} onChange={(e) => set('bags', Math.min(17, Number(e.target.value)))} required /></Field>
          <Field label="Nota opcional"><textarea rows="3" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Relación o instrucción para la entrega" /></Field>
        </>}

        {(type === 'incident' || type === 'safety') && <>
          {type === 'incident' && <div className="form-grid two"><Field label="Categoría" required><select value={form.category} onChange={(e) => set('category', e.target.value)}><option>Agua</option><option>Luz</option><option>Gas</option><option>Seguridad</option><option>Convivencia</option><option>Otro</option></select></Field><Field label="Visibilidad"><select value={form.privacy} onChange={(e) => set('privacy', e.target.value)}><option value="community">Comunitaria (agregada)</option><option value="private">Privada</option></select></Field></div>}
          <Field label="Título" required><input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Resumen breve" required /></Field>
          <Field label="Descripción" required><textarea rows="5" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={type === 'safety' ? 'Describe lo necesario para evaluar una atención segura…' : 'Qué ocurre, desde cuándo y a cuántos hogares afecta…'} required /></Field>
          <Field label="Zona" hint="Indica el sector o calle; evita una dirección exacta en reportes comunitarios."><input value={form.zone} onChange={(e) => set('zone', e.target.value)} placeholder="Sector o calle" /></Field>
          <label className="check-row"><input type="checkbox" checked={form.urgent} onChange={(e) => set('urgent', e.target.checked)} /><span><strong>Requiere atención urgente</strong><small>Activa prioridad alta; no sustituye servicios de emergencia.</small></span></label>
          {type === 'incident' && (
            <div className="location-picker-wrapper">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={Boolean(form.useGps)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    set('useGps', checked);
                    if (!checked) {
                      set('lat', null);
                      set('lng', null);
                    } else if (!form.lat || !form.lng) {
                      set('lat', 10.4589);
                      set('lng', -66.7975);
                    }
                  }}
                />
                <span>
                  <strong>Ubicación pública en el mapa (opcional)</strong>
                  <small>Permite colocar o ajustar un pin tocando en el mapa o usando el GPS.</small>
                </span>
              </label>
              {form.useGps && (
                <LocationPickerMap
                  lat={form.lat}
                  lng={form.lng}
                  onSelectLocation={(lat, lng) => {
                    set('lat', lat);
                    set('lng', lng);
                  }}
                />
              )}
            </div>
          )}
          {type === 'safety' && <div className="warning-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>warning</span><p><strong>Este canal no es visible para vecinos.</strong> Si hay peligro inmediato, busca un lugar seguro y contacta a emergencias o a una persona de confianza.</p></div>}
        </>}

        {type === 'gas' && <>
          <Field label="Servicio que utiliza" required><select value={form.provider} onChange={(e) => set('provider', e.target.value)}><option>Gas Comunal / PDVSA</option><option>Gas Caracas</option><option>Otro proveedor</option><option>No tiene servicio</option></select></Field>
          <Field group label="¿Pagaría una recarga en la próxima jornada?" required><Segmented value={form.wantsRefill} onChange={(value) => set('wantsRefill', value)} label="Intención de recarga" options={[{ value: 'yes', label: 'Sí' }, { value: 'no', label: 'No por ahora' }]} /></Field>
          <div className="form-grid two"><Field label="Bombonas"><input type="number" min="0" max="10" value={form.cylinders} onChange={(e) => set('cylinders', e.target.value)} /></Field><Field label="Tamaño"><select value={form.size} onChange={(e) => set('size', e.target.value)}><option>10 kg</option><option>18 kg</option><option>27 kg</option><option>43 kg</option><option>No sabe</option></select></Field></div>
          <Field label="Observación"><textarea rows="3" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ej. necesita apoyo para trasladar la bombona" /></Field>
        </>}

        {type === 'resident' && <>
          <Field label="Código de hogar" hint="La persona se asociará a este hogar dentro del consejo." required><input value={form.householdCode} onChange={(e) => set('householdCode', e.target.value)} placeholder="URP-A-014" required /></Field>
          <div className="form-grid two">
            <Field label="Nombres" required>
              <input value={form.firstName} onChange={(e) => set('firstName', formatPersonName(e.target.value))} style={{ textTransform: 'capitalize' }} required />
            </Field>
            <Field label="Apellidos" required>
              <input value={form.lastName} onChange={(e) => set('lastName', formatPersonName(e.target.value))} style={{ textTransform: 'capitalize' }} required />
            </Field>
          </div>
          <div className="form-grid three">
            <Field label="Nacionalidad">
              <select value={form.nationality} onChange={(e) => set('nationality', e.target.value)}>
                <option value="V">V</option>
                <option value="E">E</option>
                <option value="">Sin cédula</option>
              </select>
            </Field>
            <Field label="Cédula">
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', width: '100%' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.idNumber}
                  onChange={(e) => set('idNumber', e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleModalLookup();
                    }
                  }}
                  placeholder="12345678"
                  style={{ flex: 1, minWidth: 0, height: '42px' }}
                />
                <button
                  type="button"
                  className="btn secondary"
                  onClick={handleModalLookup}
                  disabled={modalLookupLoading || !form.idNumber}
                  title="Buscar en base de datos del censo histórico"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    padding: '0 0.85rem',
                    height: '42px',
                    flexShrink: 0,
                    borderRadius: '0.5rem',
                    border: '1px solid #0284C7',
                    background: '#0284C7',
                    color: '#FFFFFF',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: modalLookupLoading ? 'wait' : 'pointer',
                    opacity: (!form.idNumber || modalLookupLoading) ? 0.65 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {modalLookupLoading ? (
                    <span className="material-symbols-outlined rotating" style={{ fontSize: '18px' }}>progress_activity</span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  )}
                  <span>{modalLookupLoading ? 'Buscando...' : 'Buscar'}</span>
                </button>
              </div>
              {modalLookupFeedback?.success && (
                <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.success}
                </div>
              )}
              {modalLookupFeedback?.notFound && (
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.notFound}
                </div>
              )}
              {modalLookupFeedback?.error && (
                <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.error}
                </div>
              )}
            </Field>
            <Field label="Fecha de nacimiento"><input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>
          </div>
          <div className="form-grid three"><Field label="Sexo"><select value={form.sex} onChange={(e) => set('sex', e.target.value)}><option value="">Sin indicar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro / reservado</option></select></Field><Field label="Parentesco"><input value={form.relationship} onChange={(e) => set('relationship', e.target.value)} placeholder="Jefa, hijo, madre…" /></Field><Field label="Teléfono"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field></div>
          <div className="form-grid two">
            <Field label="Servicio de gas"><select value={form.gasProvider} onChange={(e) => set('gasProvider', e.target.value)}><option value="">Sin definir</option><option value="Gas Comunal / PDVSA">Gas Comunal / PDVSA</option><option value="Gas Caracas">Gas Caracas</option><option value="Otro">Otro</option><option value="Sin servicio">Sin servicio</option></select></Field>
            <Field label="Condición de la vivienda"><select value={form.housingTenure} onChange={(e) => set('housingTenure', e.target.value)}><option value="propia">Propia</option><option value="alquilada">Alquilada</option><option value="familiar">Familiar / Prestada</option><option value="otra">Otra</option></select></Field>
          </div>
          <div className="form-grid two">
            <Field label="Centro de votación (CNE)"><input value={form.votingCenterName} onChange={(e) => set('votingCenterName', e.target.value)} placeholder="Ej: U.E. Mariano Picón Salas" /></Field>
            <Field label="Ocupación u Oficio"><input value={form.communityTrade} onChange={(e) => set('communityTrade', e.target.value)} placeholder="Ej: Comerciante, Docente, Técnico..." /></Field>
          </div>
          <div className="form-grid two">
            <Field label="RIF SENIAT (Opcional)"><input value={form.rifNumber} onChange={(e) => set('rifNumber', e.target.value.toUpperCase())} placeholder="V-12345678-0" style={{ textTransform: 'uppercase' }} /></Field>
            <Field label="Condición de salud">
              <select value={form.conditionAffection || 'ninguna'} onChange={(e) => set('conditionAffection', e.target.value)}>
                <option value="ninguna">Ninguna condición especial conocida</option>
                <option value="hipertension">Hipertensión arterial</option>
                <option value="diabetes">Diabetes</option>
                <option value="asma">Asma / Afección respiratoria</option>
                <option value="alergia">Alergias crónicas</option>
                <option value="discapacidad_motora">Discapacidad motora</option>
                <option value="discapacidad_visual">Discapacidad visual</option>
                <option value="discapacidad_auditiva">Discapacidad auditiva</option>
                <option value="neurodivergencia">Neurodivergencia / TEA</option>
                <option value="cronica">Enfermedad crónica / tratamiento continuo</option>
                <option value="encamado">Persona encamada / atención prioritaria</option>
                <option value="otra">Otra condición especial</option>
              </select>
            </Field>
          </div>
          <Field label="Diagnóstico específico / medicamentos habituales"><input value={form.chronicDiseases} onChange={(e) => set('chronicDiseases', e.target.value)} placeholder="Ej: Losartán 50mg, Insulina..." /></Field>
          <Field label="Notas"><textarea rows="3" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <div className="info-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>info</span><p>La edad, niñez, próximo votante y adulto mayor se calculan desde la fecha de nacimiento. Una fecha desconocida queda vacía, nunca como edad cero.</p></div>
        </>}

        {type === 'addFamilyMember' && <>
          <div className="info-box" style={{ background: 'rgba(79, 145, 173, 0.08)', borderColor: 'var(--blue)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--blue)' }}>home</span>
            <p>El integrante se registrará directamente en <strong>tu hogar ({membership?.expand?.household?.code || '...'})</strong>. La junta puede revisar el nuevo registro.</p>
          </div>
          <div className="form-grid two">
            <Field label="Nombres" required>
              <input value={form.firstName} onChange={(e) => set('firstName', formatPersonName(e.target.value))} placeholder="Ej: María" style={{ textTransform: 'capitalize' }} required />
            </Field>
            <Field label="Apellidos" required>
              <input value={form.lastName} onChange={(e) => set('lastName', formatPersonName(e.target.value))} placeholder="Ej: González" style={{ textTransform: 'capitalize' }} required />
            </Field>
          </div>
          <div className="form-grid three">
            <Field label="Nacionalidad">
              <select value={form.nationality} onChange={(e) => set('nationality', e.target.value)}>
                <option value="V">V</option>
                <option value="E">E</option>
                <option value="">Sin cédula</option>
              </select>
            </Field>
            <Field label="Cédula">
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', width: '100%' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.idNumber}
                  onChange={(e) => set('idNumber', e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleModalLookup();
                    }
                  }}
                  placeholder="12345678"
                  style={{ flex: 1, minWidth: 0, height: '42px' }}
                />
                <button
                  type="button"
                  className="btn secondary"
                  onClick={handleModalLookup}
                  disabled={modalLookupLoading || !form.idNumber}
                  title="Buscar en base de datos del censo histórico"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    padding: '0 0.85rem',
                    height: '42px',
                    flexShrink: 0,
                    borderRadius: '0.5rem',
                    border: '1px solid #0284C7',
                    background: '#0284C7',
                    color: '#FFFFFF',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: modalLookupLoading ? 'wait' : 'pointer',
                    opacity: (!form.idNumber || modalLookupLoading) ? 0.65 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {modalLookupLoading ? (
                    <span className="material-symbols-outlined rotating" style={{ fontSize: '18px' }}>progress_activity</span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  )}
                  <span>{modalLookupLoading ? 'Buscando...' : 'Buscar'}</span>
                </button>
              </div>
              {modalLookupFeedback?.success && (
                <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.success}
                </div>
              )}
              {modalLookupFeedback?.notFound && (
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.notFound}
                </div>
              )}
              {modalLookupFeedback?.error && (
                <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.error}
                </div>
              )}
            </Field>
            <Field label="Fecha de nacimiento"><input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>
          </div>
          <div className="form-grid three"><Field label="Sexo"><select value={form.sex} onChange={(e) => set('sex', e.target.value)}><option value="">Sin indicar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro / reservado</option></select></Field><Field label="Parentesco" hint="Relación con el titular del hogar"><input value={form.relationship} onChange={(e) => set('relationship', e.target.value)} placeholder="Hijo, madre, cónyuge…" /></Field><Field label="Teléfono"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="04XX-XXXXXXX" /></Field></div>
          <div className="form-grid two">
            <Field label="Servicio de gas"><select value={form.gasProvider} onChange={(e) => set('gasProvider', e.target.value)}><option value="">Sin definir</option><option value="Gas Comunal / PDVSA">Gas Comunal / PDVSA</option><option value="Gas Caracas">Gas Caracas</option><option value="Otro">Otro</option><option value="Sin servicio">Sin servicio</option></select></Field>
            <Field label="Condición de la vivienda"><select value={form.housingTenure} onChange={(e) => set('housingTenure', e.target.value)}><option value="propia">Propia</option><option value="alquilada">Alquilada</option><option value="familiar">Familiar / Prestada</option><option value="otra">Otra</option></select></Field>
          </div>
          <div className="form-grid two">
            <Field label="Centro de votación (CNE)"><input value={form.votingCenterName} onChange={(e) => set('votingCenterName', e.target.value)} placeholder="Ej: U.E. Mariano Picón Salas" /></Field>
            <Field label="Ocupación u Oficio"><input value={form.communityTrade} onChange={(e) => set('communityTrade', e.target.value)} placeholder="Ej: Estudiante, Docente, Técnico..." /></Field>
          </div>
          <div className="form-grid two">
            <Field label="RIF SENIAT (Opcional)"><input value={form.rifNumber} onChange={(e) => set('rifNumber', e.target.value.toUpperCase())} placeholder="V-12345678-0" style={{ textTransform: 'uppercase' }} /></Field>
            <Field label="Condición de salud">
              <select value={form.conditionAffection || 'ninguna'} onChange={(e) => set('conditionAffection', e.target.value)}>
                <option value="ninguna">Ninguna condición especial conocida</option>
                <option value="hipertension">Hipertensión arterial</option>
                <option value="diabetes">Diabetes</option>
                <option value="asma">Asma / Afección respiratoria</option>
                <option value="alergia">Alergias crónicas</option>
                <option value="discapacidad_motora">Discapacidad motora</option>
                <option value="discapacidad_visual">Discapacidad visual</option>
                <option value="discapacidad_auditiva">Discapacidad auditiva</option>
                <option value="neurodivergencia">Neurodivergencia / TEA</option>
                <option value="cronica">Enfermedad crónica / tratamiento continuo</option>
                <option value="encamado">Persona encamada / atención prioritaria</option>
                <option value="otra">Otra condición especial</option>
              </select>
            </Field>
          </div>
          <Field label="Diagnóstico específico / medicamentos habituales"><input value={form.chronicDiseases} onChange={(e) => set('chronicDiseases', e.target.value)} placeholder="Ej: Losartán 50mg, Insulina..." /></Field>
          <Field label="Observación"><textarea rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Información adicional relevante" /></Field>
          <div className="info-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>info</span><p>La edad y segmento se calculan automáticamente desde la fecha de nacimiento. Si no la conoces, déjala vacía.</p></div>
        </>}

        {type === 'residentUpdate' && <>
          <div className="form-grid two">
            <Field label="Nombres" required>
              <input value={form.firstName} onChange={(e) => set('firstName', formatPersonName(e.target.value))} placeholder="Ej: María" style={{ textTransform: 'capitalize' }} required />
            </Field>
            <Field label="Apellidos" required>
              <input value={form.lastName} onChange={(e) => set('lastName', formatPersonName(e.target.value))} placeholder="Ej: Pérez" style={{ textTransform: 'capitalize' }} required />
            </Field>
          </div>
          <div className="form-grid three">
            <Field label="Nacionalidad">
              <select value={form.nationality} onChange={(e) => set('nationality', e.target.value)}>
                <option value="V">V</option>
                <option value="E">E</option>
                <option value="">Sin cédula</option>
              </select>
            </Field>
            <Field label="Cédula">
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', width: '100%' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.idNumber}
                  onChange={(e) => set('idNumber', e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleModalLookup();
                    }
                  }}
                  placeholder="12345678"
                  style={{ flex: 1, minWidth: 0, height: '42px' }}
                />
                <button
                  type="button"
                  className="btn secondary"
                  onClick={handleModalLookup}
                  disabled={modalLookupLoading || !form.idNumber}
                  title="Buscar en base de datos del censo histórico"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    padding: '0 0.85rem',
                    height: '42px',
                    flexShrink: 0,
                    borderRadius: '0.5rem',
                    border: '1px solid #0284C7',
                    background: '#0284C7',
                    color: '#FFFFFF',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: modalLookupLoading ? 'wait' : 'pointer',
                    opacity: (!form.idNumber || modalLookupLoading) ? 0.65 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {modalLookupLoading ? (
                    <span className="material-symbols-outlined rotating" style={{ fontSize: '18px' }}>progress_activity</span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  )}
                  <span>{modalLookupLoading ? 'Buscando...' : 'Buscar'}</span>
                </button>
              </div>
              {modalLookupFeedback?.success && (
                <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.success}
                </div>
              )}
              {modalLookupFeedback?.notFound && (
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.notFound}
                </div>
              )}
              {modalLookupFeedback?.error && (
                <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>
                  {modalLookupFeedback.error}
                </div>
              )}
            </Field>
            <Field label="Fecha de nacimiento" hint="Formato AAAA-MM-DD"><input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>
          </div>
          <div className="form-grid three">
            <Field label="Sexo"><select value={form.sex} onChange={(e) => set('sex', e.target.value)}><option value="">Sin indicar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro / reservado</option></select></Field>
            <Field label="Parentesco"><input value={form.relationship} onChange={(e) => set('relationship', e.target.value)} placeholder="Jefe, hijo, madre…" /></Field>
            <Field label="Teléfono"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="04XX-XXXXXXX" /></Field>
          </div>
          <div className="form-grid two">
            <Field label="Servicio de gas"><select value={form.gasProvider} onChange={(e) => set('gasProvider', e.target.value)}><option value="">Sin definir</option><option value="Gas Comunal / PDVSA">Gas Comunal / PDVSA</option><option value="Gas Caracas">Gas Caracas</option><option value="Otro">Otro</option><option value="Sin servicio">Sin servicio</option></select></Field>
            <Field label="Bombonas de gas (Cilindros)"><input type="number" min="0" max="10" value={form.gasCylindersCount} onChange={(e) => set('gasCylindersCount', e.target.value)} placeholder="Ej: 1" /></Field>
          </div>
          <div className="form-grid two">
            <Field label="Condición de la vivienda"><select value={form.housingTenure} onChange={(e) => set('housingTenure', e.target.value)}><option value="propia">Propia</option><option value="alquilada">Alquilada</option><option value="familiar">Familiar / Prestada</option><option value="otra">Otra</option></select></Field>
            <Field label="Centro de votación (CNE)"><input value={form.votingCenterName} onChange={(e) => set('votingCenterName', e.target.value)} placeholder="Ej: U.E. Mariano Picón Salas" /></Field>
          </div>
          <div className="form-grid two">
            <Field label="Ocupación u Oficio"><input value={form.communityTrade} onChange={(e) => set('communityTrade', e.target.value)} placeholder="Ej: Educador, Comerciante, Técnico..." /></Field>
            <Field label="RIF SENIAT (Opcional)"><input value={form.rifNumber} onChange={(e) => set('rifNumber', e.target.value.toUpperCase())} placeholder="V-12345678-0" style={{ textTransform: 'uppercase' }} /></Field>
          </div>
          <div className="form-grid two">
            <Field label="Condición de salud">
              <select value={form.conditionAffection || 'ninguna'} onChange={(e) => set('conditionAffection', e.target.value)}>
                <option value="ninguna">Ninguna condición especial conocida</option>
                <option value="hipertension">Hipertensión arterial</option>
                <option value="diabetes">Diabetes</option>
                <option value="asma">Asma / Afección respiratoria</option>
                <option value="alergia">Alergias crónicas</option>
                <option value="discapacidad_motora">Discapacidad motora</option>
                <option value="discapacidad_visual">Discapacidad visual</option>
                <option value="discapacidad_auditiva">Discapacidad auditiva</option>
                <option value="neurodivergencia">Neurodivergencia / TEA</option>
                <option value="cronica">Enfermedad crónica / tratamiento continuo</option>
                <option value="encamado">Persona encamada / atención prioritaria</option>
                <option value="otra">Otra condición especial</option>
              </select>
            </Field>
            <Field label="Diagnóstico específico / medicamentos habituales"><input value={form.chronicDiseases} onChange={(e) => set('chronicDiseases', e.target.value)} placeholder="Ej: Losartán 50mg, Insulina..." /></Field>
          </div>
          <Field label="Notas / Observación"><textarea rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Información adicional o condición especial" /></Field>
          <div className="info-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>info</span><p>Los cambios se guardan directamente en el censo. La edad electoral y los segmentos se recalculan automáticamente desde la fecha de nacimiento.</p></div>
        </>}

        {type === 'residentDeactivate' && <>
          <Field label="Motivo" hint="No incluyas diagnósticos ni datos sensibles innecesarios." required><textarea rows="4" value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Mudanza, registro duplicado u otra causa verificable" required /></Field>
          <div className="warning-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>warning</span><p>No se borra la historia. La baja lógica requiere rol administrador y queda en auditoría.</p></div>
        </>}

        {type === 'cne' && <>
          <Field label="Cédula" required><input value={form.idNumber} onChange={(e) => set('idNumber', e.target.value)} placeholder="V-12.345.678" required /></Field>
          {!isDemo && !membership?.resident && <div className="warning-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>warning</span><p>Un administrador debe vincular primero tu cuenta con tu identidad exacta en el censo. No se permiten consultas por otra persona del hogar.</p></div>}
          <label className="check-row consent"><input type="checkbox" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} /><span><strong>Confirmo que soy titular y autorizo esta consulta puntual</strong><small>La cédula debe coincidir con la identidad verificada de tu cuenta. Se guardará la fuente y la fecha.</small></span></label>
          {result && <div className="cne-result"><header><StatusBadge tone={result.registered ? 'success' : result.status === 'not_registered' ? 'warning' : 'info'}>{result.registered ? 'Inscrito' : result.status === 'not_registered' ? 'No inscrito' : 'Sin confirmar'}</StatusBadge><small>Fuente: {result.source || 'CNE'}</small></header><dl><div><dt>Centro</dt><dd>{result.center || 'No informado por la fuente'}</dd></div><div><dt>Dirección</dt><dd>{result.address || 'No informada'}</dd></div></dl></div>}
        </>}

        {type === 'syncChildren' && <>
          {!result && <>
            <div className="info-box" style={{ background: 'rgba(79, 145, 173, 0.08)', borderColor: 'var(--blue)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--blue)' }}>child_care</span>
              <p>Esta acción cargará los <strong>108 niños y adolescentes</strong> extraídos del censo de la comunidad con sus fechas de nacimiento reales para calcular los segmentos de edad al instante.</p>
            </div>
            <p>Presiona <strong>Sincronizar Niños</strong> para registrar automáticamente a la población infantil en PocketBase.</p>
          </>}
          {result && (
            <div className="cne-result">
              <header>
                <StatusBadge tone="success">{result.createdCount} Niños Cargados</StatusBadge>
              </header>
              <p style={{ marginTop: '12px', fontSize: '14px', color: 'var(--text-main)' }}>{result.message}</p>
            </div>
          )}
        </>}

        {type === 'cneBulk' && <>
          {!result && <>
            <Field label="Cantidad maxima" hint="Usa lotes pequenos para evitar esperas largas." required><input type="number" min="1" max="50" value={form.limit} onChange={(e) => set('limit', e.target.value)} required /></Field>
            <label className="check-row consent"><input type="checkbox" checked={form.confirmCommunityConsent} onChange={(e) => set('confirmCommunityConsent', e.target.checked)} /><span><strong>Confirmo autorizacion comunitaria para consultar estos registros</strong><small>Se registrara quien ejecuto la consulta, fecha, fuente y resultado. Los menores conocidos se saltan.</small></span></label>
          </>}
          {result && <div className="cne-result"><header><StatusBadge tone={result.failed ? 'warning' : 'success'}>{result.checked} consultadas</StatusBadge><small>{result.failed} con error</small></header><dl><div><dt>Censo</dt><dd>{result.scanned} personas con cedula revisables</dd></div><div><dt>Ya tenian CNE</dt><dd>{result.alreadyProfiled}</dd></div><div><dt>Sin fecha</dt><dd>{result.withoutBirthDate} requieren fecha de nacimiento para edad exacta</dd></div><div><dt>Menores omitidos</dt><dd>{result.knownMinors}</dd></div><div><dt>Pendientes</dt><dd>{result.remainingWithoutProfile} quedan sin perfil CNE</dd></div></dl>{Boolean(Object.keys(result.centerStats || {}).length) && <div className="mini-list">{Object.entries(result.centerStats).map(([center, count]) => <p key={center}><strong>{count}</strong><span>{center}</span></p>)}</div>}</div>}
        </>}

        {type === 'courtesy' && <>
          <Field label="Código de hogar" required><input value={form.householdCode} onChange={(e) => set('householdCode', e.target.value)} placeholder="URP-A-014" required /></Field>
          <Field label="Cantidad" required><input type="number" min="1" max="17" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
          <Field label="Motivo" required><select value={form.reason} onChange={(e) => set('reason', e.target.value)} required><option value="">Selecciona un motivo</option><option>Emergencia familiar</option><option>Adulto mayor vulnerable</option><option>Contingencia comunitaria</option><option>Otro motivo aprobado</option></select></Field>
          <Field label="Justificación"><textarea rows="4" value={form.notes} onChange={(e) => set('notes', e.target.value)} required /></Field>
          <div className="warning-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>warning</span><p>La cortesía registra al administrador aprobador, el motivo y la asignación original. No modifica pagos anteriores.</p></div>
        </>}

        {type === 'toy' && <>
          <Field label="Nombre de la campaña" required><input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <div className="form-grid three"><Field label="Fecha de corte" required><input type="date" value={form.cutoffDate} onChange={(e) => set('cutoffDate', e.target.value)} required /></Field><Field label="Edad mínima"><input type="number" min="0" max="17" value={form.minAge} onChange={(e) => set('minAge', e.target.value)} /></Field><Field label="Edad máxima"><input type="number" min="0" max="17" value={form.maxAge} onChange={(e) => set('maxAge', e.target.value)} /></Field></div>
          <Field label="Notas"><textarea rows="4" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Criterios, fecha prevista o logística" /></Field>
          <div className="info-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>info</span><p>La elegibilidad se calcula desde la fecha de nacimiento. Quien no tenga fecha queda en revisión y nunca se convierte en edad cero.</p></div>
        </>}

        {(type === 'reportReview' || type === 'reportResolve') && <>
          <div className="info-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>report</span><p><strong>{payload?.title || 'Reporte comunitario'}</strong><br />{payload?.description || 'Sin descripción adicional.'}</p></div>
          <Field label={type === 'reportResolve' ? 'Resolución aplicada' : 'Nota de revisión'} required={type === 'reportResolve'}><textarea rows="5" value={form.message} onChange={(e) => set('message', e.target.value)} placeholder={type === 'reportResolve' ? 'Describe la acción tomada o la respuesta entregada…' : 'Observación opcional para el equipo…'} required={type === 'reportResolve'} /></Field>
        </>}

        {type === 'paymentMatch' && <>
          <div className="info-box"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>payments</span><p><strong>{new Intl.NumberFormat('es-VE').format(Number(payload?.amount || 0))}</strong><br />{payload?.payerName || 'El archivo no trae nombre de pagador.'}</p></div>
          <Field label="Código del hogar" hint="Ejemplo: URP-01-053. Confirma el nombre en el censo antes de guardar." required><input value={form.householdCode} onChange={(e) => set('householdCode', e.target.value)} placeholder="URP-01-000" required /></Field>
          <Field label="Nota de revisión"><textarea rows="4" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Cómo se confirmó la coincidencia…" /></Field>
        </>}

        {error && <p className="form-error" role="alert">{error}</p>}
        {!((type === 'cne' || type === 'cneBulk' || type === 'syncChildren') && result) && <div className="modal-actions"><button className="text-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={state === 'sending' || (type === 'cne' && !isDemo && !membership?.resident)}>{state === 'sending' ? 'Guardando...' : (type === 'cne' || type === 'cneBulk') ? 'Consultar' : type === 'syncChildren' ? 'Sincronizar Niños' : 'Guardar'}</button></div>}
        {((type === 'cne' || type === 'cneBulk' || type === 'syncChildren') && result) && <div className="modal-actions"><button className="primary-button" type="button" onClick={onClose}>Listo</button></div>}
      </form>
    </Modal>
  );
}
