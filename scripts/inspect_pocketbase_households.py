import urllib.request
import json

PB_URL = 'https://pb-uroprofin.157.173.104.214.nip.io'

# Try to get public list or list through API
try:
    url = f'{PB_URL}/api/collections/communes/records'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print('Communes:', data.get('items'))
except Exception as e:
    print('Communes error:', e)

try:
    url = f'{PB_URL}/api/collections/households/records'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print('Households count:', data.get('totalItems'))
        print('First 5 households:', data.get('items')[:5])
except Exception as e:
    print('Households error:', e)
