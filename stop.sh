#!/bin/bash
# stop.sh - Script to stop the ProjectFlow environment

echo "🛑 Stopping and removing ProjectFlow infrastructure..."
docker compose down

echo "✅ ProjectFlow environment has been shut down."
