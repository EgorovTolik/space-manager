// @vitest-environment jsdom
// Интеграция state ↔ компоненты (ТЗ 05 §2/§4): монтируем App с фикстурным отчётом,
// загружаем файл через FilePanel, проверяем список комнат, карточку выбранной
// комнаты и горячую клавишу Esc. R3F-сцена замещена mock'ом (WebGL в jsdom нет —
// тесты сцены идут e2e, подзадача 6).

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
const FIXTURE = fs.readFileSync(
  path.join(process.cwd(), 'tests', 'fixtures', 'report_basic.txt'),
  'utf-8',
);

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
});

function renderApp() {
  return render(
    <ViewerProvider>
      <App />
    </ViewerProvider>,
  );
}

/** «Загрузка» файла через input[type=file] (jsdom: FileReader работает), без ожидания. */
function feedFile(container: HTMLElement, name: string, text: string): void {
  const maybeInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
  expect(maybeInput, 'в FilePanel должен быть input[type=file]').not.toBeNull();
  if (maybeInput === null) throw new Error('input[type=file] не найден'); // сужение типа
  const input = maybeInput;
  const file = new File([text], name, { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [file] });
  fireEvent.change(input);
}

async function loadReportFile(container: HTMLElement): Promise<void> {
  feedFile(container, 'result-test.txt', FIXTURE);
  // FileReader асинхронный — ждём появления списка комнат
  await waitFor(() => expect(screen.getByText('room1')).toBeTruthy(), { timeout: 5000 });
}

describe('App + store + панели (без WebGL)', () => {
  it('до загрузки: заглушка сцены, панели неактивны', () => {
    renderApp();
    expect(screen.getByText(/Загрузите файл отчёта/)).toBeTruthy();
    // кнопка пресетов тулбара заблокирована до загрузки отчёта
    const iso = screen.getByRole('button', { name: 'Изометрия' }) as HTMLButtonElement;
    expect(iso.disabled).toBe(true);
  });

  it('загрузка реального отчёта → список комнат, статус сетки, легенда', async () => {
    const { container } = renderApp();
    await loadReportFile(container);

    // строка статуса (ТЗ 04 §4.5): 50×50, 3 комнаты, число боксов стен > 0
    const status = screen.getByText(/50×50 клеток · S = 1 м\/клетку · комнат: 3 · стен: \d+ боксов/);
    expect(status).toBeTruthy();

    // список комнат (ТЗ 04 §5): все три метки + площади в м² (S=1)
    expect(screen.getByText('room2')).toBeTruthy();
    expect(screen.getByText('corridor1')).toBeTruthy();
    expect(screen.getByText('650.00 м²')).toBeTruthy(); // room1: 650 клеток
    expect(screen.getByText('375.00 м²')).toBeTruthy();
    expect(screen.getByText('225.00 м²')).toBeTruthy();

    // легенда: символ → type_id
    expect(screen.getByText('ROOM1', { selector: '.legend-row span' })).toBeTruthy();
  });

  it('клик по строке → карточка выбранной комнаты; повторный клик — снять выделение', async () => {
    const { container } = renderApp();
    await loadReportFile(container);

    expect(screen.getByText('комната не выбрана')).toBeTruthy();

    // клик по строке room1
    fireEvent.click(screen.getByText('room1'));
    await waitFor(() => {
      // карточка: метка + символ/тип + клетки + габариты bbox
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
    const { container } = renderApp();
    await loadReportFile(container);
    fireEvent.click(screen.getByText('corridor1'));
    await waitFor(() => expect(screen.getByText(/символ C · тип CORRIDOR/)).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByText('комната не выбрана')).toBeTruthy());
  });

  it('битый файл → баннер ошибки разбора, сцена не строится', async () => {
    const { container } = renderApp();
    feedFile(container, 'bad.txt', 'просто текст без секций');
    await waitFor(() => expect(screen.getByText(/Ошибка разбора отчёта/)).toBeTruthy(), { timeout: 5000 });
    // заглушка сцены остаётся — состояние не изменилось
    expect(screen.getByText(/Загрузите файл отчёта/)).toBeTruthy();
  });

  it('PNG-кнопка активна только после загрузки отчёта', async () => {
    const { container } = renderApp();
    expect((screen.getByRole('button', { name: 'PNG' }) as HTMLButtonElement).disabled).toBe(true);
    await loadReportFile(container);
    expect((screen.getByRole('button', { name: 'PNG' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
