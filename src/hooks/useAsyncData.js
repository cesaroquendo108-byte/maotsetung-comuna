import { useCallback, useEffect, useState } from 'react';

const asyncDataCache = new Map();

export function useAsyncData(load, dependencies, { ttl = 45000 } = {}) {
  const cacheKey = JSON.stringify(dependencies || []);
  const cachedEntry = asyncDataCache.get(cacheKey);
  const hasCachedData = Boolean(cachedEntry && cachedEntry.data);

  const [state, setState] = useState(() => ({
    data: hasCachedData ? cachedEntry.data : null,
    loading: !hasCachedData,
    error: '',
  }));

  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => {
    asyncDataCache.delete(cacheKey);
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    setRevision((value) => value + 1);
  }, [cacheKey]);

  useEffect(() => {
    window.addEventListener('uroprofin:data-changed', reload);
    window.addEventListener('maotsetung:data-changed', reload);
    return () => {
      window.removeEventListener('uroprofin:data-changed', reload);
      window.removeEventListener('maotsetung:data-changed', reload);
    };
  }, [reload]);

  useEffect(() => {
    let active = true;
    const currentCached = asyncDataCache.get(cacheKey);
    const now = Date.now();

    // Stale-While-Revalidate: si hay datos en cache, presentarlos de inmediato
    if (currentCached?.data) {
      setState({ data: currentCached.data, loading: false, error: '' });
      if (now - currentCached.timestamp < ttl && revision === 0) {
        return () => { active = false; };
      }
    } else {
      setState((prev) => ({ ...prev, loading: true, error: '' }));
    }

    Promise.resolve()
      .then(load)
      .then((data) => {
        if (!active) return;
        asyncDataCache.set(cacheKey, { data, timestamp: Date.now() });
        setState({ data, loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        setState((prev) => ({
          data: prev.data,
          loading: false,
          error: error?.message || 'No se pudieron cargar los datos.',
        }));
      });

    return () => { active = false; };
  }, [...dependencies, revision]);

  return { ...state, reload };
}
