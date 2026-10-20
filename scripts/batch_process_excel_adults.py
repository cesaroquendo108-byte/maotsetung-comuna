import xlrd
import datetime
import time
import urllib.request
import json

filePath = r'C:\Users\cesar\Downloads\CORPOMIRANDA CENSO UROPROFIN.xls'
outputPath = r'C:\Users\cesar\Documents\Uroprofin\resultados_lotes_adultos.md'
wb = xlrd.open_workbook(filePath)

current_year = 2026
recalculated = []

def parse_val(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return str(v).strip()

def excel_date_to_year(val):
    if isinstance(val, float) and val > 1000:
        try:
            dt = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=val)
            return dt.year, dt.strftime('%Y-%m-%d')
        except:
            pass
    return None, None

for sname in wb.sheet_names():
    sheet = wb.sheet_by_name(sname)
    if sheet.nrows < 7:
        continue
    
    for r in range(7, sheet.nrows):
        cedula = parse_val(sheet.cell_value(r, 7)) if sheet.ncols > 7 else ''
        fname = parse_val(sheet.cell_value(r, 8)) if sheet.ncols > 8 else ''
        lname = parse_val(sheet.cell_value(r, 9)) if sheet.ncols > 9 else ''
        full_name = f'{fname} {lname}'.strip()
        
        if not full_name or full_name.upper() in ['NOMBRES', 'NOMBRE', 'TOTAL', 'FORMATO']:
            continue
            
        birth_raw = sheet.cell_value(r, 12) if sheet.ncols > 12 else ''
        byear, bstr = excel_date_to_year(birth_raw)
        
        edad_excel = parse_val(sheet.cell_value(r, 13)) if sheet.ncols > 13 else ''
        parentesco = parse_val(sheet.cell_value(r, 16)) if sheet.ncols > 16 else ''
        
        orig_age = None
        if isinstance(edad_excel, int):
            orig_age = edad_excel
        elif isinstance(edad_excel, str) and (edad_excel.endswith('M') or 'MES' in edad_excel.upper()):
            orig_age = 0
        else:
            try:
                orig_age = int(float(edad_excel))
            except:
                pass
                
        if orig_age is not None and orig_age < 18:
            current_age = (current_year - byear) if byear else (orig_age + 9)
            clean_ced = str(cedula).replace('.0', '').strip()
            if current_age >= 18 and clean_ced and clean_ced != 'S/N' and len(clean_ced) > 4:
                recalculated.append({
                    'name': full_name,
                    'cedula': clean_ced,
                    'parentesco': parentesco,
                    'birth_date': bstr or '',
                    'current_age': current_age,
                    'sheet': sname
                })

print(f'Total personas a consultar en lotes de 40: {len(recalculated)}')

chunk_size = 40
chunks = [recalculated[i:i + chunk_size] for i in range(0, len(recalculated), chunk_size)]

with open(outputPath, 'w', encoding='utf-8') as f:
    f.write('# RESULTADOS DE CONSULTA POR LOTES (CNE / EDADES)\n\n')

for batch_idx, chunk in enumerate(chunks, 1):
    timestamp = datetime.datetime.now().strftime('%H:%M:%S')
    print('--------------------------------------------------')
    print(f'EJECUTANDO LOTE {batch_idx} DE {len(chunks)} ({len(chunk)} personas) - Hora: {timestamp}')
    print('--------------------------------------------------')
    
    batch_results = []
    for idx, item in enumerate(chunk, 1):
        url = f'https://api.cedula.com.ve/api/v1?app_id=9354&token=5a34b11edc91ba134780588f1e7ad3a2&nacionalidad=V&cedula={item["cedula"]}'
        fecha_nac = 'Sin fecha en API'
        centro = 'Sin centro'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Uroprofin/1.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                d = data.get('data', {})
                fecha_nac = d.get('fecha_nac') or 'Sin fecha'
                centro = d.get('centro_electoral') or 'Sin centro'
        except Exception:
            fecha_nac = 'Error / No disponible'
            
        res_line = f'{idx}. {item["name"]} | V-{item["cedula"]} | Nacimiento: {fecha_nac} | Centro: {centro}'
        print(res_line)
        batch_results.append((item["name"], item["cedula"], fecha_nac, centro, item["sheet"]))
        time.sleep(0.15)
        
    with open(outputPath, 'a', encoding='utf-8') as f:
        f.write(f'## Lote {batch_idx} ({timestamp})\n\n')
        f.write('| # | Nombre y Apellido | Cédula | Fecha de Nacimiento | Centro Electoral | Sector |\n')
        f.write('| :--- | :--- | :--- | :--- | :--- | :--- |\n')
        for i, res in enumerate(batch_results, 1):
            f.write(f'| {i} | **{res[0]}** | V-{res[1]} | `{res[2]}` | {res[3]} | {res[4]} |\n')
        f.write('\n---\n\n')

    if batch_idx < len(chunks):
        print(f'\nPausa de seguridad de 2 minutos (120 segundos) antes del Lote {batch_idx + 1}...\n')
        time.sleep(120)

print('\nTODOS LOS LOTES COMPLETADOS EXITOSAMENTE!')
