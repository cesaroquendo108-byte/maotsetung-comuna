# Comuna Mao Tse Tung · Plataforma de Gestión Sociodemográfica y Fiscal

Plataforma comunitaria e institucional para la administración de censo de hogares, ciclos de abastecimiento CLAP, gas doméstico, reporte de averías en servicios públicos, tesorería comunal (Fondo Comunal de Inversión y Desarrollo) e inteligencia sociodemográfica para la **Comuna Socialista Mao Tse Tung** (Parroquia San Agustín, Municipio Bolivariano Libertador, Caracas).

Proyecto desarrollado en alianza estratégica y académica con la **Escuela Nacional de Administración y Hacienda Pública (ENAHP-IUT)** para el cumplimiento del Servicio Comunitario en Ciencias Fiscales y la canalización de inclusión financiera en el Mercado de Valores de Caracas (BVC).

---

## Ámbito Territorial (5 Consejos Comunales de San Agustín)

1. **CC-SAC:** Consejo Comunal San Agustín Centro
2. **CC-MNG:** Consejo Comunal El Manguito
3. **CC-LCH:** Consejo Comunal La Charneca
4. **CC-HDC:** Consejo Comunal Hornos de Cal
5. **CC-MRN:** Consejo Comunal Marín

---

## Características Principales

- **Registro Progresivo y Escaneo Óptico (OCR):** Extracción automatizada de datos desde la Cédula de Identidad venezolana y el comprobante digital de RIF del SENIAT utilizando modelos de visión por inteligencia artificial (Google Gemini Vision vía OpenRouter).
- **Tablero de Inteligencia BI Comunal:** Análisis demográfico de pirámide poblacional, índice de vulnerabilidad de salud, matriz de cilindros de gas por capacidad/válvula, cobertura de almacenamiento de agua potable e Índice de Potencial Finve para bancarización bursátil.
- **Fondo Comunal de Inversión y Desarrollo:** Gestión de tesorería comunitaria con doble denominación (VES / USD a tasa oficial del Banco Central de Venezuela), cálculo de hash criptográfico SHA-256 para prevenir pagos duplicados y trazabilidad contable fiduciaria conforme a los Artículos 44 y 45 de la Ley Orgánica de los Consejos Comunales.
- **Georreferenciación San Agustín:** Mapa interactivo sobre capas OpenStreetMap centrado en las coordenadas geográficas reales de la parroquia San Agustín (`10.4940, -66.9048`).
- **Exportación Fiduciaria Sin Emojis:** Reportes de censo y prospectos de inversión en formato CSV y Excel con rigor formal de banca de inversión.

---

## Requisitos y Desarrollo Local

Requisitos del sistema:
- Node.js LTS (v20 o superior)
- Instancia de PocketBase v0.22+ (puerto local 8090 o remoto 8094)

### Comandos de Desarrollo:

```bash
# Instalar dependencias
npm install

# Ejecutar suite de pruebas unitarias (64 pruebas deterministas)
npm test

# Ejecutar compilación de producción con Vite
npm run build

# Iniciar servidor de desarrollo local
npm run dev
```

### Inicialización de la Comuna en PocketBase:

```bash
export PB_URL="http://127.0.0.1:8090"
export PB_ADMIN_EMAIL="admin@maotsetung.local"
export PB_ADMIN_PASSWORD="TuClaveSeguraPocketBase"

node scripts/seed-maotsetung-pb.mjs
```

---

## Documentación de Referencia

- Dossier Técnico ENAHP: `docs/DOSSIER_TECNICO_ENAHP.md`
- Instrumento Diagnóstico: `Documentos/Instrumento_Diagnostico_Comuna_Mao_Tse_Tung(2)(1).docx`
- Configuración Institucional: `src/config/community.js`
