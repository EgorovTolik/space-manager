// Layout редактора (ТЗ 04 §2): три колонки —
//   левая:    FilesPanel + ValidationBanner (баннер — под панелью файлов, ТЗ 04 §1/§7);
//   центр:    GridCanvas (вся оставшаяся ширина, режимы маски внутри него);
//   правая:   ТАБЫ [Кластеры][Типы][Правила] — активный таб не влияет на canvas.
// До загрузки спеки правые панели и кнопки масок неактивны: подпись «Сначала загрузите
// спекацию» (ТЗ 04 §1 / ТЗ 05 §1). beforeunload при несохранённых изменениях (ТЗ 04 §8,
// 07-nfr-limits §2) — глобальный dirty-флаг store.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ru } from './i18n/ru';
import { EditorProvider, isDirty, useEditor } from './state/editorStore';
import FilesPanel from './components/FilesPanel';
import GridCanvas from './components/GridCanvas';
import ClustersPanel from './components/ClustersPanel';
import TypesPanel from './components/TypesPanel';
import RulesPanel from './components/RulesPanel';
import ValidationBanner from './components/ValidationBanner';

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr 320px',
    gap: '8px',
    height: 'calc(100vh - 34px)',
    boxSizing: 'border-box',
    padding: '0 8px 8px',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '14px',
  },
  left: { display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' },
  center: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, minHeight: 0 },
  right: { display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' },
  tabRow: { display: 'flex', gap: 4 },
};

type Tab = 'clusters' | 'types' | 'rules';

function Layout(): JSX.Element {
  const { state } = useEditor();
  const [tab, setTab] = useState<Tab>('clusters');

  // beforeunload (ТЗ 04 §8 / 07 §2): предупреждение при несохранённых изменениях.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = ru.beforeUnload;
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const tabBtn = (active: boolean): CSSProperties => ({
    padding: '4px 10px',
    cursor: 'pointer',
    border: `1px solid ${active ? '#1565c0' : '#bbb'}`,
    borderRadius: '4px',
    background: active ? '#e3f2fd' : '#fff',
    fontWeight: active ? 700 : 400,
  });

  return (
    <div style={styles.root}>
      {/* Левая колонка: файлы + баннер ошибок (ТЗ 04 §1) */}
      <aside style={styles.left}>
        <FilesPanel />
        <ValidationBanner />
      </aside>

      {/* Центр: один сетевой редактор на оба режима маски (ТЗ 04 §2/§3) */}
      <main style={styles.center}>
        <GridCanvas />
      </main>

      {/* Правая колонка: табы; до спеки — неактивны (ТЗ 04 §1) */}
      <aside style={styles.right}>
        {state.spec ? (
          <>
            <div style={styles.tabRow}>
              {(['clusters', 'types', 'rules'] as const).map((t) => (
                <button key={t} type="button" style={tabBtn(tab === t)} onClick={() => setTab(t)}>
                  {ru.panels[t]}
                </button>
              ))}
            </div>
            {tab === 'clusters' && <ClustersPanel />}
            {tab === 'types' && <TypesPanel />}
            {tab === 'rules' && <RulesPanel />}
          </>
        ) : (
          <section className="panel" style={{ padding: 8, color: '#888' }}>
            {ru.grid.noSpec}
          </section>
        )}
      </aside>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <EditorProvider>
      <h1 style={{ margin: '6px 8px', fontSize: '16px' }}>{ru.appTitle}</h1>
      <Layout />
    </EditorProvider>
  );
}
