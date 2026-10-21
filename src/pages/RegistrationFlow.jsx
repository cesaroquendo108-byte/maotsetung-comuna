import { useEffect, useMemo, useRef, useState } from 'react';
import Brand from '../components/Brand.jsx';
import { Field, StatusBadge } from '../components/UI.jsx';
import {
  compressImageFile,
  extractHouseNumber,
  normalizeToIsoDate,
  scanCedulaDocument,
  scanRifDocument,
} from '../lib/documentScanner.js';
import { fileToBase64 } from '../lib/openrouter.js';
import {
  checkCedulaMatch,
  confirmHouseholdMatch,
  getConsolidatedZones,
  lookupHistoricalCensus,
  submitResidentRegistration,
} from '../lib/repository.js';
import { useAuth } from '../state/AuthContext.jsx';
import { formatPersonName } from '../lib/formatters.js';
import { COMMUNITY_CONFIG } from '../config/community.js';

const DRAFT_KEY = 'maotsetung_registration_cache_v1';

const DEFAULT_ZONES = COMMUNITY_CONFIG.councils.map((c) => ({
  id: c.code.toLowerCase(),
  code: c.abbreviation,
  name: c.name.toUpperCase(),
}));

export default function RegistrationFlow({ onCompleted } = {}) {
  const { user, signInGoogle, signOut, retryMemberships } = useAuth();

  const [step, setStep] = useState(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.step >= 1 && d.step <= 4) return d.step;
      }
    } catch (_) {}
    return 1;
  });

  const [zones, setZones] = useState(DEFAULT_ZONES);
  const [isSuccess, setIsSuccess] = useState(false);
  const [draftRecovered, setDraftRecovered] = useState(() => {
    try {
      return Boolean(localStorage.getItem(DRAFT_KEY));
    } catch (_) {
      return false;
    }
  });

  // Document states
  const [cedula, setCedula] = useState(() => {
    const initial = {
      tipo_documento: 'V',
      numero_cedula: '',
      nombres: '',
      apellidos: '',
      fecha_nacimiento: '',
      sexo: 'M',
      estado_civil: 'SOLTERO',
      lugar_nacimiento: '',
      esta_vencida: false,
      mensaje_vigencia: '',
      scanned: false,
      file: null,
      previewUrl: '',
      imageBase64: '',
    };
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.cedula) {
          return {
            ...initial,
            ...d.cedula,
            file: null,
            previewUrl: d.cedula.imageBase64 || d.cedula.previewUrl || '',
          };
        }
      }
    } catch (_) {}
    return initial;
  });

  const [rif, setRif] = useState(() => {
    const initial = {
      numero_rif: '',
      razon_social: '',
      domicilio_fiscal: '',
      estado: COMMUNITY_CONFIG.state || 'Distrito Capital',
      municipio: COMMUNITY_CONFIG.municipality || 'Municipio Bolivariano Libertador',
      parroquia: COMMUNITY_CONFIG.parish || 'San Agustín',
      ciudad: 'Caracas',
      codigo_postal: COMMUNITY_CONFIG.postalCode || '1010',
      numero_casa: '',
      esta_vencido: false,
      mensaje_vigencia: '',
      scanned: false,
      file: null,
      previewUrl: '',
      imageBase64: '',
    };
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.rif) {
          return {
            ...initial,
            ...d.rif,
            estado: d.rif.estado || COMMUNITY_CONFIG.state || 'Distrito Capital',
            municipio: d.rif.municipio || COMMUNITY_CONFIG.municipality || 'Municipio Bolivariano Libertador',
            parroquia: d.rif.parroquia || COMMUNITY_CONFIG.parish || 'San Agustín',
            ciudad: d.rif.ciudad || 'Caracas',
            file: null,
            previewUrl: d.rif.imageBase64 || d.rif.previewUrl || '',
          };
        }
      }
    } catch (_) {}
    return initial;
  });

  // Social & Community census state
  const [social, setSocial] = useState(() => {
    const initial = {
      zoneId: '',
      zoneCode: 'SAC',
      houseNumber: '',
      houseSuffix: '',
      dwellingAddress: '',
      phone: '',
      housingTenure: 'propia',
      // Rol en el hogar
      isHouseholdHead: true,
      relationship: 'Jefe(a) de Hogar',
      // Gas doméstico
      gasCylindersCount: '1',
      gasCylinderSize: '10kg',
      gasValveType: 'pico_rapido',
      gasProvider: 'Gas Caracas',
      cookingAppliance: 'gas_exclusivo',
      // Salud y Casos Especiales
      conditionAffection: 'ninguna',
      affectionDetail: '',
      chronicDiseases: '',
      regularMedications: '',
      isPregnantOrLactating: 'no',
      elderlyCount: '0',
      // Cónyuge o Pareja
      hasSpouse: false,
      spouse: {
        firstName: '',
        lastName: '',
        nationality: 'V',
        idNumber: '',
        phone: '',
        sex: 'F',
        birthDate: '',
      },
      // Carga Familiar
      childrenCount: 0,
      children: [],
      // Registro Electoral (CNE)
      cneStatus: 'registered',
      votingCenterName: '',
      // Infraestructura y Oficios
      waterTankCapacity: 'ninguno',
      communityTrade: '',
      petsCount: '0',
    };
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.social) {
          const loadedChildren = Array.isArray(d.social.children)
            ? d.social.children.map((c) => ({
                firstName: c.firstName || '',
                lastName: c.lastName || '',
                fullName: c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
                nationality: c.nationality || 'V',
                idNumber: c.idNumber || '',
                hasNoId: Boolean(c.hasNoId),
                birthDate: c.birthDate || '',
                age: c.age !== undefined && c.age !== null ? String(c.age) : '',
                sex: c.sex || 'M',
                relationship: c.relationship || (c.sex === 'F' ? 'Hija' : 'Hijo'),
              }))
            : [];
          const isHouseholdHead = d.social.isHouseholdHead !== undefined
            ? Boolean(d.social.isHouseholdHead)
            : (d.social.relationship ? d.social.relationship === 'Jefe(a) de Hogar' : true);
          const spouseData = d.social.spouse || {
            firstName: d.social.spouseFirstName || '',
            lastName: d.social.spouseLastName || '',
            nationality: d.social.spouseNationality || 'V',
            idNumber: d.social.spouseIdNumber || '',
            phone: d.social.spousePhone || '',
            sex: d.social.spouseSex || 'F',
            birthDate: d.social.spouseBirthDate || '',
          };
          const hasSpouse = Boolean(d.social.hasSpouse || spouseData.idNumber || spouseData.firstName);
          return {
            ...initial,
            ...d.social,
            hasSpouse,
            spouse: spouseData,
            cneStatus: d.social.cneStatus || 'registered',
            votingCenterName: d.social.votingCenterName || '',
            isHouseholdHead,
            relationship: d.social.relationship || (isHouseholdHead ? 'Jefe(a) de Hogar' : 'Hijo/a'),
            childrenCount: parseInt(d.social.childrenCount || loadedChildren.length || 0, 10),
            children: loadedChildren,
          };
        }
      }
    } catch (_) {}
    return initial;
  });

  // Auto-Match Household Detection State (Opción B)
  const [matchedHousehold, setMatchedHousehold] = useState(null);
  const [isCheckingMatch, setIsCheckingMatch] = useState(false);
  const [matchDismissed, setMatchDismissed] = useState(false);
  const [isConfirmingMatch, setIsConfirmingMatch] = useState(false);
  const [confirmMatchError, setConfirmMatchError] = useState('');
  const [matchPersonalData, setMatchPersonalData] = useState({
    phone: '',
    rifNumber: '',
    votingCenterName: '',
    communityTrade: '',
    conditionAffection: 'ninguna',
    chronicDiseases: '',
  });

  useEffect(() => {
    if (matchedHousehold?.resident) {
      const res = matchedHousehold.resident;
      setMatchPersonalData({
        phone: res.phone || '',
        rifNumber: res.rifNumber || res.sourceValues?.rifNumber || '',
        votingCenterName: res.votingCenterName || res.electoralProfile?.votingCenterName || res.sourceValues?.votingCenterName || '',
        communityTrade: res.communityTrade || res.sourceValues?.communityTrade || '',
        conditionAffection: res.conditionAffection || res.sourceValues?.conditionAffection || 'ninguna',
        chronicDiseases: res.chronicDiseases || res.sourceValues?.chronicDiseases || '',
      });
    }
  }, [matchedHousehold]);

  // Scanning / Camera UI state
  const [isScanning, setIsScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState(null); // 'cedula' or 'rif'
  const [scanError, setScanError] = useState('');
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const camInputRef = useRef(null);
  const scanTargetRef = useRef('cedula');

  // Load community zones
  useEffect(() => {
    let active = true;
    getConsolidatedZones('URP-001')
      .then((items) => {
        if (!active || !items?.length) return;
        setZones(items);
        setSocial((s) => ({ ...s, zoneId: s.zoneId || items[0]?.id || '', zoneCode: s.zoneCode || items[0]?.code || 'SAC' }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Persist form draft in localStorage (debounced, excluding heavy image Base64 to prevent thread blocking)
  useEffect(() => {
    if (isSuccess) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (_) {}
      return;
    }
    const timer = setTimeout(() => {
      try {
        const { file: _cf, imageBase64: _cib, previewUrl: _cpu, ...cedulaClean } = cedula;
        const { file: _rf, imageBase64: _rib, previewUrl: _rpu, ...rifClean } = rif;
        const draft = {
          step,
          cedula: cedulaClean,
          rif: rifClean,
          social,
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch (_) {}
    }, 400);

    return () => clearTimeout(timer);
  }, [step, cedula, rif, social, isSuccess]);

  const handleResetForm = () => {
    if (window.confirm('¿Deseas reiniciar el formulario y borrar los datos guardados en este dispositivo?')) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (_) {}
      window.location.reload();
    }
  };

  // Auto-Match Household Lookup Effect (Opción B)
  useEffect(() => {
    const rawId = String(cedula.numero_cedula || '').replace(/\D/g, '');
    if (!rawId || rawId.length < 5 || matchDismissed) {
      if (!rawId) setMatchedHousehold(null);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setIsCheckingMatch(true);
      try {
        const res = await checkCedulaMatch({
          idNumber: rawId,
          nationality: cedula.tipo_documento || 'V',
          communityCode: 'URP-001',
        });
        if (active && res?.matched) {
          setMatchedHousehold(res);
          // Pre-populate Cédula names and metadata if empty
          setCedula((prev) => ({
            ...prev,
            nombres: prev.nombres || res.resident.firstName || '',
            apellidos: prev.apellidos || res.resident.lastName || '',
            fecha_nacimiento: prev.fecha_nacimiento || res.resident.birthDate || '',
            sexo: prev.sexo || res.resident.sex || prev.sexo,
          }));
        } else if (active) {
          setMatchedHousehold(null);
        }
      } catch (_) {
        if (active) setMatchedHousehold(null);
      } finally {
        if (active) setIsCheckingMatch(false);
      }
    }, 450);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cedula.numero_cedula, cedula.tipo_documento, matchDismissed]);

  const handleConfirmHouseholdMatch = async () => {
    if (!matchedHousehold?.resident?.id || !matchedHousehold?.household?.id) return;

    setIsConfirmingMatch(true);
    setConfirmMatchError('');

    if (!user) {
      setConfirmMatchError('Debes iniciar sesión con tu correo (Gmail, Hotmail, etc.) o Google para vincular tu cuenta a esta vivienda.');
      setIsConfirmingMatch(false);
      return;
    }

    try {
      await confirmHouseholdMatch({
        residentId: matchedHousehold.resident.id,
        householdId: matchedHousehold.household.id,
        communityCode: 'URP-001',
        ...matchPersonalData,
      });
      setIsSuccess(true);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (_) {}
      try {
        await retryMemberships();
      } catch (_) {}
    } catch (err) {
      const isAuthErr = Boolean(
        err?.status === 401 ||
        String(err?.message || '').toLowerCase().includes('sesión') ||
        String(err?.message || '').toLowerCase().includes('inicia sesión') ||
        String(err?.message || '').toLowerCase().includes('venció') ||
        String(err?.message || '').toLowerCase().includes('expir')
      );

      if (isAuthErr) {
        signOut();
        setConfirmMatchError('La sesión anterior venció. Inicia sesión con tu correo (Gmail, Hotmail, etc.) o Google para continuar.');
      } else {
        setConfirmMatchError(err.message || 'Error al vincular el hogar. Intenta nuevamente.');
      }
    } finally {
      setIsConfirmingMatch(false);
    }
  };

  // Historical Census Lookup State & Action (Lupita)
  const [lookupLoading, setLookupLoading] = useState({ titular: false, spouse: false, child: {} });
  const [lookupFeedback, setLookupFeedback] = useState({ titular: null, spouse: null, child: {} });

  const handleLookupCedula = async (target, childIndex = null) => {
    let rawId = '';
    let nationality = 'V';

    if (target === 'spouse') {
      rawId = String(social.spouse?.idNumber || '').replace(/\D/g, '');
      nationality = social.spouse?.nationality || 'V';
    } else if (target === 'titular') {
      rawId = String(cedula.numero_cedula || '').replace(/\D/g, '');
      nationality = cedula.tipo_documento || 'V';
    } else if (target === 'child' && childIndex !== null) {
      const child = social.children?.[childIndex];
      rawId = String(child?.idNumber || '').replace(/\D/g, '');
      nationality = child?.nationality || 'V';
    }

    if (!rawId || rawId.length < 4) {
      const errorMsg = 'Ingresa al menos 4 dígitos para buscar en el censo.';
      if (target === 'child') {
        setLookupFeedback((prev) => ({ ...prev, child: { ...prev.child, [childIndex]: { error: errorMsg } } }));
      } else {
        setLookupFeedback((prev) => ({ ...prev, [target]: { error: errorMsg } }));
      }
      return;
    }

    if (target === 'child') {
      setLookupLoading((prev) => ({ ...prev, child: { ...prev.child, [childIndex]: true } }));
      setLookupFeedback((prev) => ({ ...prev, child: { ...prev.child, [childIndex]: null } }));
    } else {
      setLookupLoading((prev) => ({ ...prev, [target]: true }));
      setLookupFeedback((prev) => ({ ...prev, [target]: null }));
    }

    try {
      const res = await lookupHistoricalCensus({ idNumber: rawId, nationality, communityCode: 'URP-001' });
      if (res.found && res.data) {
        const d = res.data;
        if (target === 'spouse') {
          setSocial((prev) => ({
            ...prev,
            hasSpouse: true,
            spouse: {
              ...(prev.spouse || {}),
              firstName: formatPersonName(d.firstName) || prev.spouse?.firstName || '',
              lastName: formatPersonName(d.lastName) || prev.spouse?.lastName || '',
              phone: d.phone || prev.spouse?.phone || '',
              sex: d.sex || prev.spouse?.sex || 'F',
              birthDate: d.birthDate || prev.spouse?.birthDate || '',
              nationality: d.nationality || nationality,
              idNumber: d.idNumberNormalized || rawId,
            },
          }));
          setLookupFeedback((prev) => ({
            ...prev,
            spouse: { success: `Datos cargados: ${d.firstName} ${d.lastName}` },
          }));
        } else if (target === 'titular') {
          setCedula((prev) => ({
            ...prev,
            nombres: formatPersonName(d.firstName) || prev.nombres,
            apellidos: formatPersonName(d.lastName) || prev.apellidos,
            nombre_completo: `${formatPersonName(d.firstName)} ${formatPersonName(d.lastName)}`.trim(),
            fecha_nacimiento: d.birthDate || prev.fecha_nacimiento,
            sexo: d.sex || prev.sexo,
            numero_cedula: d.idNumberNormalized || rawId,
            tipo_documento: d.nationality || nationality,
          }));
          if (d.phone) {
            setSocial((prev) => ({ ...prev, phone: prev.phone || d.phone }));
          }
          if (d.dwellingAddress) {
            setSocial((prev) => ({ ...prev, dwellingAddress: prev.dwellingAddress || d.dwellingAddress }));
          }
          setLookupFeedback((prev) => ({
            ...prev,
            titular: { success: `Datos cargados: ${d.firstName} ${d.lastName}` },
          }));
        } else if (target === 'child' && childIndex !== null) {
          let calculatedAge = '';
          if (d.birthDate) {
            const parts = d.birthDate.split('-');
            if (parts.length === 3) {
              const bYear = parseInt(parts[0], 10);
              const bMonth = parseInt(parts[1], 10) - 1;
              const bDay = parseInt(parts[2], 10);
              const now = new Date();
              let calc = now.getFullYear() - bYear;
              if (now.getMonth() < bMonth || (now.getMonth() === bMonth && now.getDate() < bDay)) {
                calc -= 1;
              }
              calculatedAge = String(Math.max(0, calc));
            }
          }

          setSocial((prev) => {
            const nextChildren = [...(prev.children || [])];
            if (nextChildren[childIndex]) {
              nextChildren[childIndex] = {
                ...nextChildren[childIndex],
                firstName: formatPersonName(d.firstName) || nextChildren[childIndex].firstName,
                lastName: formatPersonName(d.lastName) || nextChildren[childIndex].lastName,
                fullName: `${formatPersonName(d.firstName)} ${formatPersonName(d.lastName)}`.trim(),
                sex: d.sex || nextChildren[childIndex].sex,
                relationship: d.sex === 'F' ? 'Hija' : 'Hijo',
                birthDate: d.birthDate || nextChildren[childIndex].birthDate,
                age: calculatedAge || nextChildren[childIndex].age,
                idNumber: d.idNumberNormalized || rawId,
                nationality: d.nationality || nationality,
                hasNoId: false,
              };
            }
            return { ...prev, children: nextChildren };
          });
          setLookupFeedback((prev) => ({
            ...prev,
            child: {
              ...prev.child,
              [childIndex]: { success: `Datos cargados: ${d.firstName} ${d.lastName}` },
            },
          }));
        }
      } else {
        const notFoundMsg = 'Cédula no encontrada en el histórico del censo. Puedes ingresar los datos manualmente.';
        if (target === 'child') {
          setLookupFeedback((prev) => ({ ...prev, child: { ...prev.child, [childIndex]: { error: notFoundMsg } } }));
        } else {
          setLookupFeedback((prev) => ({ ...prev, [target]: { error: notFoundMsg } }));
        }
      }
    } catch (err) {
      const errText = err.message || 'Error al consultar el censo.';
      if (target === 'child') {
        setLookupFeedback((prev) => ({ ...prev, child: { ...prev.child, [childIndex]: { error: errText } } }));
      } else {
        setLookupFeedback((prev) => ({ ...prev, [target]: { error: errText } }));
      }
    } finally {
      if (target === 'child') {
        setLookupLoading((prev) => ({ ...prev, child: { ...prev.child, [childIndex]: false } }));
      } else {
        setLookupLoading((prev) => ({ ...prev, [target]: false }));
      }
    }
  };

  const [diseaseInput, setDiseaseInput] = useState('');
  const diseasesList = useMemo(() => {
    return String(social.chronicDiseases || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [social.chronicDiseases]);

  const handleAddDisease = (name) => {
    const val = String(name || diseaseInput).trim();
    if (!val) return;
    const current = diseasesList;
    if (!current.some((d) => d.toLowerCase() === val.toLowerCase())) {
      const next = [...current, val].join(', ');
      setSocial((prev) => ({ ...prev, chronicDiseases: next }));
    }
    setDiseaseInput('');
  };

  const handleRemoveDisease = (idx) => {
    const next = diseasesList.filter((_, i) => i !== idx).join(', ');
    setSocial((prev) => ({ ...prev, chronicDiseases: next }));
  };

  // Update children list when childrenCount changes
  const handleChildrenCountChange = (count) => {
    const n = Math.max(0, Math.min(20, parseInt(count || '0', 10)));
    setSocial((prev) => {
      const nextChildren = [...(prev.children || [])];
      if (nextChildren.length < n) {
        for (let i = nextChildren.length; i < n; i += 1) {
          nextChildren.push({
            firstName: '',
            lastName: '',
            fullName: '',
            nationality: 'V',
            idNumber: '',
            hasNoId: false,
            birthDate: '',
            age: '',
            sex: 'M',
            relationship: 'Hijo',
          });
        }
      } else if (nextChildren.length > n) {
        nextChildren.splice(n);
      }
      return { ...prev, childrenCount: n, children: nextChildren };
    });
  };

  const updateChild = (index, field, value) => {
    setSocial((prev) => {
      const updated = [...(prev.children || [])];
      const current = { ...(updated[index] || {}) };

      if (field === 'firstName' || field === 'lastName') {
        current[field] = formatPersonName(value);
        current.fullName = `${current.firstName || ''} ${current.lastName || ''}`.trim();
      } else if (field === 'fullName') {
        current.fullName = value;
        const parts = String(value || '').trim().split(/\s+/);
        current.firstName = parts[0] || '';
        current.lastName = parts.slice(1).join(' ') || '';
      } else if (field === 'birthDate') {
        current.birthDate = value;
        if (value) {
          const bDate = new Date(value);
          if (!Number.isNaN(bDate.getTime())) {
            const now = new Date();
            let calcAge = now.getFullYear() - bDate.getFullYear();
            if (now.getMonth() < bDate.getMonth() || (now.getMonth() === bDate.getMonth() && now.getDate() < bDate.getDate())) {
              calcAge -= 1;
            }
            if (calcAge >= 0) {
              current.age = String(calcAge);
            }
          }
        }
      } else if (field === 'age') {
        current.age = value;
        const numAge = parseInt(value, 10);
        if (!current.birthDate && !Number.isNaN(numAge) && numAge >= 0 && numAge <= 35) {
          const birthYear = new Date().getFullYear() - numAge;
          current.birthDate = `${birthYear}-01-01`;
        }
      } else if (field === 'sex') {
        current.sex = value;
        if (value === 'F' && (!current.relationship || current.relationship === 'Hijo')) {
          current.relationship = 'Hija';
        } else if (value === 'M' && (!current.relationship || current.relationship === 'Hija')) {
          current.relationship = 'Hijo';
        }
      } else if (field === 'hasNoId') {
        current.hasNoId = Boolean(value);
        if (value) {
          current.idNumber = '';
        }
      } else if (field === 'idNumber') {
        current.idNumber = String(value || '').replace(/\D/g, '');
        if (current.idNumber) {
          current.hasNoId = false;
        }
      } else {
        current[field] = value;
      }

      updated[index] = current;
      return { ...prev, children: updated };
    });
  };

  // Camera Management
  const startCamera = async (mode = facingMode) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setCameraModalOpen(false);
      // Fallback to native mobile file input
      camInputRef.current?.click();
    }
  };

  const openCamera = (target = step === 2 ? 'rif' : 'cedula') => {
    scanTargetRef.current = target;
    setScanTarget(target);
    setScanError('');
    const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);
    if (isMobile) {
      camInputRef.current?.click();
      return;
    }
    if (navigator.mediaDevices?.getUserMedia) {
      setCameraModalOpen(true);
      startCamera(facingMode);
    } else {
      camInputRef.current?.click();
    }
  };

  const closeCamera = () => {
    setCameraModalOpen(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const switchCamera = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    closeCamera();
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const target = scanTargetRef.current || (step === 2 ? 'rif' : 'cedula');
      const file = new File([blob], `${target}_captura_${Date.now()}.jpg`, { type: 'image/jpeg' });
      handleProcessFile(file, target);
    }, 'image/jpeg', 0.9);
  };

  const handleProcessFile = async (file, explicitTarget) => {
    if (!file) return;
    const target = explicitTarget || scanTargetRef.current || (step === 2 ? 'rif' : 'cedula');
    scanTargetRef.current = target;
    setScanTarget(target);
    setIsScanning(true);
    setScanError('');
    try {
      const compressed = await compressImageFile(file);
      const preview = URL.createObjectURL(compressed);
      const base64 = await fileToBase64(compressed);

      if (target === 'rif') {
        const data = await scanRifDocument(compressed);
        if (data?.isCedulaDocument) {
          setCedula((prev) => ({
            ...prev,
            ...data,
            scanned: true,
            file: compressed,
            imageBase64: base64,
            previewUrl: preview,
          }));
          setScanError('Se identificó una Cédula de Identidad. Por favor, sube el Comprobante RIF del SENIAT para este paso.');
          return;
        }

        const extractedHouse = data?.numero_casa || extractHouseNumber(data?.domicilio_fiscal)?.houseNumber || '';

        setRif((prev) => ({
          ...prev,
          ...data,
          estado: data?.estado || prev.estado || COMMUNITY_CONFIG.state || 'Distrito Capital',
          municipio: data?.municipio || prev.municipio || COMMUNITY_CONFIG.municipality || 'Municipio Bolivariano Libertador',
          parroquia: data?.parroquia || prev.parroquia || COMMUNITY_CONFIG.parish || 'San Agustín',
          ciudad: data?.ciudad || prev.ciudad || 'Caracas',
          codigo_postal: data?.codigo_postal || prev.codigo_postal || COMMUNITY_CONFIG.postalCode || '1010',
          numero_casa: extractedHouse || prev.numero_casa || '',
          scanned: true,
          file: compressed,
          imageBase64: base64,
          previewUrl: preview,
        }));

        if (extractedHouse || data?.domicilio_fiscal) {
          setSocial((prev) => ({
            ...prev,
            houseNumber: prev.houseNumber || extractedHouse,
            dwellingAddress: prev.dwellingAddress || data?.domicilio_fiscal || '',
          }));
        }

        // Backfill cédula if empty and available from RIF
        if (data?.numero_cedula_asociada && !cedula.numero_cedula) {
          setCedula((prev) => ({
            ...prev,
            tipo_documento: 'V',
            numero_cedula: data.numero_cedula_asociada,
            nombres: data.nombres || prev.nombres,
            apellidos: data.apellidos || prev.apellidos,
            nombre_completo: data.razon_social || prev.nombre_completo,
            scanned: true,
          }));
        }
      } else {
        const data = await scanCedulaDocument(compressed);
        if (data?.isRifDocument) {
          const extractedHouse = data?.numero_casa || extractHouseNumber(data?.domicilio_fiscal)?.houseNumber || '';

          setRif((prev) => ({
            ...prev,
            ...data,
            estado: data?.estado || prev.estado || COMMUNITY_CONFIG.state || 'Distrito Capital',
            municipio: data?.municipio || prev.municipio || COMMUNITY_CONFIG.municipality || 'Municipio Bolivariano Libertador',
            parroquia: data?.parroquia || prev.parroquia || COMMUNITY_CONFIG.parish || 'San Agustín',
            ciudad: data?.ciudad || prev.ciudad || 'Caracas',
            codigo_postal: data?.codigo_postal || prev.codigo_postal || COMMUNITY_CONFIG.postalCode || '1010',
            numero_casa: extractedHouse || prev.numero_casa || '',
            scanned: true,
            file: compressed,
            imageBase64: base64,
            previewUrl: preview,
          }));

          if (extractedHouse || data?.domicilio_fiscal) {
            setSocial((prev) => ({
              ...prev,
              houseNumber: prev.houseNumber || extractedHouse,
              dwellingAddress: prev.dwellingAddress || data?.domicilio_fiscal || '',
            }));
          }

          const numCedula = data.numero_cedula_asociada || data.numero_cedula || '';
          setCedula((prev) => ({
            ...prev,
            tipo_documento: 'V',
            numero_cedula: numCedula || prev.numero_cedula,
            nombres: data.nombres || prev.nombres,
            apellidos: data.apellidos || prev.apellidos,
            nombre_completo: data.razon_social || prev.nombre_completo,
            scanned: true,
            file: compressed,
            imageBase64: base64,
            previewUrl: preview,
          }));
          return;
        }

        setCedula((prev) => ({
          ...prev,
          ...data,
          scanned: true,
          file: compressed,
          imageBase64: base64,
          previewUrl: preview,
        }));
      }
    } catch (err) {
      console.warn('Scan failed:', err);
      const isTechnical = err?.message && (err.message.includes('HTTP') || err.message.includes('{') || err.message.includes('status') || err.message.includes('code') || err.message.includes('motor de visión'));
      const friendlyMsg = isTechnical || !err?.message
        ? 'No se pudo leer el documento automáticamente. Puedes enfocar mejor la foto o ingresar los datos manualmente a continuación.'
        : err.message;
      setScanError(friendlyMsg);
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (camInputRef.current) camInputRef.current.value = '';
    }
  };

  const handleZoneChange = (zoneId) => {
    const found = zones.find((z) => z.id === zoneId);
    setSocial((s) => ({
      ...s,
      zoneId,
      zoneCode: found ? found.code : s.zoneCode,
    }));
  };

  // Submit complete census registration
  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError('');

    try {
      // Ensure image base64 is generated if file is present
      let cedulaB64 = cedula.imageBase64;
      if (!cedulaB64 && cedula.file) {
        cedulaB64 = await fileToBase64(cedula.file).catch(() => null);
      }
      let rifB64 = rif.imageBase64;
      if (!rifB64 && rif.file) {
        rifB64 = await fileToBase64(rif.file).catch(() => null);
      }

      const payload = {
        communityCode: 'URP-001',
        email: user?.email || '',
        cedula: { ...cedula, imageBase64: cedulaB64 },
        rif: { ...rif, imageBase64: rifB64 },
        social,
      };
      await submitResidentRegistration(payload);
      setIsSuccess(true);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (_) {}
      try {
        await retryMemberships();
      } catch (_) {}
    } catch (err) {
      const raw = String(err?.message || '');
      const isNet = raw.includes('fetch failed') || raw.includes('Failed to fetch') || raw.includes('NetworkError');
      const userMessage = isNet
        ? 'Error temporal de conexión. Tu información está a salvo; por favor pulsa nuevamente el botón para completar tu registro.'
        : (raw || 'No se pudo completar el registro. Intenta de nuevo.');
      setSubmitError(userMessage);
      setSubmitting(false);
    }
  };

  const canGoToStep2 = Boolean(cedula.numero_cedula && (cedula.nombres || cedula.apellidos));
  const canGoToStep3 = Boolean(canGoToStep2 && rif.numero_rif);
  const childrenValid = !social.childrenCount || (Array.isArray(social.children) && social.children.length >= social.childrenCount && social.children.slice(0, social.childrenCount).every((c) => {
    const hasName = Boolean(c.firstName?.trim() || c.fullName?.trim());
    const hasAge = c.age !== '' && c.age !== undefined && c.age !== null;
    const hasId = Boolean(c.hasNoId) || Boolean(String(c.idNumber || '').trim());
    return hasName && hasAge && hasId;
  }));
  const relationshipValid = social.isHouseholdHead || Boolean(social.relationship?.trim());
  const spouseValid = !social.hasSpouse || Boolean(
    social.spouse?.firstName?.trim() || social.spouse?.idNumber?.trim()
  );
  const canSubmit = Boolean(canGoToStep3 && social.zoneId && social.houseNumber.trim() && social.phone.trim() && childrenValid && relationshipValid && spouseValid);

  if (isSuccess) {
    return (
      <div className="reg-page">
        <header className="reg-header">
          <div className="reg-header-brand">
            <Brand />
            <span style={{ color: '#94A3B8' }}>|</span>
            <span className="reg-header-title">
              REGISTRO COMUNAL {COMMUNITY_CONFIG.name.toUpperCase()}
            </span>
          </div>
          {user && (
            <button type="button" className="text-button" onClick={signOut}>
              Cerrar sesión
            </button>
          )}
        </header>

        <main className="reg-container">
          <div className="reg-card" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#DCFCE7', color: '#166534', fontSize: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem', fontWeight: 900 }}>
              OK
            </div>
            <StatusBadge tone="success">Ficha Verificada y Activada</StatusBadge>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0F172A', margin: '0.75rem 0 0.5rem' }}>
              Registro Completado con Éxito
            </h1>
            <p style={{ color: '#475569', fontSize: '0.9rem', maxWidth: '480px', margin: '0 auto 1.5rem' }}>
              Tu ficha censal comunitaria y validación de identidad han sido registradas en el sistema de la {COMMUNITY_CONFIG.name}.
            </p>

            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem', maxWidth: '480px', margin: '0 auto 1.5rem', textAlign: 'left', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid #E2E8F0' }}>
                <span style={{ color: '#64748B' }}>Residente:</span>
                <strong style={{ color: '#0F172A' }}>{cedula.nombres} {cedula.apellidos}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #E2E8F0' }}>
                <span style={{ color: '#64748B' }}>Documento:</span>
                <strong style={{ color: '#0F172A' }}>{cedula.tipo_documento}-{cedula.numero_cedula} · RIF {rif.numero_rif}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #E2E8F0' }}>
                <span style={{ color: '#64748B' }}>Ubicación:</span>
                <strong style={{ color: '#0F172A' }}>Zona {social.zoneCode} · Casa {social.houseNumber}</strong>
              </div>
              {social.cneStatus !== 'not_registered' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #E2E8F0' }}>
                  <span style={{ color: '#64748B' }}>Centro de Votación:</span>
                  <strong style={{ color: '#0F172A' }}>{social.votingCenterName || 'Inscrito en CNE'}</strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem' }}>
                <span style={{ color: '#64748B' }}>Estado del Acceso:</span>
                <strong style={{ color: '#166534' }}>Activo Inmediato</strong>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '480px', margin: '0 auto' }}>
              <button
                type="button"
                className="primary-button full"
                style={{ background: '#10B981', color: '#FFFFFF', fontWeight: 900, padding: '0.85rem', fontSize: '1rem' }}
                onClick={async () => {
                  await retryMemberships();
                  if (typeof onCompleted === 'function') {
                    onCompleted();
                  } else {
                    window.location.href = '/app';
                  }
                }}
              >
                Entrar al Portal Vecinal →
              </button>
              <a
                href="/fondo"
                className="secondary-button full"
                style={{ textDecoration: 'none', textAlign: 'center', padding: '0.75rem', fontSize: '0.9rem' }}
              >
                Consultar Fondo Comunal de Inversión
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="reg-page">
      <header className="reg-header">
        <div className="reg-header-brand">
          <Brand />
          <span style={{ color: '#94A3B8' }}>|</span>
          <span className="reg-header-title">
            REGISTRO COMUNAL {COMMUNITY_CONFIG.name.toUpperCase()}
          </span>
        </div>
        <button type="button" className="text-button" onClick={signOut}>
          Cerrar sesión
        </button>
      </header>

      <main className="reg-container">
        <div className="reg-card">
          
          {/* Top User Session Pill */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#F1F5F9', borderRadius: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: user ? '#10B981' : '#F59E0B' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                {user ? 'Cuenta conectada:' : 'Cuenta:'}
              </span>
              {user ? (
                <strong style={{ fontSize: '0.85rem', color: '#0F172A' }}>
                  {user.email}
                </strong>
              ) : (
                <a
                  href="/login"
                  style={{ background: '#0F172A', color: '#FFFFFF', border: 'none', borderRadius: '0.5rem', padding: '0.25rem 0.65rem', fontSize: '0.75rem', fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}
                >
                  Conectar cuenta
                </a>
              )}
            </div>
            <StatusBadge tone="success">Paso {step} de 4</StatusBadge>
          </div>

          {draftRecovered && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 1rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '0.75rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#1E40AF' }}>
              <span>Borrador guardado localmente. Puedes continuar tu registro.</span>
              <button
                type="button"
                onClick={handleResetForm}
                style={{ background: 'transparent', border: 'none', color: '#DC2626', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontSize: '0.75rem', padding: 0 }}
              >
                Reiniciar formulario
              </button>
            </div>
          )}

          <p className="eyebrow" style={{ color: '#FF9F1C', fontWeight: 800, letterSpacing: '0.05em' }}>
            CENSO VECINAL OFICIAL PN-SUNAVAL
          </p>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0F172A', marginTop: '0.25rem' }}>
            {step === 1 && 'Paso 1: Validación de Cédula de Identidad'}
            {step === 2 && 'Paso 2: Validación de Comprobante RIF SENIAT'}
            {step === 3 && 'Paso 3: Censo Comunitario y Carga Familiar'}
            {step === 4 && 'Paso 4: Confirmación y Activación Inmediata'}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#64748B', marginBottom: '1.5rem' }}>
            {step === 1 && 'Escanea o fotografía el frente de tu cédula. Nuestro lector óptico extraerá tus datos automáticamente.'}
            {step === 2 && 'Adjunta o fotografía tu comprobante RIF del SENIAT para validar tu domicilio fiscal.'}
            {step === 3 && `Indica tu consejo comunal en la ${COMMUNITY_CONFIG.name}, condición de afectación y los datos de tus hijos.`}
            {step === 4 && 'Revisa el resumen fiduciario de tu ficha antes de activar tu acceso vecinal.'}
          </p>

          {/* Stepper Navigation Pills */}
          <div className="reg-stepper">
            {[
              { num: 1, label: 'Cédula', done: canGoToStep2 },
              { num: 2, label: 'RIF SENIAT', done: canGoToStep3 },
              { num: 3, label: 'Censo Familiar', done: Boolean(social.zoneId && social.houseNumber.trim() && social.phone.trim()) },
              { num: 4, label: 'Activación', done: false },
            ].map((s) => (
              <button
                key={s.num}
                type="button"
                className="reg-step-btn"
                onClick={() => {
                  if (s.num === 1 || (s.num === 2 && canGoToStep2) || (s.num === 3 && canGoToStep3) || (s.num === 4 && canSubmit)) {
                    setStep(s.num);
                  }
                }}
                style={{
                  border: step === s.num ? '2px solid #FF9F1C' : '1px solid #CBD5E1',
                  background: step === s.num ? '#FFFBEB' : s.done ? '#F0FDF4' : '#FFFFFF',
                  color: step === s.num ? '#92400E' : s.done ? '#166534' : '#64748B',
                }}
              >
                {s.done ? '[OK] ' : ''}{s.num}. {s.label}
              </button>
            ))}
          </div>

          {/* Hidden file inputs for mobile & gallery triggers */}
          <input
            type="file"
            ref={camInputRef}
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onClick={(e) => { e.target.value = null; }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleProcessFile(file, scanTargetRef.current || (step === 2 ? 'rif' : 'cedula'));
              e.target.value = '';
            }}
          />
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*,.pdf"
            style={{ display: 'none' }}
            onClick={(e) => { e.target.value = null; }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleProcessFile(file, scanTargetRef.current || (step === 2 ? 'rif' : 'cedula'));
              e.target.value = '';
            }}
          />

          {/* PASO 1: CÉDULA DE IDENTIDAD */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: '1.25rem', padding: '1.5rem', textAlign: 'center' }}>
                <div style={{ maxWidth: '280px', margin: '0 auto 1rem', padding: '1rem', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', fontWeight: 800, color: '#64748B', borderBottom: '1px solid #E2E8F0', paddingBottom: '0.4rem' }}>
                    <span>REPÚBLICA BOLIVARIANA DE VENEZUELA</span>
                    <span>CÉDULA</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', margin: '0.75rem 0' }}>
                    <div style={{ width: '48px', height: '60px', background: '#E2E8F0', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: '0.7rem' }}>
                      FOTO
                    </div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ height: '6px', background: '#E2E8F0', borderRadius: '4px', width: '90%', marginBottom: '6px' }} />
                      <div style={{ height: '6px', background: '#E2E8F0', borderRadius: '4px', width: '70%', marginBottom: '6px' }} />
                      <div style={{ height: '6px', background: '#E2E8F0', borderRadius: '4px', width: '50%' }} />
                    </div>
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#94A3B8', textAlign: 'right' }}>
                    V &lt; VEN &lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
                  </div>
                </div>

                {isScanning && (
                  <div style={{ padding: '1rem', color: '#D97706', fontWeight: 700, fontSize: '0.9rem' }}>
                    Analizando cédula con lector óptico...
                  </div>
                )}

                {scanError && (
                  <div className="form-error" style={{ marginBottom: '1rem' }} role="alert">
                    <strong>Aviso de lectura:</strong> {scanError}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => openCamera('cedula')}
                    style={{ background: '#FF9F1C', color: '#0F172A', fontWeight: 800 }}
                  >
                    Tomar Foto con Cámara
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      scanTargetRef.current = 'cedula';
                      setScanTarget('cedula');
                      fileInputRef.current?.click();
                    }}
                  >
                    Subir Imagen o PDF
                  </button>
                </div>
                <small style={{ display: 'block', marginTop: '0.75rem', color: '#94A3B8' }}>
                  Buena iluminación y bordes visibles. Compatible con JPG, PNG y PDF.
                </small>
              </div>

              {/* Tarjeta de Identidad Reconocida en el Censo Comunitario (Auto-Match - Opción B) */}
              {matchedHousehold && !matchDismissed && (
                <div
                  style={{
                    background: 'linear-gradient(180deg, #F0FDF4 0%, #FFFFFF 100%)',
                    border: '2px solid #16A34A',
                    borderRadius: '1.25rem',
                    padding: '1.5rem',
                    boxShadow: '0 4px 14px rgba(22, 163, 74, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#16A34A', color: '#FFFFFF', padding: '0.25rem 0.65rem', borderRadius: '4px', letterSpacing: '0.04em' }}>
                      COINCIDENCIA EN CENSO COMUNAL
                    </span>
                    <StatusBadge tone="success">Identidad Verificada</StatusBadge>
                  </div>

                  <h3 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0F172A', margin: '0.25rem 0 0.5rem' }}>
                    Perteneces al Hogar {matchedHousehold.household.code}
                  </h3>

                  <p style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.5, margin: '0 0 1rem' }}>
                    Tu cédula <strong>{cedula.tipo_documento}-{cedula.numero_cedula}</strong> ({matchedHousehold.resident.firstName} {matchedHousehold.resident.lastName}) ya se encuentra registrada en el censo oficial como <strong>{matchedHousehold.resident.relationship || 'integrante del núcleo familiar'}</strong>.
                  </p>

                  <div style={{ background: '#FFFFFF', border: '1px solid #BBF7D0', borderRadius: '0.75rem', padding: '0.85rem 1rem', fontSize: '0.82rem', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {matchedHousehold.headOfHousehold && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748B' }}>Jefe(a) de Hogar:</span>
                        <strong style={{ color: '#0F172A' }}>{matchedHousehold.headOfHousehold.firstName} {matchedHousehold.headOfHousehold.lastName}</strong>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Ubicación:</span>
                      <strong style={{ color: '#0F172A' }}>{matchedHousehold.household.address || matchedHousehold.household.reference || COMMUNITY_CONFIG.name}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Parentesco en censo:</span>
                      <strong style={{ color: '#166534' }}>{matchedHousehold.resident.relationship || 'Integrante'}</strong>
                    </div>
                  </div>

                  {/* Ficha Individual de Salud, CNE y Contacto */}
                  <div style={{ background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.65rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#0284C7' }}>clinical_notes</span>
                      <strong style={{ fontSize: '0.88rem', color: '#0F172A' }}>Ficha Individual de Salud, CNE y Contacto</strong>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 0.85rem', lineHeight: 1.4 }}>
                      Completa o valida tus datos individuales para asegurar tu atención en jornadas de salud comunitaria, padrón electoral y expediente vecinal.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <Field label="Teléfono de contacto">
                        <input
                          type="tel"
                          value={matchPersonalData.phone}
                          onChange={(e) => setMatchPersonalData((prev) => ({ ...prev, phone: e.target.value }))}
                          placeholder="0412-1234567"
                        />
                      </Field>
                      <Field label="RIF SENIAT (Opcional)">
                        <input
                          type="text"
                          value={matchPersonalData.rifNumber}
                          onChange={(e) => setMatchPersonalData((prev) => ({ ...prev, rifNumber: e.target.value.toUpperCase() }))}
                          placeholder="V-12345678-0"
                          style={{ textTransform: 'uppercase' }}
                        />
                      </Field>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <Field label="Centro de votación (CNE)">
                        <input
                          type="text"
                          value={matchPersonalData.votingCenterName}
                          onChange={(e) => setMatchPersonalData((prev) => ({ ...prev, votingCenterName: e.target.value }))}
                          placeholder="Ej: U.E. Mariano Picón Salas"
                        />
                      </Field>
                      <Field label="Ocupación u Oficio">
                        <input
                          type="text"
                          value={matchPersonalData.communityTrade}
                          onChange={(e) => setMatchPersonalData((prev) => ({ ...prev, communityTrade: e.target.value }))}
                          placeholder="Ej: Educador, Comerciante, Técnico..."
                        />
                      </Field>
                    </div>

                    <div style={{ marginBottom: '0.75rem' }}>
                      <Field label="Condición de salud o discapacidad">
                        <select
                          value={matchPersonalData.conditionAffection || 'ninguna'}
                          onChange={(e) => setMatchPersonalData((prev) => ({ ...prev, conditionAffection: e.target.value }))}
                        >
                          <option value="ninguna">Ninguna condición especial conocida</option>
                          <option value="hipertension">Hipertensión arterial</option>
                          <option value="diabetes">Diabetes</option>
                          <option value="asma">Asma / Afección respiratoria</option>
                          <option value="alergia">Alergias crónicas</option>
                          <option value="discapacidad_motora">Discapacidad motora / movilidad reducida</option>
                          <option value="discapacidad_visual">Discapacidad visual</option>
                          <option value="discapacidad_auditiva">Discapacidad auditiva</option>
                          <option value="neurodivergencia">Neurodivergencia / TEA</option>
                          <option value="cronica">Enfermedad crónica / tratamiento continuo</option>
                          <option value="encamado">Persona encamada / atención prioritaria</option>
                          <option value="otra">Otra condición especial</option>
                        </select>
                      </Field>
                    </div>

                    <Field label="Diagnóstico específico o medicamentos diarios">
                      <input
                        type="text"
                        value={matchPersonalData.chronicDiseases}
                        onChange={(e) => setMatchPersonalData((prev) => ({ ...prev, chronicDiseases: e.target.value }))}
                        placeholder="Ej: Losartán 50mg, Insulina, Inhalador de Salbutamol..."
                      />
                    </Field>
                  </div>

                  <p style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '1rem', fontStyle: 'italic' }}>
                    No requieres volver a escanear RIF ni declarar bombonas de gas. Al confirmar, tu cuenta de Google quedará vinculada directamente al hogar para acceso vecinal inmediato.
                  </p>

                  {confirmMatchError && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div className="form-error" style={{ marginBottom: '0.5rem' }} role="alert">
                        <strong>Aviso:</strong> {confirmMatchError}
                      </div>
                      <a
                        href="/login"
                        style={{
                          display: 'block',
                          textAlign: 'center',
                          width: '100%',
                          padding: '0.75rem',
                          borderRadius: '0.5rem',
                          border: '1px solid #0F172A',
                          background: '#0F172A',
                          color: '#FFFFFF',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          textDecoration: 'none',
                        }}
                      >
                        Iniciar sesion o Crear cuenta comunal →
                      </a>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <button
                      type="button"
                      className="primary-button full"
                      onClick={handleConfirmHouseholdMatch}
                      disabled={isConfirmingMatch}
                      style={{
                        background: '#16A34A',
                        color: '#FFFFFF',
                        fontWeight: 900,
                        padding: '0.9rem',
                        fontSize: '0.95rem',
                      }}
                    >
                      {isConfirmingMatch ? 'Vinculando y guardando ficha...' : 'Confirmar Vinculación y Guardar mi Ficha Personal'}
                    </button>

                    <button
                      type="button"
                      className="secondary-button full"
                      onClick={() => setMatchDismissed(true)}
                      style={{ fontSize: '0.82rem', color: '#64748B' }}
                    >
                      Continuar como Hogar Independiente (Censar nueva vivienda)
                    </button>
                  </div>
                </div>
              )}

              {/* Form fields for Cédula confirmation */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A' }}>
                    Datos del Titular de la Cédula
                  </h3>
                  {cedula.scanned && (
                    <StatusBadge tone="success">{cedula.mensaje_vigencia || 'Verificado'}</StatusBadge>
                  )}
                </div>

                <div className="reg-grid-2-1">
                  <Field label="Nacionalidad" required>
                    <select
                      value={cedula.tipo_documento}
                      onChange={(e) => setCedula({ ...cedula, tipo_documento: e.target.value })}
                    >
                      <option value="V">V - Venezolano</option>
                      <option value="E">E - Extranjero</option>
                    </select>
                  </Field>
                  <Field label="Número de Cédula" required>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Ej: 12345678"
                        value={cedula.numero_cedula}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleLookupCedula('titular');
                          }
                        }}
                        onChange={(e) => {
                          setCedula({ ...cedula, numero_cedula: e.target.value.replace(/\D/g, '') });
                          if (lookupFeedback.titular) setLookupFeedback((prev) => ({ ...prev, titular: null }));
                        }}
                        style={{ flex: 1, minWidth: 0, height: '42px' }}
                      />
                      <button
                        type="button"
                        onClick={() => handleLookupCedula('titular')}
                        disabled={lookupLoading.titular || !cedula.numero_cedula}
                        title="Buscar en base de datos del censo histórico"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                          padding: '0 0.85rem',
                          borderRadius: '0.5rem',
                          border: '1px solid #0284C7',
                          background: '#0284C7',
                          color: '#FFFFFF',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: lookupLoading.titular ? 'wait' : 'pointer',
                          opacity: (!cedula.numero_cedula || lookupLoading.titular) ? 0.65 : 1,
                          whiteSpace: 'nowrap',
                          height: '42px',
                          flexShrink: 0,
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <span>{lookupLoading.titular ? 'Buscando...' : 'Buscar'}</span>
                      </button>
                    </div>
                    {lookupFeedback.titular?.success && (
                      <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '0.35rem 0.6rem', borderRadius: '0.375rem' }}>
                        <strong>{lookupFeedback.titular.success}</strong>
                      </div>
                    )}
                    {lookupFeedback.titular?.error && (
                      <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '0.35rem 0.6rem', borderRadius: '0.375rem' }}>
                        {lookupFeedback.titular.error}
                      </div>
                    )}
                  </Field>
                </div>

                <div className="reg-grid-2" style={{ marginTop: '0.75rem' }}>
                  <Field label="Nombres" required>
                    <input
                      type="text"
                      placeholder="Nombres completos"
                      value={cedula.nombres}
                      onChange={(e) => setCedula({ ...cedula, nombres: formatPersonName(e.target.value) })}
                      style={{ textTransform: 'capitalize' }}
                    />
                  </Field>
                  <Field label="Apellidos" required>
                    <input
                      type="text"
                      placeholder="Apellidos completos"
                      value={cedula.apellidos}
                      onChange={(e) => setCedula({ ...cedula, apellidos: formatPersonName(e.target.value) })}
                      style={{ textTransform: 'capitalize' }}
                    />
                  </Field>
                </div>

                <div className="reg-grid-3" style={{ marginTop: '0.75rem' }}>
                  <Field label="Fecha de Nacimiento">
                    <input
                      type="date"
                      value={cedula.fecha_nacimiento}
                      onChange={(e) => setCedula({ ...cedula, fecha_nacimiento: e.target.value })}
                    />
                  </Field>
                  <Field label="Sexo">
                    <select
                      value={cedula.sexo}
                      onChange={(e) => setCedula({ ...cedula, sexo: e.target.value })}
                    >
                      <option value="M">Masculino</option>
                      <option value="F">Femenino</option>
                    </select>
                  </Field>
                  <Field label="Estado Civil">
                    <select
                      value={cedula.estado_civil}
                      onChange={(e) => setCedula({ ...cedula, estado_civil: e.target.value })}
                    >
                      <option value="SOLTERO">Soltero(a)</option>
                      <option value="CASADO">Casado(a)</option>
                      <option value="DIVORCIADO">Divorciado(a)</option>
                      <option value="VIUDO">Viudo(a)</option>
                    </select>
                  </Field>
                </div>

                <button
                  type="button"
                  className="primary-button full"
                  disabled={!canGoToStep2}
                  onClick={() => setStep(2)}
                  style={{ marginTop: '1.25rem' }}
                >
                  Continuar al Paso 2: Escanear RIF →
                </button>
              </div>
            </div>
          )}

          {/* PASO 2: RIF DEL SENIAT */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: '1.25rem', padding: '1.5rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '1rem' }}>
                  El RIF del SENIAT valida la concordancia de tu domicilio fiscal y tu número de registro tributario.
                </p>

                {isScanning && (
                  <div style={{ padding: '1rem', color: '#D97706', fontWeight: 700, fontSize: '0.9rem' }}>
                    Analizando comprobante RIF SENIAT...
                  </div>
                )}

                {scanError && (
                  <div className="form-error" style={{ marginBottom: '1rem' }} role="alert">
                    <strong>Aviso de lectura:</strong> {scanError}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => openCamera('rif')}
                    style={{ background: '#FF9F1C', color: '#0F172A', fontWeight: 800 }}
                  >
                    Tomar Foto del RIF
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      scanTargetRef.current = 'rif';
                      setScanTarget('rif');
                      fileInputRef.current?.click();
                    }}
                  >
                    Subir Comprobante o PDF
                  </button>
                </div>
              </div>

              {/* Form fields for RIF confirmation */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A' }}>
                    Datos del Comprobante RIF
                  </h3>
                  {rif.scanned && (
                    <StatusBadge tone={rif.esta_vencido ? 'danger' : 'success'}>
                      {rif.mensaje_vigencia || 'Verificado'}
                    </StatusBadge>
                  )}
                </div>

                <div className="reg-grid-2-1">
                  <Field label="Número de RIF" required>
                    <input
                      type="text"
                      placeholder="Ej: V-12345678-0"
                      value={rif.numero_rif}
                      onChange={(e) => setRif({ ...rif, numero_rif: e.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="Razón Social / Titular">
                    <input
                      type="text"
                      placeholder="Nombre tal como aparece en el RIF"
                      value={rif.razon_social}
                      onChange={(e) => setRif({ ...rif, razon_social: e.target.value })}
                    />
                  </Field>
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <Field label="Domicilio Fiscal SENIAT" required>
                    <input
                      type="text"
                      placeholder="Dirección fiscal registrada en el SENIAT"
                      value={rif.domicilio_fiscal}
                      onChange={(e) => {
                        const val = e.target.value;
                        const extracted = extractHouseNumber(val);
                        setRif((prev) => ({
                          ...prev,
                          domicilio_fiscal: val,
                          numero_casa: extracted.houseNumber || prev.numero_casa,
                        }));
                        if (extracted.houseNumber) {
                          setSocial((s) => ({
                            ...s,
                            houseNumber: s.houseNumber || extracted.houseNumber,
                            dwellingAddress: s.dwellingAddress || val,
                          }));
                        }
                      }}
                    />
                  </Field>
                </div>

                <div className="reg-grid-2" style={{ marginTop: '0.75rem' }}>
                  <Field label="Número de Casa (detectado del RIF)">
                    <input
                      type="text"
                      placeholder="Ej: 1006"
                      value={social.houseNumber || rif.numero_casa || ''}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9A-Za-z-]/g, '');
                        setRif((prev) => ({ ...prev, numero_casa: val }));
                        setSocial((prev) => ({ ...prev, houseNumber: val }));
                      }}
                    />
                  </Field>
                  <Field label="Zona Postal / CP">
                    <input
                      type="text"
                      placeholder="Ej: 1073"
                      value={rif.codigo_postal || '1073'}
                      onChange={(e) => setRif({ ...rif, codigo_postal: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="reg-grid-3" style={{ marginTop: '0.75rem' }}>
                  <Field label="Estado">
                    <input
                      type="text"
                      value={rif.estado || COMMUNITY_CONFIG.state || 'Distrito Capital'}
                      onChange={(e) => setRif({ ...rif, estado: e.target.value })}
                    />
                  </Field>
                  <Field label="Municipio">
                    <input
                      type="text"
                      value={rif.municipio || COMMUNITY_CONFIG.municipality || 'Municipio Bolivariano Libertador'}
                      onChange={(e) => setRif({ ...rif, municipio: e.target.value })}
                    />
                  </Field>
                  <Field label="Parroquia">
                    <input
                      type="text"
                      value={rif.parroquia || COMMUNITY_CONFIG.parish || 'San Agustín'}
                      onChange={(e) => setRif({ ...rif, parroquia: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="reg-actions-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setStep(1)}
                  >
                    ← Volver a Cédula
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    style={{ flex: 1 }}
                    disabled={!canGoToStep3}
                    onClick={() => {
                      const houseNum = social.houseNumber || rif.numero_casa || extractHouseNumber(rif.domicilio_fiscal)?.houseNumber || '';
                      setSocial((prev) => ({
                        ...prev,
                        houseNumber: prev.houseNumber || houseNum,
                        dwellingAddress: prev.dwellingAddress || rif.domicilio_fiscal || '',
                      }));
                      setStep(3);
                    }}
                  >
                    Continuar al Paso 3: Censo Comunitario →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PASO 3: CENSO COMUNITARIO Y FAMILIAR */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Teléfono / WhatsApp: Paso Indispensable */}
              <div style={{ background: 'rgba(79, 145, 173, 0.08)', border: '1px solid var(--blue)', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, background: 'var(--blue)', color: '#FFFFFF', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    PASO INDISPENSABLE
                  </span>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    Número de Teléfono Celular / WhatsApp
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '0.75rem' }}>
                  Es el canal indispensable para coordinar las entregas, operativos de gas y avisos urgentes del consejo.
                </p>
                <Field label="Teléfono de Contacto del Titular" required hint="Ejemplo: 0412-1234567 o 0414-7654321">
                  <input
                    type="tel"
                    placeholder="0412-1234567"
                    value={social.phone}
                    onChange={(e) => setSocial({ ...social, phone: e.target.value })}
                    required
                  />
                </Field>
              </div>

              {/* Sección 1: Ubicación Vecinal y Vivienda */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#0F172A', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    1. VIVIENDA
                  </span>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    Ubicación Vecinal y Nomenclatura en {COMMUNITY_CONFIG.name}
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1rem' }}>
                  Registra tu consejo comunal y número de casa correlativo para la ruta organizada de entrega de beneficios.
                </p>

                <div className="reg-grid-2">
                  <Field label={`Consejo Comunal donde vives en ${COMMUNITY_CONFIG.name}`} required>
                    <select
                      value={social.zoneId}
                      onChange={(e) => handleZoneChange(e.target.value)}
                    >
                      <option value="">Selecciona tu consejo comunal</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.code} · {z.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Número de Casa (ej: 1006)" required>
                    <input
                      type="text"
                      placeholder="Ej: 1006"
                      value={social.houseNumber}
                      onChange={(e) => setSocial({ ...social, houseNumber: e.target.value.replace(/[^0-9A-Za-z-]/g, '') })}
                    />
                  </Field>
                </div>

                {/* Condición de la Vivienda: Propia o Alquilada */}
                <div style={{ marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px solid #E2E8F0' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#0F172A', marginBottom: '0.35rem' }}>
                    Condición de la Vivienda: ¿Es Propia o Alquilada? <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 0.65rem' }}>
                    Indica si la vivienda es propia, alquilada o si habitas bajo condición familiar o prestada.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
                    {[
                      { value: 'propia', label: 'Vivienda Propia', desc: 'Inmueble propio del hogar' },
                      { value: 'alquilada', label: 'Alquilada', desc: 'En arrendamiento' },
                      { value: 'familiar', label: 'Familiar / Prestada', desc: 'Prestada por terceros' },
                      { value: 'otra', label: 'Otra Condición', desc: 'Condición especial' },
                    ].map((opt) => {
                      const isSelected = (social.housingTenure || 'propia') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setSocial({ ...social, housingTenure: opt.value })}
                          style={{
                            padding: '0.75rem 0.65rem',
                            borderRadius: '0.75rem',
                            border: isSelected ? '2px solid var(--blue, #4a91ad)' : '1px solid #CBD5E1',
                            background: isSelected ? 'rgba(79, 145, 173, 0.08)' : '#F8FAFC',
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <strong style={{ fontSize: '0.85rem', color: isSelected ? '#0F172A' : '#475569' }}>
                            {opt.label}
                          </strong>
                          <small style={{ fontSize: '0.7rem', color: isSelected ? '#334155' : '#64748B' }}>
                            {opt.desc}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginTop: '0.85rem' }}>
                  <Field label="Dirección Detallada / Punto de Referencia" required hint="Ej: Al lado de la bodega, frente a la escalera principal">
                    <input
                      type="text"
                      placeholder="Ej: Al lado de la bodega, frente a la escalera principal"
                      value={social.dwellingAddress}
                      onChange={(e) => setSocial({ ...social, dwellingAddress: e.target.value })}
                    />
                  </Field>
                </div>
              </div>

              {/* Sección: Rol en el Núcleo Familiar */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#0F172A', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    ROL EN EL HOGAR
                  </span>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    ¿Eres el Jefe o Jefa de Hogar?
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '0.85rem' }}>
                  El Jefe o Jefa de Hogar es el titular que declara el número de bombonas de gas de la vivienda. Los demás integrantes no declaran bombonas para evitar duplicar el censo comunal.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => setSocial({
                      ...social,
                      isHouseholdHead: true,
                      relationship: 'Jefe(a) de Hogar',
                      gasCylindersCount: social.gasCylindersCount === '0' ? '1' : (social.gasCylindersCount || '1'),
                    })}
                    style={{
                      padding: '0.85rem',
                      borderRadius: '0.75rem',
                      border: social.isHouseholdHead ? '2px solid var(--blue, #4a91ad)' : '1px solid #CBD5E1',
                      background: social.isHouseholdHead ? 'rgba(79, 145, 173, 0.08)' : '#F8FAFC',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <strong style={{ fontSize: '0.9rem', color: social.isHouseholdHead ? '#0F172A' : '#475569' }}>
                      Sí, soy el Jefe(a) de Hogar
                    </strong>
                    <small style={{ fontSize: '0.75rem', color: '#64748B' }}>
                      Declaro las bombonas y servicios del hogar
                    </small>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSocial({
                      ...social,
                      isHouseholdHead: false,
                      relationship: social.relationship === 'Jefe(a) de Hogar' ? 'Hijo/a' : (social.relationship || 'Hijo/a'),
                      gasCylindersCount: '0',
                    })}
                    style={{
                      padding: '0.85rem',
                      borderRadius: '0.75rem',
                      border: !social.isHouseholdHead ? '2px solid var(--blue, #4a91ad)' : '1px solid #CBD5E1',
                      background: !social.isHouseholdHead ? 'rgba(79, 145, 173, 0.08)' : '#F8FAFC',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <strong style={{ fontSize: '0.9rem', color: !social.isHouseholdHead ? '#0F172A' : '#475569' }}>
                      No, soy integrante familiar
                    </strong>
                    <small style={{ fontSize: '0.75rem', color: '#64748B' }}>
                      Hijo(a), cónyuge u otro familiar conviviente
                    </small>
                  </button>
                </div>

                {!social.isHouseholdHead && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <Field label="Parentesco con el Jefe o Jefa de Hogar" required>
                      <select
                        value={social.relationship || 'Hijo/a'}
                        onChange={(e) => setSocial({ ...social, relationship: e.target.value })}
                      >
                        <option value="Cónyuge">Cónyuge / Pareja</option>
                        <option value="Hijo/a">Hijo o Hija</option>
                        <option value="Madre/Padre">Madre o Padre</option>
                        <option value="Hermano/a">Hermano o Hermana</option>
                        <option value="Abuelo/a">Abuelo o Abuela</option>
                        <option value="Familiar">Otro Familiar</option>
                        <option value="No familiar">No familiar / Inquilino</option>
                      </select>
                    </Field>
                  </div>
                )}
              </div>

              {/* Sección: Cónyuge o Pareja en el Hogar (Opción A) */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#0F172A', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    CÓNYUGE O PAREJA
                  </span>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    ¿Convives con tu cónyuge o pareja en esta vivienda?
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '0.85rem' }}>
                  Permite que tu pareja sea reconocida automáticamente en el censo para ingresar al portal vecinal con su propio teléfono móvil y cuenta de Google sin duplicar registros.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => setSocial((prev) => ({
                      ...prev,
                      hasSpouse: true,
                      spouse: prev.spouse || {
                        firstName: '',
                        lastName: '',
                        nationality: 'V',
                        idNumber: '',
                        phone: '',
                        sex: prev.isHouseholdHead && cedula.sexo === 'M' ? 'F' : 'M',
                        birthDate: '',
                      },
                    }))}
                    style={{
                      padding: '0.85rem',
                      borderRadius: '0.75rem',
                      border: social.hasSpouse ? '2px solid var(--blue, #4a91ad)' : '1px solid #CBD5E1',
                      background: social.hasSpouse ? 'rgba(79, 145, 173, 0.08)' : '#F8FAFC',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <strong style={{ fontSize: '0.9rem', color: social.hasSpouse ? '#0F172A' : '#475569' }}>
                      Sí, convivo con mi pareja
                    </strong>
                    <small style={{ fontSize: '0.75rem', color: '#64748B' }}>
                      Registrar cédula para auto-vinculación
                    </small>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSocial((prev) => ({
                      ...prev,
                      hasSpouse: false,
                    }))}
                    style={{
                      padding: '0.85rem',
                      borderRadius: '0.75rem',
                      border: !social.hasSpouse ? '2px solid var(--blue, #4a91ad)' : '1px solid #CBD5E1',
                      background: !social.hasSpouse ? 'rgba(79, 145, 173, 0.08)' : '#F8FAFC',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <strong style={{ fontSize: '0.9rem', color: !social.hasSpouse ? '#0F172A' : '#475569' }}>
                      No / Sin cónyuge conviviente
                    </strong>
                    <small style={{ fontSize: '0.75rem', color: '#64748B' }}>
                      Solo titular o soltero(a)
                    </small>
                  </button>
                </div>

                {social.hasSpouse && (
                  <div style={{ marginTop: '1rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '0.75rem', padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <strong style={{ fontSize: '0.85rem', color: '#0F172A' }}>
                        Datos de Identidad del Cónyuge o Pareja
                      </strong>
                    </div>

                    {/* Cédula del cónyuge */}
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                        Cédula de Identidad del Cónyuge
                      </label>
                      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', width: '100%' }}>
                        <select
                          value={social.spouse?.nationality || 'V'}
                          onChange={(e) => setSocial((prev) => ({
                            ...prev,
                            spouse: { ...(prev.spouse || {}), nationality: e.target.value },
                          }))}
                          style={{ width: '65px', minWidth: '65px', height: '42px', flexShrink: 0, padding: '0.4rem', borderRadius: '0.5rem', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
                        >
                          <option value="V">V</option>
                          <option value="E">E</option>
                        </select>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="Ej. 11165218"
                          value={social.spouse?.idNumber || ''}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleLookupCedula('spouse');
                            }
                          }}
                          onChange={(e) => {
                            setSocial((prev) => ({
                              ...prev,
                              spouse: { ...(prev.spouse || {}), idNumber: e.target.value.replace(/\D/g, '') },
                            }));
                            if (lookupFeedback.spouse) setLookupFeedback((prev) => ({ ...prev, spouse: null }));
                          }}
                          style={{ flex: 1, minWidth: 0, height: '42px', padding: '0.5rem 0.65rem', borderRadius: '0.5rem', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
                        />
                        <button
                          type="button"
                          onClick={() => handleLookupCedula('spouse')}
                          disabled={lookupLoading.spouse || !social.spouse?.idNumber}
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
                            cursor: lookupLoading.spouse ? 'wait' : 'pointer',
                            opacity: (!social.spouse?.idNumber || lookupLoading.spouse) ? 0.65 : 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                          <span>{lookupLoading.spouse ? 'Buscando...' : 'Buscar'}</span>
                        </button>
                      </div>
                      <small style={{ display: 'block', marginTop: '0.3rem', fontSize: '0.72rem', color: '#0369A1' }}>
                        Escribe la cédula y presiona <b>Buscar</b> (o Enter) para traer los nombres automáticamente del censo previo.
                      </small>
                      {lookupFeedback.spouse?.success && (
                        <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '0.35rem 0.6rem', borderRadius: '0.375rem' }}>
                          <strong>{lookupFeedback.spouse.success}</strong>
                        </div>
                      )}
                      {lookupFeedback.spouse?.error && (
                        <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '0.35rem 0.6rem', borderRadius: '0.375rem' }}>
                          {lookupFeedback.spouse.error}
                        </div>
                      )}
                    </div>

                    {/* Nombres y Apellidos */}
                    <div className="reg-grid-2" style={{ gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <Field label="Nombres del Cónyuge" required>
                        <input
                          type="text"
                          placeholder="Ej. Carmen Elena"
                          value={social.spouse?.firstName || ''}
                          onChange={(e) => setSocial((prev) => ({
                            ...prev,
                            spouse: { ...(prev.spouse || {}), firstName: formatPersonName(e.target.value) },
                          }))}
                          style={{ textTransform: 'capitalize' }}
                        />
                      </Field>
                      <Field label="Apellidos del Cónyuge" required>
                        <input
                          type="text"
                          placeholder="Ej. Pérez Gómez"
                          value={social.spouse?.lastName || ''}
                          onChange={(e) => setSocial((prev) => ({
                            ...prev,
                            spouse: { ...(prev.spouse || {}), lastName: formatPersonName(e.target.value) },
                          }))}
                          style={{ textTransform: 'capitalize' }}
                        />
                      </Field>
                    </div>

                    {/* Teléfono y Sexo */}
                    <div className="reg-grid-2" style={{ gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <Field label="Teléfono / WhatsApp de Contacto" hint="Para notificaciones y coordinación">
                        <input
                          type="tel"
                          placeholder="0412-1234567"
                          value={social.spouse?.phone || ''}
                          onChange={(e) => setSocial((prev) => ({
                            ...prev,
                            spouse: { ...(prev.spouse || {}), phone: e.target.value },
                          }))}
                        />
                      </Field>
                      <Field label="Sexo">
                        <select
                          value={social.spouse?.sex || 'F'}
                          onChange={(e) => setSocial((prev) => ({
                            ...prev,
                            spouse: { ...(prev.spouse || {}), sex: e.target.value },
                          }))}
                        >
                          <option value="F">Femenino</option>
                          <option value="M">Masculino</option>
                        </select>
                      </Field>
                    </div>

                    {/* Fecha de Nacimiento opcional */}
                    <div style={{ marginBottom: '0.75rem' }}>
                      <Field label="Fecha de Nacimiento (Opcional)">
                        <input
                          type="date"
                          value={social.spouse?.birthDate || ''}
                          onChange={(e) => setSocial((prev) => ({
                            ...prev,
                            spouse: { ...(prev.spouse || {}), birthDate: e.target.value },
                          }))}
                        />
                      </Field>
                    </div>

                    {/* Ficha Social y de Salud del Cónyuge */}
                    <div style={{ marginTop: '0.75rem', padding: '0.85rem', background: '#F8FAFC', borderRadius: '0.5rem', border: '1px solid #E2E8F0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#0284C7' }}>health_and_safety</span>
                        <strong style={{ fontSize: '0.82rem', color: '#0F172A' }}>Ficha Social y de Salud del Cónyuge</strong>
                      </div>

                      {/* Salud y Enfermedades Crónicas */}
                      <div className="reg-grid-2" style={{ gap: '0.75rem', marginBottom: '0.65rem' }}>
                        <Field label="Condición Especial o Discapacidad">
                          <select
                            value={social.spouse?.conditionAffection || 'ninguna'}
                            onChange={(e) => setSocial((prev) => ({
                              ...prev,
                              spouse: { ...(prev.spouse || {}), conditionAffection: e.target.value },
                            }))}
                          >
                            <option value="ninguna">Ninguna / En buen estado</option>
                            <option value="hipertension">Hipertensión arterial</option>
                            <option value="diabetes">Diabetes</option>
                            <option value="asma">Asma / Afección respiratoria</option>
                            <option value="discapacidad_motora">Discapacidad motora</option>
                            <option value="discapacidad_visual">Discapacidad visual</option>
                            <option value="discapacidad_auditiva">Discapacidad auditiva</option>
                            <option value="enfermedad_cronica">Enfermedad crónica / tratamiento continuo</option>
                            <option value="encamado">Persona en cama / dependiente</option>
                            <option value="otra">Otra condición o requerimiento</option>
                          </select>
                        </Field>
                        <Field label="Enfermedades o Tratamientos Específicos" hint="Ej: Losartán 50mg, Insulina...">
                          <input
                            type="text"
                            placeholder="Ej. Hipertensión, medicación diaria..."
                            value={social.spouse?.chronicDiseases || ''}
                            onChange={(e) => setSocial((prev) => ({
                              ...prev,
                              spouse: { ...(prev.spouse || {}), chronicDiseases: e.target.value },
                            }))}
                          />
                        </Field>
                      </div>

                      {/* Centro Electoral y Ocupación */}
                      <div className="reg-grid-2" style={{ gap: '0.75rem', marginBottom: '0.65rem' }}>
                        <Field label="Centro de Votación (CNE)">
                          <input
                            type="text"
                            placeholder="Ej. U.E. Mariano Picón Salas"
                            value={social.spouse?.votingCenterName || ''}
                            onChange={(e) => setSocial((prev) => ({
                              ...prev,
                              spouse: { ...(prev.spouse || {}), votingCenterName: e.target.value },
                            }))}
                          />
                        </Field>
                        <Field label="Ocupación / Situación Laboral">
                          <select
                            value={social.spouse?.communityTrade || 'hogar'}
                            onChange={(e) => setSocial((prev) => ({
                              ...prev,
                              spouse: { ...(prev.spouse || {}), communityTrade: e.target.value },
                            }))}
                          >
                            <option value="empleado">Empleado(a) público o privado</option>
                            <option value="comercio_independiente">Comercio independiente / Emprendedor</option>
                            <option value="hogar">Labores del hogar</option>
                            <option value="jubilado_pensionado">Jubilado(a) / Pensionado(a)</option>
                            <option value="estudiante">Estudiante</option>
                            <option value="oficio_tecnico">Oficio técnico / Profesional</option>
                            <option value="desempleado">En búsqueda de empleo</option>
                            <option value="otro">Otro</option>
                          </select>
                        </Field>
                      </div>

                      {/* RIF Opcional */}
                      <div>
                        <Field label="Número de RIF (Opcional)" hint="Si posee comprobante fiscal SENIAT">
                          <input
                            type="text"
                            placeholder="Ej. V-12345678-0"
                            value={social.spouse?.rifNumber || ''}
                            onChange={(e) => setSocial((prev) => ({
                              ...prev,
                              spouse: { ...(prev.spouse || {}), rifNumber: e.target.value.toUpperCase() },
                            }))}
                          />
                        </Field>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sección 2: Suministro de Gas Doméstico */}
              {social.isHouseholdHead ? (
                <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#0F172A', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                      2. GAS DOMÉSTICO
                    </span>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                      Cilindros y Equipamiento de Gas
                    </h3>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1rem' }}>
                    Como Jefe(a) de Hogar, declara los cilindros activos de tu vivienda para la ruta de recarga comunitaria.
                  </p>

                  <div className="reg-grid-3">
                    <Field label="Cilindros en Uso" required>
                      <select
                        value={social.gasCylindersCount || '1'}
                        onChange={(e) => setSocial({ ...social, gasCylindersCount: e.target.value })}
                      >
                        <option value="1">1 cilindro</option>
                        <option value="2">2 cilindros</option>
                        <option value="3">3 cilindros</option>
                        <option value="4">4 o más cilindros</option>
                      </select>
                    </Field>

                    <Field label="Capacidad Principal" required>
                      <select
                        value={social.gasCylinderSize || '10kg'}
                        onChange={(e) => setSocial({ ...social, gasCylinderSize: e.target.value })}
                      >
                        <option value="10kg">10 kg (Pequeña)</option>
                        <option value="18kg">18 kg (Mediana)</option>
                        <option value="43kg">43 kg (Grande)</option>
                      </select>
                    </Field>

                    <Field label="Tipo de Válvula">
                      <select
                        value={social.gasValveType || 'pico_rapido'}
                        onChange={(e) => setSocial({ ...social, gasValveType: e.target.value })}
                      >
                        <option value="pico_rapido">Pico Rápido / Presión</option>
                        <option value="rosca">Rosca Tradicional</option>
                      </select>
                    </Field>
                  </div>

                  <div className="reg-grid-2" style={{ marginTop: '0.75rem' }}>
                    <Field label="Distribuidora Habitual">
                      <select
                        value={social.gasProvider === 'gas_miranda' ? 'Gas Caracas' : (social.gasProvider || 'Gas Caracas')}
                        onChange={(e) => setSocial({ ...social, gasProvider: e.target.value })}
                      >
                        <option value="Gas Caracas">Gas Caracas</option>
                        <option value="PDVSA Gas Comunal">PDVSA Gas Comunal</option>
                        <option value="Directo / Camión Privado">Directo / Camión Privado</option>
                      </select>
                    </Field>

                    <Field label="Artefacto de Cocina">
                      <select
                        value={social.cookingAppliance || 'gas_exclusivo'}
                        onChange={(e) => setSocial({ ...social, cookingAppliance: e.target.value })}
                      >
                        <option value="gas_exclusivo">Cocina a Gas Exclusiva</option>
                        <option value="mixta_gas_electrica">Mixta (Gas y Hornilla Eléctrica)</option>
                        <option value="electrica_exclusiva">Solo Cocina Eléctrica</option>
                      </select>
                    </Field>
                  </div>
                </div>
              ) : (
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#64748B', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                      2. GAS DOMÉSTICO
                    </span>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#475569', margin: 0 }}>
                      Control de Cilindros por Vivienda
                    </h3>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0, lineHeight: 1.5 }}>
                    Al identificarte como integrante del núcleo familiar, las bombonas de gas son declaradas exclusivamente por el Jefe o Jefa de tu hogar. Esto garantiza que los cilindros de tu casa no se contabilicen múltiples veces en los operativos comunales.
                  </p>
                </div>
              )}

              {/* Sección 3: Salud y Casos Especiales */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#0F172A', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    3. ATENCIÓN SOCIAL
                  </span>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    Salud, Discapacidad y Casos Especiales
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1rem' }}>
                  Permite priorizar jornadas médicas, medicamentos de alto costo y atención prioritaria.
                </p>

                <Field label="¿Tiene usted o alguien de su núcleo alguna condición o discapacidad?" required>
                  <select
                    value={social.conditionAffection}
                    onChange={(e) => setSocial({ ...social, conditionAffection: e.target.value })}
                  >
                    <option value="ninguna">Ninguna / Buen estado general</option>
                    <option value="discapacidad_motora">Discapacidad motora</option>
                    <option value="discapacidad_visual">Discapacidad visual</option>
                    <option value="discapacidad_auditiva">Discapacidad auditiva</option>
                    <option value="enfermedad_cronica">Enfermedad crónica / tratamiento continuo</option>
                    <option value="adulto_mayor_dependiente">Adulto mayor dependiente</option>
                    <option value="otra">Otra condición o requerimiento</option>
                  </select>
                </Field>

                {social.conditionAffection !== 'ninguna' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <Field label="Detalle de la condición o tratamiento necesario" required>
                      <textarea
                        rows={2}
                        placeholder="Describe la condición o asistencia requerida."
                        value={social.affectionDetail}
                        onChange={(e) => setSocial({ ...social, affectionDetail: e.target.value })}
                      />
                    </Field>
                  </div>
                )}

                <div style={{ marginTop: '0.75rem' }}>
                  <Field label="Enfermedades Crónicas en el Núcleo Familiar" hint="Puedes agregar una o varias enfermedades escribiendo su nombre o seleccionando de la lista">
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Ej: Hipertensión, Diabetes, Asma, Cardiopatía..."
                        value={diseaseInput}
                        onChange={(e) => setDiseaseInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddDisease();
                          }
                        }}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleAddDisease()}
                        style={{ whiteSpace: 'nowrap', padding: '0 1rem' }}
                      >
                        + Agregar
                      </button>
                    </div>

                    {/* Sugerencias rápidas */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '0.5rem' }}>
                      <small style={{ width: '100%', color: '#64748B', fontSize: '0.75rem' }}>Opciones frecuentes (toca para añadir):</small>
                      {['Hipertensión', 'Diabetes', 'Asma', 'Cardiopatía', 'Artritis', 'Alergias severas', 'Cáncer'].map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => handleAddDisease(item)}
                          style={{
                            background: diseasesList.includes(item) ? '#E2E8F0' : '#F8FAFC',
                            border: '1px solid #CBD5E1',
                            borderRadius: '12px',
                            padding: '2px 8px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            color: '#334155',
                          }}
                        >
                          + {item}
                        </button>
                      ))}
                    </div>

                    {/* Lista de enfermedades agregadas */}
                    {diseasesList.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '0.5rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '0.5rem' }}>
                        {diseasesList.map((disease, idx) => (
                          <span
                            key={idx}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              background: '#FFFFFF',
                              border: '1px solid #CBD5E1',
                              borderRadius: '16px',
                              padding: '3px 10px',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              color: '#0F172A',
                            }}
                          >
                            {disease}
                            <button
                              type="button"
                              onClick={() => handleRemoveDisease(idx)}
                              aria-label={`Quitar ${disease}`}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#EF4444',
                                fontWeight: 800,
                                fontSize: '0.9rem',
                                padding: 0,
                                marginLeft: '2px',
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
                        Ninguna enfermedad agregada aún. Si nadie en tu núcleo sufre de enfermedades crónicas, déjalo vacío.
                      </p>
                    )}
                  </Field>
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <Field label="Medicamentos de Uso Continuo Requeridos" hint="Indica los fármacos que toman regularmente los integrantes del núcleo">
                    <input
                      type="text"
                      placeholder="Ej: Losartán 50mg, Metformina 850mg, Eutirox 100mcg"
                      value={social.regularMedications}
                      onChange={(e) => setSocial({ ...social, regularMedications: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="reg-grid-2" style={{ marginTop: '0.75rem' }}>
                  <Field label="Mujeres Embarazadas o en Lactancia">
                    <select
                      value={social.isPregnantOrLactating}
                      onChange={(e) => setSocial({ ...social, isPregnantOrLactating: e.target.value })}
                    >
                      <option value="no">No</option>
                      <option value="embarazo">Embarazo en curso</option>
                      <option value="lactancia">Lactancia materna activa</option>
                    </select>
                  </Field>

                  <Field label="Adultos Mayores (60+ años) en el Hogar">
                    <select
                      value={social.elderlyCount}
                      onChange={(e) => setSocial({ ...social, elderlyCount: e.target.value })}
                    >
                      <option value="0">0 adultos mayores</option>
                      <option value="1">1 adulto mayor</option>
                      <option value="2">2 adultos mayores</option>
                      <option value="3">3 o más adultos mayores</option>
                    </select>
                  </Field>
                </div>
              </div>

              {/* Sección 4: Carga Familiar e Hijos */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#0F172A', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    4. CARGA FAMILIAR
                  </span>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    Hijos e Integrantes Menores de Edad
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1rem' }}>
                  Cada hijo será integrado al censo general de la comunidad para beneficios de útiles escolares, jornadas infantiles y conteo demográfico.
                </p>

                <Field label="¿Cuántos hijos tienes?">
                  <select
                    value={social.childrenCount}
                    onChange={(e) => handleChildrenCountChange(e.target.value)}
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? 'No tengo hijos' : `${n} ${n === 1 ? 'hijo' : 'hijos'}`}
                      </option>
                    ))}
                  </select>
                </Field>

                {social.childrenCount > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
                    {social.children.map((child, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: '#F8FAFC',
                          border: '1px solid #CBD5E1',
                          borderRadius: '0.75rem',
                          padding: '1.25rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <strong style={{ fontSize: '0.85rem', color: '#0F172A' }}>
                            Hijo/a #{idx + 1}
                          </strong>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B' }}>
                            {child.hasNoId ? 'Menor sin cédula' : child.idNumber ? `${child.nationality || 'V'}-${child.idNumber}` : 'Cédula pendiente'}
                          </span>
                        </div>

                        {/* Fila 1: Nombres y Apellidos */}
                        <div className="reg-grid-2" style={{ gap: '0.75rem', marginBottom: '0.75rem' }}>
                          <Field label="Nombres" required>
                            <input
                              type="text"
                              placeholder="Ej. Juan Carlos"
                              value={child.firstName || ''}
                              onChange={(e) => updateChild(idx, 'firstName', e.target.value)}
                              style={{ textTransform: 'capitalize' }}
                            />
                          </Field>
                          <Field label="Apellidos" required>
                            <input
                              type="text"
                              placeholder="Ej. Pérez Gómez"
                              value={child.lastName || ''}
                              onChange={(e) => updateChild(idx, 'lastName', e.target.value)}
                              style={{ textTransform: 'capitalize' }}
                            />
                          </Field>
                        </div>

                        {/* Fila 2: Cédula de Identidad con selector V/E y checkbox Menor sin cédula */}
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                            Cédula de Identidad
                          </label>
                          <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', width: '100%' }}>
                            <select
                              value={child.nationality || 'V'}
                              onChange={(e) => updateChild(idx, 'nationality', e.target.value)}
                              disabled={child.hasNoId}
                              style={{ width: '65px', minWidth: '65px', height: '42px', flexShrink: 0, padding: '0.4rem', borderRadius: '0.5rem', border: '1px solid #CBD5E1', background: child.hasNoId ? '#F1F5F9' : '#FFFFFF' }}
                            >
                              <option value="V">V</option>
                              <option value="E">E</option>
                            </select>
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder={child.hasNoId ? 'Menor sin cédula (S/C)' : 'Ej. 30821164'}
                              value={child.hasNoId ? '' : (child.idNumber || '')}
                              disabled={child.hasNoId}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleLookupCedula('child', idx);
                                }
                              }}
                              onChange={(e) => {
                                updateChild(idx, 'idNumber', e.target.value);
                                if (lookupFeedback.child?.[idx]) {
                                  setLookupFeedback((prev) => ({
                                    ...prev,
                                    child: { ...prev.child, [idx]: null },
                                  }));
                                }
                              }}
                              style={{ flex: 1, minWidth: 0, height: '42px', padding: '0.5rem 0.65rem', borderRadius: '0.5rem', border: '1px solid #CBD5E1', background: child.hasNoId ? '#F1F5F9' : '#FFFFFF' }}
                            />
                            {!child.hasNoId && (
                              <button
                                type="button"
                                onClick={() => handleLookupCedula('child', idx)}
                                disabled={lookupLoading.child?.[idx] || !child.idNumber}
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
                                  cursor: lookupLoading.child?.[idx] ? 'wait' : 'pointer',
                                  opacity: (!child.idNumber || lookupLoading.child?.[idx]) ? 0.65 : 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="11" cy="11" r="8" />
                                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                                <span>{lookupLoading.child?.[idx] ? 'Buscando...' : 'Buscar'}</span>
                              </button>
                            )}
                          </div>
                          {!child.hasNoId && (
                            <small style={{ display: 'block', marginTop: '0.3rem', fontSize: '0.72rem', color: '#0369A1' }}>
                              Escribe la cédula y presiona <b>Buscar</b> (o Enter) para traer los nombres automáticamente del censo previo.
                            </small>
                          )}
                          {lookupFeedback.child?.[idx]?.success && (
                            <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '0.35rem 0.6rem', borderRadius: '0.375rem' }}>
                              <strong>{lookupFeedback.child[idx].success}</strong>
                            </div>
                          )}
                          {lookupFeedback.child?.[idx]?.error && (
                            <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '0.35rem 0.6rem', borderRadius: '0.375rem' }}>
                              {lookupFeedback.child[idx].error}
                            </div>
                          )}
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#475569', marginTop: '0.35rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={Boolean(child.hasNoId)}
                              onChange={(e) => updateChild(idx, 'hasNoId', e.target.checked)}
                            />
                            <span>Menor sin cédula aún (escolar o menor de 9 años)</span>
                          </label>
                        </div>

                        {/* Fila 3: Sexo, Fecha de Nacimiento y Edad */}
                        <div className="reg-grid-3" style={{ gap: '0.75rem' }}>
                          <Field label="Sexo" required>
                            <select
                              value={child.sex || 'M'}
                              onChange={(e) => updateChild(idx, 'sex', e.target.value)}
                            >
                              <option value="M">Masculino (Hijo)</option>
                              <option value="F">Femenino (Hija)</option>
                            </select>
                          </Field>
                          <Field label="Fecha de Nacimiento">
                            <input
                              type="date"
                              value={child.birthDate || ''}
                              onChange={(e) => updateChild(idx, 'birthDate', e.target.value)}
                            />
                          </Field>
                          <Field label="Edad (años)" required>
                            <input
                              type="number"
                              min="0"
                              max="35"
                              placeholder="Edad"
                              value={child.age || ''}
                              onChange={(e) => updateChild(idx, 'age', e.target.value)}
                            />
                          </Field>
                        </div>

                        {/* Fila 4: Ficha Social y de Salud del Hijo/Dependiente */}
                        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#F8FAFC', borderRadius: '0.5rem', border: '1px solid #E2E8F0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#0284C7' }}>health_and_safety</span>
                            <strong style={{ fontSize: '0.8rem', color: '#0F172A' }}>Ficha de Salud y Condición de {child.firstName || `Hijo(a) ${idx + 1}`}</strong>
                          </div>

                          <div className="reg-grid-2" style={{ gap: '0.75rem', marginBottom: '0.5rem' }}>
                            <Field label="Condición Especial o Alergia">
                              <select
                                value={child.conditionAffection || 'ninguna'}
                                onChange={(e) => updateChild(idx, 'conditionAffection', e.target.value)}
                              >
                                <option value="ninguna">Ninguna / En buen estado</option>
                                <option value="asma">Asma / Afección respiratoria</option>
                                <option value="alergia_cronica">Alergia crónica a alimentos o fármacos</option>
                                <option value="discapacidad_motora">Discapacidad motora</option>
                                <option value="discapacidad_visual">Discapacidad visual</option>
                                <option value="discapacidad_auditiva">Discapacidad auditiva</option>
                                <option value="neurodivergencia">Neurodivergencia / TEA / TDAH</option>
                                <option value="enfermedad_cronica">Enfermedad crónica / tratamiento continuo</option>
                                <option value="otra">Otra condición especial</option>
                              </select>
                            </Field>
                            <Field label="Detalle de Afección o Medicamento" hint="Ej: Salbutamol, intolerancia...">
                              <input
                                type="text"
                                placeholder="Ej. Asma bronquial, toma antialérgico..."
                                value={child.chronicDiseases || ''}
                                onChange={(e) => updateChild(idx, 'chronicDiseases', e.target.value)}
                              />
                            </Field>
                          </div>

                          {/* Escolaridad / Nivel Educativo y Centro de Votación */}
                          <div className={Number(child.age) >= 18 ? 'reg-grid-2' : ''} style={{ gap: '0.75rem' }}>
                            <Field label="Nivel Educativo / Escolaridad">
                              <select
                                value={child.schoolLevel || (Number(child.age) < 3 ? 'maternal' : Number(child.age) < 6 ? 'preescolar' : Number(child.age) < 12 ? 'primaria' : Number(child.age) < 18 ? 'bachillerato' : 'universidad')}
                                onChange={(e) => updateChild(idx, 'schoolLevel', e.target.value)}
                              >
                                <option value="maternal">Maternal (0 - 2 años)</option>
                                <option value="preescolar">Preescolar / Inicial (3 - 5 años)</option>
                                <option value="primaria">Primaria (1er a 6to grado)</option>
                                <option value="bachillerato">Bachillerato / Secundaria</option>
                                <option value="tecnico">Educación Técnica / Oficio</option>
                                <option value="universidad">Universidad / Superior</option>
                                <option value="no_estudia">No estudia actualmente</option>
                              </select>
                            </Field>

                            {/* Centro de votación si es mayor de edad */}
                            {Number(child.age) >= 18 && (
                              <Field label="Centro de Votación (CNE)" hint="Mayor de 18 años">
                                <input
                                  type="text"
                                  placeholder="Ej: U.E. Mariano Picón Salas"
                                  value={child.votingCenterName || ''}
                                  onChange={(e) => updateChild(idx, 'votingCenterName', e.target.value)}
                                />
                              </Field>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Sección 5: Registro Electoral (CNE) y Centro de Votación */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#0F172A', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    5. REGISTRO ELECTORAL (CNE)
                  </span>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    Centro de Votación y Estatus Electoral
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1rem' }}>
                  Información para georreferenciación electoral vecinal, coordinación de mesas y logística cívica de la comunidad.
                </p>

                <div className="reg-grid-2">
                  <Field label="¿Estás inscrito(a) en el Registro Electoral (CNE)?">
                    <select
                      value={social.cneStatus || 'registered'}
                      onChange={(e) => setSocial({ ...social, cneStatus: e.target.value })}
                    >
                      <option value="registered">Sí, estoy inscrito(a) en el CNE</option>
                      <option value="not_registered">No estoy inscrito(a) en el CNE</option>
                    </select>
                  </Field>

                  {social.cneStatus !== 'not_registered' && (
                    <Field label="Centro de Votación Asignado (Plantel o Escuela)" hint="Nombre del colegio o liceo donde votas">
                      <input
                        type="text"
                        placeholder="Ej: U.E. Mariano Picón Salas"
                        value={social.votingCenterName || ''}
                        onChange={(e) => setSocial({ ...social, votingCenterName: e.target.value })}
                      />
                    </Field>
                  )}
                </div>

                {social.cneStatus !== 'not_registered' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '0.75rem' }}>
                    <small style={{ width: '100%', color: '#64748B', fontSize: '0.75rem' }}>Planteles frecuentes de la zona (toca para autocompletar):</small>
                    {[
                      'U.E. Mariano Picón Salas',
                      'Colegio Fe y Alegría',
                      'Liceo Andrés Bello',
                      'U.E. Concentrada San José',
                      'Ciclo Combinado Fernando Peñalver',
                    ].map((center) => (
                      <button
                        key={center}
                        type="button"
                        onClick={() => setSocial({ ...social, votingCenterName: center })}
                        style={{
                          background: social.votingCenterName === center ? '#E2E8F0' : '#F8FAFC',
                          border: social.votingCenterName === center ? '1px solid #94A3B8' : '1px solid #CBD5E1',
                          borderRadius: '12px',
                          padding: '3px 10px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          color: '#334155',
                          fontWeight: social.votingCenterName === center ? 700 : 500,
                        }}
                      >
                        {social.votingCenterName === center ? '✓ ' : '+ '}{center}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Sección 6: Servicios y Talento Comunitario */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, background: '#E2E8F0', color: '#0F172A', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    6. COMUNIDAD Y SERVICIOS
                  </span>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    Almacenamiento de Agua y Aporte Comunitario
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1rem' }}>
                  Información para planes de contingencia hídrica y red de apoyo técnico vecinal.
                </p>

                <div className="reg-grid-2">
                  <Field label="Capacidad de Almacenamiento de Agua">
                    <select
                      value={social.waterTankCapacity}
                      onChange={(e) => setSocial({ ...social, waterTankCapacity: e.target.value })}
                    >
                      <option value="ninguno">Sin tanque / Red directa</option>
                      <option value="pipotes">Pipotes o bidones menores</option>
                      <option value="500L">Tanque 500 litros</option>
                      <option value="1000L">Tanque 1.000 litros</option>
                      <option value="1500_2000L">Tanque 1.500 - 2.000 litros</option>
                      <option value="mas_2000L">Tanque mayor a 2.000 litros</option>
                    </select>
                  </Field>

                  <Field label="Mascotas / Animales en el Hogar">
                    <select
                      value={social.petsCount}
                      onChange={(e) => setSocial({ ...social, petsCount: e.target.value })}
                    >
                      <option value="0">0 mascotas</option>
                      <option value="1">1 mascota</option>
                      <option value="2">2 mascotas</option>
                      <option value="3">3 o más mascotas</option>
                    </select>
                  </Field>
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <Field label="Oficio, Profesión o Talento que puedes Aportar">
                    <input
                      type="text"
                      placeholder="Ej: Electricista, Plomería, Mecánica, Enfermería, Herrería, Docencia"
                      value={social.communityTrade}
                      onChange={(e) => setSocial({ ...social, communityTrade: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="reg-actions-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setStep(2)}
                  >
                    ← Volver a RIF
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    style={{ flex: 1 }}
                    disabled={!canSubmit}
                    onClick={() => setStep(4)}
                  >
                    Revisar Resumen y Activar →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PASO 4: RESUMEN Y ACTIVACIÓN */}
          {step === 4 && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 900, color: '#0F172A', marginBottom: '1.25rem' }}>
                  Resumen Integral de tu Ficha Vecinal
                </h3>

                {/* Grid 1: Titular y RIF */}
                <div className="reg-grid-2" style={{ paddingBottom: '1rem', borderBottom: '1px solid #E2E8F0', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Titular Cédula</span>
                    <strong style={{ color: '#0F172A' }}>{cedula.nombres} {cedula.apellidos}</strong>
                    <div style={{ color: '#334155', fontWeight: 700 }}>{cedula.tipo_documento}-{cedula.numero_cedula}</div>
                  </div>
                  <div>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Comprobante RIF SENIAT</span>
                    <strong style={{ color: '#0F172A' }}>{rif.numero_rif}</strong>
                    <div style={{ color: '#334155' }}>{rif.domicilio_fiscal || 'Domicilio fiscal validado'}</div>
                  </div>
                </div>

                {/* Grid 2: Ubicación y Contacto */}
                <div className="reg-grid-2" style={{ padding: '1rem 0', borderBottom: '1px solid #E2E8F0', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Ubicación y Rol en Hogar</span>
                    <strong style={{ color: '#0F172A' }}>CC {social.zoneCode} · Casa {social.houseNumber}{social.houseSuffix ? ` (${social.houseSuffix})` : ''}</strong>
                    <div style={{ color: '#334155' }}>Rol: <b>{social.isHouseholdHead ? 'Jefe(a) de Hogar' : `Integrante (${social.relationship || 'Familiar'})`}</b></div>
                    <div style={{ color: '#334155', marginTop: '2px' }}>
                      Vivienda: <b>{social.housingTenure === 'alquilada' ? 'Alquilada' : social.housingTenure === 'familiar' ? 'Familiar / Prestada' : social.housingTenure === 'otra' ? 'Otra condición' : 'Propia'}</b>
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Contacto y Cuenta</span>
                    <strong style={{ color: '#0F172A' }}>{social.phone}</strong>
                    <div style={{ color: '#334155' }}>{user?.email}</div>
                  </div>
                </div>

                {/* Resumen: Cónyuge o Pareja Registrada (Opción A) */}
                {social.hasSpouse && (
                  <div style={{ padding: '0.85rem 0', borderBottom: '1px solid #E2E8F0', fontSize: '0.85rem' }}>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Cónyuge o Pareja en el Hogar</span>
                    <strong style={{ color: '#0F172A' }}>
                      {social.spouse?.firstName} {social.spouse?.lastName}
                    </strong>
                    <div style={{ color: '#334155', marginTop: '0.2rem' }}>
                      Cédula: <b>{social.spouse?.nationality || 'V'}-{social.spouse?.idNumber || 'Sin cédula'}</b>
                      {social.spouse?.phone ? ` · Tel: ${social.spouse.phone}` : ''}
                      {social.spouse?.sex ? ` · Sexo: ${social.spouse.sex === 'F' ? 'Femenino' : 'Masculino'}` : ''}
                    </div>
                  </div>
                )}

                {/* Grid 3: Gas Doméstico y Servicios */}
                <div className="reg-grid-2" style={{ padding: '1rem 0', borderBottom: '1px solid #E2E8F0', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Gas Doméstico</span>
                    {social.isHouseholdHead ? (
                      <>
                        <strong style={{ color: '#0F172A' }}>{social.gasCylindersCount} cilindro(s) · {social.gasCylinderSize}</strong>
                        <div style={{ color: '#334155' }}>Válvula: {social.gasValveType === 'pico_rapido' ? 'Pico Rápido' : 'Rosca'} · {social.gasProvider}</div>
                      </>
                    ) : (
                      <>
                        <strong style={{ color: '#0F172A' }}>No aplica (Declarado por Jefe de Hogar)</strong>
                        <div style={{ color: '#64748B' }}>Evita duplicaciones en el censo comunal</div>
                      </>
                    )}
                  </div>
                  <div>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Servicios y Aporte</span>
                    <strong style={{ color: '#0F172A' }}>Agua: {social.waterTankCapacity}</strong>
                    <div style={{ color: '#334155' }}>Oficio: {social.communityTrade || 'No especificado'} · Mascotas: {social.petsCount}</div>
                  </div>
                </div>

                {/* Grid 4: Registro Electoral CNE y Centro de Votación */}
                <div className="reg-grid-2" style={{ padding: '1rem 0', borderBottom: '1px solid #E2E8F0', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Registro Electoral (CNE)</span>
                    <strong style={{ color: '#0F172A' }}>
                      {social.cneStatus === 'not_registered' ? 'No inscrito en el CNE' : 'Inscrito en el Registro Electoral'}
                    </strong>
                    <div style={{ color: '#334155' }}>
                      {social.cneStatus === 'not_registered'
                        ? 'No habilitado para votación activa'
                        : 'Elector activo en la circunscripción'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.75rem' }}>Centro de Votación Asignado</span>
                    <strong style={{ color: '#0F172A' }}>
                      {social.cneStatus === 'not_registered'
                        ? 'No aplica'
                        : (social.votingCenterName || 'Plantel pendiente por definir')}
                    </strong>
                    <div style={{ color: '#64748B' }}>
                      {social.cneStatus !== 'not_registered' && social.votingCenterName
                        ? 'Plantel electoral georreferenciado'
                        : 'Coordinación cívica comunitaria'}
                    </div>
                  </div>
                </div>

                {/* Grid 5: Salud y Carga Familiar */}
                <div style={{ paddingTop: '1rem', fontSize: '0.85rem' }}>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <span style={{ color: '#64748B', fontSize: '0.75rem' }}>Salud y Afectación: </span>
                    <strong style={{ color: '#0F172A' }}>
                      {social.conditionAffection === 'ninguna' ? 'Ninguna afectación reportada' : social.conditionAffection}
                    </strong>
                    {social.affectionDetail && <p style={{ color: '#475569', margin: '0.25rem 0' }}>{social.affectionDetail}</p>}
                    {(social.chronicDiseases || social.regularMedications) && (
                      <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.25rem' }}>
                        {social.chronicDiseases && <span>Crónicos: {social.chronicDiseases}. </span>}
                        {social.regularMedications && <span>Medicamentos: {social.regularMedications}. </span>}
                      </div>
                    )}
                  </div>
                  <div>
                    <span style={{ color: '#64748B', fontSize: '0.75rem' }}>Hijos registrados para el censo: </span>
                    <strong style={{ color: '#0F172A' }}>{social.childrenCount}</strong>
                    {social.children.length > 0 && (
                      <ul style={{ margin: '0.25rem 0 0 1rem', color: '#475569' }}>
                        {social.children.map((c, i) => {
                          const name = c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || `Hijo #${i + 1}`;
                          const idText = c.hasNoId ? 'Sin cédula (menor)' : (c.idNumber ? `${c.nationality || 'V'}-${c.idNumber}` : 'Sin cédula');
                          const relation = c.relationship || (c.sex === 'F' ? 'Hija' : 'Hijo');
                          return (
                            <li key={i}>
                              <strong>{name}</strong> · {idText} · {relation} {c.age ? `(${c.age} años)` : ''}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {submitError && (
                <div className="form-error" role="alert">
                  <strong>Error de activación:</strong> {submitError}
                </div>
              )}

              <div className="reg-actions-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setStep(3)}
                  disabled={submitting}
                >
                  ← Modificar Datos
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  style={{ flex: 1, background: '#10B981', color: '#FFFFFF', fontWeight: 900, fontSize: '0.95rem' }}
                  disabled={submitting}
                >
                  {submitting ? 'Activando acceso...' : 'Completar Registro y Activar Acceso Directo'}
                </button>
              </div>
            </form>
          )}

        </div>
      </main>

      {/* LIVE CAMERA MODAL (Statera Desktop WebRTC Viewfinder) */}
      {cameraModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(5, 7, 11, 0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#0F172A', border: '1px solid #1E293B', borderRadius: '1.5rem', maxWidth: '520px', width: '100%', overflow: 'hidden', color: '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0 }}>
                  {scanTarget === 'cedula' ? 'Fotografiar Cédula de Identidad' : 'Fotografiar Comprobante RIF'}
                </h3>
                <small style={{ color: '#94A3B8' }}>Centra el documento dentro del marco guía</small>
              </div>
              <button type="button" onClick={closeCamera} style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '1.25rem', cursor: 'pointer' }} aria-label="Cerrar cámara">
                X
              </button>
            </div>

            <div style={{ position: 'relative', width: '100%', height: '320px', background: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {/* ID Card Guider box */}
              <div style={{ position: 'absolute', width: '85%', maxWidth: '340px', aspectRatio: scanTarget === 'cedula' ? '85.6/53.98' : '3/4', border: '2px dashed #FF9F1C', borderRadius: '1rem', boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '0.75rem' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 800, background: '#FF9F1C', color: '#0F172A', padding: '0.15rem 0.4rem', borderRadius: '4px', alignSelf: 'flex-start' }}>
                  {scanTarget === 'cedula' ? 'Frente de la Cédula' : 'Comprobante RIF'}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#FEF3C7', background: 'rgba(0,0,0,0.7)', padding: '0.2rem 0.5rem', borderRadius: '1rem', alignSelf: 'center' }}>
                  Sin reflejos y texto legible
                </span>
              </div>
            </div>

            <div style={{ padding: '1rem', borderTop: '1px solid #1E293B', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={switchCamera} style={{ flex: 1, minHeight: '44px', background: '#1E293B', color: '#F1F5F9', border: 'none', borderRadius: '0.75rem', padding: '0.6rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 700 }}>
                Girar Cámara
              </button>
              <button type="button" onClick={capturePhoto} style={{ flex: 2, minHeight: '48px', background: '#FF9F1C', color: '#0F172A', border: 'none', borderRadius: '1rem', padding: '0.75rem 1rem', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 900 }}>
                Tomar Foto
              </button>
              <button type="button" onClick={() => { closeCamera(); fileInputRef.current?.click(); }} style={{ flex: 1, minHeight: '44px', background: '#1E293B', color: '#F1F5F9', border: 'none', borderRadius: '0.75rem', padding: '0.6rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 700 }}>
                Galería
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
