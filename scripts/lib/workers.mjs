// Постоянный Python-воркер с протоколом «JSON по строке»: модели грузятся один раз,
// запросы сопоставляются с ответами по id.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export function startWorker(name, command, args, { cwd, env = {}, readyTimeoutMs = 300_000 } = {}) {
  const proc = spawn(command, args, {
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = new Map();
  let nextId = 1;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const timer = setTimeout(() => rejectReady(new Error(`${name}: не поднялся за ${readyTimeoutMs} мс`)), readyTimeoutMs);

  // Хвост stderr — чтобы при падении воркера было видно причину, а не просто код выхода.
  const errTail = [];
  readline.createInterface({ input: proc.stderr }).on('line', (l) => {
    errTail.push(l);
    if (errTail.length > 40) errTail.shift();
  });
  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; } // посторонний вывод библиотек
    if (msg.ready) { clearTimeout(timer); resolveReady(msg); return; }
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p.resolve(msg); }
  });
  proc.on('exit', (code) => {
    const err = new Error(`${name}: процесс завершился (код ${code})\n${errTail.join('\n')}`);
    clearTimeout(timer);
    rejectReady(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });

  return {
    name,
    ready,
    call(payload, timeoutMs = 60_000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { pending.delete(id); reject(new Error(`${name}: таймаут ${timeoutMs} мс`)); }, timeoutMs);
        pending.set(id, {
          resolve: (m) => { clearTimeout(t); resolve(m); },
          reject: (e) => { clearTimeout(t); reject(e); },
        });
        proc.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
      });
    },
    stop() {
      proc.stdin.end();
      proc.kill();
    },
  };
}
