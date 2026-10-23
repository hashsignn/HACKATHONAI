"""Replay the Alpina / SinoGear scenario in the terminal.

python -m countersign.demo                 # full run, prints trail, invoice and integrity
python -m countersign.demo --until M3      # stop after any stage
python -m countersign.demo --tamper        # then edit one past event and show detection
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime

from .bootstrap import Settings, build_container
from .clock import Clock
from .projections.audit import build_trail, render_markdown
from .projections.billing import build_invoice
from .projections.quality import reviewer_quality
from .scenario import ENGAGEMENT_ID, JUNIOR, STAGES, load_contract, run_alpina


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--until", choices=STAGES, default="released")
    parser.add_argument(
        "--tamper", action="store_true", help="alter one past decision and re-verify"
    )
    args = parser.parse_args(argv)

    clock = Clock(datetime(2026, 10, 21, 7, 0, tzinfo=UTC))
    c = build_container(Settings(db_path=":memory:", seed=None), clock=clock)
    state = run_alpina(
        c.service, load_contract(c.settings.fixture_dir), until=args.until, tick=clock.advance
    )

    print(
        render_markdown(build_trail(state, c.store.verify(ENGAGEMENT_ID), c.directory, c.keyring))
    )

    inv = build_invoice(state, c.rate_card, c.directory)
    print(f"## Invoice ({inv.status}, {inv.review_level} review x{inv.review_multiplier:g})\n")
    for line in inv.lines:
        print(
            f"  {line.milestone} {line.title:<34} {inv.currency} {line.amount:>8,.0f}   signed by {line.signed_by}"
        )
    print(f"  {'Total':<37} {inv.currency} {inv.total:>8,.0f}")
    if inv.not_billed:
        print(f"  Not billed (unsigned): {', '.join(inv.not_billed)}")
    if inv.saving_vs_hourly is not None:
        print(
            f"\n  Full review quoted at {inv.currency} {inv.quote_total:,.0f} vs "
            f"{inv.currency} {inv.quote_hourly_equivalent:,.0f} billed hourly before AI "
            f"({inv.saving_vs_hourly:.0%} less for the client)."
        )

    q = reviewer_quality(JUNIOR, [state])
    print("\n## Reviewer record: Lea Brunner\n")
    for k, v in q.as_dict().items():
        if k != "user_id":
            print(f"  {k:<24} {v if not isinstance(v, float) else f'{v:.0%}'}")

    if args.tamper:
        target = next(e for e in c.store.load(ENGAGEMENT_ID) if e.type == "item_decided")
        c.store._raw_execute_for_tests("DROP TRIGGER events_no_update")
        c.store._raw_execute_for_tests(
            "UPDATE events SET actor = 'someone.else' WHERE engagement_id = ? AND n = ?",
            (ENGAGEMENT_ID, target.n),
        )
        v = c.store.verify(ENGAGEMENT_ID)
        print(f"\n## Tamper test\n\n  Changed who decided event #{target.n}.")
        print(f"  Chain verifies: {v.ok}. First bad event: #{v.first_bad_n} ({v.reason}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
