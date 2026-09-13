// Общий контур unit-тестов API (ТЗ 05 §1): tmp-workspace через SPACEMGR_WORKSPACE,
// createApp() + listen(0) + fetch; stub «python» вместо .venv/bin/python.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { crc32 } from 'node:zlib';
import AdmZip from 'adm-zip';

import { createApp, type AppOptions } from '../../server/index.js';
import { SPEC_TEMPLATE, MASK_TEMPLATE } from '../../server/workspace.js';

export const EXPECTED_SPEC = [
  'grid:',
  '  width: 20',
  '  height: 20',
  'blockedFile: blocked.txt',
  'presetFile: preset.txt',
  'types:',
  '  ROOM: { symbol: "R", name: Комната }',
  'rules:',
  '  connectivity: 8',
  '  adjacency:',
  '    forbidden: []',
  '    allow: null',
  '  size:',
  '    min: null',
  '    max: null',
  '  convexity:',
  '    weight: soft',
  '  fillAll: false',
  '  touchAll: false',
  'clusters:',
  '  - id: room1',
  '    type: ROOM',
  '    areaPercent: 100',
  '    shape: free',
  '',
].join('\n');

export const EXPECTED_MASK = ('.'.repeat(20) + '\n').repeat(20);

export interface StubConfig {
  exit?: number;
  sleep?: number;
  writefirst?: boolean;
}

export interface TestCtx {
  base: string;
  ws: string;
  tmp: string;
  /** Настроить поведение stub-python (exit code / sleep / написать файл до сна). */
  setStub: (cfg: StubConfig) => Promise<void>;
  /** Аргументы последнего spawn-вызова (строки argv). */
  readStubArgs: () => string[] | null;
  stop: () => Promise<void>;
}

const STUB_SCRIPT = `#!/usr/bin/env bash
CFG=__CFG__
ARGS=__ARGS__
printf '%s\\n' "$@" > "$ARGS"
code=0
sleep_s=0
writefirst=0
if [ -f "$CFG" ]; then
  c=$(sed -n 's/^exit=\\([0-9][0-9]*\\)$/\\1/p' "$CFG")
  [ -n "$c" ] && code=$c
  s=$(sed -n 's/^sleep=\\([0-9.]*\\)$/\\1/p' "$CFG")
  [ -n "$s" ] && sleep_s=$s
  w=$(sed -n 's/^writefirst=\\([01]\\)$/\\1/p' "$CFG")
  [ -n "$w" ] && writefirst=$w
fi
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--out" ]; then out="$a"; fi
  prev="$a"
done
write_report() {
  {
    if [ "$code" = "1" ]; then
      echo "НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ."
      echo "Причина: тестовая жёсткая невозможность (stub, exit 1)"
      echo ""
    fi
    echo "== КАРТА =="
    echo ""
    echo "...."
    echo "...."
    echo ""
    echo "== ТАБЛИЦА: запрошено / фактически / отклонение =="
    echo ""
    echo "stub-строка-таблицы"
    echo ""
    echo "== ПРЕДУПРЕЖДЕНИЯ =="
    echo ""
    echo "нет"
  } > "$out"
}
if [ "$code" = "2" ]; then
  echo "ОШИБКА ВХОДНЫХ ДАННЫХ: тестовая ошибка входных данных (stub, exit 2)" >&2
else
  if [ "$writefirst" = "1" ]; then write_report; fi
  if [ "$sleep_s" != "0" ]; then sleep "$sleep_s"; fi
  if [ "$writefirst" != "1" ]; then write_report; fi
fi
echo "stub-stderr code=$code" >&2
exit "$code"
`;

export async function startServer(opts: AppOptions = {}): Promise<TestCtx> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacemgr-test-'));
  const ws = path.join(tmp, 'workspace');
  const cfgPath = path.join(tmp, 'stub-cfg');
  const argsPath = path.join(tmp, 'stub-args.txt');
  const stubPath = path.join(tmp, 'stub-python.sh');
  fs.writeFileSync(
    stubPath,
    STUB_SCRIPT.replaceAll('__CFG__', JSON.stringify(cfgPath)).replaceAll('__ARGS__', JSON.stringify(argsPath)),
  );
  fs.chmodSync(stubPath, 0o755);

  const app = await createApp({ workspaceDir: ws, pythonBin: stubPath, ...opts });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${addr.port}`,
    ws,
    tmp,
    setStub: async (cfg) => {
      await fsp.writeFile(
        cfgPath,
        `exit=${cfg.exit ?? 0}\nsleep=${cfg.sleep ?? 0}\nwritefirst=${cfg.writefirst ? 1 : 0}\n`,
      );
    },
    readStubArgs: () => {
      try {
        return fs.readFileSync(argsPath, 'utf8').trim().split('\n');
      } catch {
        return null;
      }
    },
    stop: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** JSON-запрос с парсингом тела; возвращает статус + тело. */
export async function api(
  ctx: TestCtx,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(ctx.base + urlPath, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

// ---------------------------------------------------------------------------
// ZIP-хелперы для тестов импорта/архива (ТЗ 05 §3.4)
// ---------------------------------------------------------------------------

export function makeZip(entries: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(entries)) {
    zip.addFile(name, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  }
  return zip.toBuffer();
}

interface RawEntry {
  name: string;
  data: string;
}

/**
 * Сырой ZIP (stored) с произвольными именами записей — для вредоносных кейсов,
 т.к. AdmZip.addFile нормализует имена при записи.
 */
export function makeRawZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const dataBuf = Buffer.from(e.data, 'utf8');
    const crc = crc32(dataBuf) >>> 0;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(0, 8); // stored
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0x21, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(dataBuf.length, 18);
    lfh.writeUInt32LE(dataBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0x21, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(dataBuf.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);

    locals.push(lfh, nameBuf, dataBuf);
    centrals.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + dataBuf.length;
  }

  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, central, eocd]);
}

export async function postRaw(
  ctx: TestCtx,
  urlPath: string,
  body: Buffer,
  contentType: string,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const res = await fetch(ctx.base + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

export { SPEC_TEMPLATE, MASK_TEMPLATE };
