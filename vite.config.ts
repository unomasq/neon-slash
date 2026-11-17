import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

// COOP/COEP нужны для SharedArrayBuffer (многопоточный wasm tfjs); credentialless не ломает сторонние ресурсы
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

/**
 * tfjs-wasm собирает код pthread-воркера как `'var WasmBackendModuleThreadedSimd = ' + factory.toString()`.
 * Фабрика ссылается на внешнюю переменную _scriptDir (объявлена в обёртке IIFE); после минификации/бандлинга
 * имя меняется, а внешняя область в blob недоступна -> «ReferenceError: e is not defined» в подворкере.
 * Убираем внешнюю зависимость: _scriptDir -> undefined (blob передаётся через mainScriptUrlOrBlob).
 */
const wasmThreadFix = (): Plugin => ({
  name: 'tfjs-wasm-pthread-fix',
  enforce: 'pre',
  transform(code, id) {
    if (!/tfjs-backend-wasm-threaded-simd\.js$/.test(id.split('?')[0]!)) return null;
    const out = code
      .replace(/var _scriptDir = [^;]*;/, '')
      .replace(/if \(typeof __filename !== 'undefined'\) _scriptDir = [^;]*;/, '')
      .replace(/\b_scriptDir\b/g, 'undefined');
    return { code: out, map: null };
  },
});

export default defineConfig({
  server: { host: true, headers: isolation },
  preview: { headers: isolation },
  plugins: [wasmThreadFix()],
  worker: { format: 'es', plugins: () => [wasmThreadFix()] },
  // pose-detection тянет @mediapipe/pose (битый ESM-экспорт) — подменяем заглушкой
  resolve: { alias: { '@mediapipe/pose': fileURLToPath(new URL('./src/tracking/mediapipePoseStub.ts', import.meta.url)) } },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
