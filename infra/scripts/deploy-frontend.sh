#!/usr/bin/env bash
# Builds the frontend and publishes it to Amplify Hosting (manual deployment, no Git provider needed).
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name CozyD714 \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
APP_ID="$(output AmplifyAppId)"

cd "$ROOT"
npm run build --workspace shared
npm run build --workspace frontend
ZIP="$(mktemp -d)/frontend.zip"
(cd frontend/dist && zip -qr "$ZIP" .)

read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --region "$REGION" --app-id "$APP_ID" --branch-name main \
  --query '[jobId, zipUploadUrl]' --output text)
curl -fsS -T "$ZIP" "$UPLOAD_URL" >/dev/null
aws amplify start-deployment --region "$REGION" --app-id "$APP_ID" --branch-name main --job-id "$JOB_ID" >/dev/null

echo "Deploying (job $JOB_ID)…"
for _ in $(seq 1 60); do
  STATUS="$(aws amplify get-job --region "$REGION" --app-id "$APP_ID" --branch-name main --job-id "$JOB_ID" \
    --query 'job.summary.status' --output text)"
  [[ "$STATUS" == "SUCCEED" ]] && { echo "Live at $(output AppUrl)"; exit 0; }
  [[ "$STATUS" == "FAILED" || "$STATUS" == "CANCELLED" ]] && { echo "Deployment $STATUS" >&2; exit 1; }
  sleep 5
done
echo "Timed out waiting for the deployment" >&2
exit 1
