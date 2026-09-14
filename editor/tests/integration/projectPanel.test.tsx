// @vitest-environment jsdom
// Интеграционные тесты ProjectFilesPanel (docs-unified/05 §2, 04-integrations.md §1.3–§1.6):
// - выбор проекта → SPEC_LOADED/MASK_LOADED из мок-ответов;
// - нормализация имён масок: спека со ссылкой на «blocked_basic.txt» → в модели
//   blockedFile: 'blocked.txt', файл читается по ИСХОДНОМУ имени;
// - dirty → кнопка сохранения с ●; успех save → markClean;
// - генерация: POST без автосохранения при чистом состоянии, блок результата (exit 0).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Dispatch } from 'react';
import ProjectFilesPanel from '../../src/components/FilesPanel';
import { EditorProvider, isDirty, useEditor } from '../../src/state/editorStore';
import type { EditorAction, EditorState } from '../../src/state/editorStore';

const PROJECT = 'demo';

const SPEC_WITH_NONCANON_MASK = `grid:
  width: 10
  height: 10
blockedFile: blocked_basic.txt
presetFile: null
types:
  A: { symbol: "A", name: null }
rules:
  connectivity: 8
  adjacency:
    forbidden: []
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
  touchAll: false
clusters:
  - id: a1
    type: A
    areaPercent: 50
    shape: free
`;

const BLOCKED_10 = (
  '*.........\n' +
  Array.from({ length: 9 }, () => '..........\n').join('')
);

const REPORT_OK = [
  '== КАРТА ==',
  '',
  'AA..........',
  '',
  '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
  '',
  'id        | type     | доля (%) | цель (клеток) | факт (клеток) | отклонение | статус',
  'a1        | A        | 50       | 50            | 50            | 0          | ок',
  '',
  '== ПРЕДУПРЕЖДЕНИЯ ==',
  '',
  'нет',
].join('\n');

interface Call {
  method: string;
  url: string;
  body?: string;
}

interface MockOpts {
  /** Человекочитаемое имя проекта (по умолчанию PROJECT). */
  projectName?: string;
  /** Slug проекта в URL/API (по умолчанию PROJECT — совпадает с именем). */
  projectSlug?: string;
  /** Начальная история result-* (`GET …/results`); после генерации новая
   *  ревизия добавляется наверх (замечание 4). */
  results?: { name: string; mtimeIso: string }[];
}

/** Мок fetch над /api (docs-unified/02): projects/file/files/generate/results/types-catalog. */
function mockFetch(files: Record<string, string>, opts: MockOpts = {}): Call[] {
  const projectName = opts.projectName ?? PROJECT;
  const projectSlug = opts.projectSlug ?? PROJECT;
  let resultsList: { name: string; mtimeIso: string }[] = [...(opts.results ?? [])];
  const calls: Call[] = [];
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined });

    let status = 200;
    let contentType = 'application/json';
    let bodyText = '';
    if (url === '/api/types-catalog') {
      // Общий список типов (ST-2) — в интеграции каталог пустой.
      bodyText = JSON.stringify({ types: {} });
    } else if (url === '/api/projects') {
      bodyText = JSON.stringify({
        projects: [
          {
            id: 'id-1',
            name: projectName,
            slug: projectSlug,
            createdAt: '2026-09-13T12:00:00.000Z',
            updatedAt: '2026-09-13T12:00:00.000Z',
            latestResult: null,
            sizeBytes: 100,
            resultsCount: 0,
            previewsCount: 0,
            filesCount: Object.keys(files).length,
          },
        ],
      });
    } else if (url === `/api/projects/${encodeURIComponent(projectSlug)}/results`) {
      bodyText = JSON.stringify({ results: resultsList });
    } else if (/\/file\?name=/.test(url)) {
      const name = new URL(url, 'http://localhost').searchParams.get('name');
      if (name !== null && files[name] !== undefined) {
        contentType = 'text/plain; charset=utf-8';
        bodyText = files[name];
      } else {
        status = 404;
        bodyText = JSON.stringify({ error: 'FILE_NOT_FOUND', message: `Файл «${name}» не найден` });
      }
    } else if (url.endsWith('/files') && method === 'PUT') {
      const parsed = JSON.parse((init?.body as string) ?? '{}') as { files?: Record<string, unknown> };
      bodyText = JSON.stringify({
        saved: Object.keys(parsed.files ?? {}),
        deleted: ['blocked.txt', 'preset.txt'].filter(
          (n) => !(parsed.files && n in parsed.files),
        ),
      });
    } else if (url.endsWith('/generate') && method === 'POST') {
      // Успешная генерация → новая ревизия наверху истории (замечание 4).
      resultsList = [
        { name: 'result-20260913-120000.txt', mtimeIso: '2026-09-13T12:05:00.000Z' },
        ...resultsList.filter((r) => r.name !== 'result-20260913-120000.txt'),
      ];
      bodyText = JSON.stringify({
        resultFile: 'result-20260913-120000.txt',
        exitCode: 0,
        feasible: true,
        report: REPORT_OK,
      });
    } else {
      status = 404;
      bodyText = JSON.stringify({ error: 'NOT_FOUND', message: 'Не найдено' });
    }
    return new Response(bodyText, { status, headers: { 'Content-Type': contentType } });
  };
  vi.stubGlobal('fetch', handler);
  return calls;
}

let store: { state: EditorState; dispatch: Dispatch<EditorAction> } | null = null;

function StoreCapture(): null {
  const value = useEditor();
  store = value;
  return null;
}

function renderPanel(initialUrl?: string) {
  if (initialUrl) window.history.pushState(null, '', initialUrl);
  const utils = render(
    <EditorProvider>
      <StoreCapture />
      <ProjectFilesPanel />
    </EditorProvider>,
  );
  return utils;
}

async function selectProject(value: string): Promise<void> {
  const select = screen.getByRole('combobox', { name: 'Проект' }) as HTMLSelectElement;
  await waitFor(() => expect(select.disabled).toBe(false));
  fireEvent.change(select, { target: { value } });
}

afterEach(() => {
  cleanup(); // без vitest globals RTL не чистит DOM автоматически
  vi.unstubAllGlobals();
  store = null;
  window.history.pushState(null, '', '/');
});

describe('ProjectFilesPanel: загрузка проекта (docs-unified/04 §1.3)', () => {
  it('читает spec.yaml и маску по исходному имени, нормализует имя в модели', async () => {
    const calls = mockFetch({ 'spec.yaml': SPEC_WITH_NONCANON_MASK, 'blocked_basic.txt': BLOCKED_10 });
    renderPanel();
    await selectProject(PROJECT);

    await waitFor(() => expect(store?.state.spec).not.toBeNull(), { timeout: 5000 });
    await waitFor(
      () => expect(store?.state.blockedMask).not.toBeNull(),
      { timeout: 5000 },
    );

    // Нормализация: в модели каноническое имя, файл читан по исходному.
    expect(store!.state.spec!.blockedFile).toBe('blocked.txt');
    expect(calls.some((c) => c.url.endsWith('/file?name=spec.yaml'))).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/file?name=blocked_basic.txt'))).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/file?name=blocked.txt'))).toBe(false);

    // Загрузка — не «изменение»: глобальный dirty сброшен.
    expect(isDirty()).toBe(false);
  });

});

describe('ProjectFilesPanel: сохранение в проект (docs-unified/04 §1.5)', () => {
  it('dirty → кнопка с ●; PUT канонической тройки; успех → markClean', async () => {
    const calls = mockFetch({ 'spec.yaml': SPEC_WITH_NONCANON_MASK, 'blocked_basic.txt': BLOCKED_10 });
    renderPanel();
    await selectProject(PROJECT);
    await waitFor(() => expect(store?.state.blockedMask).not.toBeNull());

    // Изменение модели (чистим маску) → dirty.
    act(() => {
      store!.dispatch({ type: 'MASK_CLEAR_ALL', kind: 'blocked' });
    });
    await waitFor(() => expect(isDirty()).toBe(true));
    const saveBtn = screen.getByRole('button', { name: /Сохранить в проект/ });
    expect(saveBtn.textContent).toContain('●');

    fireEvent.click(saveBtn);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/files'))), {
      timeout: 5000,
    });
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/files'))!;
    const payload = JSON.parse(put.body!) as { files: Record<string, string> };
    expect(Object.keys(payload.files).sort()).toEqual(['blocked.txt', 'spec.yaml']);
    // spec нормализован: blockedFile — канонический.
    expect(payload.files['spec.yaml']).toContain('blockedFile: blocked.txt');
    // Маска очищена → 10 строк из точек.
    expect(payload.files['blocked.txt']).toBe(Array.from({ length: 10 }, () => '..........\n').join(''));

    await waitFor(() => expect(isDirty()).toBe(false));
    await screen.findByText(/Сохранено в/);
  });
});

describe('ProjectFilesPanel: генерация (docs-unified/04 §1.6)', () => {
  it('чистое состояние → только POST /generate; блок результата exit 0 со ссылкой Viewer3D', async () => {
    const calls = mockFetch({ 'spec.yaml': SPEC_WITH_NONCANON_MASK, 'blocked_basic.txt': BLOCKED_10 });
    renderPanel();
    await selectProject(PROJECT);
    await waitFor(() => expect(store?.state.blockedMask).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Генерировать размещение/ }));
    await waitFor(
      () => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/generate'))),
      { timeout: 5000 },
    );
    // Автосохранения не было — состояние чистое.
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    await screen.findByText(/Размещение найдено: result-20260913-120000\.txt/);
    const link = screen.getByRole('link', { name: 'Открыть в Viewer3D' });
    expect(link.getAttribute('href')).toBe(
      `/viewer3d?project=${PROJECT}&result=result-20260913-120000.txt`,
    );
  });

  it('?project=<нет в списке> → баннер «не найден»', async () => {
    mockFetch({ 'spec.yaml': SPEC_WITH_NONCANON_MASK, 'blocked_basic.txt': BLOCKED_10 });
    renderPanel('/?project=nope');
    await screen.findByText(/Проект «nope» не найден/);
  });
});

describe('ProjectFilesPanel: «Отчёты генераций» (замечание 4)', () => {
  it('пустой список → «Результатов пока нет»', async () => {
    mockFetch(
      { 'spec.yaml': SPEC_WITH_NONCANON_MASK, 'blocked_basic.txt': BLOCKED_10 },
      { results: [] },
    );
    renderPanel();
    await selectProject(PROJECT);
    await screen.findByText('Результатов пока нет', {}, { timeout: 5000 });
  });

  it('имя+дата, «В 3D» со slug в href, «Открыть отчёт» раскрывает текст (name ≠ slug)', async () => {
    const calls = mockFetch(
      {
        'spec.yaml': SPEC_WITH_NONCANON_MASK,
        'blocked_basic.txt': BLOCKED_10,
        'result-20260913-110000.txt': REPORT_OK,
      },
      {
        projectName: 'Демо офис',
        projectSlug: 'demo-office',
        results: [{ name: 'result-20260913-110000.txt', mtimeIso: '2026-09-13T11:00:00.000Z' }],
      },
    );
    renderPanel();

    // Селектор показывает человекочитаемое имя, value — slug.
    const select = screen.getByRole('combobox', { name: 'Проект' }) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(Array.from(select.options).some((o) => o.textContent === 'Демо офис')).toBe(true);
    fireEvent.change(select, { target: { value: 'demo-office' } });

    // Статус строки — человекочитаемое имя; запросы идут по SLUG.
    await screen.findByText(/проект: Демо офис/);
    expect(calls.some((c) => c.url === '/api/projects/demo-office/results')).toBe(true);
    expect(calls.some((c) => c.url.includes('/api/projects/%D0%94'))).toBe(false); // name в URL не идёт

    // Строка ревизии: имя + дата; «В 3D» — slug + файл.
    await screen.findByText(/result-20260913-110000\.txt ·/, {}, { timeout: 5000 });
    const link = screen.getByRole('link', { name: 'В 3D' });
    expect(link.getAttribute('href')).toBe(
      '/viewer3d?project=demo-office&result=result-20260913-110000.txt',
    );

    // «Открыть отчёт» → inline-раскрытие полного текста (GET …/file?name=…).
    fireEvent.click(screen.getByRole('button', { name: 'Открыть отчёт' }));
    await screen.findByText(/== ТАБЛИЦА/, {}, { timeout: 5000 });
    expect(calls.some((c) => c.url.endsWith('/file?name=result-20260913-110000.txt'))).toBe(true);

    // Повторный клик — сворачивание.
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть отчёт' }));
    await waitFor(() => expect(screen.queryByText(/== ТАБЛИЦА/)).toBeNull());
  });

  it('после успешной генерации блок обновляется: новая ревизия наверху', async () => {
    const calls = mockFetch(
      { 'spec.yaml': SPEC_WITH_NONCANON_MASK, 'blocked_basic.txt': BLOCKED_10 },
      { results: [{ name: 'result-20260913-100000.txt', mtimeIso: '2026-09-13T10:00:00.000Z' }] },
    );
    renderPanel();
    await selectProject(PROJECT);
    await screen.findByText(/result-20260913-100000\.txt/, {}, { timeout: 5000 });

    fireEvent.click(screen.getByRole('button', { name: /Генерировать размещение/ }));
    await screen.findByText(/Размещение найдено: result-20260913-120000\.txt/, {}, { timeout: 5000 });

    // История перечитана после генерации; новая ревизия выше старой.
    await waitFor(
      () => {
        const reads = calls.filter((c) => c.url.endsWith('/results')).length;
        expect(reads).toBeGreaterThanOrEqual(2);
      },
      { timeout: 5000 },
    );
    const section = screen.getByText('Отчёты генераций').parentElement!;
    const namesInOrder = Array.from(section.querySelectorAll('span')).map((s) => s.textContent ?? '');
    const freshIdx = namesInOrder.findIndex((t) => t.includes('result-20260913-120000.txt'));
    const oldIdx = namesInOrder.findIndex((t) => t.includes('result-20260913-100000.txt'));
    expect(freshIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(freshIdx).toBeLessThan(oldIdx);
  });
});
