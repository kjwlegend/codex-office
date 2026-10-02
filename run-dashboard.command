#!/bin/zsh
set -e
TOOL_DIR="${0:A:h}"
cd "$TOOL_DIR"
python3 codex_usage.py dashboard --days 30 --open
