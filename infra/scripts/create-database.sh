#!/usr/bin/env bash
# Creates the Aurora PostgreSQL Serverless cluster (express configuration) once, then prints the CDK context
# values for it. CloudFormation cannot create express-configuration clusters yet, so this lives outside the stack.
#
# Scales to zero: minimum 0 ACU, pauses after 5 idle minutes. IAM authentication only (no password to store).
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
CLUSTER="${1:-cozy-d714}"

aws rds create-db-cluster \
  --region "$REGION" \
  --db-cluster-identifier "$CLUSTER" \
  --engine aurora-postgresql \
  --with-express-configuration >/dev/null

aws rds wait db-cluster-available --region "$REGION" --db-cluster-identifier "$CLUSTER"

aws rds modify-db-cluster \
  --region "$REGION" \
  --db-cluster-identifier "$CLUSTER" \
  --serverless-v2-scaling-configuration MinCapacity=0,MaxCapacity=2,SecondsUntilAutoPause=300 \
  --apply-immediately >/dev/null

aws rds describe-db-clusters --region "$REGION" --db-cluster-identifier "$CLUSTER" \
  --query 'DBClusters[0].{host:Endpoint,resourceId:DbClusterResourceId,scaling:ServerlessV2ScalingConfiguration}'

echo
echo "Deploy with:"
echo "  npm run deploy --workspace infra -- -c dbHost=<host> -c dbClusterResourceId=<resourceId>"
