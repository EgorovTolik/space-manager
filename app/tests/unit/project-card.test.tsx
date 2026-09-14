// @vitest-environment jsdom
// Unit-тесты компонентов экрана «Проекты» (ручное тестирование, раунд 4):
//   • ProjectCard — ВСЕ превью в ленте, без усечения и без «+N»;
//   • PreviewModal — стрелки «←»/«→» листают коллекцию карточки с wrap-around,
//     подпись (имя + дата) и счётчик «N / M» актуальны;
//   • кнопки «Переименовать»/«Удалить» — единый класс размера (.icon-btn).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import PreviewModal from '../../src/components/PreviewModal';
import ProjectCard from '../../src/components/ProjectCard';
import type { PreviewEntry, ProjectMeta } from '../../src/lib/api';

const ISO = '2026-09-13T13:15:04.210Z';

function project(over: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    id: 'id-alpha',
    name: 'alpha',
    slug: 'alpha',
    createdAt: ISO,
    updatedAt: ISO,
    latestResult: null,
    sizeBytes: 1024,
    resultsCount: 0,
    previewsCount: 0,
    filesCount: 3,
    ...over,
  };
}

/** N превью с предсказуемыми именами (в UI список идёт по убыванию имени). */
function previews(n: number): PreviewEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `preview-20260913-${String(140500 + i).padStart(6, '0')}.png`,
    sizeBytes: 1000 + i,
    mtimeIso: ISO,
  }));
}

function renderCard(n = 8): HTMLElement {
  const list = previews(n);
  const card = render(
    <ProjectCard
      project={project({ previewsCount: n })}
      previews={list}
      onRename={() => undefined}
      onDelete={() => undefined}
      onPreview={() => undefined}
    />,
  );
  return card.container;
}

afterEach(() => cleanup());

describe('ProjectCard: лента превью (заметка №1)', () => {
  it('рендерит ВСЕ превью без усечения и без «+N»', () => {
    const container = renderCard(12); // раньше лимит был 8 + «+4»
    const strip = container.querySelector('.preview-strip');
    expect(strip).not.toBeNull();
    const imgs = strip!.querySelectorAll('img');
    expect(imgs).toHaveLength(12);
    // Ни одного маркера скрытых превью.
    expect(container.textContent).not.toMatch(/\+\d+/);
    expect(container.querySelector('.preview-more')).toBeNull();
  });

  it('без превью — блок ленты не рендерится', () => {
    const container = renderCard(0);
    expect(container.querySelector('.preview-strip')).toBeNull();
  });
});

describe('PreviewModal: навигация по коллекции (заметка №1, продолжение)', () => {
  function openModal(count: number, index: number): void {
    const list = previews(count);
    render(<PreviewModal slug="alpha" entries={list} index={index} onClose={() => undefined} />);
  }

  it('«→» листает вперёд; подпись и счётчик актуальны', () => {
    openModal(3, 0);
    const img = () => document.querySelector('.preview-full') as HTMLImageElement;
    expect(img().src).toContain('file=preview-20260913-140500.png');
    expect(screen.getByText('1 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Следующее превью' }));
    expect(img().src).toContain('file=preview-20260913-140501.png');
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });

  it('wrap-around: «→» с конца — в начало, «←» с начала — в конец', () => {
    openModal(3, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущее превью' }));
    expect((document.querySelector('.preview-full') as HTMLImageElement).src).toContain(
      'file=preview-20260913-140502.png',
    );
    expect(screen.getByText('3 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Следующее превью' }));
    expect((document.querySelector('.preview-full') as HTMLImageElement).src).toContain(
      'file=preview-20260913-140500.png',
    );
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('подпись показывает имя и дату ТЕКУЩЕГО изображения', () => {
    openModal(2, 1);
    const caption = (): string => document.querySelector('.preview-caption')!.textContent ?? '';
    expect(caption()).toContain('preview-20260913-140501.png');

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущее превью' }));
    expect(caption()).toContain('preview-20260913-140500.png');
    expect(caption()).not.toContain('preview-20260913-140501.png');
  });

  it('одно превью — без стрелок и без счётчика', () => {
    openModal(1, 0);
    expect(screen.queryByRole('button', { name: 'Предыдущее превью' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Следующее превью' })).toBeNull();
    expect(document.querySelector('.preview-counter')).toBeNull();
  });
});

describe('ProjectCard: кнопки rename/delete (заметка №2)', () => {
  it('«Переименовать» и «Удалить» — единый класс размера .icon-btn', () => {
    renderCard(1);
    const rename = screen.getByRole('button', { name: 'Переименовать проект alpha' });
    const del = screen.getByRole('button', { name: 'Удалить проект alpha' });
    expect(rename.className).toBe('icon-btn');
    expect(del.className).toBe(rename.className); // один класс → одна высота/padding/шрифт
  });
});
