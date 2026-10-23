"""Domain errors. The API layer maps each class to one HTTP status."""


class DomainError(Exception):
    """Base class for every rule violation the platform reports to a user."""


class NotFound(DomainError):
    """The engagement, milestone or item does not exist."""


class Forbidden(DomainError):
    """The actor's role may not perform this action."""


class Conflict(DomainError):
    """The action is not allowed in the current state (e.g. milestone already signed)."""


class SealedError(Conflict):
    """The AI list is sealed until the reviewer submits their own assessment."""


class ConcurrencyError(Conflict):
    """Another write landed first; reload and retry."""


class IntegrityError(DomainError):
    """The ledger or a sealed commitment failed verification."""
