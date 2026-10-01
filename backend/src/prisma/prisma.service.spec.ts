import { databasePoolConfig } from "./prisma.service.js";

describe("databasePoolConfig", () => {
  it("uses DATABASE_URL by default", () => {
    expect(databasePoolConfig({ DATABASE_URL: "postgresql://u:p@localhost/db" })).toEqual({
      connectionString: "postgresql://u:p@localhost/db"
    });
  });

  it("uses a small TLS pool with an IAM token password for Aurora", async () => {
    const config = databasePoolConfig({
      DB_IAM_AUTH: "true",
      DB_HOST: "cluster.example.rds.amazonaws.com",
      DB_USER: "cozy_app",
      S3_REGION: "ap-southeast-2",
      AWS_ACCESS_KEY_ID: "AKIATEST",
      AWS_SECRET_ACCESS_KEY: "secret"
    });
    expect(config).toMatchObject({
      host: "cluster.example.rds.amazonaws.com",
      port: 5432,
      user: "cozy_app",
      database: "postgres",
      ssl: { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 10_000
    });
    expect(typeof config.password).toBe("function");
    const token = await (config.password as () => Promise<string>)();
    expect(token).toContain("cluster.example.rds.amazonaws.com:5432");
    expect(token).toContain("DBUser=cozy_app");
  });

  it("requires the host and user in IAM mode", () => {
    expect(() => databasePoolConfig({ DB_IAM_AUTH: "true", DB_USER: "cozy_app" })).toThrow("DB_HOST is required");
  });
});
