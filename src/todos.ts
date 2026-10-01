import type { Database } from 'bun:sqlite';
import { newId } from './ids';
import { nowIso } from './time';
import { ApiError } from './errors';

/** The session or API token that performed an action on a todo. */
export interface TodoVia {
  id: string;
  kind: 'session' | 'api_token';
  label: string | null;
}

export interface Todo {
  id: string;
  title: string;
  notes: string | null;
  done: boolean;
  doneAt: string | null;
  tags: string[];
  createdAt: string;
  createdVia: TodoVia | null;
  updatedAt: string;
  doneVia: TodoVia | null;
}

interface TodoRow {
  id: string;
  title: string;
  notes: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  created_via: string | null;
  created_via_kind: TodoVia['kind'] | null;
  created_via_label: string | null;
  done_via: string | null;
  done_via_kind: TodoVia['kind'] | null;
  done_via_label: string | null;
}

/** Todo columns plus the kind and label of the session/token in created_via and done_via. */
const SELECT_TODO = `
  SELECT t.*,
    CASE WHEN cs.id IS NOT NULL THEN 'session' WHEN ct.id IS NOT NULL THEN 'api_token' END
      AS created_via_kind,
    COALESCE(cs.label, ct.label) AS created_via_label,
    CASE WHEN ds.id IS NOT NULL THEN 'session' WHEN dt.id IS NOT NULL THEN 'api_token' END
      AS done_via_kind,
    COALESCE(ds.label, dt.label) AS done_via_label
  FROM todos t
  LEFT JOIN auth_sessions cs ON cs.id = t.created_via
  LEFT JOIN api_tokens ct ON ct.id = t.created_via
  LEFT JOIN auth_sessions ds ON ds.id = t.done_via
  LEFT JOIN api_tokens dt ON dt.id = t.done_via`;

export interface Tag {
  id: string;
  name: string;
  count: number;
}

function normaliseTag(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64);
}

export class TodoService {
  constructor(private readonly db: Database) {}

  list(
    ownerId: string,
    opts: { tag?: string; status?: 'open' | 'done' | 'all'; limit?: number } = {},
  ): Todo[] {
    const status = opts.status ?? 'open';
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const params: (string | number)[] = [];
    let sql = SELECT_TODO;
    if (opts.tag) {
      sql += ` JOIN todo_tags tt ON tt.todo_id = t.id
               JOIN tags g ON g.id = tt.tag_id AND g.owner_id = t.owner_id AND g.name = ?`;
      params.push(normaliseTag(opts.tag));
    }
    sql += ` WHERE t.owner_id = ?`;
    params.push(ownerId);
    if (status === 'open') sql += ` AND t.done_at IS NULL`;
    else if (status === 'done') sql += ` AND t.done_at IS NOT NULL`;
    sql += ` ORDER BY t.sort_key ASC, t.created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.query(sql).all(...params) as TodoRow[];

    return rows.map((r) => this.toTodo(r));
  }

  get(ownerId: string, id: string): Todo {
    const row = this.db
      .query(`${SELECT_TODO} WHERE t.id = ? AND t.owner_id = ?`)
      .get(id, ownerId) as TodoRow | undefined;
    if (!row) throw new ApiError('not_found', 'Todo not found.');
    return this.toTodo(row);
  }

  /** `via` is the id of the session or API token doing the action, if any. */
  create(
    ownerId: string,
    input: { title: string; notes?: string | null; tags?: string[] },
    via: string | null,
  ): Todo {
    const title = input.title?.trim();
    if (!title) throw new ApiError('validation_failed', 'title is required.');
    if (title.length > 500) throw new ApiError('validation_failed', 'title is too long.');

    const now = nowIso();
    const id = newId('tod');
    const maxSort = this.db
      .query('SELECT COALESCE(MAX(sort_key), 0) AS m FROM todos WHERE owner_id = ?')
      .get(ownerId) as { m: number };
    this.db
      .query(
        `INSERT INTO todos
         (id, owner_id, title, notes, done_at, sort_key, created_at, updated_at, created_via)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(id, ownerId, title, input.notes?.trim() || null, maxSort.m + 1, now, now, via);

    if (input.tags?.length) this.setTags(ownerId, id, input.tags);
    return this.get(ownerId, id);
  }

  update(
    ownerId: string,
    id: string,
    patch: { title?: string; notes?: string | null; tags?: string[]; done?: boolean },
    via: string | null,
  ): Todo {
    const existing = this.get(ownerId, id);
    const title =
      patch.title !== undefined ? patch.title.trim() : existing.title;
    if (!title) throw new ApiError('validation_failed', 'title is required.');
    const notes =
      patch.notes !== undefined ? (patch.notes?.trim() || null) : existing.notes;
    let doneAt = existing.doneAt;
    let doneVia = existing.doneVia?.id ?? null;
    // Checking an already-done todo keeps who checked it first.
    if (patch.done === true && doneAt === null) {
      doneAt = nowIso();
      doneVia = via;
    }
    if (patch.done === false) {
      doneAt = null;
      doneVia = null;
    }

    this.db
      .query(
        `UPDATE todos SET title = ?, notes = ?, done_at = ?, done_via = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?`,
      )
      .run(title, notes, doneAt, doneVia, nowIso(), id, ownerId);

    if (patch.tags !== undefined) this.setTags(ownerId, id, patch.tags);
    return this.get(ownerId, id);
  }

  check(ownerId: string, id: string, via: string | null): Todo {
    return this.update(ownerId, id, { done: true }, via);
  }

  uncheck(ownerId: string, id: string, via: string | null): Todo {
    return this.update(ownerId, id, { done: false }, via);
  }

  remove(ownerId: string, id: string): void {
    const result = this.db
      .query('DELETE FROM todos WHERE id = ? AND owner_id = ?')
      .run(id, ownerId);
    if (result.changes === 0) throw new ApiError('not_found', 'Todo not found.');
  }

  listTags(ownerId: string): Tag[] {
    return this.db
      .query(
        `SELECT g.id, g.name, COUNT(tt.todo_id) AS count
         FROM tags g
         LEFT JOIN todo_tags tt ON tt.tag_id = g.id
         WHERE g.owner_id = ?
         GROUP BY g.id
         ORDER BY g.name ASC`,
      )
      .all(ownerId) as Tag[];
  }

  deleteTag(ownerId: string, name: string): void {
    const tag = this.db
      .query('SELECT id FROM tags WHERE owner_id = ? AND name = ?')
      .get(ownerId, normaliseTag(name)) as { id: string } | undefined;
    if (!tag) throw new ApiError('not_found', 'Tag not found.');
    this.db.query('DELETE FROM todo_tags WHERE tag_id = ?').run(tag.id);
    this.db.query('DELETE FROM tags WHERE id = ?').run(tag.id);
  }

  private setTags(ownerId: string, todoId: string, tagNames: string[]): void {
    const normalised = [
      ...new Set(tagNames.map(normaliseTag).filter((n) => n.length > 0)),
    ];
    this.db.query('DELETE FROM todo_tags WHERE todo_id = ?').run(todoId);
    for (const name of normalised) {
      let tag = this.db
        .query('SELECT id FROM tags WHERE owner_id = ? AND name = ?')
        .get(ownerId, name) as { id: string } | undefined;
      if (!tag) {
        const id = newId('tag');
        this.db
          .query('INSERT INTO tags (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
          .run(id, ownerId, name, nowIso());
        tag = { id };
      }
      this.db
        .query('INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)')
        .run(todoId, tag.id);
    }
  }

  private toTodo(row: TodoRow): Todo {
    const tags = (
      this.db
        .query(
          `SELECT g.name FROM tags g
           JOIN todo_tags tt ON tt.tag_id = g.id
           WHERE tt.todo_id = ?
           ORDER BY g.name ASC`,
        )
        .all(row.id) as Array<{ name: string }>
    ).map((t) => t.name);

    return {
      id: row.id,
      title: row.title,
      notes: row.notes,
      done: row.done_at !== null,
      doneAt: row.done_at,
      tags,
      createdAt: row.created_at,
      createdVia: toVia(row.created_via, row.created_via_kind, row.created_via_label),
      updatedAt: row.updated_at,
      doneVia: toVia(row.done_via, row.done_via_kind, row.done_via_label),
    };
  }
}

function toVia(
  id: string | null,
  kind: TodoVia['kind'] | null,
  label: string | null,
): TodoVia | null {
  // Sessions and tokens are only deleted together with their user (and todos),
  // so an id with no matching row should not happen; report it as unknown.
  if (id === null || kind === null) return null;
  return { id, kind, label };
}
