#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Forge が生成する run.sh か、直接起動
if [ -f "run.sh" ]; then
    bash run.sh
else
    java -Xmx4G -Xms2G \
        -jar forge-1.20.1-47.1.3.jar \
        nogui
fi
