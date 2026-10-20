# Presentacion Ejecutiva: Modernizacion y Gestion Fiscal Digital en la Comuna Mao Tse Tung

## Proyecto de Servicio Comunitario · Escuela Nacional de Administracion y Hacienda Pública (ENAHP-IUT)
**Carrera:** Ciencias Fiscales (Menciones: Finanzas Publicas, Rentas y Aduanas)  
**Entidad Territorial:** Comuna Socialista Mao Tse Tung, Parroquia San Agustin, Municipio Bolivariano Libertador, Caracas  
**Presentador:** David Hernandez y Equipo Tecnico ENAHP  
**Tutor Academico:** Coordinacion de Servicio Comunitario ENAHP  
**Ambito Operativo:** 5 Consejos Comunales (San Agustin Centro, El Manguito, La Charneca, Hornos de Cal, Marin)  
**Fecha:** Octubre 2026  

---

## Estructura de la Defensa / Guion de Ponencia

### Diapositiva 1: Portada Institucional y Contexto Academico
- **Titulo:** Sistema Digital de Caracterizacion Sociodemografica, Tesoreria Comunal e Inclusion Financiera.
- **Institucion:** Escuela Nacional de Administracion y Hacienda Publica (ENAHP-IUT), organo adscrito al Ministerio del Poder Popular de Economia y Finanzas.
- **Marco Legal:** Ley de Servicio Comunitario del Estudiante de Educacion Superior; Ley Organica del Poder Popular; Ley Organica de las Comunas; Ley Organica de los Consejos Comunales (Arts. 44 y 45).
- **Mensaje Clave:** La aplicacion practica de las Ciencias Fiscales y las Finanzas Publicas al servicio directo del Poder Popular en el corazon historico de Caracas: San Agustin.

---

### Diapositiva 2: El Diagnostico Fiscal y Social en San Agustin
- **Limitaciones del Modelo Tradicional:**
  1. *Fragmentacion de Datos:* Censos levantados en papel y cuadernos escolares, con perdida recurrente de folios, ilegibilidad de cedulas y desactualizacion inmediata.
  2. *Vulnerabilidad Operativa:* Dificultad para coordinar contingencias de servicios publicos (abastecimiento de gas domestico, ciclos de agua y entrega CLAP).
  3. *Opacidad y Desconfianza en Tesoreria:* Manejo manual de aportes vecinales en efectivo o transferencias no conciliadas, generando friccion en asambleas ciudadanas.
  4. *Perdida de Poder Adquisitivo:* Omision del impacto cambiario e inflacionario en la ejecucion de presupuestos y proyectos comunales.
- **Impacto Poblacional:** Mas de 300 a 500 familias vulnerables en 5 sectores topograficamente complejos.

---

### Diapositiva 3: Arquitectura Tecnologica de la Plataforma `maotsetung-comuna`
- **Desarrollo Soberano y de Alta Disponibilidad:**
  - *Front-End:* Aplicacion Web Progresiva (PWA) e hibrida movil (Capacitor/Android) desarrollada en React 19 y Vite, con soporte fuera de linea (offline-first) para trabajo de campo en veredas sin cobertura.
  - *Back-End:* Instancia dedicada de alta velocidad sobre Linux/PocketBase en la nube (`steam-vps`), protegida con cifrado AES-256 (`PB_ENCRYPTION_KEY`) y proxy inverso seguro Caddy con certificados SSL/TLS automaticos.
  - *Vision Artificial Forense:* Extraccion automatica de documentos (Cedula de Identidad y RIF SENIAT) mediante modelos de vision multimodal con inferencia de alta precision, eliminando errores de transcripcion mecanica.

---

### Diapositiva 4: Correspondencia Exacta con el Instrumento Diagnostico ENAHP (10 Bloques)
La plataforma digitaliza integralmente los diez bloques de investigacion comunal:
1. **Bloque I (Territorio):** Georreferenciacion interactiva con mapas vectoriales OpenStreetMap (lat: 10.4940, lng: -66.9048) y zonificacion por codigo unico de vivienda (`MTT-[CONSEJO]-[NUMERO_CASA]`).
2. **Bloque II (Jefaturas y Familia):** Arbol de parentesco digital, identificacion de jefes/jefas de hogar y menores dependientes.
3. **Bloque III (Salud Comunitaria):** Registro de patologias cronicas (hipertension, diabetes) para focalizacion de insumos medicos.
4. **Bloque IV (Servicios Publicos):** Matriz de cilindros de gas domestico (10kg, 18kg, 43kg, tipo de valvula) y capacidad de almacenamiento de agua.
5. **Bloque V (Distribucion CLAP):** Padrón digital de beneficiarios y auditoria de entregas con firma y cedula del receptor.
6. **Bloque VI (Tesoreria Comunal):** Conciliacion bancaria sistematizada y prevencion de fraude en comprobantes de Pago Movil.
7. **Bloque VII (Proteccion Cambiaria):** Calculo multi-moneda en Bolivares (VES) y Dolares (USD) a tasa oficial del Banco Central de Venezuela (BCV).
8. **Bloque VIII (Contraloria Social):** Exportacion de libros censales y balances a formatos universales (CSV, Excel) con politica estricta de Cero Emojis.
9. **Bloque IX (Economia Comunal):** Clasificacion de oficios y competencias laborales en 15 areas tecnicas para cuadrillas comunales.
10. **Bloque X (Inversion y Finve):** Evaluacion de bancarizacion y potencial inversionista para inclusion en la Bolsa de Valores de Caracas (BVC).

---

### Diapositiva 5: Descentralizacion y Control por Consejo Comunal
- **Segmentacion Autonoma:**
  - La plataforma opera como una confederacion comunal que respeta la identidad e independencia de cada uno de los 5 Consejos Comunales:
    - *SAC:* San Agustin Centro
    - *MNG:* El Manguito
    - *LCH:* La Charneca
    - *HDC:* Hornos de Cal
    - *MRN:* Marin
- **Filtrado Dinamico en 1 Clic:** Los voceros de cada consejo pueden consultar, validar y exportar exclusivamente el padron de su poligonal territorial, o consolidar la vision global de la comuna para negociaciones institucionales.

---

### Diapositiva 6: Innovacion Fiscal: Tesoreria Digital y Trazabilidad Criptografica
- **Cumplimiento de los Articulos 44 y 45 de la Ley Organica de los Consejos Comunales:**
  - *Validacion Criptografica de Pagos:* Cada comprobante bancario procesado genera un hash SHA-256 unico. Si un habitante intenta registrar dos veces la misma transferencia o captura, el sistema rechaza la transaccion inmediatamente, erradicando los aportes duplicados.
  - *Inteligencia Artificial Financiera:* El modulo de tesoreria lee el monto, fecha y banco emisor desde la imagen del comprobante de Pago Movil y concilia contra la cuota comunal fijada en Asambleas.
  - *Soberania Monetaria:* Aportes en Bolivares con registro del contravalor fiduciario en divisas referenciales BCV, permitiendo auditorias transparentes ante el Consejo Local de Planificacion Publica (CLPP) y la Contraloria General de la Republica.

---

### Diapositiva 7: Inclusion Financiera: El Indice de Potencial Finve
- **De la Asistencia Social al Desarrollo Patrimonial Comunitario:**
  - El sistema incorpora el algoritmo cuantitativo de 4 pilares (0 a 100 puntos):
    1. *Cumplimiento KYC e Identidad (25%):* Validacion fiscal SENIAT y cedulacion vigente.
    2. *Capacidad Productiva (25%):* Oficios tecnicos, ingreso formal y tenencia habitacional.
    3. *Compromiso Comunitario (25%):* Historial de solvencia con los fondos comunales.
    4. *Bancarizacion Digital (25%):* Uso de herramientas de pago electronico y canales moviles.
- **Conexion con el Mercado de Capitales:**
  - Permite canalizar a familias solventes hacia programas de ahorro en renta fija privada comercial venezolana (papeles comerciales e inversiones supervisadas por SUNAVAL / BVC a traves de Statera Casa de Bolsa).

---

### Diapositiva 8: Demostracion Operativa en Vivo (Puntos Clave del Sistema)
1. **Flujo de Registro Digital:** Demostracion de captura de Cedula/RIF y registro automatico del jefe de hogar en menos de 45 segundos.
2. **Tablero de Control Censal:** Uso de la barra de filtros por Consejo Comunal y visualizacion de estatus electoral CNE.
3. **Modulo de Tesoreria:** Subida de comprobante bancario, verificacion de hash y asignacion contable.
4. **Exportacion Fiduciaria:** Descarga del reporte censal en formato CSV institucional para rendicion de cuentas.

---

### Diapositiva 9: Conclusiones y Aporte al Servicio Comunitario ENAHP
- **Trascendencia Academica:** Este proyecto no culmina en un informe teorico empastado; entrega un activo tecnologico real, soberano y operativo que queda en manos del Poder Popular y de la ENAHP para sucesivas cohortes estudiantiles.
- **Rigor Fiduciario:** Demuestra que las herramientas modernas de las finanzas y la ciencia de datos son perfectamente aplicables al entorno comunal, promoviendo la transparencia, la soberania monetaria y la eficiencia del gasto publico comunitario.
- **Impacto Institucional:** Posiciona a la Comuna Mao Tse Tung y a la ENAHP como pioneras nacionales en gobernanza comunal digital en Venezuela.

---

## Preguntas Frecuentes Anticipadas ante el Jurado Evaluador

**1. ¿Como se garantiza la privacidad de los datos personales de los vecinos?**  
*Respuesta:* El sistema implementa aislamiento por roles (RBAC). Un vecino comun unicamente puede ver la ficha de su propio hogar. Los voceros tienen acceso restringido a su consejo comunal, y el acceso administrativo global esta reservado exclusivamente a voceros principales certificados con doble autenticacion en servidores seguros.

**2. ¿Que ocurre si falla la conectividad electrica o de internet en San Agustin?**  
*Respuesta:* La aplicacion cuenta con persistencia local en caché (PWA e IndexedDB). Los censadores pueden registrar datos casa por casa en zonas sin cobertura celular; al retornar a una zona con conexion, el sistema sincroniza los registros en lote de forma idempotente sin duplicar cedulas.

**3. ¿Cual es la base legal para el manejo del Fondo Comunal de Inversion?**  
*Respuesta:* El diseno sigue estrictamente los Articulos 44 y 45 de la Ley Organica de los Consejos Comunales y el Articulo 34 de la Ley Organica de las Comunas, los cuales establecen la obligatoriedad de la rendicion trimestral de cuentas con soportes contables verificables.
