// @vitest-environment jsdom
// Интеграция «UI ↔ API» менеджера проектов с моком fetch (ТЗ 05 §2):
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
      const name = (JSON.parse(String(init?.body)) as { name: string }).name;
      if (state.projects.some((p) => p.name === name)) {
        return jsonRes(409, { error: 'PROJECT_EXISTS', message: `Проект с именем «${name}» уже существует` });
      }
      const p = project({ name });
      state.projects = [p, ...state.projects];
      return jsonRes(201, { project: p });
    }
    if (method === 'DELETE' && url.startsWith('/api/projects/')) {
      const name = decodeURIComponent(url.slice('/api/projects/'.length));
      const i = state.projects.findIndex((p) => p.name === name);
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
      const oldName = decodeURIComponent(url.split('/').slice(-2, -1)[0]);
      const newName = (JSON.parse(String(init?.body)) as { name: string }).name;
      const i = state.projects.findIndex((p) => p.name === oldName);
      if (i < 0) {
        return jsonRes(404, { error: 'PROJECT_NOT_FOUND', message: `Проект «${oldName}» не найден в рабочем пространстве` });
      }
      state.projects[i] = project({ ...state.projects[i], name: newName });
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

    const input = screen.getByPlaceholderText('имя проекта (a–z, 0–9, `_`, `-`)');
    fireEvent.change(input, { target: { value: 'demo-p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await screen.findByText('demo-p1'); // заголовок карточки
    const post = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects' && (i as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'demo-p1' });
  });

  it('невалидный slug → inline-ошибка, POST не отправляется', async () => {
    const m = mockApi([]);
    render(<App />);
    await screen.findByText(/Проектов пока нет/);

    openCreate();
    const input = screen.getByPlaceholderText('имя проекта (a–z, 0–9, `_`, `-`)');
    fireEvent.change(input, { target: { value: 'Abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByText(/Допустимые символы/)).toBeTruthy();
    const post = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects' && (i as RequestInit | undefined)?.method === 'POST',
    );
    expect(post).toBeUndefined();
  });

  it('дубликат (409) → inline-текст API', async () => {
    mockApi([project({ name: 'beta' })]);
    render(<App />);
    await screen.findByText('beta');

    openCreate();
    const input = screen.getByPlaceholderText('имя проекта (a–z, 0–9, `_`, `-`)');
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByText(/Проект с именем «beta» уже существует/)).toBeTruthy();
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

describe('переименование', () => {
  it('✎ → новое имя → PATCH → карточка обновлена', async () => {
    const m = mockApi([project({ name: 'alpha' })]);
    render(<App />);
    await screen.findByText('alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать проект alpha' }));
    const input = (await screen.findByLabelText('новое имя проекта')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'beta2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.queryByText('alpha')).toBeNull());
    expect(screen.getByText('beta2')).toBeTruthy();
    const patch = m.fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/projects/alpha/rename' && (i as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ name: 'beta2' });
  });
});
