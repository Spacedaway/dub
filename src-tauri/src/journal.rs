use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

use crate::contracts::{
    BatchKind, BatchStatus, JournalEntry, PlanStep, RenameFailure, SkipReason, StepRole,
    UndoAvailability,
};
use crate::platform;

#[derive(Debug, Clone)]
pub struct JournalPath(pub PathBuf);

impl JournalPath {
    pub fn open(&self) -> rusqlite::Result<Connection> {
        let connection = Connection::open(&self.0)?;
        // Every pragma here except journal_mode applies to this connection only.
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA fullfsync = ON;
             PRAGMA checkpoint_fullfsync = ON;
             PRAGMA foreign_keys = ON;",
        )?;
        migrate(&connection)?;
        Ok(connection)
    }
}

const MIGRATIONS: [&str; 3] = [
    r#"
    CREATE TABLE batches (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('rename', 'undo')),
        undoes_batch_id TEXT REFERENCES batches (id),
        status TEXT NOT NULL CHECK (status IN
            ('running', 'completed', 'stopped', 'interrupted', 'undone', 'partiallyUndone')),
        created_at INTEGER NOT NULL,
        finished_at INTEGER,
        platform TEXT NOT NULL,
        app_version TEXT NOT NULL
    );
    CREATE TABLE steps (
        batch_id TEXT NOT NULL REFERENCES batches (id),
        position INTEGER NOT NULL,
        row_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('direct', 'toTemporary', 'fromTemporary')),
        volume_id TEXT NOT NULL,
        from_path TEXT NOT NULL,
        to_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN
            ('planned', 'started', 'done', 'failed', 'undone', 'skipped')),
        size_after INTEGER,
        modified_after_ms INTEGER,
        detail TEXT,
        PRIMARY KEY (batch_id, position)
    );
"#,
    r#"
    ALTER TABLE batches ADD COLUMN plan_id TEXT;
    CREATE UNIQUE INDEX batches_plan_id ON batches (plan_id);
"#,
    r#"
    ALTER TABLE steps RENAME COLUMN size_after TO size;
    ALTER TABLE steps RENAME COLUMN modified_after_ms TO modified_ms;
    ALTER TABLE steps ADD COLUMN group_id TEXT;
    ALTER TABLE steps ADD COLUMN undoes_position INTEGER;
    CREATE TABLE batch_volumes (
        batch_id TEXT NOT NULL REFERENCES batches (id),
        volume_id TEXT NOT NULL,
        mount_point TEXT NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (batch_id, volume_id)
    );
"#,
];

fn migrate(connection: &Connection) -> rusqlite::Result<()> {
    let version: usize = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (index, migration) in MIGRATIONS.iter().enumerate().skip(version) {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(migration)?;
        transaction.pragma_update(None, "user_version", (index + 1) as i64)?;
        transaction.commit()?;
    }
    Ok(())
}

macro_rules! database_text {
    ($type:ty { $($variant:ident => $text:literal),+ $(,)? }) => {
        impl $type {
            pub fn as_text(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }

            pub fn from_text(text: &str) -> Option<Self> {
                match text { $($text => Some(Self::$variant),)+ _ => None }
            }
        }
    };
}

database_text!(BatchKind { Rename => "rename", Undo => "undo" });
database_text!(BatchStatus {
    Running => "running",
    Completed => "completed",
    Stopped => "stopped",
    Interrupted => "interrupted",
    Undone => "undone",
    PartiallyUndone => "partiallyUndone",
});
database_text!(StepRole { Direct => "direct", ToTemporary => "toTemporary", FromTemporary => "fromTemporary" });
database_text!(StepStatus {
    Planned => "planned",
    Started => "started",
    Done => "done",
    Failed => "failed",
    Undone => "undone",
    Skipped => "skipped",
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepStatus {
    Planned,
    Started,
    Done,
    Failed,
    Undone,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fingerprint {
    pub size: u64,
    pub modified_ms: i64,
}

impl Fingerprint {
    pub fn of(path: &Path) -> Option<Self> {
        let metadata = std::fs::symlink_metadata(path).ok()?;
        Some(Self {
            size: metadata.len(),
            modified_ms: metadata
                .modified()
                .ok()
                .map(milliseconds_since_epoch)
                .unwrap_or(0),
        })
    }
}

#[derive(Debug, Clone)]
pub struct JournalStep {
    pub position: u32,
    pub row_id: String,
    pub group_id: String,
    pub role: StepRole,
    pub volume_id: String,
    pub from: String,
    pub to: String,
}

impl From<&PlanStep> for JournalStep {
    fn from(step: &PlanStep) -> Self {
        Self {
            position: step.position,
            row_id: step.row_id.clone(),
            group_id: step.group_id.clone(),
            role: step.role,
            volume_id: step.volume_id.clone(),
            from: step.from.clone(),
            to: step.to.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RecordedStep {
    pub step: JournalStep,
    pub status: StepStatus,
    pub fingerprint: Option<Fingerprint>,
}

#[derive(Debug, Clone)]
pub struct BatchRecord {
    pub kind: BatchKind,
    pub status: BatchStatus,
}

pub enum StepOutcome<'a> {
    Done(Option<Fingerprint>),
    Skipped(SkipReason),
    Failed(&'a RenameFailure),
    RolledBack,
}

pub struct NewBatch<'a> {
    pub id: &'a str,
    pub kind: BatchKind,
    pub undoes_batch_id: Option<&'a str>,
    pub plan_id: Option<&'a str>,
}

pub fn plan_was_applied(connection: &Connection, plan_id: &str) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM batches WHERE plan_id = ?1)",
        params![plan_id],
        |row| row.get(0),
    )
}

pub fn begin_batch(
    connection: &mut Connection,
    batch: &NewBatch,
    steps: &[JournalStep],
) -> rusqlite::Result<()> {
    let batch_id = batch.id;
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO batches (id, kind, undoes_batch_id, plan_id, status, created_at, platform, app_version)
         VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6, ?7)",
        params![
            batch_id,
            batch.kind.as_text(),
            batch.undoes_batch_id,
            batch.plan_id,
            now_ms(),
            std::env::consts::OS,
            env!("CARGO_PKG_VERSION"),
        ],
    )?;
    {
        let mut insert = transaction.prepare(
            "INSERT INTO steps (batch_id, position, row_id, group_id, role, volume_id, from_path, to_path, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for step in steps {
            let status = if step.position == 1 {
                StepStatus::Started
            } else {
                StepStatus::Planned
            };
            insert.execute(params![
                batch_id,
                step.position,
                step.row_id,
                step.group_id,
                step.role.as_text(),
                step.volume_id,
                step.from,
                step.to,
                status.as_text(),
            ])?;
        }
    }
    transaction.commit()
}

pub fn record_step(
    connection: &mut Connection,
    batch_id: &str,
    position: u32,
    outcome: StepOutcome,
    next_position: Option<u32>,
) -> rusqlite::Result<()> {
    let transaction = connection.transaction()?;
    match outcome {
        StepOutcome::Done(fingerprint) => {
            set_step_done(&transaction, batch_id, position, fingerprint)?;
        }
        StepOutcome::Skipped(reason) => {
            transaction.execute(
                "UPDATE steps SET status = 'skipped', detail = ?3 WHERE batch_id = ?1 AND position = ?2",
                params![batch_id, position, serde_json::to_string(&reason).unwrap_or_default()],
            )?;
        }
        StepOutcome::Failed(failure) => {
            transaction.execute(
                "UPDATE steps SET status = 'failed', detail = ?3 WHERE batch_id = ?1 AND position = ?2",
                params![batch_id, position, serde_json::to_string(failure).unwrap_or_default()],
            )?;
        }
        StepOutcome::RolledBack => {
            transaction.execute(
                "UPDATE steps SET status = 'skipped', detail = '\"rolledBack\"' WHERE batch_id = ?1 AND position = ?2",
                params![batch_id, position],
            )?;
        }
    }
    if let Some(next_position) = next_position {
        set_step_status(&transaction, batch_id, next_position, StepStatus::Started)?;
    }
    transaction.commit()
}

pub fn set_step_status(
    connection: &Connection,
    batch_id: &str,
    position: u32,
    status: StepStatus,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE steps SET status = ?3 WHERE batch_id = ?1 AND position = ?2",
        params![batch_id, position, status.as_text()],
    )?;
    Ok(())
}

fn set_step_done(
    connection: &Connection,
    batch_id: &str,
    position: u32,
    fingerprint: Option<Fingerprint>,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE steps SET status = 'done', size = ?3, modified_ms = ?4
         WHERE batch_id = ?1 AND position = ?2",
        params![
            batch_id,
            position,
            fingerprint.map(|fingerprint| fingerprint.size as i64),
            fingerprint.map(|fingerprint| fingerprint.modified_ms),
        ],
    )?;
    Ok(())
}

pub fn finish_batch(
    connection: &Connection,
    batch_id: &str,
    status: BatchStatus,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE batches SET status = ?2, finished_at = ?3 WHERE id = ?1",
        params![batch_id, status.as_text(), now_ms()],
    )?;
    Ok(())
}

pub fn set_batch_status(
    connection: &Connection,
    batch_id: &str,
    status: BatchStatus,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE batches SET status = ?2 WHERE id = ?1",
        params![batch_id, status.as_text()],
    )?;
    Ok(())
}

pub fn load_batch(
    connection: &Connection,
    batch_id: &str,
) -> rusqlite::Result<Option<BatchRecord>> {
    connection
        .query_row(
            "SELECT kind, status FROM batches WHERE id = ?1",
            params![batch_id],
            |row| {
                let kind: String = row.get(0)?;
                let status: String = row.get(1)?;
                Ok((kind, status))
            },
        )
        .optional()?
        .map(|(kind, status)| {
            Ok(BatchRecord {
                kind: BatchKind::from_text(&kind).ok_or_else(|| invalid_text("kind", &kind))?,
                status: BatchStatus::from_text(&status)
                    .ok_or_else(|| invalid_text("status", &status))?,
            })
        })
        .transpose()
}

pub fn load_steps(connection: &Connection, batch_id: &str) -> rusqlite::Result<Vec<RecordedStep>> {
    let mut query = connection.prepare(
        "SELECT position, row_id, COALESCE(group_id, row_id), role, volume_id, from_path, to_path,
                status, size, modified_ms
         FROM steps WHERE batch_id = ?1 ORDER BY position",
    )?;
    let rows = query.query_map(params![batch_id], |row| {
        let role: String = row.get(3)?;
        let status: String = row.get(7)?;
        let size: Option<i64> = row.get(8)?;
        let modified_ms: Option<i64> = row.get(9)?;
        Ok(RecordedStep {
            step: JournalStep {
                position: row.get(0)?,
                row_id: row.get(1)?,
                group_id: row.get(2)?,
                role: StepRole::from_text(&role).ok_or_else(|| invalid_text("role", &role))?,
                volume_id: row.get(4)?,
                from: row.get(5)?,
                to: row.get(6)?,
            },
            status: StepStatus::from_text(&status)
                .ok_or_else(|| invalid_text("status", &status))?,
            fingerprint: size
                .zip(modified_ms)
                .map(|(size, modified_ms)| Fingerprint {
                    size: size as u64,
                    modified_ms,
                }),
        })
    })?;
    rows.collect()
}

pub fn history(connection: &Connection, limit: u32) -> rusqlite::Result<Vec<JournalEntry>> {
    let mut query = connection.prepare(
        "SELECT b.id, b.kind, b.created_at, b.status, b.undoes_batch_id,
                (SELECT COUNT(*) FROM steps s WHERE s.batch_id = b.id),
                (SELECT COUNT(*) FROM steps s WHERE s.batch_id = b.id AND s.status = 'done')
         FROM batches b ORDER BY b.created_at DESC, b.id DESC LIMIT ?1",
    )?;
    let rows = query.query_map(params![limit], |row| {
        let kind_text: String = row.get(1)?;
        let status_text: String = row.get(3)?;
        let kind =
            BatchKind::from_text(&kind_text).ok_or_else(|| invalid_text("kind", &kind_text))?;
        let status = BatchStatus::from_text(&status_text)
            .ok_or_else(|| invalid_text("status", &status_text))?;
        let done_steps: u32 = row.get(6)?;
        Ok(JournalEntry {
            batch_id: row.get(0)?,
            kind,
            created_at: row.get(2)?,
            status,
            total_steps: row.get(5)?,
            done_steps,
            undoes_batch_id: row.get(4)?,
            undo: undo_availability(kind, status, done_steps),
        })
    })?;
    rows.collect()
}

pub fn undo_availability(
    kind: BatchKind,
    status: BatchStatus,
    done_steps: u32,
) -> UndoAvailability {
    match (kind, status) {
        (BatchKind::Undo, _) => UndoAvailability::NotUndoable,
        (_, BatchStatus::Undone) => UndoAvailability::AlreadyUndone,
        (_, BatchStatus::Running) => UndoAvailability::NotUndoable,
        _ if done_steps == 0 => UndoAvailability::NotUndoable,
        _ => UndoAvailability::Available,
    }
}

pub fn recover(journal: &JournalPath) -> rusqlite::Result<()> {
    let mut connection = journal.open()?;
    let running: Vec<String> = connection
        .prepare("SELECT id FROM batches WHERE status = 'running'")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    for batch_id in running {
        reconcile_batch(&mut connection, &batch_id)?;
    }
    Ok(())
}

pub fn reconcile_batch(connection: &mut Connection, batch_id: &str) -> rusqlite::Result<()> {
    let transaction = connection.transaction()?;
    for recorded in load_steps(&transaction, batch_id)? {
        if recorded.status != StepStatus::Started {
            continue;
        }
        let position = recorded.step.position;
        let from = Path::new(&recorded.step.from);
        let to = Path::new(&recorded.step.to);
        match (platform::path_present(from), platform::path_present(to)) {
            (true, false) => {
                set_step_status(&transaction, batch_id, position, StepStatus::Planned)?
            }
            (false, true) => set_step_done(&transaction, batch_id, position, Fingerprint::of(to))?,
            (true, true) | (false, false) => {}
        }
    }
    finish_batch(&transaction, batch_id, BatchStatus::Interrupted)?;
    transaction.commit()
}

pub fn milliseconds_since_epoch(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn now_ms() -> i64 {
    milliseconds_since_epoch(SystemTime::now())
}

fn invalid_text(column: &str, text: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidColumnType(0, format!("{column} = {text}"), rusqlite::types::Type::Text)
}
