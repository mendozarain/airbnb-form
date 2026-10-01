import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as amplify from "aws-cdk-lib/aws-amplify";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

const TIME_ZONE = "Asia/Manila";
const APP_DB_USER = "cozy_app";
const ADMIN_DB_USER = "postgres";

export class CozyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // The Aurora express-configuration cluster is created once by infra/scripts/create-database.sh (CloudFormation
    // cannot create it yet); its coordinates are passed in as context.
    const dbHost = this.requiredContext("dbHost");
    const dbClusterResourceId = this.requiredContext("dbClusterResourceId");
    const dbName = this.node.tryGetContext("dbName") ?? "postgres";
    const appOrigin: string | undefined = this.node.tryGetContext("appOrigin");
    const alertEmail: string | undefined = this.node.tryGetContext("alertEmail");

    // ---------------------------------------------------------------------------------------------- storage
    const bucket = new s3.Bucket(this, "Uploads", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          // Browsers PUT guest IDs straight to S3 with a short-lived signed URL.
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: appOrigin ? [appOrigin] : ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000
        }
      ],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
        // Backstop only: the cleanup job deletes IDs after 31 days.
        { prefix: "ids/", expiration: cdk.Duration.days(60) },
        { prefix: "admin-edits/", expiration: cdk.Duration.days(60) }
      ]
    });

    // ---------------------------------------------------------------------------------------------- secrets
    // Holds every app setting (API keys, Hostex token, public URLs). Values other than the generated auth secret
    // are loaded with infra/scripts/push-secrets.sh so they never pass through chat or source control.
    const appSecret = new secretsmanager.Secret(this, "AppSecret", {
      description: "Cozy D-714 application configuration (JSON)",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: "BETTER_AUTH_SECRET",
        passwordLength: 48,
        excludePunctuation: true
      }
    });

    // ---------------------------------------------------------------------------------------------- queues
    const alarmTopic = new sns.Topic(this, "Alarms");
    if (alertEmail) alarmTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));

    const jobsDlq = new sqs.Queue(this, "JobsDlq", {
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true
    });
    const jobsQueue = new sqs.Queue(this, "JobsQueue", {
      visibilityTimeout: cdk.Duration.minutes(30),
      deadLetterQueue: { queue: jobsDlq, maxReceiveCount: 3 },
      enforceSSL: true
    });
    const browserDlq = new sqs.Queue(this, "BrowserDlq", {
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true
    });
    const browserQueue = new sqs.Queue(this, "BrowserQueue", {
      visibilityTimeout: cdk.Duration.minutes(60),
      deadLetterQueue: { queue: browserDlq, maxReceiveCount: 3 },
      enforceSSL: true
    });

    // EventBridge Scheduler assumes this role to deliver one-time retry wake-ups to the queues.
    const wakeRole = new iam.Role(this, "WakeScheduleRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": this.account } }
      })
    });
    jobsQueue.grantSendMessages(wakeRole);
    browserQueue.grantSendMessages(wakeRole);

    // ---------------------------------------------------------------------------------------------- compute
    const image = new ecrAssets.DockerImageAsset(this, "BackendImage", {
      directory: path.join(__dirname, "..", ".."),
      file: "backend/Dockerfile",
      platform: ecrAssets.Platform.LINUX_ARM64,
      exclude: ["infra/cdk.out", "infra/node_modules"]
    });
    const code = (handler: string) =>
      lambda.DockerImageCode.fromEcr(image.repository, { tagOrDigest: image.imageTag, cmd: [handler] });

    const commonEnv: Record<string, string> = {
      NODE_ENV: "production",
      APP_SECRET_ARN: appSecret.secretArn,
      S3_BUCKET: bucket.bucketName,
      S3_REGION: this.region,
      DB_IAM_AUTH: "true",
      DB_HOST: dbHost,
      DB_NAME: dbName,
      DB_USER: APP_DB_USER,
      DB_POOL_MAX: "3",
      JOBS_QUEUE_URL: jobsQueue.queueUrl,
      JOBS_QUEUE_ARN: jobsQueue.queueArn,
      BROWSER_QUEUE_URL: browserQueue.queueUrl,
      BROWSER_QUEUE_ARN: browserQueue.queueArn,
      SCHEDULER_ROLE_ARN: wakeRole.roleArn,
      HOSTEX_TIMEZONE: TIME_ZONE
    };

    const makeFunction = (
      name: string,
      props: { handler: string; memorySize: number; timeout: cdk.Duration; ephemeralMb?: number; env?: Record<string, string> }
    ) =>
      new lambda.DockerImageFunction(this, name, {
        code: code(props.handler),
        architecture: lambda.Architecture.ARM_64,
        memorySize: props.memorySize,
        timeout: props.timeout,
        ephemeralStorageSize: props.ephemeralMb ? cdk.Size.mebibytes(props.ephemeralMb) : undefined,
        environment: { ...commonEnv, ...props.env },
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY
        })
      });

    const api = makeFunction("Api", {
      handler: "backend/dist/lambda.handler",
      memorySize: 1536,
      timeout: cdk.Duration.seconds(29)
    });
    const worker = makeFunction("Worker", {
      handler: "backend/dist/worker.handler",
      memorySize: 1536,
      timeout: cdk.Duration.minutes(5)
    });
    // Runs the Google Form automation: headless Chromium needs memory and /tmp.
    const browserWorker = makeFunction("BrowserWorker", {
      handler: "backend/dist/worker.handler",
      memorySize: 3008,
      timeout: cdk.Duration.minutes(15),
      ephemeralMb: 2048
    });
    const migrate = makeFunction("Migrate", {
      handler: "backend/dist/migrate.handler",
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      env: { DB_ADMIN_USER: ADMIN_DB_USER }
    });

    const runtimeFunctions = [api, worker, browserWorker];
    for (const fn of [...runtimeFunctions, migrate]) appSecret.grantRead(fn);
    for (const fn of runtimeFunctions) {
      bucket.grantReadWrite(fn);
      jobsQueue.grantSendMessages(fn);
      browserQueue.grantSendMessages(fn);
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["rds-db:connect"],
          resources: [this.dbUserArn(dbClusterResourceId, APP_DB_USER)]
        })
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["scheduler:CreateSchedule"],
          resources: [`arn:${this.partition}:scheduler:${this.region}:${this.account}:schedule/default/wake-*`]
        })
      );
      wakeRole.grantPassRole(fn.grantPrincipal);
    }
    migrate.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["rds-db:connect"],
        resources: [this.dbUserArn(dbClusterResourceId, ADMIN_DB_USER)]
      })
    );

    // One job at a time reads from each queue's batch; two browser runs may overlap at most.
    worker.addEventSource(
      new SqsEventSource(jobsQueue, { batchSize: 1, maxConcurrency: 5, reportBatchItemFailures: true })
    );
    browserWorker.addEventSource(
      new SqsEventSource(browserQueue, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true })
    );

    // ---------------------------------------------------------------------------------------------- API
    const accessLogs = new logs.LogGroup(this, "ApiAccessLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    const httpApi = new apigwv2.CfnApi(this, "HttpApi", {
      name: "cozy-d714-api",
      protocolType: "HTTP"
    });
    const integration = new apigwv2.CfnIntegration(this, "ApiIntegration", {
      apiId: httpApi.ref,
      integrationType: "AWS_PROXY",
      integrationUri: api.functionArn,
      payloadFormatVersion: "2.0",
      timeoutInMillis: 30000
    });
    new apigwv2.CfnRoute(this, "ApiRoute", {
      apiId: httpApi.ref,
      routeKey: "$default",
      target: `integrations/${integration.ref}`
    });
    new apigwv2.CfnStage(this, "ApiStage", {
      apiId: httpApi.ref,
      stageName: "$default",
      autoDeploy: true,
      defaultRouteSettings: { throttlingRateLimit: 50, throttlingBurstLimit: 100 },
      accessLogSettings: {
        destinationArn: accessLogs.logGroupArn,
        format: JSON.stringify({
          requestId: "$context.requestId",
          ip: "$context.identity.sourceIp",
          requestTime: "$context.requestTime",
          method: "$context.httpMethod",
          path: "$context.path",
          status: "$context.status",
          responseLength: "$context.responseLength",
          integrationError: "$context.integrationErrorMessage"
        })
      }
    });
    api.addPermission("ApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: `arn:${this.partition}:execute-api:${this.region}:${this.account}:${httpApi.ref}/*/*`
    });
    const apiUrl = `https://${httpApi.ref}.execute-api.${this.region}.amazonaws.com`;

    // ---------------------------------------------------------------------------------------------- frontend
    // Static hosting only; "/api/*" is proxied to the API so the browser sees one origin and Better Auth cookies
    // stay first-party. Deployed by infra/scripts/deploy-frontend.sh (no Git provider connection needed).
    const amplifyApp = new amplify.CfnApp(this, "Frontend", {
      name: "cozy-d714",
      platform: "WEB",
      customRules: [
        { source: "/api/<*>", target: `${apiUrl}/api/<*>`, status: "200" },
        {
          source: "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
          target: "/index.html",
          status: "200"
        }
      ],
      customHeaders: [
        "customHeaders:",
        "  - pattern: '**'",
        "    headers:",
        "      - key: Strict-Transport-Security",
        "        value: max-age=31536000; includeSubDomains",
        "      - key: X-Content-Type-Options",
        "        value: nosniff",
        "      - key: X-Frame-Options",
        "        value: DENY",
        "      - key: Referrer-Policy",
        "        value: strict-origin-when-cross-origin"
      ].join("\n")
    });
    const branch = new amplify.CfnBranch(this, "FrontendMain", {
      appId: amplifyApp.attrAppId,
      branchName: "main",
      stage: "PRODUCTION",
      enableAutoBuild: false
    });

    // ---------------------------------------------------------------------------------------------- schedules
    // Webhooks and the job queues do the real-time work; these cover time-based work and act as a safety net for
    // a missed webhook. Keeping them few lets the database stay paused between them.
    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": this.account } }
      })
    });
    worker.grantInvoke(schedulerRole);

    const schedules: Array<{ id: string; job: string; cron: string; description: string }> = [
      {
        id: "HostexReconcile",
        job: "hostex.reconcile",
        cron: "cron(0 7,12,20 * * ? *)",
        description: "07:00 sends invites that just became due; 12:00 and 20:00 recover any missed webhook"
      },
      { id: "CalendarDaily", job: "calendar.dailySync", cron: "cron(0 3 * * ? *)", description: "Refresh 90 days of Hostex calendar" },
      { id: "PricingAutomatic", job: "pricing.automatic", cron: "cron(0 8 * * ? *)", description: "Daily automatic pricing" },
      { id: "Cleanup", job: "automation.cleanup", cron: "cron(17 2 * * ? *)", description: "Delete expired ID files and screenshots" }
    ];
    for (const item of schedules) {
      new scheduler.CfnSchedule(this, item.id, {
        description: item.description,
        scheduleExpression: item.cron,
        scheduleExpressionTimezone: TIME_ZONE,
        flexibleTimeWindow: { mode: "OFF" },
        target: {
          arn: worker.functionArn,
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({ job: item.job }),
          retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 3600 }
        }
      });
    }

    // ---------------------------------------------------------------------------------------------- alarms
    const notify = new cwActions.SnsAction(alarmTopic);
    for (const [name, dlq] of [
      ["JobsDlqNotEmpty", jobsDlq],
      ["BrowserDlqNotEmpty", browserDlq]
    ] as const) {
      new cloudwatch.Alarm(this, name, {
        metric: dlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: "A background job failed three times and was parked in the dead-letter queue"
      }).addAlarmAction(notify);
    }
    for (const [name, fn] of [
      ["Api", api],
      ["Worker", worker],
      ["BrowserWorker", browserWorker]
    ] as const) {
      new cloudwatch.Alarm(this, `${name}Errors`, {
        metric: fn.metricErrors({ period: cdk.Duration.minutes(15) }),
        threshold: 3,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${name} Lambda errors`
      }).addAlarmAction(notify);
      new cloudwatch.Alarm(this, `${name}Throttles`, {
        metric: fn.metricThrottles({ period: cdk.Duration.minutes(15) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${name} Lambda throttled`
      }).addAlarmAction(notify);
    }

    // ---------------------------------------------------------------------------------------------- outputs
    new cdk.CfnOutput(this, "AppUrl", { value: `https://${branch.branchName}.${amplifyApp.attrDefaultDomain}` });
    new cdk.CfnOutput(this, "AmplifyAppId", { value: amplifyApp.attrAppId });
    new cdk.CfnOutput(this, "ApiUrl", { value: apiUrl });
    new cdk.CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new cdk.CfnOutput(this, "SecretArn", { value: appSecret.secretArn });
    new cdk.CfnOutput(this, "MigrateFunction", { value: migrate.functionName });
    new cdk.CfnOutput(this, "ApiFunction", { value: api.functionName });
    new cdk.CfnOutput(this, "WorkerFunction", { value: worker.functionName });
    new cdk.CfnOutput(this, "BrowserWorkerFunction", { value: browserWorker.functionName });
    new cdk.CfnOutput(this, "AlarmTopicArn", { value: alarmTopic.topicArn });
  }

  private dbUserArn(clusterResourceId: string, user: string) {
    return `arn:${this.partition}:rds-db:${this.region}:${this.account}:dbuser:${clusterResourceId}/${user}`;
  }

  private requiredContext(key: string): string {
    const value = this.node.tryGetContext(key);
    if (typeof value !== "string" || !value) {
      throw new Error(`Missing CDK context "${key}". Run infra/scripts/create-database.sh, then pass it with -c ${key}=...`);
    }
    return value;
  }
}
