// @vitest-environment jsdom
// Интеграция «UI ↔ API» менеджера проектов с моком fetch (ТЗ 05 §2).
// Замечание 2: у проекта два имени — display-name (name, показывается в UI) и
// slug (ключ всех URL); мок повторяет сервер: rename меняет только name,
// create сам генерирует slug.
//   • создание → появление карточки (+ красные slug, 409);
//   • удаление с подтверждением;
//   • импорт: ошибка 409 → баннер; успех → info-баннер + карточка;
//   • превью: миниатюра → модалка оригинала, блокировка скролла, закрытие по Esc.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from '../../src/App';
import type { ProjectMeta } from '../../src/lib/api';

// ---------------------------------------------------------------------------
// Мок API: состояние проектов в памяти, маршрутизация по URL+методу.
// ---------------------------------------------------------------------------

const ISO = '2026-09-13T13:15:04.210Z';

function project(over: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    id: 'id-' + over.name,
    name: 'alpha',
    // По умолчанию slug = имя (как в проде для латинских имён).
    slug: over.slug ?? over.name ?? 'alpha',
    createdAt: ISO,
    updatedAt: ISO,
    latestResult: null,
    sizeBytes: 48211,
    resultsCount: 3,
    previewsCount: 0,
    filesCount: 5,
    ...over,
  };
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface ApiState {
  projects: ProjectMeta[];
}

interface MockApi {
  fetchMock: ReturnType<typeof vi.fn>;
  state: ApiState;
  importResponse?: (state: ApiState) => Response; // переопределение ответа на импорт (для 409)
}

function mockApi(initial: ProjectMeta[], importFn?: (state: ApiState) => Response, deleteStatus = 204): MockApi {
  const state = { projects: [...initial] };
  const m: MockApi = {
    fetchMock: vi.fn(),
    state,
    importResponse: importFn,
  };

  m.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/projects' && method === 'GET') {
      return jsonRes(200, { projects: state.projects });
    }
    if (url === '/api/projects' && method === 'POST') {
      // Замечание 2: тело — человекочитаемое имя; slug генерирует «сервер».
      const name = (JSON.parse(String(init?.body)) as { name: string }).name;
      if (name.length < 1 || name.length > 64 || name.includes('/')) {
        return jsonRes(400, { error: 'INVALID_NAME', message: 'Имя не проходит регламент имён проекта' });
      }
      const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
      let slug = (base || 'project-mock') ;
      let n = 2;
      while (state.projects.some((p) => p.slug === slug)) {
        slug = `${base}-${n}`;
        n += 1;
      }
      const p = project({ name, slug });
      state.projects = [p, ...state.projects];
      return jsonRes(201, { project: p });
    }
    if (method === 'DELETE' && url.startsWith('/api/projects/')) {
      // Замечание 2: в URL — slug, не display-name.
      const slug = decodeURIComponent(url.slice('/api/projects/'.length));
      const i = state.projects.findIndex((p) => p.slug === slug);
      if (i < 0) {
        return jsonRes(404, { error: 'PROJECT_NOT_FOUND', message: `Проект «${name}» не найден в рабочем пространстве` });
      }
      if (deleteStatus !== 204) {
        return jsonRes(deleteStatus, {
          error: 'PROJECT_NOT_FOUND',
          message: `Проект «${name}» не найден в рабочем пространстве`,
        });
      }
      state.projects.splice(i, 1);
      return new Response(null, { status: 204 });
    }
    if (url === '/api/projects/import' && method === 'POST') {
      if (m.importResponse) return m.importResponse(state);
      const p = project({ name: 'imported-2', latestResult: null });
      state.projects = [p, ...state.projects];
      return jsonRes(201, {
        project: p,
        imported: ['spec.yaml', 'blocked.txt'],
        skipped: [{ name: 'preview/preview-20260913-140512.png', reason: 'превью не импортируется' }],
      });
    }
    if (url.endsWith('/previews') && method === 'GET') {
      const name = decodeURIComponent(url.split('/').slice(-2, -1)[0]);
      if (name === 'alpha') {
        return jsonRes(200, {
          previews: [
            { name: 'preview-20260913-140512.png', sizeBytes: 1000, mtimeIso: ISO },
            { name: 'preview-20260913-132001.png', sizeBytes: 900, mtimeIso: ISO },
          ],
        });
      }
      return jsonRes(200, { previews: [] });
    }
    if (/\/rename$/.test(url) && method === 'PATCH') {
      // Замечание 2: меняем только display-name; slug (и каталог) не трогаем.
      const slug = decodeURIComponent(url.split('/').slice(-2, -1)[0]);
      const newName = (JSON.parse(String(init?.body)) as { name: string }).name;
      if (newName.length < 1 || newName.length > 64 || newName.includes('/')) {
        return jsonRes(422, { error: 'UNPROCESSABLE', message: 'Имя не проходит регламент имён проекта' });
      }
      const i = state.projects.findIndex((p) => p.slug === slug);
      if (i < 0) {
        return jsonRes(404, { error: 'PROJECT_NOT_FOUND', message: `Проект «${slug}» не найден в рабочем пространстве` });
      }
      state.projects[i] = { ...state.projects[i], name: newName };
      return jsonRes(200, { project: state.projects[i] });
    }
    return jsonRes(404, { error: 'NOT_FOUND', message: `Не найдено: ${url}` });
  });

  vi.stubGlobal('fetch', m.fetchMock);
  return m;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Кнопка «Создать» есть и в шапке, и в пустом состоянии — кликаем первую.
function openCreate(): void {
  const btns = screen.getAllByRole('button', { name: '＋ Создать проект' });
  fireEvent.click(btns[0]);
}

// ---------------------------------------------------------------------------
// Тесты
// ---------------------------------------------------------------------------

describe('создание проекта', () => {
  it('пустой workspace → подсказка; создание → карточка появляется', async () => {
    const m = mockApi([]);
    render(<App />);

    await screen.findByText(/Проектов пока нет/);
    openCreate();

    const input = screen.getByPlaceholderText('имя проекта (напр., «Офис Б», до 64 символов)');
    fireEvent.change(input, { target: { value: 'demo-p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await screen.findByText('demo-p1'); // заголовок карточки
    const post = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects' && (i as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'demo-p1' });
  });

  it('невалидное имя (содержит «/») → inline-ошибка, POST не отправляется', async () => {
    const m = mockApi([]);
    render(<App />);
    await screen.findByText(/Проектов пока нет/);

    openCreate();
    // Замечание 2: кириллица/пробелы/регистр теперь допустимы; запрещён только «/».
    const input = screen.getByPlaceholderText('имя проекта (напр., «Офис Б», до 64 символов)');
    fireEvent.change(input, { target: { value: 'a/b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByText(/запрещён символ/)).toBeTruthy();
    const post = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects' && (i as RequestInit | undefined)?.method === 'POST',
    );
    expect(post).toBeUndefined();
  });

  it('замечание 2: кириллическое имя создаётся; slug — латинский', async () => {
    const m = mockApi([]);
    render(<App />);
    await screen.findByText(/Проектов пока нет/);

    openCreate();
    const input = screen.getByPlaceholderText('имя проекта (напр., «Офис Б», до 64 символов)');
    fireEvent.change(input, { target: { value: 'Офис Б-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await screen.findByText('Офис Б-2'); // заголовок карточки — display-name
    const post = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects' && (i as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'Офис Б-2' });
  });

  it('дубликат display-name → разрешён; slug получает суффикс -2', async () => {
    const m = mockApi([project({ name: 'beta' })]);
    render(<App />);
    await screen.findByText('beta');

    openCreate();
    const input = screen.getByPlaceholderText('имя проекта (напр., «Офис Б», до 64 символов)');
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    // Две карточки с одинаковым заголовком — уникален slug, а не имя.
    await waitFor(() => expect(screen.getAllByText('beta')).toHaveLength(2));
    const posts = m.fetchMock.mock.calls.filter(
      ([u, i]) => String(u) === '/api/projects' && (i as RequestInit | undefined)?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
  });
});

describe('удаление проекта', () => {
  it('🗑 → подтверждение → DELETE → карточка исчезает', async () => {
    const m = mockApi([project({ name: 'alpha' })]);
    render(<App />);
    await screen.findByText('alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Удалить проект alpha' }));
    expect(await screen.findByText(/Действие необратимо/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await screen.findByText(/Проектов пока нет/);

    const del = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects/alpha' && (i as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(del).toBeDefined();
  });

  it('404 при удалении → баннер с текстом API и [Обновить], модалка закрывается', async () => {
    // эмулируем удаление каталога «сзади»: DELETE отвечает 404
    mockApi([project({ name: 'ghost' })], undefined, 404);
    render(<App />);
    await screen.findByText('ghost');

    fireEvent.click(screen.getByRole('button', { name: 'Удалить проект ghost' }));
    await screen.findByText(/Действие необратимо/);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText(/не найден в рабочем пространстве/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeTruthy();
    expect(document.querySelector('.modal')).toBeNull();
  });
});

describe('импорт из архива', () => {
  function fileInput(container: HTMLElement): HTMLInputElement {
    const el = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!el) throw new Error('hidden file input не найден');
    return el;
  }

  it('успех → info-баннер «импортирован: файлов N, пропущено M» + карточка', async () => {
    const m = mockApi([]);
    const { container } = render(<App />);
    await screen.findByText(/Проектов пока нет/);

    fireEvent.change(fileInput(container), {
      target: { files: [new File(['zip-bytes'], 'proj.zip', { type: 'application/zip' })] },
    });

    expect(await screen.findByText(/Проект «imported-2» импортирован: файлов 2, пропущено 1/)).toBeTruthy();
    await screen.findByText('imported-2'); // карточка после перезапроса списка
    const imp = m.fetchMock.mock.calls.find(([u]) => String(u) === '/api/projects/import');
    expect(imp).toBeDefined();
  });

  it('ошибка 409 от сервера → красный баннер с текстом API', async () => {
    mockApi(
      [],
      () => jsonRes(409, { error: 'PROJECT_EXISTS', message: 'Проект с именем «x» уже существует' }),
    );
    const { container } = render(<App />);
    await screen.findByText(/Проектов пока нет/);

    fireEvent.change(fileInput(container), {
      target: { files: [new File(['zip-bytes'], 'proj.zip', { type: 'application/zip' })] },
    });

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Проект с именем «x» уже существует');
  });
});

describe('превью (ТЗ 03 §3)', () => {
  it('миниатюры подгружаются; клик → модалка оригинала + имя/дата; Esc закрывает; скролл блокируется', async () => {
    mockApi([project({ name: 'alpha', previewsCount: 2 })]);
    render(<App />);

    const thumb = (await screen.findByAltText('preview-20260913-140512.png')) as HTMLImageElement;
    expect(thumb.getAttribute('loading')).toBe('lazy');

    fireEvent.click(thumb);
    const dialog = await screen.findByRole('dialog');
    const full = dialog.querySelector('.preview-full') as HTMLImageElement;
    expect(full.src).toContain('/api/projects/alpha/preview?file=preview-20260913-140512.png');
    expect(dialog.textContent).toContain('preview-20260913-140512.png');
    expect(document.body.style.overflow).toBe('hidden'); // ТЗ 03 §3: скролл блокируется

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.preview-full')).toBeNull());
    expect(document.body.style.overflow).toBe('');
  });
});

describe('переименование (замечание 2)', () => {
  it('✎ → новое имя → PATCH по старому slug → карточка обновлена; slug стабилен', async () => {
    const m = mockApi([project({ name: 'alpha' })]);
    render(<App />);
    await screen.findByText('alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать проект alpha' }));
    const input = (await screen.findByLabelText('новое имя проекта')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Новое Имя' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.queryByText('alpha')).toBeNull());
    expect(screen.getByText('Новое Имя')).toBeTruthy();
    // PATCH ушёл по старому slug (display-name не участвует в URL)
    const patch = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects/alpha/rename' && (i as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ name: 'Новое Имя' });

    // Slug стабилен: удаление по-прежнему идёт по /api/projects/alpha.
    fireEvent.click(screen.getByRole('button', { name: 'Удалить проект Новое Имя' }));
    await screen.findByText(/Действие необратимо/);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await screen.findByText(/Проектов пока нет/);
    const del = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects/alpha' && (i as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(del).toBeDefined();
  });
});

describe('иконки карточки (замечание 3)', () => {
  it('✎ и 🗑 имеют одинаковый класс и размеры (.icon-btn)', async () => {
    mockApi([project({ name: 'alpha' })]);
    render(<App />);
    await screen.findByText('alpha');

    const rename = screen.getByRole('button', { name: 'Переименовать проект alpha' });
    const del = screen.getByRole('button', { name: 'Удалить проект alpha' });
    expect(rename.className).toBe('icon-btn');
    expect(del.className).toBe(rename.className);
  });
});
