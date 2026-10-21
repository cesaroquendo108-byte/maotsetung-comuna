import { useEffect, useState } from 'react';
import Brand from '../components/Brand.jsx';
import { Field } from '../components/UI.jsx';
import { getLoginAvailability } from '../lib/pocketbase.js';
import { useAuth } from '../state/AuthContext.jsx';

export default function Login() {
  const { signInGoogle, signInPassword, signUpPassword, enterDemo, demoEnabled, loading, error: authError } = useAuth();
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [localError, setLocalError] = useState('');
  const [googleAvailability, setGoogleAvailability] = useState('available');

  useEffect(() => {
    let active = true;
    getLoginAvailability().then(({ google }) => {
      if (active) setGoogleAvailability(google === true ? 'available' : google === false ? 'disabled' : 'unavailable');
    });
    return () => { active = false; };
  }, []);

  const switchMode = (newMode) => {
    setMode(newMode);
    setLocalError('');
    if (newMode === 'signup') {
      if (password && !passwordConfirm) setPasswordConfirm(password);
      if (email && !name) {
        const guessedName = email.split('@')[0].replace(/[._-]/g, ' ');
        setName(guessedName.charAt(0).toUpperCase() + guessedName.slice(1));
      }
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setLocalError('');

    if (mode === 'signup') {
      if (!email.trim() || !password) {
        setLocalError('Completa todos los campos obligatorios.');
        return;
      }
      if (password.length < 8) {
        setLocalError('La contrasena debe tener al menos 8 caracteres.');
        return;
      }
      if (password !== passwordConfirm) {
        setLocalError('Las contrasenas no coinciden.');
        return;
      }
      try {
        await signUpPassword({ email, password, passwordConfirm, name });
      } catch (err) {
        setLocalError(err?.message || 'No se pudo crear la cuenta.');
      }
    } else {
      if (!email.trim() || !password) {
        setLocalError('Introduce tu correo y contrasena.');
        return;
      }
      try {
        await signInPassword(email, password);
      } catch (err) {
        // AuthContext gestiona el error
      }
    }
  };

  const displayError = localError || authError;

  return (
    <div className="login-page">
      <div className="login-glow login-glow--one" />
      <div className="login-glow login-glow--two" />

      <section className="login-panel">
        <div className="login-card">
          <div className="login-brand"><Brand /></div>
          <p className="eyebrow">COMUNA MAO TSE TUNG · SAN AGUSTIN</p>

          <div style={{
            display: 'flex',
            background: '#F1F5F9',
            borderRadius: '0.65rem',
            padding: '3px',
            margin: '0.75rem 0 1.25rem',
            border: '1px solid #E2E8F0',
          }}>
            <button
              type="button"
              onClick={() => switchMode('signin')}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '0.85rem',
                fontWeight: mode === 'signin' ? 700 : 500,
                background: mode === 'signin' ? '#FFFFFF' : 'transparent',
                color: mode === 'signin' ? '#0F172A' : '#64748B',
                boxShadow: mode === 'signin' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Iniciar sesion
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '0.85rem',
                fontWeight: mode === 'signup' ? 700 : 500,
                background: mode === 'signup' ? '#FFFFFF' : 'transparent',
                color: mode === 'signup' ? '#0F172A' : '#64748B',
                boxShadow: mode === 'signup' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Crear cuenta
            </button>
          </div>

          <h1>{mode === 'signin' ? 'Bienvenido al Portal Comunal' : 'Crear cuenta comunal'}</h1>
          <p>
            {mode === 'signin'
              ? 'Accede con tu cuenta institucional o comunitaria para consultar la caracterizacion sociodemografica, los 5 consejos comunales y los servicios.'
              : 'Registrate con tu correo para vincular tu identidad censal y participar en la gestion comunal de San Agustin.'}
          </p>

          <form onSubmit={submit}>
            {mode === 'signup' && (
              <Field label="Nombre completo" required>
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ej. Maria Perez"
                />
              </Field>
            )}

            <Field label="Correo" required>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nombre@correo.com"
              />
            </Field>

            <Field label="Contrasena" required>
              <input
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {mode === 'signup' && (
              <Field label="Confirmar contrasena" required>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  placeholder="••••••••"
                />
              </Field>
            )}

            {mode === 'signin' && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '0.85rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: '#64748B', width: '100%' }}>Voceros autorizados (1 clic):</span>
                <button type="button" className="link-button" style={{ fontSize: '0.72rem', padding: '3px 8px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '4px', color: '#334155' }} onClick={() => { setEmail('cesaroquendo10@gmail.com'); setPassword('MaoTseTung2026!'); }}>Cesar</button>
                <button type="button" className="link-button" style={{ fontSize: '0.72rem', padding: '3px 8px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '4px', color: '#334155' }} onClick={() => { setEmail('david.enahp@gmail.com'); setPassword('MaoTseTung2026!'); }}>David (ENAHP)</button>
                <button type="button" className="link-button" style={{ fontSize: '0.72rem', padding: '3px 8px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '4px', color: '#334155' }} onClick={() => { setEmail('kilby12lite@gmail.com'); setPassword('MaoTseTung2026!'); }}>Kilby</button>
              </div>
            )}

            <button
              className="primary-button full"
              type="submit"
              disabled={loading || !email || !password || (mode === 'signup' && (!passwordConfirm || !name.trim()))}
            >
              {loading
                ? (mode === 'signup' ? 'Creando cuenta…' : 'Entrando…')
                : (mode === 'signup' ? 'Crear cuenta' : 'Entrar')}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0' }}>
            <div style={{ flex: 1, height: '1px', background: '#E2E8F0' }} />
            <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 600 }}>o tambien</span>
            <div style={{ flex: 1, height: '1px', background: '#E2E8F0' }} />
          </div>

          <button className="google-button" type="button" disabled={loading || googleAvailability !== 'available'} onClick={() => signInGoogle().catch(() => {})}>
            <span className="google-g">G</span>{loading ? 'Conectando…' : googleAvailability === 'checking' ? 'Comprobando Google…' : 'Continuar con Google'}
          </button>

          {displayError && (
            <div className="form-error" role="alert" style={{ marginTop: '0.85rem' }}>
              <strong>{mode === 'signup' ? 'No pudimos crear tu cuenta.' : 'No pudimos iniciar sesion.'}</strong>
              <span>{displayError}</span>
              {mode === 'signin' && (
                <div style={{ marginTop: '0.65rem', paddingTop: '0.65rem', borderTop: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <p style={{ margin: '0 0 0.45rem', fontSize: '0.8rem', color: '#991B1B', lineHeight: 1.4 }}>
                    ¿Es la primera vez que entras o no tienes contrasena aun para <strong>{email || 'este correo'}</strong>?
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    style={{
                      background: '#DC2626',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '0.5rem',
                      padding: '6px 12px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Crear cuenta con este correo →
                  </button>
                </div>
              )}
            </div>
          )}

          <div style={{ margin: '1.25rem 0 0.75rem', padding: '0.85rem 1rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '0.75rem', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#0F172A', fontWeight: 700 }}>Acceso Fiduciario Unificado</p>
            <p style={{ margin: '0.35rem 0 0.65rem', fontSize: '0.8rem', color: '#475569', lineHeight: 1.45 }}>
              {mode === 'signup'
                ? 'Tras crear tu cuenta, pasaras directamente al registro de tu Cedula y RIF para vincular tu ficha censal al sistema.'
                : 'Inicia sesion con tu correo o cuenta de Google. Si aun no tienes un hogar censado, podras completar tu ficha en el siguiente paso.'}
            </p>
            <a href="/fondo" style={{ fontSize: '0.8rem', color: '#0284C7', textDecoration: 'none', fontWeight: 600 }}>
              Consultar Fondo Comunal de Inversion →
            </a>
          </div>

          {demoEnabled && (
            <div className="demo-entry">
              <span>Vista de desarrollo</span>
              <button type="button" onClick={enterDemo}>Explorar la demo <b>→</b></button>
            </div>
          )}
          <small className="privacy-copy">Al continuar aceptas el uso responsable de tus datos para la gestion del consejo.</small>
          <div className="login-security"><span aria-hidden="true" style={{ fontWeight: 800 }}>•</span><p><strong>Acceso protegido</strong><small>Tus datos personales no son publicos.</small></p></div>
          <a className="login-landing-link" href="/">Ver landing publica</a>
        </div>
      </section>
    </div>
  );
}
