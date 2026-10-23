.PHONY: install test lint format docs demo serve serve-pricing serve-live

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

docs:               ## regenerate docs/departments.md from the catalogue and price list
	python -m countersign.catalogue_doc > docs/departments.md

demo:               ## replay the Alpina case in the terminal, then tamper with the record
	python -m countersign.demo --tamper

serve:              ## console at http://localhost:8000, Alpina seeded just before the blind pass
	COUNTERSIGN_SEED=M3-sealed uvicorn countersign.api.app:create_app --factory --reload

serve-pricing:      ## console seeded at intake, so the manager can confirm the pricing live
	COUNTERSIGN_SEED=opened uvicorn countersign.api.app:create_app --factory --reload

serve-live:         ## console with an empty, persistent ledger
	COUNTERSIGN_DB=countersign.db uvicorn countersign.api.app:create_app --factory
