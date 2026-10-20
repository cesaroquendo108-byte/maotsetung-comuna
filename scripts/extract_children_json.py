import xlrd
import datetime
import json

filePath = r'C:\Users\cesar\Downloads\CORPOMIRANDA CENSO UROPROFIN.xls'
wb = xlrd.open_workbook(filePath)
current_year = 2026
children = []

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
        fn = parse_val(sheet.cell_value(r, 8)) if sheet.ncols > 8 else ''
        ln = parse_val(sheet.cell_value(r, 9)) if sheet.ncols > 9 else ''
        full_name = f'{fn} {ln}'.strip()
        if not full_name or full_name.upper() in ['NOMBRES', 'NOMBRE', 'TOTAL', 'FORMATO', 'APELLIDOS']:
            continue

        ced = parse_val(sheet.cell_value(r, 7)) if sheet.ncols > 7 else ''
        birth_raw = sheet.cell_value(r, 12) if sheet.ncols > 12 else ''
        bstr, byear = excel_date_to_str(birth_raw)
        edad_excel = parse_val(sheet.cell_value(r, 13)) if sheet.ncols > 13 else ''
        parentesco = parse_val(sheet.cell_value(r, 16)) if sheet.ncols > 16 else ''
        sexo = parse_val(sheet.cell_value(r, 14)) if sheet.ncols > 14 else ''

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
            if curr_age < 18:
                clean_c = str(ced).replace('.0', '').replace('V-', '').replace('E-', '').strip()
                if clean_c in ['S/N', '0', '', 'None']:
                    clean_c = ''
                
                sex_norm = ''
                if sexo:
                    s = str(sexo).upper().strip()
                    if s in ['F', 'FEMENINO', 'FEM']:
                        sex_norm = 'F'
                    elif s in ['M', 'MASCULINO', 'MASC']:
                        sex_norm = 'M'

                children.append({
                    'firstName': fn.upper().strip(),
                    'lastName': ln.upper().strip(),
                    'idNumber': f'V-{clean_c}' if clean_c else '',
                    'nationality': 'V',
                    'birthDate': bstr,
                    'relationship': str(parentesco).strip() if parentesco else 'Hijo/a',
                    'sex': sex_norm,
                    'sector': sname,
                    'currentAge': curr_age,
                })

print(f'Total niños (<18 en 2026): {len(children)}')
with open(r'C:\Users\cesar\Documents\Uroprofin\scripts\children_data.json', 'w', encoding='utf-8') as f:
    json.dump(children, f, ensure_ascii=False, indent=2)
print('Guardado en scripts/children_data.json')
