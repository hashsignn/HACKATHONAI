"""The decision record: append-only, tamper-evident, safe under concurrent writers."""

from __future__ import annotations

import itertools
import sqlite3

import pytest

from countersign.domain.errors import ConcurrencyError
from countersign.ledger.store import genesis_hash
from countersign.scenario import ENGAGEMENT_ID


def test_chain_starts_at_genesis_and_verifies(container, run_until):
    run_until("M2")
    events = container.store.load(ENGAGEMENT_ID)
    assert events[0].prev_hash == genesis_hash(ENGAGEMENT_ID)
    assert all(b.prev_hash == a.hash for a, b in itertools.pairwise(events))
    result = container.store.verify(ENGAGEMENT_ID)
    assert result.ok and result.length == len(events) and result.head_hash == events[-1].hash


@pytest.mark.parametrize("sql", ["UPDATE events SET actor = 'mallory'", "DELETE FROM events"])
def test_database_refuses_to_rewrite_history(container, run_until, sql):
    run_until("opened")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        container.store._raw_execute_for_tests(sql)


def test_tampering_that_bypasses_the_triggers_is_detected_and_located(container, run_until):
    run_until("M2")
    store = container.store
    store._raw_execute_for_tests("DROP TRIGGER events_no_update")
    # Quietly turn the warranty rejection into an approval.
    store._raw_execute_for_tests(
        'UPDATE events SET payload = replace(payload, \'"action":"reject"\', \'"action":"approve"\') '
        "WHERE engagement_id = ? AND type = 'item_decided' AND payload LIKE '%\"action\":\"reject\"%'",
        (ENGAGEMENT_ID,),
    )
    tampered = next(
        e
        for e in store.load(ENGAGEMENT_ID)
        if e.type == "item_decided" and e.payload["milestone"] == "M2"
    )
    result = store.verify(ENGAGEMENT_ID)
    assert not result.ok
    assert result.first_bad_n == tampered.n
    assert result.reason == "event content was altered"


def test_stale_writer_is_rejected(container, svc, run_until):
    state = run_until("opened")
    from countersign.domain.events import EngagementStopped

    with pytest.raises(ConcurrencyError):
        container.store.append(
            ENGAGEMENT_ID, "marco.rossi", [EngagementStopped(reason="x")], expected_n=state.n - 1
        )


def test_same_inputs_give_the_same_record(contract):
    from countersign.scenario import run_alpina
    from tests.conftest import make_container

    heads = []
    for _ in range(2):
        c, clock = make_container()
        run_alpina(c.service, contract, tick=clock.advance)
        heads.append(c.store.verify(ENGAGEMENT_ID).head_hash)
    assert heads[0] == heads[1]
