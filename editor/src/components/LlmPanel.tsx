// Раздел «LLM-генерация» (docs-llm/06 §2) — в панели Файлы рядом с существующей
// кнопкой «⚡ Генерировать размещение» (которая остаётся без изменений).
// - textarea запроса + выпадающий список моделей (GET /api/llm/providers, optgroup по
//   провайдерам; defaultModel — первым в своей группе и помечен) + поля лимитов
//   с плейсхолдерами-дефолтами 5 / 2.0 (пусто = дефолт сервера — в тело не передаётся);
//   totalTimeoutSec удалён из UI — сервер поле игнорирует (LST-8);
// - «Запустить» → POST …/llm-generate (202 {sessionId}); во время прогона активна «Стоп»
//   (POST …/llm-stop); лог шагов — опрос GET …/llm-status раз в ~1.5 c (вариант «б», без SSE),
//   по терминальному состоянию опрос останавливается; ошибка опроса (сеть) — повтор
//   следующего тика, без сброса состояния (06 §2.4);
// - 409 LLM_SESSION_ACTIVE → «Уже идёт LLM-прогон» + наблюдение за активной сессией;
// - по завершении: кандидаты (файл, комментарий LLM, «рекомендовано», ссылка Viewer3D —
//   тот же формат, что у обычной генерации); stopped/error — сообщение + error из ответа;
// - configured=false → блок «LLM не настроен» + подсказка про llm.config.json, элементы
//   недоступны, остальной редактор работает без изменений (06 §2.3);
// - история: последние сессии (GET …/llm-sessions) — время, статус, модель; по клику —
//   журнал (iterations + кандидаты). При отсутствии активной сессии при загрузке
//   раскрывается последняя (06 §2.2 «Последняя сессия»).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ru } from '../i18n/ru';
import {
  ApiError,
  getLlmProviders,
  getLlmStatus,
  listLlmSessions,
  loadLlmSession,
  startLlmGenerate,
  stopLlm,
} from '../lib/api';
import type { LlmJournalRecord, LlmLogEntry, LlmProvidersResponse, LlmSessionSummary } from '../lib/api';
import { formatLlmLimits, formatLlmLogLine, outcomeFromRecord, outcomeFromStatus, parseLlmLimits, viewer3dHref } from '../lib/llm';
import type { LlmOutcome } from '../lib/llm';

/** Период опроса статуса (06 §1.3 — зафиксировано ~1.5 c). */
const POLL_MS = 1500;
/** Дефолты-плейсхолдеры лимитов (05 §2) — подсказка в полях, НЕ отправляются.
 * totalTimeoutSec удалён из UI: сервер его больше не принимает (LST-8). */
const LIMIT_DEFAULTS = { maxIterations: '5', timeBudgetPerRun: '2.0' };

const sectionStyle: CSSProperties = { borderTop: '1px solid #ddd', paddingTop: 8, marginTop: 6 };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 };
const btnStyle: CSSProperties = { padding: '3px 8px', cursor: 'pointer' };
const disabledBtnStyle: CSSProperties = { ...btnStyle, cursor: 'not-allowed', opacity: 0.5 };
const statusStyle: CSSProperties = { color: '#555', fontSize: 12, marginTop: 2 };
const errorStyle: CSSProperties = { color: '#c62828', fontSize: 12, marginTop: 4 };
const okStyle: CSSProperties = { color: '#2e7d32', fontSize: 12, marginTop: 4 };
const noteStyle: CSSProperties = {
  background: '#fff3cd',
  border: '1px solid #f0ad4e',
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 12,
  marginTop: 6,
};

export default function LlmPanel(props: { slug: string }): JSX.Element {
  const { slug } = props;

  // ── Провайдеры/модели (06 §2.2) ───────────────────────────────────────────────
  const [providers, setProviders] = useState<LlmProvidersResponse | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // ── Форма запуска ──────────────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('');
  const [limIter, setLimIter] = useState('');
  const [limTb, setLimTb] = useState('');

  // ── Живой прогон (опрос ~1.5 c) ───────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState<LlmOutcome | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // ── История сессий (06 §1.5) ──────────────────────────────────────────────────
  const [sessions, setSessions] = useState<LlmSessionSummary[] | null>(null);
  const [openJournalId, setOpenJournalId] = useState<string | null>(null);
  const [journal, setJournal] = useState<LlmJournalRecord | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);

  const configured = providers?.configured ?? false;

  // ── Загрузка при смене проекта: провайдеры + (если настроено) последние сессии ─
  useEffect(() => {
    let cancelled = false;
    setProviders(null);
    setProvidersError(null);
    setPrompt('');
    setModelId('');
    setLimIter('');
    setLimTb('');
    setSessionId(null);
    setRunning(false);
    setStarting(false);
    setLive(null);
    setApiError(null);
    setSessions(null);
    setOpenJournalId(null);
    setJournal(null);
    setJournalError(null);

    getLlmProviders()
      .then((p) => {
        if (cancelled) return;
        setProviders(p);
        if (!p.configured) return; // «LLM не настроен» — сессии не запрашиваем
        const def = p.defaultModel ?? '';
        setModelId((cur) => (cur !== '' && modelInProviders(cur, p) ? cur : def));
        void refreshSessions().then(async (list) => {
          if (cancelled) return;
          // Активная сессия (перезаход на страницу во время прогона) → наблюдение.
          const active = list.find((s) => s.status === 'running');
          if (active !== undefined) {
            setSessionId(active.sessionId);
            setRunning(true);
            setLive({ state: 'running', log: [], candidates: null, recommended: null, error: null, note: null });
          } else if (list.length > 0) {
            // Нет активной — панель показывает последнюю сессию (06 §2.2).
            await openJournal(list[0].sessionId);
          }
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setProvidersError(errText(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function refreshSessions(): Promise<LlmSessionSummary[]> {
    try {
      const list = await listLlmSessions(slug);
      setSessions(list);
      return list;
    } catch {
      setSessions([]); // история необязательна для прогона — блок пустой
      return [];
    }
  }

  async function openJournal(id: string): Promise<void> {
    if (openJournalId === id) {
      setOpenJournalId(null);
      setJournal(null);
      setJournalError(null);
      return;
    }
    setOpenJournalId(id);
    setJournal(null);
    setJournalError(null);
    try {
      setJournal(await loadLlmSession(slug, id));
    } catch (e) {
      setJournalError(errText(e));
    }
  }

  // ── Опрос статуса (06 §1.3): ~1.5 c, по терминальному состоянию — стоп ────────
  useEffect(() => {
    if (!running || sessionId === null) return;
    const id = sessionId; // конст-копия: сужение типа внутри async-closure
    let cancelled = false;
    async function tick(): Promise<void> {
      try {
        const v = await getLlmStatus(slug, id);
        if (cancelled) return;
        setLive(outcomeFromStatus(v));
        if (v.state !== 'running') {
          setRunning(false);
          void refreshSessions(); // новая/обновлённая запись в истории
        }
      } catch {
        // Ошибка опроса (сеть/404) — повтор следующего тика, без сброса состояния (06 §2.4).
      }
    }
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sessionId, running]);


  // ── «Запустить» (06 §1.2) ──────────────────────────────────────────────────────
  async function onStart(): Promise<void> {
    if (!configured || running || starting) return;
    const p = prompt.trim();
    if (p.length === 0 || modelId === '') return; // кнопка в любом случае disabled
    const parsed = parseLlmLimits({ maxIterations: limIter, timeBudgetPerRun: limTb });
    if (parsed.error !== null) {
      setApiError(ru.llm.limitsInvalid);
      return;
    }
    setStarting(true);
    setApiError(null);
    try {
      const body: { prompt: string; modelId: string; limits?: ReturnType<typeof parseLlmLimits>['limits'] } = {
        prompt: p,
        modelId,
      };
      if (Object.keys(parsed.limits).length > 0) body.limits = parsed.limits;
      const { sessionId: id } = await startLlmGenerate(slug, body);
      setSessionId(id);
      setRunning(true);
      // Оптимистичный UI: строка состояния видна сразу, до первого тика опроса.
      setLive({ state: 'running', log: [], candidates: null, recommended: null, error: null, note: null });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'LLM_SESSION_ACTIVE') {
        // 06 §2.4: понятное сообщение + наблюдение за активной сессией.
        setApiError(ru.llm.sessionActive);
        try {
          const list = await listLlmSessions(slug);
          setSessions(list);
          const active = list.find((s) => s.status === 'running');
          if (active !== undefined) {
            setSessionId(active.sessionId);
            setRunning(true);
            setLive({ state: 'running', log: [], candidates: null, recommended: null, error: null, note: null });
          }
        } catch {
          // список недоступен — остаёмся в сообщении об активной сессии
        }
      } else {
        setApiError(errText(e)); // 503/422/400 — RU-текст из ответа (06 §2.4)
      }
    } finally {
      setStarting(false);
    }
  }

  // ── «Стоп» (06 §1.4): активна только во время прогона ─────────────────────────
  async function onStop(): Promise<void> {
    if (!running) return;
    try {
      await stopLlm(slug); // далее дожидаемся терминального состояния опросом
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setRunning(false); // LLM_NO_SESSION
      else setApiError(errText(e));
    }
  }

  const logTexts = { ok: ru.llm.logOk, failed: ru.llm.logFailed, noAction: ru.llm.logNoAction };
  const canStart = configured && !running && !starting && prompt.trim().length > 0 && modelId !== '';

  return (
    <div style={sectionStyle}>
      <strong>{ru.llm.title}</strong>

      {providers === null && <div style={statusStyle}>{ru.llm.loadingModels}</div>}
      {providersError !== null && (
        <div style={errorStyle}>
          {ru.llm.providersError} {providersError}
        </div>
      )}

      {providers?.configured === false && (
        <div style={{ ...noteStyle, marginTop: 6 }}>
          <div>{ru.llm.notConfigured}</div>
          <div style={{ marginTop: 2 }}>{ru.llm.notConfiguredHint}</div>
          {providers.reason !== undefined && providers.reason.length > 0 && (
            <div style={{ color: '#856404' }}>{providers.reason}</div>
          )}
        </div>
      )}

      {/* Форма/кнопки — всегда после загрузки конфигурации; при configured=false — disabled (06 §2.3). */}
      {providers !== null && (
        <>
          <div style={rowStyle}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={ru.llm.promptPlaceholder}
              aria-label={ru.llm.promptLabel}
              disabled={!configured || running}
              rows={2}
              style={{ flex: 1, minWidth: 160, fontSize: 12 }}
            />
          </div>
          <div style={rowStyle}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#555' }}>
              {ru.llm.modelLabel}
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                aria-label={ru.llm.modelLabel}
                disabled={!configured || running}
              >
                {modelOptionsEmpty(providers) && <option value="">{ru.llm.noModels}</option>}
                {(providers?.providers ?? []).map((p) => (
                  <optgroup key={p.id} label={p.id}>
                    {orderDefaultFirst(
                      p.models,
                      providers?.defaultModel ? `${p.id}/${providers.defaultModel}` : null,
                    ).map((m) => {
                      const full = `${p.id}/${m.id}`;
                      const isDefault = providers?.defaultModel === full;
                      return (
                        <option key={full} value={full}>
                          {m.id}
                          {m.label !== null ? ` (${m.label})` : ''}
                          {isDefault ? ` [${ru.llm.modelDefaultMark}]` : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
          <div style={rowStyle}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#555' }}>
              {ru.llm.limitIterations}
              <input
                value={limIter}
                onChange={(e) => setLimIter(e.target.value)}
                placeholder={LIMIT_DEFAULTS.maxIterations}
                aria-label={ru.llm.limitIterations}
                disabled={!configured || running}
                style={{ width: 60, marginTop: 0 }}
              />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#555' }}>
              {ru.llm.limitTimeBudget}
              <input
                value={limTb}
                onChange={(e) => setLimTb(e.target.value)}
                placeholder={LIMIT_DEFAULTS.timeBudgetPerRun}
                aria-label={ru.llm.limitTimeBudget}
                disabled={!configured || running}
                style={{ width: 60, marginTop: 0 }}
              />
            </label>
          </div>
          <div style={{ color: '#888', fontSize: 11 }}>{ru.llm.limitsHint}</div>

          <div style={rowStyle}>
            <button
              type="button"
              style={canStart ? btnStyle : disabledBtnStyle}
              disabled={!canStart}
              aria-busy={starting || running || undefined}
              onClick={() => void onStart()}
            >
              {ru.llm.startBtn}
            </button>
            <button
              type="button"
              style={running ? btnStyle : disabledBtnStyle}
              disabled={!running}
              onClick={() => void onStop()}
            >
              {ru.llm.stopBtn}
            </button>
          </div>

          {apiError !== null && (
            <div style={errorStyle}>{apiError}</div>
          )}

          {/* Живой лог / итог прогона */}
          {live !== null && <OutcomeBlock slug={slug} outcome={live} logTexts={logTexts} />}
        </>
      )}

      {/* ── История LLM-сессий (06 §1.5, 05 §5) ── */}
      {configured && sessions !== null && (
        <div style={{ ...sectionStyle, borderTop: '1px dashed #ccc' }}>
          <strong>{ru.llm.sessionsTitle}</strong>
          {sessions.length === 0 ? (
            <div style={statusStyle}>{ru.llm.sessionsEmpty}</div>
          ) : (
            sessions.map((s) => (
              <SessionRow key={s.sessionId} slug={slug} info={s} open={openJournalId === s.sessionId} onToggle={() => void openJournal(s.sessionId)} />
            ))
          )}
          {openJournalId !== null && journalError !== null && (
            <div style={errorStyle}>
              {ru.llm.loadSessionError} {journalError}
            </div>
          )}
          {journal !== null && openJournalId !== null && (
            <details open style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>{openJournalId}</summary>
              <div style={statusStyle}>
                {ru.llm.limitsCaption} {formatLlmLimits(journal.limits, { defaultMark: ru.llm.limitsDefaultMark })}
              </div>
              <OutcomeBlock slug={slug} outcome={outcomeFromRecord(journal)} logTexts={logTexts} />
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Вспомогательные (чистые) функции ────────────────────────────────────────────

function modelInProviders(value: string, p: LlmProvidersResponse): boolean {
  return (p.providers ?? []).some((pr) => pr.models.some((m) => `${pr.id}/${m.id}` === value));
}

/** Пустой список моделей — ни в одном провайдере нет ни одной модели. */
function modelOptionsEmpty(p: LlmProvidersResponse | null): boolean {
  if (p === null || p.providers === undefined) return false;
  return p.providers.every((pr) => pr.models.length === 0);
}

/** defaultModel — первым в своей группе (06 §2.2). */
function orderDefaultFirst(models: { id: string; label: string | null }[], defaultFull: string | null): typeof models {
  if (defaultFull === null) return models;
  const idx = models.findIndex((m) => m.id === defaultFull.split('/').slice(1).join('/'));
  if (idx <= 0) return models;
  return [models[idx], ...models.slice(0, idx), ...models.slice(idx + 1)];
}

// ── Блок состояния/итога: live-опрос и журнал истории рендерятся одинаково ─────

interface OutcomeProps {
  slug: string;
  outcome: LlmOutcome;
  logTexts: { ok: string; failed: string; noAction: string };
}

function OutcomeBlock(props: OutcomeProps): JSX.Element {
  const { slug, outcome } = props;
  const stateLine =
    outcome.state === 'running'
      ? ru.llm.stateRunning
      : outcome.state === 'done'
        ? ru.llm.stateDone
        : outcome.state === 'stopped'
          ? ru.llm.stateStopped
          : ru.llm.stateError;
  const stateStyle = outcome.state === 'done' ? okStyle : outcome.state === 'running' ? statusStyle : errorStyle;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={stateStyle}>{stateLine}</div>

      <div style={{ ...statusStyle, marginTop: 4 }}>{ru.llm.logTitle}</div>
      {outcome.log.length === 0 ? (
        <div style={{ color: '#888', fontSize: 12 }}>{ru.llm.noLog}</div>
      ) : (
        <LogLines log={outcome.log} texts={props.logTexts} />
      )}

      {/* note — пояснение авто-завершения по стагнации (LST-8); текст самодостаточный. */}
      {outcome.note !== null && <div style={noteStyle}>{outcome.note}</div>}

      {outcome.state === 'done' && outcome.candidates !== null && (
        <div style={{ marginTop: 6 }}>
          <div style={statusStyle}>{ru.llm.candidatesTitle}</div>
          {outcome.candidates.length === 0 ? (
            <div style={{ color: '#888', fontSize: 12 }}>{ru.llm.noCandidates}</div>
          ) : (
            outcome.candidates.map((c) => (
              <div key={c.file} style={{ marginTop: 4 }}>
                <div style={{ fontSize: 12 }}>
                  <code>{c.file}</code>
                  {outcome.recommended === c.file && (
                    <span style={{ color: '#2e7d32', fontWeight: 'bold' }}> ★ {ru.llm.recommendedMark}</span>
                  )}
                </div>
                {c.comment.length > 0 && (
                  <div style={{ color: '#555', fontSize: 12 }}>{c.comment}</div>
                )}
                <a href={viewer3dHref(slug, c.file)}>{ru.llm.openViewer3d}</a>
              </div>
            ))
          )}
        </div>
      )}

      {outcome.state !== 'running' && outcome.error !== null && (
        <div style={{ ...errorStyle, marginTop: 4 }}>{outcome.error}</div>
      )}
    </div>
  );
}

// ── Лог шагов: блоки-строки с отступом, свой контейнер со скроллом (LST-8) ─────
// max-height + overflow-y: при длинном логe список не раздувает панель;
// авто-прокрутка вниз только если пользователь не прокрутил вверх.
const LOG_MAX_HEIGHT = 300;

// `raw` у шага есть только в полном журнале сессии (не в llm-status) — блока нет без него.
function LogLines(props: {
  log: Array<LlmLogEntry & { raw?: string }>;
  texts: { ok: string; failed: string; noAction: string };
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    // «Уже внизу» (с запасом 24 px) — доводим до конца; прокрутил вверх — не трогаем.
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 24) {
      el.scrollTop = el.scrollHeight;
    }
  }, [props.log.length]);
  return (
    <div
      ref={boxRef}
      className="llm-log"
      style={{ maxHeight: LOG_MAX_HEIGHT, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', margin: '2px 0' }}
    >
      {props.log.map((e) => (
        <div key={e.n} className="llm-log-line" style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>
          {formatLlmLogLine(e, props.texts)}
          {/* raw есть только в полном журнале сессии (не в llm-status) — блока нет без него. */}
          {typeof e.raw === 'string' && e.raw.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11 }}>{ru.llm.rawAnswer}</summary>
              <pre
                className="llm-raw"
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  margin: '4px 0 0',
                  padding: 6,
                  background: '#f5f5f5',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                }}
              >
                {e.raw}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Строка истории сессии: время · статус · модель + раскрытие журнала ──────────

function SessionRow(props: { slug: string; info: LlmSessionSummary; open: boolean; onToggle: () => void }): JSX.Element {
  const when = new Date(props.info.startedAt);
  const dateLabel = Number.isNaN(when.getTime())
    ? props.info.startedAt
    : when.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

  return (
    <div style={{ marginTop: 6 }}>
      <div style={rowStyle}>
        <span title={props.info.promptPreview} style={{ fontSize: 12 }}>
          {props.info.sessionId} · {ru.llm.statusLabels[props.info.status]} · {props.info.modelId} · {dateLabel}
        </span>
        <button type="button" style={btnStyle} onClick={props.onToggle}>
          {props.open ? ru.llm.closeJournal : ru.llm.openJournal}
        </button>
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
