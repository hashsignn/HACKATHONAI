"""Append-only, hash-chained event store (SQLite).

Guarantees, in order of strength:

1. **Append-only at the database level.** ``UPDATE`` and ``DELETE`` on ``events`` are
   rejected by triggers, so application code cannot rewrite history by accident.
2. **Tamper-evident.** Each event stores the hash of the previous event in the same
   engagement; ``verify`` recomputes the chain, so an edit made by bypassing the
   triggers (e.g. editing the file directly) is detected and located.
3. **Optimistic concurrency.** Writers state the length of the history they decided
   on; a concurrent write makes the ``(engagement_id, n)`` constraint fail and the
   command is retried by the caller instead of silently interleaving.

The sealed vault holds content committed to but not yet revealed (the AI's list in a
blind pass, the identity of planted controls). It is not part of the public record;
what the record holds is the *commitment*, and the reveal event lets anyone check it.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from ..domain.errors import ConcurrencyError, NotFound
from ..domain.events import DomainEvent, parse_event
from .crypto import canonical_json, sha256_hex

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id TEXT    NOT NULL,
    n             INTEGER NOT NULL,
    type          TEXT    NOT NULL,
    actor         TEXT    NOT NULL,
    occurred_at   TEXT    NOT NULL,
    payload       TEXT    NOT NULL,
    prev_hash     TEXT    NOT NULL,
    hash          TEXT    NOT NULL UNIQUE,
    UNIQUE (engagement_id, n)
);
CREATE INDEX IF NOT EXISTS events_by_engagement ON events (engagement_id, n);

CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TABLE IF NOT EXISTS vault (
    engagement_id TEXT NOT NULL,
    key           TEXT NOT NULL,
    content       TEXT NOT NULL,
    salt          TEXT NOT NULL,
    PRIMARY KEY (engagement_id, key)
);
"""


def genesis_hash(engagement_id: str) -> str:
    return sha256_hex(f"genesis:{engagement_id}".encode())


def _event_hash(
    engagement_id: str,
    n: int,
    type_: str,
    actor: str,
    occurred_at: str,
    payload: dict[str, Any],
    prev_hash: str,
) -> str:
    material = {
        "engagement_id": engagement_id,
        "n": n,
        "type": type_,
        "actor": actor,
        "occurred_at": occurred_at,
        "payload": payload,
        "prev_hash": prev_hash,
    }
    return sha256_hex(canonical_json(material))


@dataclass(frozen=True)
class StoredEvent:
    seq: int
    engagement_id: str
    n: int
    type: str
    actor: str
    occurred_at: str
    payload: dict[str, Any]
    prev_hash: str
    hash: str

    @property
    def event(self) -> DomainEvent:
        return parse_event(self.payload)

    @property
    def timestamp(self) -> datetime:
        return datetime.fromisoformat(self.occurred_at)


@dataclass(frozen=True)
class ChainVerification:
    ok: bool
    length: int
    head_hash: str
    first_bad_n: int | None = None
    reason: str | None = None


def utc_now() -> datetime:
    return datetime.now(UTC)


class EventStore:
    def __init__(self, path: str = ":memory:", clock: Callable[[], datetime] = utc_now) -> None:
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        if path != ":memory:":
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)
        self._lock = threading.RLock()
        self._clock = clock

    # ------------------------------------------------------------------ writes
    def append(
        self,
        engagement_id: str,
        actor: str,
        events: Sequence[BaseModel],
        expected_n: int,
    ) -> list[StoredEvent]:
        """Append ``events`` atomically, provided the history still has ``expected_n`` events."""
        stored: list[StoredEvent] = []
        with self._lock:
            cur = self._conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                row = cur.execute(
                    "SELECT n, hash FROM events WHERE engagement_id = ? ORDER BY n DESC LIMIT 1",
                    (engagement_id,),
                ).fetchone()
                current_n = row["n"] if row else 0
                prev_hash = row["hash"] if row else genesis_hash(engagement_id)
                if current_n != expected_n:
                    raise ConcurrencyError(
                        f"engagement {engagement_id} changed (expected {expected_n} events, "
                        f"found {current_n}); reload and retry"
                    )
                for i, ev in enumerate(events, start=1):
                    n = current_n + i
                    payload = ev.model_dump(mode="json")
                    occurred_at = self._clock().isoformat()
                    h = _event_hash(
                        engagement_id, n, payload["type"], actor, occurred_at, payload, prev_hash
                    )
                    cur.execute(
                        "INSERT INTO events (engagement_id, n, type, actor, occurred_at, payload, prev_hash, hash)"
                        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            engagement_id,
                            n,
                            payload["type"],
                            actor,
                            occurred_at,
                            canonical_json(payload).decode(),
                            prev_hash,
                            h,
                        ),
                    )
                    stored.append(
                        StoredEvent(
                            cur.lastrowid,
                            engagement_id,
                            n,
                            payload["type"],
                            actor,
                            occurred_at,
                            payload,
                            prev_hash,
                            h,
                        )
                    )
                    prev_hash = h
                cur.execute("COMMIT")
            except sqlite3.IntegrityError as exc:
                cur.execute("ROLLBACK")
                raise ConcurrencyError(str(exc)) from exc
            except Exception:
                cur.execute("ROLLBACK")
                raise
        return stored

    def vault_put(self, engagement_id: str, key: str, content: Any, salt: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO vault (engagement_id, key, content, salt) VALUES (?, ?, ?, ?)",
                (engagement_id, key, canonical_json(content).decode(), salt),
            )

    # ------------------------------------------------------------------- reads
    def load(self, engagement_id: str) -> list[StoredEvent]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM events WHERE engagement_id = ? ORDER BY n", (engagement_id,)
            ).fetchall()
        if not rows:
            raise NotFound(f"no engagement {engagement_id!r}")
        return [self._row(r) for r in rows]

    def exists(self, engagement_id: str) -> bool:
        with self._lock:
            return (
                self._conn.execute(
                    "SELECT 1 FROM events WHERE engagement_id = ? LIMIT 1", (engagement_id,)
                ).fetchone()
                is not None
            )

    def engagement_ids(self) -> list[str]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT engagement_id, MIN(seq) AS first FROM events GROUP BY engagement_id ORDER BY first"
            ).fetchall()
        return [r["engagement_id"] for r in rows]

    def vault_get(self, engagement_id: str, key: str) -> tuple[Any, str]:
        with self._lock:
            row = self._conn.execute(
                "SELECT content, salt FROM vault WHERE engagement_id = ? AND key = ?",
                (engagement_id, key),
            ).fetchone()
        if row is None:
            raise NotFound(f"nothing sealed under {key!r}")
        return json.loads(row["content"]), row["salt"]

    def verify(self, engagement_id: str) -> ChainVerification:
        events = self.load(engagement_id)
        prev = genesis_hash(engagement_id)
        for e in events:
            if e.prev_hash != prev:
                return ChainVerification(
                    False, len(events), events[-1].hash, e.n, "broken link to previous event"
                )
            expected = _event_hash(
                e.engagement_id, e.n, e.type, e.actor, e.occurred_at, e.payload, e.prev_hash
            )
            if expected != e.hash:
                return ChainVerification(
                    False, len(events), events[-1].hash, e.n, "event content was altered"
                )
            prev = e.hash
        return ChainVerification(True, len(events), prev)

    # ----------------------------------------------------------------- helpers
    @staticmethod
    def _row(r: sqlite3.Row) -> StoredEvent:
        return StoredEvent(
            seq=r["seq"],
            engagement_id=r["engagement_id"],
            n=r["n"],
            type=r["type"],
            actor=r["actor"],
            occurred_at=r["occurred_at"],
            payload=json.loads(r["payload"]),
            prev_hash=r["prev_hash"],
            hash=r["hash"],
        )

    def _raw_execute_for_tests(self, sql: str, params: Iterable[Any] = ()) -> None:
        """Escape hatch used only by tamper-detection tests."""
        with self._lock:
            self._conn.execute(sql, tuple(params))
