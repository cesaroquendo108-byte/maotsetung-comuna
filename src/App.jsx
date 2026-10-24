import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import AppShell from './components/AppShell.jsx';
import ActionModal from './components/ActionModal.jsx';
import DonateModal from './components/DonateModal.jsx';
import Brand from './components/Brand.jsx';
import { PageSkeleton, Toast } from './components/UI.jsx';
import { useAuth } from './state/AuthContext.jsx';
import { isAuthorizedAdmin } from './lib/permissions.js';

const Login = lazy(() => import('./pages/Login.jsx'));
const Landing = lazy(() => import('./pages/Landing.jsx'));
const RegistrationFlow = lazy(() => import('./pages/RegistrationFlow.jsx'));
const Home = lazy(() => import('./pages/Home.jsx'));
const Clap = lazy(() => import('./pages/Clap.jsx'));
const Census = lazy(() => import('./pages/Census.jsx'));
const Community = lazy(() => import('./pages/Community.jsx'));
const TreasuryFund = lazy(() => import('./pages/TreasuryFund.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const CommunityAnalytics = lazy(() => import('./pages/CommunityAnalytics.jsx'));

export default function App() {
  const auth = useAuth();
  const [section, setSection] = useState('home');
  const [action, setAction] = useState(null);
  const [toast, setToast] = useState(null);
  const [isDonateOpen, setIsDonateOpen] = useState(false);

  const sectionRef = useRef(section);
  const actionRef = useRef(action);
  const isDonateOpenRef = useRef(isDonateOpen);
  const historyStackRef = useRef(['home']);

  useEffect(() => { sectionRef.current = section; }, [section]);
  useEffect(() => { actionRef.current = action; }, [action]);
  useEffect(() => { isDonateOpenRef.current = isDonateOpen; }, [isDonateOpen]);

  const openAction = useCallback((type, payload = null) => setAction({ type, payload }), []);
  const closeAction = useCallback(() => setAction(null), []);
  const closeToast = useCallback(() => setToast(null), []);

  const navigateToSection = useCallback((nextSection) => {
    if (nextSection === sectionRef.current) return;
    setSection(nextSection);
    historyStackRef.current.push(nextSection);
    if (window.history && window.history.pushState) {
      window.history.pushState({ section: nextSection }, '', window.location.pathname);
    }
  }, []);

  const handleBack = useCallback(() => {
    if (actionRef.current) {
      closeAction();
      return true;
    }
    if (isDonateOpenRef.current) {
      setIsDonateOpen(false);
      return true;
    }
    if (historyStackRef.current.length > 1) {
      historyStackRef.current.pop();
      const prevSection = historyStackRef.current[historyStackRef.current.length - 1] || 'home';
      setSection(prevSection);
      return true;
    }
    if (sectionRef.current !== 'home') {
      setSection('home');
      historyStackRef.current = ['home'];
      return true;
    }
    return false;
  }, [closeAction]);

  useEffect(() => {
    let removeListener = null;

    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('backButton', () => {
        const handled = handleBack();
        if (!handled) {
          CapApp.exitApp();
        }
      }).then((handle) => {
        removeListener = handle;
      }).catch((err) => {
        console.warn('Capacitor backButton listener error:', err);
      });
    }

    const onPopState = () => {
      handleBack();
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      if (removeListener && removeListener.remove) {
        removeListener.remove();
      }
      window.removeEventListener('popstate', onPopState);
    };
  }, [handleBack]);

  const publicPath = window.location.pathname;
  const openApp = publicPath === '/app' || publicPath.startsWith('/app/');
  const isRegisterRoute = publicPath === '/register' || publicPath === '/registro';
  const isTreasuryRoute = publicPath === '/treasury' || publicPath === '/fondo';

  const handleRegistrationCompleted = useCallback(async () => {
    await auth.retryMemberships();
    if (window.location.pathname !== '/app') {
      window.history.replaceState({}, '', '/app');
    }
  }, [auth]);

  if (isTreasuryRoute) {
    return (
      <Suspense fallback={<div className="app-loading"><Brand /><p>Cargando fondo comunal…</p></div>}>
        <div className="treasury-standalone-shell">
          <header className="treasury-standalone-header">
            <a href="/" style={{ textDecoration: 'none' }}><Brand compact /></a>
            <div className="treasury-standalone-actions">
              <a href="/app" className="primary-button" style={{ textDecoration: 'none' }}>Entrar al Portal</a>
            </div>
          </header>
          <TreasuryFund role={auth.role} onAction={openAction} />
        </div>
      </Suspense>
    );
  }

  if (!auth.user) {
    return (
      <Suspense fallback={<div className="app-loading"><Brand /><p>Cargando…</p></div>}>
        {openApp || isRegisterRoute ? <Login /> : <Landing />}
      </Suspense>
    );
  }

  if (auth.loading) {
    return (
      <div className="app-loading">
        <Brand />
        <p>Cargando tu consejo…</p>
      </div>
    );
  }

  // Si hubo un error temporal conectando con el servidor, ofrecer reintento en vez de forzar registro
  if (auth.membershipError && !auth.membership && !auth.isDemo) {
    return (
      <div className="app-loading" style={{ gap: '1rem', padding: '2rem' }}>
        <Brand />
        <p style={{ color: '#B45309', maxWidth: '420px', textAlign: 'center', fontSize: '0.9rem', lineHeight: '1.4' }}>
          {auth.membershipError}
        </p>
        <button
          type="button"
          className="primary-button"
          style={{ minWidth: '180px' }}
          onClick={() => auth.retryMemberships()}
        >
          Reintentar conexión
        </button>
        <button
          type="button"
          className="text-button"
          onClick={auth.signOut}
          style={{ marginTop: '0.5rem' }}
        >
          Cerrar sesión
        </button>
      </div>
    );
  }

  const isPlatformAdmin = auth.role === 'admin' || isAuthorizedAdmin(auth.user);
  const hasLinkedIdentity = isPlatformAdmin
    || Boolean(auth.membership?.resident)
    || Boolean(auth.membership?.household)
    || (Array.isArray(auth.memberships) && auth.memberships.some((m) => Boolean(m.resident) || Boolean(m.household) || m.role === 'admin'))
    || auth.isDemo;

  if (!hasLinkedIdentity) {
    return (
      <Suspense fallback={<div className="app-loading"><Brand /><p>Cargando registro…</p></div>}>
        <RegistrationFlow onCompleted={handleRegistrationCompleted} />
      </Suspense>
    );
  }

  if (isRegisterRoute) {
    window.history.replaceState({}, '', '/app');
  }

  const isAdmin = (auth.role === 'admin' || isAuthorizedAdmin(auth.user)) && (auth.isDemo || isAuthorizedAdmin(auth.user));

  const pages = {
    home: <Home role={auth.role} user={auth.user} onNavigate={navigateToSection} onAction={openAction} />,
    clap: <Clap role={auth.role} onAction={openAction} />,
    treasury: <TreasuryFund role={auth.role} onAction={openAction} />,
    census: <Census role={auth.role} onAction={openAction} onNavigate={navigateToSection} />,
    community: <Community role={auth.role} onAction={openAction} />,
    profile: <Profile onAction={openAction} />,
    ...(isAdmin ? { analytics: <CommunityAnalytics role={auth.role} onAction={openAction} onNavigate={navigateToSection} /> } : {}),
  };

  return (
    <>
      <AppShell section={section} onSection={navigateToSection} user={auth.user} role={auth.role} community={auth.community} memberships={auth.memberships} onSelectCommunity={auth.selectCommunity} isDemo={auth.isDemo} onOpenDonate={() => setIsDonateOpen(true)}>
        <Suspense fallback={<PageSkeleton />}>
          {pages[section] || pages.home}
        </Suspense>
      </AppShell>
      <ActionModal type={action?.type} payload={action?.payload} onClose={closeAction} onToast={setToast} />
      {isDonateOpen && <DonateModal onClose={() => setIsDonateOpen(false)} onToast={setToast} />}
      <Toast toast={toast} onClose={closeToast} />
    </>
  );
}
