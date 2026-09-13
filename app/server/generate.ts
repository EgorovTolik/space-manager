// Запуск Python-солвера как внешнего процесса (ТЗ 02 §6.10; 01 §7).
// аргументы — массив (без shell), maxBuffer-лимит на вывод 10 МБ,
// hard timeout с SIGKILL и удалением частичного файла — в обработчике index.ts.
import { spawn, type ChildProcess } from 'node:child_process';

export interface SolverRunResult {
  exitCode: number | null; // null — процесс не завершился (timeout/ошибка spawn)
  timedOut: boolean;
  spawnError: string | null; // сообщение об ошибке spawn (например, нет python)
  stdout: string;
  stderr: string;
}

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // maxBuffer 10 МБ (ТЗ 01 §7)

export function runSolver(
  pythonBin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; /** Внешний стоп (LLM-сессии): SIGKILL child-процесса, тот же механизм, что таймаут. */ signal?: AbortSignal },
): Promise<SolverRunResult> {
  return new Promise<SolverRunResult>((resolvePromise) => {
    let settled = false;
    let stdout = '';
    let stderr = '';

    const child: ChildProcess = spawn(pythonBin, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: SolverRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    const appendCapped = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8');
      return next.length > MAX_OUTPUT_BYTES ? next.slice(0, MAX_OUTPUT_BYTES) : next;
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk);
    });

    const timer = setTimeout(() => {
      // Hard timeout: SIGKILL + отметка; частичный файл удалит вызывающий.
      try {
        child.kill('SIGKILL');
      } catch {
        // процесс мог завершиться в ту же миллисекунду
      }
      finish({ exitCode: null, timedOut: true, spawnError: null, stdout, stderr });
    }, opts.timeoutMs);

    if (opts.signal !== undefined) {
      if (opts.signal.aborted) {
        try {
          child.kill('SIGKILL');
        } catch {
          // процесс ещё не стартовал — kill не нужен
        }
        finish({ exitCode: null, timedOut: true, spawnError: null, stdout, stderr });
      } else {
        const onAbort = (): void => {
          try {
            child.kill('SIGKILL');
          } catch {
            // процесс мог завершиться в ту же миллисекунду
          }
          finish({ exitCode: null, timedOut: true, spawnError: null, stdout, stderr });
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.on('error', (err: Error) => {
      finish({
        exitCode: null,
        timedOut: false,
        spawnError: err.message,
        stdout,
        stderr,
      });
    });

    child.on('close', (code: number | null) => {
      finish({
        exitCode: code,
        timedOut: false,
        spawnError: null,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * In-process очередь генераций: одна активная на проект, остальные ждут
 * (ТЗ 02 §6.10; одноместный режим).
 */
export function createProjectQueue(): {
  enqueue: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
} {
  const tails = new Map<string, Promise<unknown>>();

  function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    // Хвост цепи всегда «зелёный», чтобы следующая задача не падала на ошибке предыдущей.
    tails.set(key, run.then(() => undefined, () => undefined));
    return run;
  }

  return { enqueue };
}
