import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import pb, { currentUser, DEMO_ENABLED, login as passwordLogin, loginGoogle, logout as pbLogout, registerWithPassword } from '../lib/pocketbase.js';
import { demoCommunity, demoHousehold } from '../lib/demoData.js';
import { clearMembershipCache, getMemberships } from '../lib/repository.js';
import { isAuthorizedAdmin } from '../lib/permissions.js';

const AuthContext = createContext(null);

const demoUser = { id: 'demo-user', name: 'Usuario demo', email: 'demo@maotsetung.local', avatar: '' };
const demoMembership = {
  id: 'demo-membership',
  user: demoUser.id,
  community: demoCommunity.id,
  household: demoHousehold.id,
  role: 'admin',
  status: 'active',
  expand: { community: demoCommunity, household: demoHousehold },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => currentUser());
  const [membership, setMembership] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(Boolean(currentUser()));
  const [membershipError, setMembershipError] = useState('');
  const [membershipReloadKey, setMembershipReloadKey] = useState(0);
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => pb.authStore.onChange((_token, model) => {
    if (!isDemo) setUser(model || null);
  }, true), [isDemo]);

  useEffect(() => {
    let active = true;
    if (!user) {
      setMemberships([]);
      setMembership(null);
      setMembershipError('');
      setLoading(false);
      return () => { active = false; };
    }
    if (isDemo) {
      setMembershipError('');
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setMembershipError('');
    getMemberships(user.id)
      .then((records) => {
        if (!active) return;
        setMemberships(records);
        setMembership((current) => {
          if (current?.id && records.some((r) => r.id === current.id)) {
            return records.find((r) => r.id === current.id);
          }
          return records.find((r) => r.resident && r.status === 'active')
            || records.find((r) => r.household && r.status === 'active')
            || records.find((r) => r.role === 'admin')
            || records[0]
            || null;
        });
      })
      .catch((err) => {
        if (active) {
          setMemberships([]);
          setMembership(null);
          setMembershipError(err?.message || 'No pudimos verificar tus permisos con el servidor. No enviaremos una solicitud nueva hasta confirmar tu estado.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, isDemo, membershipReloadKey]);

  const signInGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      const record = await loginGoogle();
      setUser(record);
      setIsDemo(false);
      clearMembershipCache();
      try {
        const records = await getMemberships(record.id);
        setMemberships(records);
        const activeMem = records.find((r) => r.resident && r.status === 'active')
          || records.find((r) => r.household && r.status === 'active')
          || records.find((r) => r.role === 'admin')
          || records[0]
          || null;
        setMembership(activeMem);
        setMembershipError('');
      } catch (_) {}
    } catch (e) {
      setError(e?.message || 'No pudimos iniciar sesión con Google.');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const signInPassword = async (email, password) => {
    setError('');
    setLoading(true);
    try {
      const record = await passwordLogin(email, password);
      setUser(record);
      setIsDemo(false);
      clearMembershipCache();
      try {
        const records = await getMemberships(record.id);
        setMemberships(records);
        const activeMem = records.find((r) => r.resident && r.status === 'active')
          || records.find((r) => r.household && r.status === 'active')
          || records.find((r) => r.role === 'admin')
          || records[0]
          || null;
        setMembership(activeMem);
        setMembershipError('');
      } catch (_) {}
    } catch (e) {
      setError('Revisa el correo y la contraseña e intenta de nuevo.');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const signUpPassword = async ({ email, password, passwordConfirm, name }) => {
    setError('');
    setLoading(true);
    try {
      const record = await registerWithPassword({ email, password, passwordConfirm, name });
      setUser(record);
      setIsDemo(false);
      return record;
    } catch (e) {
      setError(e?.message || 'No se pudo crear la cuenta.');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const enterDemo = () => {
    if (!DEMO_ENABLED) return;
    setIsDemo(true);
    setUser(demoUser);
    setMembership(demoMembership);
    setMemberships([demoMembership]);
    setMembershipError('');
    setLoading(false);
    setError('');
  };

  const selectCommunity = (membershipId) => {
    const selected = memberships.find((record) => record.id === membershipId);
    if (selected) setMembership(selected);
  };

  const setDemoRole = (role) => {
    if (!isDemo) return;
    setMembership((current) => ({ ...current, role }));
  };

  const signOut = () => {
    clearMembershipCache();
    if (!isDemo) pbLogout();
    setUser(null);
    setMembership(null);
    setMemberships([]);
    setMembershipError('');
    setIsDemo(false);
    setError('');
  };

  const retryMemberships = async () => {
    clearMembershipCache();
    setMembershipReloadKey((value) => value + 1);
    if (!user || isDemo) return [];
    try {
      setLoading(true);
      const records = await getMemberships(user.id);
      setMemberships(records);
      const activeMem = records.find((record) => record.id === membership?.id)
        || records.find((r) => r.resident && r.status === 'active')
        || records.find((r) => r.household && r.status === 'active')
        || records.find((r) => r.role === 'admin')
        || records[0]
        || null;
      setMembership(activeMem);
      setMembershipError('');
      return records;
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  };

  const value = useMemo(() => ({
    user,
    membership,
    memberships,
    membershipError,
    role: isAuthorizedAdmin(user) ? 'admin' : (membership?.role || 'regular'),
    community: membership?.expand?.community || null,
    household: membership?.expand?.household || null,
    loading,
    error,
    isDemo,
    demoEnabled: DEMO_ENABLED,
    signInGoogle,
    signInPassword,
    signUpPassword,
    enterDemo,
    retryMemberships,
    setDemoRole,
    selectCommunity,
    signOut,
  }), [user, membership, memberships, membershipError, loading, error, isDemo]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return context;
}
