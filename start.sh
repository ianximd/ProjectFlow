#!/bin/bash
# start.sh - Script to start the ProjectFlow environment

echo "🚀 Starting ProjectFlow infrastructure (SQL Server, Redis, MinIO)..."
docker compose up -d

echo "⏳ Waiting a few seconds for services to initialize..."
sleep 3

echo "💻 Starting development servers (Frontend & API)..."
echo "Press Ctrl+C to stop the servers when you're done."
npm run dev
