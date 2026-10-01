#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CozyStack } from "../lib/cozy-stack";

const app = new cdk.App();

// The project's AWS account and Region. Fixed so a stray default profile can never deploy this somewhere else.
const account = app.node.tryGetContext("account") ?? "460047018105";
const region = app.node.tryGetContext("region") ?? "ap-southeast-2";

new CozyStack(app, "CozyD714", {
  env: { account, region },
  description: "Cozy Davao D-714: Amplify frontend, Lambda API and workers, Aurora Serverless, S3, EventBridge Scheduler"
});
