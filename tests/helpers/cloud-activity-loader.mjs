import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'mock:cloud-env', shortCircuit: true };
  if (specifier.endsWith('/_lib/auth')) return { url: 'mock:cloud-auth', shortCircuit: true };
  if (specifier === '../../../../db') return { url: 'mock:cloud-db', shortCircuit: true };
  if (specifier.endsWith('/write-rate-limit')) return { url: 'mock:cloud-rate', shortCircuit: true };
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
    return next(new URL(specifier + '.ts', context.parentURL).href, context);
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  const mocks = {
    'mock:cloud-env': 'export const env=new Proxy({}, {get:(_,key)=>globalThis.__cloudTest.env[key]});',
    'mock:cloud-auth': 'export async function getAuthorizedUser(){return globalThis.__cloudTest.actor}',
    'mock:cloud-db': 'export async function getDb(){throw new Error("unexpected write")}',
    'mock:cloud-rate': 'export async function consumeWriteRateLimit(){throw new Error("unexpected write")}',
  };
  if (url in mocks) return { format: 'module', source: mocks[url], shortCircuit: true };
  if (url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(await readFile(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  return next(url, context);
}
