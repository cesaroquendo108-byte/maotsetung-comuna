import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: { target: { type: 'string' } } });
if (!values.target) {
  console.error('Uso: npm run pb:setup -- --target "C:\\ruta\\pocketbase-uroprofin"');
  process.exit(1);
}

const target = path.resolve(values.target);
const root = path.parse(target).root;
if (target === root || target.length <= root.length + 2) throw new Error('El destino es demasiado amplio. Usa el directorio exclusivo de Uroprofin.');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(scriptDir, '..', 'infra', 'pocketbase');
await fs.access(path.join(source, 'pb_migrations'));
await fs.access(path.join(source, 'pb_hooks'));
await fs.mkdir(target, { recursive: true });
await fs.cp(path.join(source, 'pb_migrations'), path.join(target, 'pb_migrations'), { recursive: true, force: false, errorOnExist: true });
await fs.cp(path.join(source, 'pb_hooks'), path.join(target, 'pb_hooks'), { recursive: true, force: false, errorOnExist: true });

console.log(`Infraestructura copiada en ${target}`);
console.log('Revisa los archivos y ejecuta "pocketbase migrate up" desde ese directorio en un entorno de ensayo.');
