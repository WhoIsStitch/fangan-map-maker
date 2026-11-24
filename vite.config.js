import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectsDir = path.join(root, 'projects');
const SAFE = /^[\w\- .()']+\.tvfmap\.json$/;

/**
 * Tiny local save service: lets the app save projects straight into MapMaker/projects/ on disk
 * (no downloads). Only available while the local dev server runs (Start Map Maker.cmd).
 *   GET  /api/projects          -> [{ file, id, name, savedAt, size }]
 *   GET  /api/projects/<file>   -> the project JSON
 *   PUT  /api/projects/<file>   -> write the project JSON
 */
function saveService() {
  return {
    name: 'tvf-save-service',
    configureServer(server) {
      server.middlewares.use('/api/projects', (req, res) => {
        const send = (code, body, type = 'application/json') => { res.statusCode = code; res.setHeader('Content-Type', type); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
        try {
          fs.mkdirSync(projectsDir, { recursive: true });
          const name = decodeURIComponent((req.url || '/').replace(/^\/+/, '').split('?')[0]);
          if (!name) {
            if (req.method !== 'GET') return send(405, { error: 'method' });
            const list = fs.readdirSync(projectsDir).filter((f) => SAFE.test(f)).map((f) => {
              const full = path.join(projectsDir, f);
              const st = fs.statSync(full);
              let id = '', pname = f;
              try { const head = JSON.parse(fs.readFileSync(full, 'utf8')); id = head.id || ''; pname = head.name || f; } catch { /* unreadable */ }
              return { file: f, id, name: pname, savedAt: st.mtimeMs, size: st.size };
            });
            return send(200, list);
          }
          if (!SAFE.test(name) || name.includes('..') || name.includes('/') || name.includes('\\')) return send(400, { error: 'bad file name' });
          const full = path.join(projectsDir, name);
          if (req.method === 'GET') {
            if (!fs.existsSync(full)) return send(404, { error: 'not found' });
            return send(200, fs.readFileSync(full, 'utf8'));
          }
          if (req.method === 'PUT' || req.method === 'POST') {
            const chunks = [];
            let size = 0;
            req.on('data', (c) => { size += c.length; if (size > 100 * 1024 * 1024) req.destroy(); else chunks.push(c); });
            req.on('end', () => {
              try {
                const text = Buffer.concat(chunks).toString('utf8');
                JSON.parse(text); // refuse anything that isn't JSON
                const tmp = full + '.tmp';
                fs.writeFileSync(tmp, text, 'utf8');
                fs.renameSync(tmp, full); // atomic-ish: never leaves a half-written project
                send(200, { ok: true, file: name, path: path.relative(root, full) });
              } catch (err) { send(500, { error: err.message }); }
            });
            return;
          }
          send(405, { error: 'method' });
        } catch (err) { send(500, { error: err.message }); }
      });
    },
  };
}

export default defineConfig({
  plugins: [saveService()],
  server: { port: 5178, strictPort: true, open: false, watch: { ignored: ['**/projects/**'] } },
  preview: { port: 5178 },
  base: './',
});
