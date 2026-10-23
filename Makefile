.PHONY: install test lint format demo serve serve-live

install:            ## install the package with dev tools
	pip install -e ".[dev]"

test:               ## run the test suite
	pytest

lint:               ## lint and check formatting
	ruff check .
	ruff format --check .

format:
	ruff format .
	ruff check --fix .

demo:               ## replay the Alpina scenario in the terminal, then tamper with it
	python -m countersign.demo --tamper

serve:              ## console at http://localhost:8000, seeded just before the blind pass
	COUNTERSIGN_SEED=M3-sealed uvicorn countersign.api.app:create_app --factory --reload

serve-live:         ## console with an empty, persistent ledger
	COUNTERSIGN_DB=countersign.db uvicorn countersign.api.app:create_app --factory
