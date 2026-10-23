"""Canonical hashing, commitments and signatures.

* Canonical JSON (sorted keys, no whitespace) so the same content always hashes the same.
* Commit-reveal: publish ``sha256(salt || content)`` now, reveal ``salt`` and ``content`` later.
* Ed25519 signatures over milestone digests.

Key management here is a DEVELOPMENT stand-in: keys are derived deterministically
from the user id so the demo is reproducible. In production each signer's key lives
in the firm's PKI / HSM (or a qualified e-signature service under Swiss ZertES), and
this module only ever sees the public half.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


def canonical_json(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def new_salt() -> str:
    return secrets.token_hex(16)


def commitment(content: Any, salt: str) -> str:
    return sha256_hex(salt.encode() + canonical_json(content))


@dataclass(frozen=True)
class SignatureResult:
    signature: str
    key_id: str


class DevKeyring:
    """Deterministic per-user Ed25519 keys. Development and demo use only."""

    def __init__(self, namespace: str = "countersign-dev") -> None:
        self._namespace = namespace
        self._cache: dict[str, Ed25519PrivateKey] = {}

    def _private(self, user_id: str) -> Ed25519PrivateKey:
        if user_id not in self._cache:
            seed = hashlib.sha256(f"{self._namespace}:{user_id}".encode()).digest()
            self._cache[user_id] = Ed25519PrivateKey.from_private_bytes(seed)
        return self._cache[user_id]

    def public_key(self, user_id: str) -> Ed25519PublicKey:
        return self._private(user_id).public_key()

    def key_id(self, user_id: str) -> str:
        raw = self.public_key(user_id).public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        return f"{user_id}:{sha256_hex(raw)[:16]}"

    def sign(self, user_id: str, digest: str) -> SignatureResult:
        sig = self._private(user_id).sign(digest.encode())
        return SignatureResult(signature=sig.hex(), key_id=self.key_id(user_id))

    def verify(self, user_id: str, digest: str, signature_hex: str) -> bool:
        try:
            self.public_key(user_id).verify(bytes.fromhex(signature_hex), digest.encode())
        except (InvalidSignature, ValueError):
            return False
        return True
