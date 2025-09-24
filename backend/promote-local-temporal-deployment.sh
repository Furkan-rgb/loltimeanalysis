#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
# The names of the worker deployments you want to promote.
DEPLOYMENTS=(
  "internal-processor"
  "match-history-processor"
)
# The name of the docker compose service running the temporal admin tools.
ADMIN_TOOLS_SERVICE="temporal-admin-tools"


# --- Script Logic ---
# Check if a Build ID was provided as an argument.
if [ -z "$1" ]; then
  echo "🚫 Error: No Build ID provided."
  echo "   Usage: ./promote-local-deployment.sh <build-id>"
  echo "   Example: ./promote-local-deployment.sh local-dev"
  exit 1
fi

BUILD_ID=$1

echo "▶️  Starting promotion for Build ID: '$BUILD_ID'..."
echo ""

# Loop through each deployment and promote the specified build ID.
for deployment in "${DEPLOYMENTS[@]}"; do
  echo "--> Promoting '$deployment' to Build ID '$BUILD_ID'..."
  docker compose exec -T "$ADMIN_TOOLS_SERVICE" temporal worker deployment set-current-version \
    --deployment-name "$deployment" \
    --build-id "$BUILD_ID"
  echo "    Done."
  echo ""
done

echo "✅ All deployments successfully promoted to Build ID: '$BUILD_ID'!"
