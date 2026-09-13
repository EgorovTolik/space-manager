// Все строки UI менеджера проектов. RU — единственный язык.
// Выжимка обязательных строк — ТЗ docs-unified/03-manager-ui.md §5.

export const ru = {
  appTitle: 'Space Manager · проекты',
  actions: {
    create: '＋ Создать проект',
    import: '⬆ Импортировать из архива…',
    importing: 'Импортируем…',
  },
  create: {
    placeholder: 'имя проекта (a–z, 0–9, `_`, `-`)',
    submit: 'Создать',
    creating: 'Создаём…',
    cancel: 'Отмена',
    invalidSlug: 'Допустимые символы: a–z, 0–9, `_`, `-`; длина 1–40',
  },
  rename: {
    title: 'Переименовать проект?',
    newLabel: 'новое имя проекта',
    save: 'Сохранить',
    saving: 'Сохраняем…',
    cancel: 'Отмена',
  },
  card: {
    editor: 'Редактор',
    viewer: 'Viewer3D',
    archive: '⬇ Архив',
    changed: 'изменён: {date}',
    metrics: 'файлов: {files} · результатов: {results} · {size}',
    corrupted: '⚠ метаданные повреждены',
    previews: 'Превью',
    renameAria: 'Переименовать проект {name}',
    deleteAria: 'Удалить проект {name}',
  },
  confirmDelete: {
    title: 'Удалить проект?',
    body: 'Удалить проект «{name}» и все его файлы? Действие необратимо.',
    delete: 'Удалить',
    deleting: 'Удаляем…',
    cancel: 'Отмена',
  },
  empty: {
    hint: 'Проектов пока нет. Создайте первый проект или импортируйте архив.',
  },
  error: {
    loadProjects:
      'Не удалось загрузить список проектов: {detail} Проверьте, что запущен сервис (:4080).',
    retry: 'Повторить',
    refresh: 'Обновить',
  },
  importSuccess: 'Проект «{name}» импортирован: файлов {n}, пропущено {m}',
  // Тот же текст, что у API 413 PAYLOAD_TOO_LARGE (server/errors.ts) — ТЗ 03 §2.
  tooLarge: 'Размер загрузки превышает лимит 10 МБ',
  loading: 'Загружаем проекты…',
  closeAria: 'Закрыть',
};

/** Подстановка {плейсхолдеров} в шаблон строки. */
export function t(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in vars ? String(vars[key]) : m,
  );
}
