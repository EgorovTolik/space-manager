// Карточка проекта (ТЗ 03 §1/§2): метрики, действия, ссылки на editor/viewer3d,
// лента превью (≤8 + «+N»). Для corrupted-проектов всё неактивно кроме удаления.
// Замечание 2: заголовок — человекочитаемое имя (project.name), все URL/ссылки
// используют стабильный project.slug.
import { ru, t } from '../i18n/ru';
import type { PreviewEntry, ProjectMeta } from '../lib/api';
import { editorPath, formatDate, formatSize, previewUrl, viewerPath } from '../lib/format';

/** ТЗ 03 §3: лимит миниатюр на карточке. */
export const PREVIEW_STRIP_LIMIT = 8;

interface ProjectCardProps {
  project: ProjectMeta;
  /** Список превью (по убыванию имени, новые первыми); undefined — ещё не загружен. */
  previews?: PreviewEntry[];
  onRename: () => void;
  onDelete: () => void;
  onPreview: (entry: PreviewEntry) => void;
}

export default function ProjectCard({ project, previews, onRename, onDelete, onPreview }: ProjectCardProps): JSX.Element {
  const corrupted = Boolean(project.corrupted);
  const shown = previews ? previews.slice(0, PREVIEW_STRIP_LIMIT) : [];
  const hiddenCount = previews ? Math.max(0, previews.length - PREVIEW_STRIP_LIMIT) : 0;

  return (
    <article className={`card${corrupted ? ' corrupted' : ''}`}>
      <h3>
        {project.name}
        {corrupted && <span className="badge-warn">{ru.card.corrupted}</span>}
      </h3>
      <p className="muted">{t(ru.card.changed, { date: formatDate(project.updatedAt) })}</p>
      <p className="muted">
        {t(ru.card.metrics, {
          files: project.filesCount,
          results: project.resultsCount,
          size: formatSize(project.sizeBytes),
        })}
      </p>

      <div className="card-actions">
        {/* Замечание 3: обе иконки — один класс .icon-btn с фиксированными размерами. */}
        <button
          type="button"
          className="icon-btn"
          aria-label={t(ru.card.renameAria, { name: project.name })}
          title={ru.rename.title}
          disabled={corrupted}
          onClick={onRename}
        >
          ✎
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t(ru.card.deleteAria, { name: project.name })}
          title={ru.confirmDelete.title}
          onClick={onDelete}
        >
          🗑
        </button>
      </div>

      <div className="card-nav">
        {corrupted ? (
          <>
            <span className="btn-ghost">{ru.card.editor}</span>
            <span className="btn-ghost">{ru.card.viewer}</span>
            <span className="btn-ghost">{ru.card.archive}</span>
          </>
        ) : (
          <>
            <a className="btn-link" href={editorPath(project.slug)}>
              {ru.card.editor}
            </a>
            <a className="btn-link" href={viewerPath(project.slug, project.latestResult)}>
              {ru.card.viewer}
            </a>
            <a className="btn-link" href={`/api/projects/${encodeURIComponent(project.slug)}/archive`}>
              {ru.card.archive}
            </a>
          </>
        )}
      </div>

      {shown.length > 0 && (
        <div className="preview-block">
          <span className="muted">{ru.card.previews}:</span>
          <div className="preview-strip">
            {shown.map((e) => (
              <img
                key={e.name}
                src={previewUrl(project.slug, e.name)}
                alt={e.name}
                title={e.name}
                loading="lazy" // ТЗ 03 §3: ленивая подгрузка
                onClick={() => onPreview(e)}
              />
            ))}
            {hiddenCount > 0 && <span className="muted preview-more">+{hiddenCount}</span>}
          </div>
        </div>
      )}
    </article>
  );
}
