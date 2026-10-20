import { useEffect, useState } from 'react';
import Brand from '../components/Brand.jsx';
import { Field } from '../components/UI.jsx';
import { getLoginAvailability } from '../lib/pocketbase.js';
import { useAuth } from '../state/AuthContext.jsx';

export default function Login() {
  const { signInGoogle, signInPassword, enterDemo, demoEnabled, loading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [googleAvailability, setGoogleAvailability] = useState('checking');

  useEffect(() => {
    let active = true;
    getLoginAvailability().then(({ google }) => {
      if (active) setGoogleAvailability(google === true ? 'available' : google === false ? 'disabled' : 'unavailable');
    });
    return () => { active = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!email || !password) return;
    try { await signInPassword(email, password); } catch { /* El contexto muestra el error. */ }
  };

  return (
    <div className="login-page">
      <div className="login-glow login-glow--one" />
      <div className="login-glow login-glow--two" />

      <section className="login-panel">
        <div className="login-card">
          <div className="login-brand"><Brand /></div>
          <p className="eyebrow">COMUNA MAO TSE TUNG · SAN AGUSTÍN</p>
          <h1>Bienvenido al Portal Comunal</h1>
          <p>Accede con tu cuenta institucional o comunitaria para consultar la caracterización sociodemográfica, los 5 consejos comunales y los servicios.</p>

          <form onSubmit={submit}>
            <Field label="Correo" required>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@correo.com" />
            </Field>
            <Field label="Contraseña" required>
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
            </Field>
            <button className="primary-button full" type="submit" disabled={loading || !email || !password}>{loading ? 'Entrando…' : 'Entrar'}</button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0' }}>
            <div style={{ flex: 1, height: '1px', background: '#E2E8F0' }} />
            <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 600 }}>o también</span>
            <div style={{ flex: 1, height: '1px', background: '#E2E8F0' }} />
          </div>

          <button className="google-button" type="button" disabled={loading || googleAvailability !== 'available'} onClick={() => signInGoogle().catch(() => {})}>
            <span className="google-g">G</span>{loading ? 'Conectando…' : googleAvailability === 'checking' ? 'Comprobando Google…' : 'Continuar con Google'}
          </button>

          {error && <div className="form-error" role="alert"><strong>No pudimos iniciar sesión.</strong><span>{error}</span></div>}

          <div style={{ margin: '1.25rem 0 0.75rem', padding: '0.85rem 1rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '0.75rem', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#0F172A', fontWeight: 700 }}>Acceso Fiduciario Unificado</p>
            <p style={{ margin: '0.35rem 0 0.65rem', fontSize: '0.8rem', color: '#475569', lineHeight: 1.45 }}>
              Inicia sesión con tu cuenta de Google. Si aún no tienes un hogar censado en la comunidad, el sistema abrirá automáticamente tu ficha de registro e identidad.
            </p>
            <a href="/fondo" style={{ fontSize: '0.8rem', color: '#0284C7', textDecoration: 'none', fontWeight: 600 }}>
              Consultar Fondo Comunal de Inversión →
            </a>
          </div>

          {demoEnabled && (
            <div className="demo-entry">
              <span>Vista de desarrollo</span>
              <button type="button" onClick={enterDemo}>Explorar la demo <b>→</b></button>
            </div>
          )}
          <small className="privacy-copy">Al continuar aceptas el uso responsable de tus datos para la gestión del consejo.</small>
          <div className="login-security"><span aria-hidden="true" style={{ fontWeight: 800 }}>•</span><p><strong>Acceso protegido</strong><small>Tus datos personales no son públicos.</small></p></div>
          <a className="login-landing-link" href="/">Ver landing pública</a>
        </div>
      </section>
    </div>
  );
}
