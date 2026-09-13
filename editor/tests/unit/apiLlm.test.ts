// Unit-тесты LLM-API-обёрток (docs-llm/06 §1): формы запросов (метод/URL/тело) и
// разбор ответов 202/200 + ошибок 409/503/422/400 (ApiError: status/code/RU-message).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  getLlmProviders,
  getLlmStatus,
  listLlmSessions,
  loadLlmSession,
  startLlmGenerate,
  stopLlm,
} from '../../src/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface Call {
  url: string;
  init?: RequestInit;
}

function mockFetchOnce(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse(status, body);
  }));
  return calls;
}

const RAW_SLUG = 'my proj'; // пробел → проверяем encodeURIComponent в URL
const ENCODED_SLUG = encodeURIComponent(RAW_SLUG);

afterEach(() => vi.unstubAllGlobals());

describe('getLlmProviders (GET /api/llm/providers)', () => {
  it('GET без тела; разбирает configured=true + providers', async () => {
    const body = {
      configured: true,
      defaultModel: 'eac-mac-ai/qwen.gguf',
      providers: [{ id: 'eac-mac-ai', models: [{ id: 'qwen.gguf', label: 'лучшая локальная' }] }],
    };
    const calls = mockFetchOnce(200, body);
    await expect(getLlmProviders()).resolves.toEqual(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/llm/providers');
    // GET: метод не задан (fetch-дефолт), тела нет.
    expect(calls[0].init?.method ?? 'GET').toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('configured=false — тоже HTTP 200, reason на месте', async () => {
    mockFetchOnce(200, { configured: false, reason: 'отсутствует llm.config.json' });
    await expect(getLlmProviders()).resolves.toEqual({ configured: false, reason: 'отсутствует llm.config.json' });
  });

  it('HTTP-ошибка → ApiError с кодом и RU-текстом', async () => {
    mockFetchOnce(500, { error: 'INTERNAL', message: 'сбой' });
    await expect(getLlmProviders()).rejects.toMatchObject({ status: 500, code: 'INTERNAL', message: 'сбой' });
  });
});

describe('startLlmGenerate (POST …/llm-generate)', () => {
  it('202: POST с JSON-телом {prompt, modelId, limits}; slug экранирован в URL', async () => {
    const calls = mockFetchOnce(202, { sessionId: '20260913-200232' });
    await expect(
      startLlmGenerate(RAW_SLUG, { prompt: 'коридор поменьше', modelId: 'p/m.gguf', limits: { maxIterations: 5 } }),
    ).resolves.toEqual({ sessionId: '20260913-200232' });
    expect(calls[0].url).toBe(`/api/projects/${ENCODED_SLUG}/llm-generate`);
    const init = calls[0].init!;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: 'коридор поменьше',
      modelId: 'p/m.gguf',
      limits: { maxIterations: 5 },
    });
  });

  it('без limits — ключа limits в теле НЕТ (пустые поля UI = дефолт сервера)', async () => {
    const calls = mockFetchOnce(202, { sessionId: 's' });
    await startLlmGenerate(RAW_SLUG, { prompt: 'p', modelId: 'p/m' });
    expect(JSON.parse(String(calls[0].init!.body))).toEqual({ prompt: 'p', modelId: 'p/m' });
  });

  it('409 LLM_SESSION_ACTIVE — ApiError(409, LLM_SESSION_ACTIVE)', async () => {
    mockFetchOnce(409, { error: 'LLM_SESSION_ACTIVE', message: 'У проекта уже есть активная LLM-сессия' });
    const e = await startLlmGenerate(RAW_SLUG, { prompt: 'p', modelId: 'p/m' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(409);
    expect(e.code).toBe('LLM_SESSION_ACTIVE');
    expect(e.message).toBe('У проекта уже есть активная LLM-сессия');
  });

  it('503 LLM_NOT_CONFIGURED — ApiError(503)', async () => {
    mockFetchOnce(503, { error: 'LLM_NOT_CONFIGURED', message: 'LLM не настроен' });
    const e = await startLlmGenerate(RAW_SLUG, { prompt: 'p', modelId: 'p/m' }).catch((x) => x);
    expect(e).toMatchObject({ status: 503, code: 'LLM_NOT_CONFIGURED' });
  });

  it('422 LLM_UNKNOWN_MODEL — ApiError(422)', async () => {
    mockFetchOnce(422, { error: 'LLM_UNKNOWN_MODEL', message: 'провайдер «x» не найден в конфиге' });
    const e = await startLlmGenerate(RAW_SLUG, { prompt: 'p', modelId: 'x/m' }).catch((x) => x);
    expect(e).toMatchObject({ status: 422, code: 'LLM_UNKNOWN_MODEL' });
  });

  it('400 LLM_INVALID_BODY — ApiError(400)', async () => {
    mockFetchOnce(400, { error: 'LLM_INVALID_BODY', message: 'Поле prompt — непустая строка' });
    const e = await startLlmGenerate(RAW_SLUG, { prompt: '', modelId: 'p/m' }).catch((x) => x);
    expect(e).toMatchObject({ status: 400, code: 'LLM_INVALID_BODY', message: 'Поле prompt — непустая строка' });
  });

  it('HTTP 200 (а не 202) — тоже ошибка ApiError', async () => {
    mockFetchOnce(200, { error: 'WEIRD', message: 'неожиданно' });
    const e = await startLlmGenerate(RAW_SLUG, { prompt: 'p', modelId: 'p/m' }).catch((x) => x);
    expect(e).toMatchObject({ status: 200, code: 'WEIRD' });
  });
});

describe('getLlmStatus (GET …/llm-status?session=…)', () => {
  it('параметр session в query; разбирает running-вид', async () => {
    const body = {
      state: 'running',
      log: [{ n: 1, action: 'run_generation', ok: true, summary: 'result-a.txt (exit 0)' }],
      error: null,
      startedAt: 't0',
      finishedAt: null,
    };
    const calls = mockFetchOnce(200, body);
    await expect(getLlmStatus(RAW_SLUG, '20260913-200232')).resolves.toEqual(body);
    expect(calls[0].url).toBe(`/api/projects/${ENCODED_SLUG}/llm-status?session=20260913-200232`);
    expect(calls[0].init?.method ?? 'GET').toBe('GET');
  });

  it('done: candidates + recommended на месте', async () => {
    mockFetchOnce(200, {
      state: 'done',
      log: [],
      candidates: [{ file: 'a.txt', comment: 'комментарий' }],
      recommended: 'a.txt',
      error: null,
      startedAt: 't0',
      finishedAt: 't1',
    });
    const v = await getLlmStatus(RAW_SLUG, 's');
    expect(v.candidates).toEqual([{ file: 'a.txt', comment: 'комментарий' }]);
    expect(v.recommended).toBe('a.txt');
  });

  it('404 LLM_NO_SESSION — ApiError(404)', async () => {
    mockFetchOnce(404, { error: 'LLM_NO_SESSION', message: 'Сессия не найдена' });
    const e = await getLlmStatus(RAW_SLUG, 'nope').catch((x) => x);
    expect(e).toMatchObject({ status: 404, code: 'LLM_NO_SESSION' });
  });
});

describe('stopLlm (POST …/llm-stop)', () => {
  it('200 {state} — разбор; метод POST', async () => {
    const calls = mockFetchOnce(200, { state: 'stopping' });
    await expect(stopLlm(RAW_SLUG)).resolves.toEqual({ state: 'stopping' });
    expect(calls[0].url).toBe(`/api/projects/${ENCODED_SLUG}/llm-stop`);
    expect(calls[0].init?.method).toBe('POST');
  });

  it('терминальная сессия → 200 с текущим state', async () => {
    mockFetchOnce(200, { state: 'done' });
    await expect(stopLlm(RAW_SLUG)).resolves.toEqual({ state: 'done' });
  });

  it('404 LLM_NO_SESSION — ApiError(404)', async () => {
    mockFetchOnce(404, { error: 'LLM_NO_SESSION', message: 'активная сессия отсутствует' });
    const e = await stopLlm(RAW_SLUG).catch((x) => x);
    expect(e).toMatchObject({ status: 404, code: 'LLM_NO_SESSION' });
  });
});

describe('listLlmSessions (GET …/llm-sessions)', () => {
  it('разбирает массив sessions из поля body.sessions', async () => {
    const sessions = [
      {
        sessionId: '20260913-200455',
        status: 'done',
        modelId: 'p/m',
        promptPreview: 'сделай коридор поменьше',
        startedAt: 't0',
        finishedAt: 't1',
      },
    ];
    const calls = mockFetchOnce(200, { sessions });
    await expect(listLlmSessions(RAW_SLUG)).resolves.toEqual(sessions);
    expect(calls[0].url).toBe(`/api/projects/${ENCODED_SLUG}/llm-sessions`);
  });

  it('пустой список — []', async () => {
    mockFetchOnce(200, { sessions: [] });
    await expect(listLlmSessions(RAW_SLUG)).resolves.toEqual([]);
  });
});

describe('loadLlmSession (GET …/llm-sessions/<id>)', () => {
  it('полный журнал возвращается без изменений', async () => {
    const record = {
      prompt: 'p',
      modelId: 'p/m',
      limits: { maxIterations: 5, timeBudgetPerRun: 2, totalTimeoutSec: 180 },
      iterations: [{ n: 1, action: 'run_generation', args: { seed: 7 }, ok: true, summary: 'ok' }],
      candidates: [{ file: 'a.txt', comment: 'c' }],
      recommended: 'a.txt',
      status: 'done',
      startedAt: 't0',
      finishedAt: 't1',
    };
    const calls = mockFetchOnce(200, record);
    await expect(loadLlmSession(RAW_SLUG, '20260913-200455')).resolves.toEqual(record);
    expect(calls[0].url).toBe(`/api/projects/${ENCODED_SLUG}/llm-sessions/20260913-200455`);
  });

  it('отсутствующий id → ApiError(404, LLM_NO_SESSION)', async () => {
    mockFetchOnce(404, { error: 'LLM_NO_SESSION', message: 'Сессия «x» не найдена' });
    const e = await loadLlmSession(RAW_SLUG, 'x').catch((x) => x);
    expect(e).toMatchObject({ status: 404, code: 'LLM_NO_SESSION' });
  });
});
