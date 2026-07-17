#!/bin/bash

# Install act if not already installed
if ! command -v act &> /dev/null; then
    echo "Installing act..."
    brew install act
fi

# Check if KIMI_API_KEY is set
if [ -z "$KIMI_API_KEY" ]; then
    echo "Error: KIMI_API_KEY environment variable is not set"
    echo "Please export your API key: export KIMI_API_KEY='your-key-here'"
    exit 1
fi

# Run the MCP test workflow locally (requires E2E_ENABLED=true to actually run the jobs)
echo "Running MCP server test locally with act..."
act push --secret KIMI_API_KEY="$KIMI_API_KEY" --var E2E_ENABLED=true -W .github/workflows/test-mcp-servers.yml --container-architecture linux/amd64
