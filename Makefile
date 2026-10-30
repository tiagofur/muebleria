.PHONY: help preflight factory-test handoff review-bundle labels

help: ## Show Software Factory commands
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

preflight: ## Read-only factory preflight (C1); never authorizes a write
	python3 scripts/factory_preflight.py

factory-test: ## Run factory guardrail tests (C3 structural)
	python3 -m unittest discover -s scripts -p test_factory_efficiency.py -v
	python3 -m unittest discover -s scripts -p test_factory_workflow_contract.py -v
	python3 -m unittest discover -s scripts -p test_factory_handoff.py -v
	python3 -m unittest discover -s scripts -p test_check_pr_metadata.py -v
	python3 -m unittest discover -s scripts -p test_factory_review_bundle.py -v

handoff: ## Advisory exact-PR evidence handoff (C4); requires --pr --issue --head --base
	python3 scripts/factory_handoff.py --pr $${PR:?set PR} --issue $${ISSUE:?set ISSUE} --head $${HEAD:?set HEAD} --base $${BASE:?set BASE}

review-bundle: ## Deterministic clean-context review bundle; BASE_REF/HEAD_REF/ISSUE env
	python3 scripts/factory_review_bundle.py --base $${BASE_REF:-origin/main} --head $${HEAD_REF:-HEAD} --issue $${ISSUE:?set ISSUE}

labels: ## Idempotently create the missing factory labels via gh CLI
	./scripts/setup-labels.sh
