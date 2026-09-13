// Менеджер проектов — корневой компонент SPA (ТЗ 03 §1–§4).
// Единственный экран: шапка с действиями, сетка карточек, модалки, баннеры.
import { useCallback, useEffect, useRef, useState } from 'react';

import ConfirmDeleteModal from './components/ConfirmDeleteModal';
import CreateProjectForm from './components/CreateProjectForm';
import EmptyState from './components/EmptyState';
import PreviewModal from './components/PreviewModal';
import ProjectCard from './components/ProjectCard';
import RenameDialog from './components/RenameDialog';
import { ru, t } from './i18n/ru';
import {
  ApiRequestError,
  createProject,
  deleteProject,
  getPreviews,
  importZip,
  listProjects,
  renameProject,
  type PreviewEntry,
  type ProjectMeta,
} from './lib/api';
import { previewUrl } from './lib/format';

/** ТЗ 02 §5: лимит загрузки 10 МБ — клиентская проверка ДО отправки. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** ТЗ 03 §4: автоскрытие баннера ошибки действия через 10 с. */
const ACTION_BANNER_TTL_MS = 10_000;

interface ActionBanner {
  kind: 'error' | 'info';
  text: string;
  /** Показывать кнопку [Обновить] (проект пропал со стороны, 404/5xx). */
  refresh?: boolean;
}

type ModalState =
  | { type: 'none' }
  | { type: 'rename'; project: ProjectMeta }
  | { type: 'delete'; project: ProjectMeta }
  | { type: 'preview'; project: ProjectMeta; entry: PreviewEntry };

export default function App(): JSX.Element {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null); // null — ещё не загружено
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<ActionBanner | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [previews, setPreviews] = useState<Record<string, PreviewEntry[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // --- Загрузка списка (ТЗ 03 §4) ------------------------------------------
  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      setProjects(await listProjects());
    } catch (e) {
      setProjects([]);
      setLoadError(e instanceof ApiRequestError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Ленивая подгрузка превью для карточек, у которых previewsCount > 0 (ТЗ 03 §3).
  // Ключ — slug (замечание 2: display-name не обязателен уникальным).
  useEffect(() => {
    if (!projects) return;
    for (const p of projects) {
      if (p.previewsCount > 0 && !(p.slug in previews)) {
        getPreviews(p.slug)
          .then((list) => setPreviews((m) => ({ ...m, [p.slug]: list })))
          .catch(() => undefined); // превью не критичны: без миниатюр карточка валидна
      }
    }
  }, [projects, previews]);

  // Автоскрытие баннера действия (ТЗ 03 §4).
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), ACTION_BANNER_TTL_MS);
    return () => window.clearTimeout(id);
  }, [banner]);

  // --- Ошибки действий → баннер (ТЗ 03 §4) ----------------------------------
  const actionError = useCallback((e: unknown): void => {
    const isApi = e instanceof ApiRequestError;
    setBanner({
      kind: 'error',
      text: isApi ? e.message : String(e),
      refresh: isApi && (e.status === 404 || e.status >= 500),
    });
  }, []);

  // --- Действия (ТЗ 03 §2) ---------------------------------------------------
  const handleCreate = async (name: string): Promise<void> => {
    await createProject(name); // ApiRequestError → inline в форме
    setShowCreate(false);
    await load();
  };

  const handleRename = async (project: ProjectMeta, newName: string): Promise<void> => {
    try {
      await renameProject(project.slug, newName); // замечание 2: меняется только display-name
      setModal({ type: 'none' });
      await load();
    } catch (e) {
      actionError(e); // ТЗ 03 §2: 409/404 — баннер с текстом API, модалка остаётся
    }
  };

  const handleDelete = async (project: ProjectMeta): Promise<void> => {
    setDeleteBusy(true);
    try {
      await deleteProject(project.slug); // 204
      setModal({ type: 'none' });
      await load();
    } catch (e) {
      actionError(e);
      if (e instanceof ApiRequestError && e.status === 404) setModal({ type: 'none' });
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleImportFile = async (file: File | null): Promise<void> => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setBanner({ kind: 'error', text: ru.tooLarge }); // тот же текст, что у API 413
      return;
    }
    setImporting(true);
    try {
      const out = await importZip(file);
      setBanner({
        kind: 'info',
        text: t(ru.importSuccess, { name: out.project.name, n: out.imported.length, m: out.skipped.length }),
      });
      await load();
    } catch (e) {
      actionError(e); // напр. 400 BAD_ZIP — красный баннер с текстом API
    } finally {
      setImporting(false);
    }
  };

  // --- Рендер ----------------------------------------------------------------
  return (
    <div className="app">
      <header className="app-header">
        <h1>{ru.appTitle}</h1>
        <div className="header-actions">
          <button type="button" onClick={() => setShowCreate((v) => !v)} disabled={importing}>
            {ru.actions.create}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? ru.actions.importing : ru.actions.import}
          </button>
        </div>
      </header>

      {showCreate && (
        <div className="create-row">
          <CreateProjectForm onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
        </div>
      )}

      {/* Скрытый input импорта: имя проекта выводит сервер (ТЗ 03 §2) */}
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        aria-label="Импорт архива проекта (.zip)"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = ''; // повторный выбор того же файла тоже срабатывает
          void handleImportFile(f);
        }}
      />

      {loadError && (
        <div className="banner error" role="alert">
          <span>{t(ru.error.loadProjects, { detail: loadError })}</span>
          <button type="button" onClick={() => void load()}>
            {ru.error.retry}
          </button>
        </div>
      )}

      {banner && (
        <div className={`banner ${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
          <span>{banner.text}</span>
          {banner.refresh && (
            <button
              type="button"
              onClick={() => {
                setBanner(null);
                void load();
              }}
            >
              {ru.error.refresh}
            </button>
          )}
        </div>
      )}

      <main className="content">
        {!projects ? (
          <p className="muted">{ru.loading}</p>
        ) : projects.length === 0 && !loadError ? (
          <EmptyState onCreate={() => setShowCreate(true)} onImport={() => fileRef.current?.click()} />
        ) : (
          <div className="cards">
            {projects.map((p) => (
              <ProjectCard
                key={p.slug}
                project={p}
                previews={previews[p.slug]}
                onRename={() => setModal({ type: 'rename', project: p })}
                onDelete={() => setModal({ type: 'delete', project: p })}
                onPreview={(entry) => setModal({ type: 'preview', project: p, entry })}
              />
            ))}
          </div>
        )}
      </main>

      {modal.type === 'rename' && (
        <RenameDialog
          initialName={modal.project.name}
          onSave={(newName) => handleRename(modal.project, newName)}
          onClose={() => setModal({ type: 'none' })}
        />
      )}
      {modal.type === 'delete' && (
        <ConfirmDeleteModal
          name={modal.project.name}
          busy={deleteBusy}
          onConfirm={() => handleDelete(modal.project)}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}
      {modal.type === 'preview' && (
        <PreviewModal
          url={previewUrl(modal.project.slug, modal.entry.name)}
          name={modal.entry.name}
          mtimeIso={modal.entry.mtimeIso}
          onClose={() => setModal({ type: 'none' })}
        />
      )}
    </div>
  );
}
