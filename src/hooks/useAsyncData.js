import { useCallback, useEffect, useState } from 'react';

export function useAsyncData(load, dependencies) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => {
    setState({ data: null, loading: true, error: '' });
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    window.addEventListener('maotsetung:data-changed', reload);
    window.addEventListener('uroprofin:data-changed', reload);
    return () => {
      window.removeEventListener('maotsetung:data-changed', reload);
      window.removeEventListener('uroprofin:data-changed', reload);
    };
  }, [reload]);

  useEffect(() => {
    let active = true;
    setState({ data: null, loading: true, error: '' });
    Promise.resolve()
      .then(load)
      .then((data) => { if (active) setState({ data, loading: false, error: '' }); })
      .catch((error) => { if (active) setState({ data: null, loading: false, error: error?.message || 'No se pudieron cargar los datos.' }); });
    return () => { active = false; };
    // La persona que llama define explícitamente cuándo se repite la consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);

  return { ...state, reload };
}
