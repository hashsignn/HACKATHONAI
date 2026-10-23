"""Who can act. In production this is the firm's identity provider (SSO + RBAC);
here it is a small TOML directory of fictional people."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

from .errors import Forbidden
from .models import Role


@dataclass(frozen=True)
class User:
    id: str
    name: str
    role: Role


class Directory:
    def __init__(self, users: dict[str, User]) -> None:
        self._users = users

    @classmethod
    def from_toml(cls, path: Path) -> Directory:
        raw = tomllib.loads(Path(path).read_text())
        return cls({uid: User(uid, u["name"], Role(u["role"])) for uid, u in raw["users"].items()})

    def get(self, user_id: str | None) -> User:
        if not user_id or user_id not in self._users:
            raise Forbidden(f"unknown user {user_id!r}")
        return self._users[user_id]

    def all(self) -> list[User]:
        return list(self._users.values())
