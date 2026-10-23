"""A clock that can be pinned and advanced (for reproducible demos and tests) and then
released to real time."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta


class Clock:
    def __init__(self, start: datetime | None = None) -> None:
        self._pinned = start

    def __call__(self) -> datetime:
        return self._pinned if self._pinned is not None else datetime.now(UTC)

    @property
    def pinned(self) -> bool:
        return self._pinned is not None

    def advance(self, seconds: float) -> None:
        if self._pinned is not None:
            self._pinned += timedelta(seconds=seconds)

    def release(self) -> None:
        """Switch to real time. Only safe if the pinned time is not in the future."""
        if self._pinned is not None and self._pinned > datetime.now(UTC):
            raise ValueError("pinned clock is ahead of real time; releasing would go backwards")
        self._pinned = None
