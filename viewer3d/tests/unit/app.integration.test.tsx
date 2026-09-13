// @vitest-environment jsdom
// Интеграция state ↔ компоненты в проектном режиме (docs-unified/04 §2): монтируем
// App, API единого сервиса мокнем через fetch-заглушку (GET /api/projects, …/results,
// …/file), проверяем: автовыбор проекта/ревизии, список комнат, карточку выбранной
// комнаты, Esc, переключение ревизий, битый результат → баннер. R3F-сцена замещена
// mock'ом (WebGL в jsdom нет — тесты сцены идут e2e).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { App } from '../../src/App';
import { ViewerProvider } from '../../src/state/viewerStore';

vi.mock('../../src/scene/Scene', () => ({
  Scene: () => <div data-testid="scene-mock" />,
}));

// eslint-disable-next-line react-refresh/only-export-components
// vitest + jsdom: import.meta.url не file:// — путь считаем от cwd (корень viewer3d).
const GOOD_REPORT = fs.readFileSync(
  path.join(process.cwd(), 'tests', 'fixtures', 'report_basic.txt'),
  'utf-8',
);
const BAD_REPORT = 'просто текст без секций';

const PROJECT = 'demo';
const NEW_RESULT = 'result-20260913-000000.txt';
const OLD_RESULT = 'result-20260901-000000.txt';

// ── Мок fetch (docs-unified/02 §6: projects / results / file) ────────────────────

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function okText(text: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('не JSON');
    },
    text: async () => text,
  } as unknown as Response;
}

function notFound(): Response {
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: 'FILE_NOT_FOUND', message: 'Файл не найден' }),
    text: async () => '',
  } as unknown as Response;
}

function installApiMock(): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === '/api/projects') {
      return okJson({
        projects: [
          {
            id: 'id-demo',
            name: PROJECT,
            slug: PROJECT, // в моке имя и slug совпадают (замечание 2)
            createdAt: '2026-09-13T12:00:00.000Z',
            updatedAt: '2026-09-13T12:00:00.000Z',
            latestResult: NEW_RESULT,
            sizeBytes: 123,
            resultsCount: 2,
            previewsCount: 0,
            filesCount: 3,
          },
        ],
      });
    }
    if (url === `/api/projects/${PROJECT}/results`) {
      // имя desc — свежая первая (docs-unified/02 §6.11)
      return okJson({
        results: [
          { name: NEW_RESULT, sizeBytes: GOOD_REPORT.length, mtimeIso: '2026-09-13T12:00:00.000Z' },
          { name: OLD_RESULT, sizeBytes: BAD_REPORT.length, mtimeIso: '2026-09-01T12:00:00.000Z' },
        ],
      });
    }
    const fileMatch = /\/api\/projects\/([^/]+)\/file\?name=([^&]+)/.exec(url);
    if (fileMatch !== null) {
      if (fileMatch[1] === PROJECT && fileMatch[2] === NEW_RESULT) return okText(GOOD_REPORT);
      if (fileMatch[1] === PROJECT && fileMatch[2] === OLD_RESULT) return okText(BAD_REPORT);
    }
    return notFound();
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  installApiMock();
  window.history.pushState(null, '', '/viewer3d/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState(null, '', '/viewer3d/');
});

function renderApp() {
  return render(
    <ViewerProvider>
      <App />
    </ViewerProvider>,
  );
}

/** Дождаться списка проектов и выбрать проект в селекторе (docs-unified/04 §2.3). */
async function selectProject(): Promise<void> {
  const select = screen.getByRole('combobox', { name: 'Проект' });
  await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false), { timeout: 5000 });
  fireEvent.change(select, { target: { value: PROJECT } });
}

/** Дождаться загрузки ревизии (список комнат появился). */
async function waitLoaded(): Promise<void> {
  await waitFor(() => expect(screen.getByText('room1')).toBeTruthy(), { timeout: 5000 });
}

describe('App + ProjectPanel + store (проектный режим, без WebGL)', () => {
  it('до выбора проекта: заглушка сцены, селекторы, зелёная кнопка «К проектам» слева', async () => {
    renderApp();
    expect(screen.getByText(/Выберите проект и файл результата/)).toBeTruthy();
    // Замечание 1: самая левая кнопка заголовка — «К проектам» (менеджер, /).
    const toProjects = screen.getByRole('link', { name: 'К проектам' }) as HTMLAnchorElement;
    expect(toProjects.getAttribute('href')).toBe('/');
    expect(
      toProjects.parentElement!.firstElementChild === toProjects,
    ).toBeTruthy();
    // кнопка пресетов тулбара заблокирована до загрузки отчёта
    const iso = screen.getByRole('button', { name: 'Изометрия' }) as HTMLButtonElement;
    expect(iso.disabled).toBe(true);
    // список проектов подгружен с API
    await waitFor(() =>
      expect(screen.getByRole('option', { name: PROJECT })).toBeTruthy(),
    );
  });

  it('выбор проекта → автовыбор свежей ревизии, список комнат, статус «проект · файл»', async () => {
    renderApp();
    await selectProject();
    await waitLoaded();

    // строка статуса сцены: префикс проект/файл + 50×50, 3 комнаты, боксы > 0
    expect(
      screen.getByText(
        new RegExp(`проект: ${PROJECT} · файл: ${NEW_RESULT} · 50×50 клеток · S = 1 м/клетку · комнат: 3 · стен: \\d+ боксов`),
        { selector: '.status-line' },
      ),
    ).toBeTruthy();

    // статус панели «Проект»: «проект: p · файл: f» (docs-unified/04 §2.3)
    expect(
      screen.getByText(new RegExp(`проект: ${PROJECT} · файл: ${NEW_RESULT}`), {
        selector: '.panel-files li',
      }),
    ).toBeTruthy();

    // список комнат (ТЗ 04 §5): все три метки + площади в м² (S=1)
    expect(screen.getByText('room2')).toBeTruthy();
    expect(screen.getByText('corridor1')).toBeTruthy();
    expect(screen.getByText('650.00 м²')).toBeTruthy(); // room1: 650 клеток
    expect(screen.getByText('375.00 м²')).toBeTruthy();
    expect(screen.getByText('225.00 м²')).toBeTruthy();

    // легенда: символ → type_id
    expect(screen.getByText('ROOM1', { selector: '.legend-row span' })).toBeTruthy();
  });

  it('переключение ревизии на битый файл → баннер разбора, прежняя сцена не меняется (docs-unified/04 §2.3)', async () => {
    renderApp();
    await selectProject();
    await waitLoaded();

    const revSelect = screen.getByRole('combobox', { name: 'Файл результата (ревизия)' });
    fireEvent.change(revSelect, { target: { value: OLD_RESULT } });

    // баннер ошибки разбора; состояние отчёта — прежняя (корректная) ревизия
    await waitFor(() => expect(screen.getByText(/Ошибка разбора отчёта/)).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('room1')).toBeTruthy();
    // строка статуса сцены по-прежнему на свежей (корректной) ревизии
    expect(
      screen.getByText(new RegExp(`файл: ${NEW_RESULT} · 50×50 клеток`), { selector: '.status-line' }),
    ).toBeTruthy();
  });

  it('URL ?project=&result= с битой ревизией → баннер, сцена не строится (docs-unified/04 §2.5)', async () => {
    window.history.pushState(null, '', `/viewer3d/?project=${PROJECT}&result=${OLD_RESULT}`);
    renderApp();

    await waitFor(() => expect(screen.getByText(/Ошибка разбора отчёта/)).toBeTruthy(), { timeout: 5000 });
    // заглушка сцены — состояние не изменилось (отчёт не загружен)
    expect(screen.getByText(/Выберите проект и файл результата/)).toBeTruthy();
  });

  it('URL ?project= → проект подгружается автоматически', async () => {
    window.history.pushState(null, '', `/viewer3d/?project=${PROJECT}`);
    renderApp();
    await waitLoaded();
    expect(screen.getByText('room1')).toBeTruthy();
  });

  it('клик по строке → карточка выбранной комнаты; повторный клик — снять выделение', async () => {
    renderApp();
    await selectProject();
    await waitLoaded();

    expect(screen.getByText('комната не выбрана')).toBeTruthy();

    // клик по строке room1
    fireEvent.click(screen.getByText('room1'));
    await waitFor(() => {
      const info = screen.getAllByText('room1');
      expect(info.length).toBeGreaterThanOrEqual(2); // строка списка + заголовок карточки
    });
    expect(screen.getByText(/символ R · тип ROOM1/)).toBeTruthy();
    expect(screen.getByText(/клеток: 650 · площадь: 650\.00 м²/)).toBeTruthy();
    expect(screen.getByText(/габариты \(bbox\):/)).toBeTruthy();

    // повторный клик по выделенной строке — снять выделение (ТЗ 04 §5)
    fireEvent.click(screen.getAllByText('room1')[0]);
    await waitFor(() => expect(screen.getByText('комната не выбрана')).toBeTruthy());
  });

  it('Esc снимает выделение (ТЗ 04 §12)', async () => {
    renderApp();
    await selectProject();
    await waitLoaded();
    fireEvent.click(screen.getByText('corridor1'));
    await waitFor(() => expect(screen.getByText(/символ C · тип CORRIDOR/)).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByText('комната не выбрана')).toBeTruthy());
  });

  it('PNG-кнопка активна только после загрузки отчёта', async () => {
    renderApp();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'PNG' }) as HTMLButtonElement).disabled).toBe(true),
    );
    await selectProject();
    await waitLoaded();
    expect((screen.getByRole('button', { name: 'PNG' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('двухуровневое имя: селектор — человекочитаемое name, API/URL/статусы — slug (замечание 2)', async () => {
    const NAME = 'Демо офис'; // русские буквы + пробел в display-имени
    const SLUG = 'demo-office';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url === '/api/projects') {
          return okJson({
            projects: [
              {
                id: 'id-1',
                name: NAME,
                slug: SLUG,
                createdAt: null,
                updatedAt: null,
                latestResult: NEW_RESULT,
                sizeBytes: 1,
                resultsCount: 1,
                previewsCount: 0,
                filesCount: 2,
              },
            ],
          });
        }
        if (url === `/api/projects/${SLUG}/results`) {
          return okJson({
            results: [
              { name: NEW_RESULT, sizeBytes: GOOD_REPORT.length, mtimeIso: '2026-09-13T12:00:00.000Z' },
            ],
          });
        }
        const m = /\/api\/projects\/([^/]+)\/file\?name=([^&]+)/.exec(url);
        if (m !== null && m[1] === SLUG && m[2] === NEW_RESULT) return okText(GOOD_REPORT);
        return notFound();
      }),
    );

    renderApp();
    const select = screen.getByRole('combobox', { name: 'Проект' }) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false), { timeout: 5000 });

    // Опция: текст — человекочитаемое имя, value — slug.
    const option = Array.from(select.options).find((o) => o.textContent === NAME);
    expect(option?.value).toBe(SLUG);

    fireEvent.change(select, { target: { value: SLUG } });
    await waitFor(() => expect(screen.getByText('room1')).toBeTruthy(), { timeout: 5000 });

    // Статус панели — человекочитаемое имя; URL — slug.
    expect(
      screen.getByText(new RegExp(`проект: ${NAME} · файл: ${NEW_RESULT}`), {
        selector: '.panel-files li',
      }),
    ).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(`?project=${SLUG}&result=${NEW_RESULT}`));
  });
});
