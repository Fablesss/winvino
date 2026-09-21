// Постоянный Python-воркер с протоколом «JSON по строке»: модели грузятся один раз,
// запросы сопоставляются с ответами по id.
//
// Воркер под надзором: упал — перезапускается с нарастающей паузой; завис на запросе —
// убивается по таймауту и тоже перезапускается (иначе вся очередь стоит за ним вечно).
// Пока он поднимается, запросы сразу получают WorkerUnavailableError, а не ждут.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

/** Воркер сейчас не может ответить: поднимается, перезапускается или завис. */
export class WorkerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkerUnavailableError';
  }
}

export function startWorker(name, command, args, {
  cwd,
  env = {},
  readyTimeoutMs = 300_000,
  callTimeoutMs = 60_000,
  restartDelayMs = 1_000,
  maxRestartDelayMs = 30_000,
  log = console.error,
} = {}) {
  const pending = new Map();
  const readyListeners = new Set();
  let nextId = 1;
  let proc = null;
  let info = null; // строка {ready: true, ...} текущего процесса; null — не готов
  let stopped = false;
  let delay = restartDelayMs;

  function spawnProcess() {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    proc = child;
    const errTail = []; // хвост stderr — причина падения в логе, а не просто код выхода
    const readyTimer = setTimeout(() => {
      log(`${name}: не поднялся за ${readyTimeoutMs} мс, перезапуск`);
      child.kill();
    }, readyTimeoutMs);

    child.stdin.on('error', () => {}); // EPIPE при записи в умерший процесс не должен ронять сервис
    readline.createInterface({ input: child.stderr }).on('line', (l) => {
      errTail.push(l);
      if (errTail.length > 40) errTail.shift();
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; } // посторонний вывод библиотек
      if (msg.ready) {
        clearTimeout(readyTimer);
        info = msg;
        delay = restartDelayMs;
        for (const fn of [...readyListeners]) fn(msg);
        return;
      }
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p.resolve(msg); }
    });
    child.on('error', (err) => log(`${name}: не удалось запустить ${command}: ${err.message}`));
    child.on('close', (code, signal) => {
      clearTimeout(readyTimer);
      if (proc === child) { proc = null; info = null; }
      const err = new WorkerUnavailableError(`${name}: процесс завершился (${code ?? signal})`);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      if (stopped) return;
      log(`${name}: процесс завершился (${code ?? signal}), перезапуск через ${delay} мс\n${errTail.slice(-12).join('\n')}`);
      setTimeout(spawnProcess, delay);
      delay = Math.min(delay * 2, maxRestartDelayMs);
    });
  }

  spawnProcess();

  return {
    name,
    /** Первый подъём воркера. */
    ready: new Promise((resolve) => {
      const once = (msg) => { readyListeners.delete(once); resolve(msg); };
      readyListeners.add(once);
    }),
    isReady: () => info !== null,
    /** Вызывается на каждый подъём, включая перезапуски. */
    onReady(fn) { readyListeners.add(fn); },
    call(payload, timeoutMs = callTimeoutMs) {
      if (!proc || !info) return Promise.reject(new WorkerUnavailableError(`${name}: не готов`));
      const child = proc;
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          pending.delete(id);
          reject(new WorkerUnavailableError(`${name}: нет ответа за ${timeoutMs} мс, перезапуск`));
          child.kill();
        }, timeoutMs);
        pending.set(id, {
          resolve: (m) => { clearTimeout(t); resolve(m); },
          reject: (e) => { clearTimeout(t); reject(e); },
        });
        child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
      });
    },
    stop() {
      stopped = true;
      proc?.stdin.end();
      proc?.kill();
    },
  };
}
