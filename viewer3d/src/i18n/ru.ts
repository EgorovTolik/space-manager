// Все строки UI на русском (ТЗ 04 §11): именованные константы + функции шаблонов.
// Внешних i18n-библиотек нет; русский — единственный язык. Запрещено дублировать
// строки по компонентам — только через этот модуль.

export const ru = {
  // Общие
  appTitle: 'viewer3d — 3D-визуализатор размещения кластеров',
  disabledHint: 'Сначала загрузите отчёт',

  // Панель «Проект и ревизия» (docs-unified/04 §2.3; была «ФАЙЛ», ТЗ viewer3d 04 §2)
  panelFiles: 'ПРОЕКТ',
  fileStatus: 'Отчёт:',
  projectSelectAria: 'Проект',
  projectPlaceholder: '— выберите проект —',
  revisionSelectAria: 'Файл результата (ревизия)',
  revisionPlaceholder: '— выберите файл —',
  loadingLabel: 'загрузка…',
  noProjects: 'проектов нет — создайте проект в менеджере (/) и выполните генерацию',
  noResults: 'в проекте нет файлов result-* — выполните генерацию размещения в редакторе',
  projectNotFoundBanner: (name: string): string => `Проект «${name}» не найден`,
  loadErrorBanner: (msg: string): string => `Не удалось загрузить файл: ${msg}`,
  fileNameLabel: 'имя:',
  gridStatusLabel: 'сетка:',
  roomsStatusLabel: 'комнат:',
  infeasibleMark: 'размещение не удалось',
  warningsCountLabel: '⚠ предупреждения:',
  parseErrorBanner: 'Ошибка разбора отчёта',
  expandDetails: 'подробнее',
  noReportLoaded: 'отчёт не загружен — выберите проект и файл результата',

  // PNG → предпросмотр проекта (docs-unified/04 §2.4)
  snapshotSaved: (file: string): string => `Предпросмотр сохранён в проект: ${file}`,
  snapshotFailed: 'Не удалось снять кадр сцены — попробуйте ещё раз',
  snapshotErrorBanner: (msg: string): string => `Не удалось сохранить предпросмотр: ${msg}`,

  // Заголовок (docs-unified/04 §2.2)
  toProjects: '← К проектам',

  // Заглушка сцены до загрузки (04 §1)
  scenePlaceholder: 'Выберите проект и файл результата (result-*.txt)',

  // Панель «Параметры» (04 §3)
  panelParams: 'ПАРАМЕТРЫ',
  paramScale: 'Масштаб, ед./клетка',
  paramWallHeight: 'Высота стены',
  paramWallThickness: 'Толщина стены',
  paramUnit: 'Единица',
  paramShowBlocked: 'Показывать blocked',
  paramWallsOpacity: 'Прозрачность стен',
  paramHideWalls: 'Скрыть стены',
  paramShowLabels: 'Подписи комнат',
  resetParamsButton: 'Сбросить параметры',

  // Тулбар / пресеты (04 §4.4, §10)
  presetIso: 'Изометрия',
  presetTop: 'Сверху',
  presetFront: 'Спереди',
  pngSnapshotButton: 'PNG',
  pngSnapshotTitle: 'Сохранить текущий кадр сцены в PNG',

  // Список комнат (04 §5)
  panelRooms: 'КОМНАТЫ',
  roomsColLabel: 'метка',
  roomsColSymbol: 'символ',
  roomsColType: 'тип',
  roomsColCells: 'клеток',
  roomsColArea: 'площадь',
  roomsColStatus: 'статус',
  noRooms: 'комнат нет',
  unmatchedBlockTitle: 'В ТАБЛИЦЕ, НО НЕ НАЙДЕНО:',
  notPlacedMark: '(не размещён)',
  dash: '—',

  // Карточка выбранной комнаты (04 §6)
  panelInfo: 'ИНФО (выбранное)',
  infoNoSelection: 'комната не выбрана',
  infoCellsLabel: 'клеток:',
  infoAreaLabel: 'площадь:',
  infoBboxLabel: 'габариты (bbox):',
  infoTableRowTitle: '— строка таблицы:',
  infoSharePrefix: 'доля',
  deselectButton: 'Снять выделение',

  // Легенда (04 §5)
  panelLegend: 'ЛЕГЕНДА',
  legendEmpty: 'символы появятся после загрузки отчёта',

  // Баннер предупреждений (04 §9)
  warningsBannerCollapse: 'Свернуть',
  warningsBannerExpand: 'Развернуть',

  // Строки-шаблоны
  infoSymbolTypeLine: (symbol: string, typeId: string | null): string =>
    `символ ${symbol} · тип ${typeId ?? '—'}`,
  gridStatus: (w: number, h: number): string => `${w}×${h}`,
  roomsCount: (n: number): string => String(n),
  areaValue: (value: number, unitLabel: string): string =>
    `${value.toFixed(2)} ${unitLabel}²`,
  bboxValue: (w: number, h: number, unitLabel: string): string =>
    `${w.toFixed(1)} × ${h.toFixed(1)} ${unitLabel}`,
  // Строка статуса (04 §4.5 + docs-unified/04 §2.2): проект и ревизия — префикс,
  // если отчёт загружен из проекта единого сервиса.
  statusLine: (
    w: number,
    h: number,
    scale: number,
    unitLabel: string,
    roomsCount: number,
    wallBoxesCount: number,
    projectName: string | null,
    resultName: string | null,
  ): string =>
    `${projectName !== null ? `проект: ${projectName} · файл: ${resultName ?? '—'} · ` : ''}` +
    `${w}×${h} клеток · S = ${scale} ${unitLabel}/клетку · комнат: ${roomsCount} · стен: ${wallBoxesCount} боксов`,

  // Статус панели «Проект» (docs-unified/04 §2.3): «проект: p · файл: f».
  projectFileLine: (project: string | null, file: string | null): string =>
    `проект: ${project ?? '—'} · файл: ${file ?? '—'}`,
  unmatchedRowLine: (id: string, typeId: string, actual: number): string =>
    actual === 0 ? `${id} — ${typeId}, факт 0 кл. (не размещён)` : `${id} — ${typeId}, факт ${actual} кл.`,
  infoTableRowLine: (share: number | null, target: number, actual: number, deviation: string, status: string): string =>
    `доля ${share === null ? '—' : `${share}%`} · цель ${target} · факт ${actual} · отклонение ${deviation} · статус ${status}`,
};

export type RuStrings = typeof ru;
