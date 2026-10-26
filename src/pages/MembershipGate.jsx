import { useEffect, useMemo, useState } from 'react';
import Brand from '../components/Brand.jsx';
import { Field, StatusBadge } from '../components/UI.jsx';
import {
  createConsolidatedLinkRequest,
  getConsolidatedZones,
  getMyConsolidatedLinkRequests,
} from '../lib/repository.js';
import { useAuth } from '../state/AuthContext.jsx';

const initialForm = { communityCode: 'MTT-001', zoneId: '', code: '', idNumber: '', phone: '', reference: '' };

export default function MembershipGate() {
  const { user, signOut, membershipError, retryMemberships } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [zones, setZones] = useState([]);
  const [request, setRequest] = useState(null);
  const [state, setState] = useState('checking');
  const [activeCommunityCode, setActiveCommunityCode] = useState(form.communityCode);
  const [lookupKey, setLookupKey] = useState(0);

  useEffect(() => {
    let active = true;
    if (membershipError) return () => { active = false; };
    setState((curr) => (curr === 'idle' || curr === 'sent' ? curr : 'checking'));
    Promise.all([
      getMyConsolidatedLinkRequests(),
      getConsolidatedZones(activeCommunityCode),
    ])
      .then(([requests, nextZones]) => {
        if (!active) return;
        const pending = requests.find((item) => ['pending', 'review'].includes(item.status));
        const approved = requests.find((item) => item.status === 'approved');
        setRequest(pending || approved || null);
        setZones(nextZones);
        setForm((current) => ({ ...current, zoneId: current.zoneId || nextZones[0]?.id || '' }));
        setState(pending ? 'sent' : approved ? 'approved' : 'idle');
        setZoneState('ready');
      })
      .catch(() => {
        if (!active) return;
        setState('lookup-error');
        setZoneState('error');
      });
    return () => { active = false; };
  }, [user.id, membershipError, lookupKey, activeCommunityCode]);

  const selectedZone = useMemo(() => zones.find((zone) => zone.id === form.zoneId), [zones, form.zoneId]);
  const needsReference = !form.code.trim();
  const hasSearchValue = Boolean(form.idNumber.trim() || form.phone.trim());
  const canSubmit = Boolean(form.zoneId && hasSearchValue && (!needsReference || form.reference.trim()));
  const blocked = Boolean(membershipError || (state === 'checking' && zoneState === 'loading' && !zones.length) || state === 'lookup-error');
  const sent = state === 'sent';

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setState('sending');
    try {
      const result = await createConsolidatedLinkRequest({
        communityCode: form.communityCode,
        zoneId: form.zoneId,
        code: form.code,
        idNumber: form.idNumber,
        phone: form.phone,
        reference: form.reference,
      });
      setRequest(result);
      setState('sent');
    } catch (error) {
      setState('error');
      setRequest({ error: error?.message || 'No pudimos registrar la solicitud.' });
    }
  };

  const retry = () => {
    setLookupKey((value) => value + 1);
    setZoneState('loading');
  };

  return (
    <div className="gate-page">
      <header><Brand /><button type="button" className="text-button" onClick={signOut}>Cerrar sesión</button></header>
      <main>
        <div className="gate-card">
          <p className="eyebrow">VINCULAR HOGAR</p>
          <StatusBadge tone={state === 'approved' ? 'success' : sent ? 'success' : blocked ? 'warning' : 'info'}>
            {state === 'approved' ? 'Solicitud aprobada' : sent ? 'Solicitud enviada' : membershipError ? 'Verificación interrumpida' : state === 'lookup-error' ? 'No pudimos revisar el servidor' : state === 'checking' ? 'Comprobando tu cuenta' : 'Falta confirmar tu hogar'}
          </StatusBadge>
          <h1>{state === 'approved' ? 'Tu solicitud fue aprobada.' : sent ? 'La junta revisará tu hogar.' : membershipError ? 'No asumiremos que te falta acceso.' : state === 'lookup-error' ? 'No pudimos confirmar tu solicitud.' : state === 'checking' ? 'Estamos verificando tu estado.' : 'Encontremos tu registro.'}</h1>
          <p>{state === 'approved' ? 'Actualiza tu sesión para cargar el consejo y sus servicios.' : sent ? 'El consejo comunal y los datos de búsqueda quedaron guardados. No necesitas enviar otra solicitud.' : membershipError || state === 'lookup-error' ? 'Para evitar duplicados, el formulario seguirá cerrado hasta que el servidor confirme tu estado.' : state === 'checking' ? 'Esto suele tardar solo unos segundos.' : 'Selecciona el consejo comunal donde vives y escribe al menos una forma de localizarte en el censo.'}</p>

          {membershipError && <div className="form-error" role="alert"><strong>No pudimos verificar tus permisos.</strong><span>{membershipError}</span><button className="secondary-button" type="button" onClick={retryMemberships}>Reintentar verificación</button></div>}
          {!membershipError && state === 'lookup-error' && <div className="form-error" role="alert"><strong>No pudimos cargar los consejos comunales o tu solicitud.</strong><span>Revisa la conexión y vuelve a intentar.</span><button className="secondary-button" type="button" onClick={retry}>Volver a comprobar</button></div>}
          {state === 'approved' && <button className="primary-button full" type="button" onClick={retryMemberships}>Actualizar acceso</button>}

          {!blocked && !sent && state !== 'approved' && (
            <form onSubmit={submit}>
              <Field label="Código del consejo" required><input value={form.communityCode} onChange={(event) => update('communityCode', event.target.value)} onBlur={() => { const code = form.communityCode.trim().toUpperCase(); if (code && code !== activeCommunityCode) setActiveCommunityCode(code); }} /></Field>
              <Field label="Consejo Comunal donde vives" required hint={zoneState === 'ready' ? `${zones.length} consejos disponibles` : 'Cargando consejos…'}>
                <select value={form.zoneId} onChange={(event) => update('zoneId', event.target.value)} required>
                  <option value="">Selecciona tu consejo comunal</option>
                  {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.code} · {zone.name}</option>)}
                </select>
              </Field>
              <Field label="Código de vivienda" hint="Si ya te dieron un código MTT, escríbelo aquí."><input value={form.code} onChange={(event) => update('code', event.target.value)} placeholder="MTT-SAC-001" /></Field>
              <Field label="Cédula" hint="Se usa únicamente para localizar tu registro."><input value={form.idNumber} onChange={(event) => update('idNumber', event.target.value)} placeholder="V-12.345.678" /></Field>
              <Field label="Teléfono" hint="Puedes usar cédula o teléfono; ambos ayudan a confirmar."><input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="0412-0000000" /></Field>
              <Field label="Referencia de la vivienda" required={needsReference} hint="Obligatoria si no tienes código de vivienda."><input value={form.reference} onChange={(event) => update('reference', event.target.value)} placeholder="Portón, escalera o referencia cercana" /></Field>
              <button className="primary-button full" type="submit" disabled={state === 'sending' || !canSubmit}>{state === 'sending' ? 'Enviando…' : 'Solicitar vinculación'}</button>
              {state === 'error' && <p className="form-error" role="alert">{request?.error || 'No pudimos enviar la solicitud. Intenta de nuevo.'}</p>}
            </form>
          )}
          {!membershipError && state !== 'lookup-error' && state !== 'approved' && <div className="gate-note"><strong>{selectedZone ? `Consejo Comunal: ${selectedZone.name}` : 'Importante'}</strong><p>La coincidencia no aprueba el acceso por sí sola. La junta debe cotejar el hogar por invitación, verificación presencial u otro factor antes de vincular tu cuenta.</p></div>}
        </div>
      </main>
    </div>
  );
}
