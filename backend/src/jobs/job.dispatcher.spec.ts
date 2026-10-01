import { jest } from "@jest/globals";
import { JobDispatcher } from "./job.dispatcher.js";

const ENV_KEYS = ["JOBS_QUEUE_URL", "BROWSER_QUEUE_URL", "JOBS_QUEUE_ARN", "BROWSER_QUEUE_ARN", "SCHEDULER_ROLE_ARN"];

describe("JobDispatcher", () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    jest.useRealTimers();
  });

  function withQueues() {
    process.env.JOBS_QUEUE_URL = "https://sqs/jobs";
    process.env.BROWSER_QUEUE_URL = "https://sqs/browser";
    process.env.JOBS_QUEUE_ARN = "arn:jobs";
    process.env.BROWSER_QUEUE_ARN = "arn:browser";
    const dispatcher = new JobDispatcher();
    const send = jest.fn<(command: unknown) => Promise<unknown>>().mockResolvedValue({});
    (dispatcher as unknown as { sqs: unknown }).sqs = { send };
    (dispatcher as unknown as { scheduler: unknown }).scheduler = { send };
    return { dispatcher, send };
  }

  it("runs the job in-process when no queue is configured", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    jest.useFakeTimers();
    const dispatcher = new JobDispatcher();
    const handler = jest.fn<(message: unknown) => Promise<void>>().mockResolvedValue();
    dispatcher.registerLocalHandler(handler);

    await dispatcher.enqueue("hostex.webhooks", { delaySeconds: 3 });
    expect(handler).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(3000);
    expect(handler).toHaveBeenCalledWith({ job: "hostex.webhooks" });
  });

  it("sends browser jobs to the browser queue and the rest to the jobs queue", async () => {
    const { dispatcher, send } = withQueues();
    await dispatcher.enqueue("automation.queue");
    await dispatcher.enqueue("aiReview.queue", { delaySeconds: 5 });

    const inputs = send.mock.calls.map(([command]) => (command as { input: Record<string, unknown> }).input);
    expect(inputs[0]).toMatchObject({ QueueUrl: "https://sqs/browser", MessageBody: '{"job":"automation.queue"}' });
    expect(inputs[1]).toMatchObject({ QueueUrl: "https://sqs/jobs", DelaySeconds: 5 });
  });

  it("never throws when the queue rejects, because a lost wake-up is recovered by reconcile", async () => {
    const { dispatcher, send } = withQueues();
    send.mockRejectedValue(new Error("throttled"));
    await expect(dispatcher.enqueue("chat.queue")).resolves.toBeUndefined();
  });

  it("uses an SQS delay for short retries and a one-time schedule for long ones", async () => {
    const { dispatcher, send } = withQueues();
    process.env.SCHEDULER_ROLE_ARN = "arn:role";

    await dispatcher.wakeAt("hostex.deliveries", new Date(Date.now() + 120_000));
    await dispatcher.wakeAt("hostex.deliveries", new Date(Date.now() + 3 * 3600_000));

    const [short, long] = send.mock.calls.map(([command]) => command as { input: Record<string, unknown> });
    expect(short.input).toMatchObject({ QueueUrl: "https://sqs/jobs" });
    expect(long.input).toMatchObject({
      ActionAfterCompletion: "DELETE",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: { Arn: "arn:jobs", RoleArn: "arn:role" }
    });
    expect(String(long.input.ScheduleExpression)).toMatch(/^at\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\)$/);
  });
});
