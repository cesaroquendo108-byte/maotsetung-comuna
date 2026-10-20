import xlrd
import datetime
import time
import urllib.request
import json
import os

filePath = r'C:\Users\cesar\Downloads\CORPOMIRANDA CENSO UROPROFIN.xls'
outputPath = r'C:\Users\cesar\Documents\Uroprofin\resultados_sincronizacion_censo.md'
wb = xlrd.open_workbook(filePath)

current_year = 2026
children_to_sync = []
adults_to_sync = []

def parse_val(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return str(v).strip()

def excel_date_to_str(val):
    if isinstance(val, float) and val > 1000:
        try:
            dt = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=val)
            return dt.strftime('%Y-%m-%d'), dt.year
        except:
            pass
    return '', None

for sname in wb.sheet_names():
    sheet = wb.sheet_by_name(sname)
    if sheet.nrows < 7:
        continue
    
    for r in range(7, sheet.nrows):
        ced = parse_val(sheet.cell_value(r, 7)) if sheet.ncols > 7 else ''
        fn = parse_val(sheet.cell_value(r, 8)) if sheet.ncols > 8 else ''
        ln = parse_val(sheet.cell_value(r, 9)) if sheet.ncols > 9 else ''
        full_name = f'{fn} {ln}'.strip()
        
        if not full_name or full_name.upper() in ['NOMBRES', 'NOMBRE', 'TOTAL', 'FORMATO']:
            continue
            
        birth_raw = sheet.cell_value(r, 12) if sheet.ncols > 12 else ''
        bstr, byear = excel_date_to_str(birth_raw)
        
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
            curr_age = (current_year - byear) if byear else (orig_age + 9)
            clean_c = str(ced).replace('.0', '').replace('V-', '').replace('E-', '').strip()
            
            entry = {
                'firstName': fn,
                'lastName': ln,
                'cedula': clean_c if clean_c != 'S/N' else '',
                'birthDate': bstr,
                'age': curr_age,
                'parentesco': parentesco,
                'sector': sname
            }
            
            if curr_age < 18:
                children_to_sync.append(entry)
            else:
                adults_to_sync.append(entry)

print(f'Total Niños (<18 en 2026): {len(children_to_sync)}')
print(f'Total Nuevos Adultos (>=18 en 2026): {len(adults_to_sync)}')

# Split adults with cédula into chunks of 40
adults_with_id = [a for a in adults_to_sync if a['cedula'] and len(a['cedula']) > 4]
chunk_size = 40
chunks = [adults_with_id[i:i + chunk_size] for i in range(0, len(adults_with_id), chunk_size)]

with open(outputPath, 'w', encoding='utf-8') as f:
    f.write('# REPORTES DE VERIFICACIÓN DE ADULTOS Y NIÑOS\n\n')
    f.write(f'• **Niños actuales (<18 años)**: {len(children_to_sync)} registrados.\n')
    f.write(f'• **Nuevos adultos para votar (≥18 años)**: {len(adults_to_sync)} ({len(adults_with_id)} con cédula para CNE).\n\n')

for batch_idx, chunk in enumerate(chunks, 1):
    timestamp = datetime.datetime.now().strftime('%H:%M:%S')
    print('--------------------------------------------------')
    print(f'CONSULTANDO CNE - LOTE {batch_idx} DE {len(chunks)} ({len(chunk)} personas) - Hora: {timestamp}')
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
            
        res_line = f'{idx}. {item["firstName"]} {item["lastName"]} | V-{item["cedula"]} | Nacimiento CNE: {fecha_nac} | Centro: {centro}'
        print(res_line)
        batch_results.append((f'{item["firstName"]} {item["lastName"]}', item["cedula"], fecha_nac, centro, item["sector"]))
        time.sleep(0.15)
        
    with open(outputPath, 'a', encoding='utf-8') as f:
        f.write(f'## Lote {batch_idx} ({timestamp})\n\n')
        f.write('| # | Nombre y Apellido | Cédula | Fecha Nacimiento CNE | Centro Electoral | Sector |\n')
        f.write('| :--- | :--- | :--- | :--- | :--- | :--- |\n')
        for i, res in enumerate(batch_results, 1):
            f.write(f'| {i} | **{res[0]}** | V-{res[1]} | `{res[2]}` | {res[3]} | {res[4]} |\n')
        f.write('\n---\n\n')

    if batch_idx < len(chunks):
        print(f'\nPausa de seguridad de 2 minutos (120 segundos) antes del Lote {batch_idx + 1}...\n')
        time.sleep(120)

print('\n¡PROCESO COMPLETADO Y CNE VERIFICADO EXITOSAMENTE!')
