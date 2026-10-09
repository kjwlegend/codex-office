#!/bin/zsh
cd "${0:A:h}"
export PYTHONDONTWRITEBYTECODE=1
python3 codex_usage.py serve --days 30 --open "$@"
