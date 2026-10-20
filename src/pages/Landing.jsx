import Brand from '../components/Brand.jsx';
import { COMMUNITY_CONFIG } from '../config/community.js';

const APP_DOWNLOAD = '/downloads/maotsetung.apk';

export default function Landing() {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Comuna Mao Tse Tung inicio">
          <Brand compact />
        </a>
        <nav aria-label="Secciones de Comuna Mao Tse Tung">
          <a href="/fondo">Tesorería Comunal</a>
        </nav>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <a className="landing-nav__cta" href="/app">
            Entrar al Portal
          </a>
        </div>
      </header>

      <main>
        <section className="landing-hero" style={{ gridTemplateColumns: '1fr', minHeight: 'auto', padding: 'clamp(48px, 7vw, 84px) clamp(20px, 5vw, 64px)' }}>
          <div className="landing-hero__content" style={{ maxWidth: '820px', margin: '0 auto', textAlign: 'center' }}>
            <p className="eyebrow">COMUNA MAO TSE TUNG · SAN AGUSTÍN · ENAHP-IUT</p>
            <h1>Inteligencia comunal, caracterización sociodemográfica y control fiscal para 5 consejos comunales.</h1>
            <p style={{ margin: '0 auto 16px', maxWidth: '640px' }}>
              Plataforma desarrollada junto a los estudiantes de Ciencias Fiscales de la ENAHP para articular el ciclo comunal: censo familiar, logística de servicios, rendición de cuentas financieras y proyectos comunitarios en San Agustín, Caracas.
            </p>
            <p style={{ margin: '0 auto 28px', maxWidth: '640px' }}>
              <strong>Menos papel, mayor transparencia contable y soberanía de datos para el Poder Popular.</strong>
            </p>
            <div className="landing-actions" style={{ justifyContent: 'center' }}>
              <a className="landing-button landing-button--primary" href="/app">
                Entrar al Portal con Google
              </a>
              <a className="landing-button landing-button--light" href="/fondo">
                Tesorería y Fondo
              </a>
              <a className="landing-button landing-button--outline" href={APP_DOWNLOAD} style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#ffd8d4' }}>
                Descargar APK (Android)
              </a>
            </div>
            <p style={{ margin: '18px auto 0', maxWidth: '580px', fontSize: '0.85rem', color: '#94A3B8' }}>
              Acceso institucional seguro. El sistema asocia automáticamente a cada vocero con su Consejo Comunal correspondiente.
            </p>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div>
          <Brand compact />
          <p>
            Comuna Socialista Mao Tse Tung · Parroquia San Agustín, Municipio Bolivariano Libertador, Caracas.
            Desarrollado en articulación con el Programa de Servicio Comunitario de la ENAHP-IUT.
          </p>
        </div>
        <nav>
          <a href="/fondo">Tesorería Comunal</a>
          <a href="/app">Entrar al Portal</a>
          <a href={APP_DOWNLOAD}>Descargar APK</a>
        </nav>
      </footer>
    </div>
  );
}
