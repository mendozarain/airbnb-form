#!/usr/bin/env bash
# Merges KEY=VALUE lines from an env file into the app's Secrets Manager secret, keeping keys already there
# (such as the generated BETTER_AUTH_SECRET). Values are read from the file, never printed.
#
#   infra/scripts/push-secrets.sh path/to/app.env [secret-arn]
#
# Set BETTER_AUTH_URL, PUBLIC_APP_URL and TRUSTED_ORIGINS to the Amplify URL (the AppUrl stack output).
# Legacy Railway-only keys (DATABASE_URL, PORT, AWS_*) are skipped: AWS supplies those through IAM and CDK.
set -euo pipefail

ENV_FILE="${1:?usage: push-secrets.sh <env-file> [secret-arn]}"
REGION="${AWS_REGION:-ap-southeast-2}"
SECRET_ARN="${2:-$(aws cloudformation describe-stacks --region "$REGION" --stack-name CozyD714 \
  --query "Stacks[0].Outputs[?OutputKey=='SecretArn'].OutputValue" --output text)}"

CURRENT="$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ARN" --query SecretString --output text)"

MERGED="$(CURRENT="$CURRENT" python3 - "$ENV_FILE" <<'PY'
import json, os, sys

skip_exact = {"DATABASE_URL", "PORT", "NODE_ENV"}
skip_prefix = ("AWS_", "SOURCE_", "RAILWAY_")
secret = json.loads(os.environ["CURRENT"])
for raw in open(sys.argv[1], encoding="utf-8"):
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip().removeprefix("export ").strip()
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    if not value or key in skip_exact or key.startswith(skip_prefix):
        continue
    secret[key] = value
print(json.dumps(secret))
PY
)"

aws secretsmanager put-secret-value --region "$REGION" --secret-id "$SECRET_ARN" --secret-string "$MERGED" >/dev/null
echo "Updated $(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$MERGED") keys in $SECRET_ARN"
