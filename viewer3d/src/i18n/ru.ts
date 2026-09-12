// Все строки UI на русском (ТЗ 04 §11): именованные константы + функции шаблонов.
// Внешних i18n-библиотек нет; русский — единственный язык. Запрещено дублировать
// строки по компонентам — только через этот модуль.

export const ru = {
  // Общие
  appTitle: 'viewer3d — 3D-визуализатор размещения кластеров',
  disabledHint: 'Сначала загрузите отчёт',

  // Панель «Файл» (04 §2)
  panelFiles: 'ФАЙЛ',
  fileStatus: 'Отчёт:',
  loadReportButton: '📂 Загрузить отчёт…',
  fileNameLabel: 'имя:',
  gridStatusLabel: 'сетка:',
  roomsStatusLabel: 'комнат:',
  infeasibleMark: 'размещение не удалось',
  warningsCountLabel: '⚠ предупреждения:',
  parseErrorBanner: 'Ошибка разбора отчёта',
  expandDetails: 'подробнее',
  noReportLoaded: 'файл не загружен',

  // Заглушка сцены до загрузки (04 §1)
  scenePlaceholder: 'Загрузите файл отчёта (result-*.txt)',

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
  statusLine: (
    w: number,
    h: number,
    scale: number,
    unitLabel: string,
    roomsCount: number,
    wallBoxesCount: number,
  ): string =>
    `${w}×${h} клеток · S = ${scale} ${unitLabel}/клетку · комнат: ${roomsCount} · стен: ${wallBoxesCount} боксов`,
  unmatchedRowLine: (id: string, typeId: string, actual: number): string =>
    actual === 0 ? `${id} — ${typeId}, факт 0 кл. (не размещён)` : `${id} — ${typeId}, факт ${actual} кл.`,
  infoTableRowLine: (share: number | null, target: number, actual: number, deviation: string, status: string): string =>
    `доля ${share === null ? '—' : `${share}%`} · цель ${target} · факт ${actual} · отклонение ${deviation} · статус ${status}`,
};

export type RuStrings = typeof ru;
