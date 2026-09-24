/**
 * Shared helpers for database tests.
 * Each test file runs inside one transaction that is rolled back at the end,
 * so tests leave no data behind. Each scenario runs inside a savepoint.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect } from "vitest";

export const DATABASE_URL = process.env.DATABASE_URL;

export type TestUser = { id: string; email: string };

export class DbHarness {
  readonly db: Client;

  constructor() {
    this.db = new Client({ connectionString: DATABASE_URL });
  }

  async start(): Promise<void> {
    await this.db.connect();
    await this.db.query("begin");
  }

  async stop(): Promise<void> {
    await this.db.query("rollback");
    await this.db.end();
  }

  query(sql: string, params: unknown[] = []) {
    return this.db.query(sql, params);
  }

  /** Creates an auth user as sign-up would. The trigger creates the profile. */
  async createUser(meta: Record<string, unknown> = {}): Promise<TestUser> {
    const user = { id: randomUUID(), email: `test-${randomUUID()}@example.test` };
    await this.db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      user.id,
      user.email,
      JSON.stringify(meta),
    ]);
    return user;
  }

  /** Sets a role directly, as the make-admin script does with the service key. */
  async setRoleAsServer(userId: string, role: "buyer" | "vendor" | "admin"): Promise<void> {
    await this.asServer();
    await this.db.query("update public.profiles set role = $2 where id = $1", [userId, role]);
  }

  async actAs(user: TestUser | "anon"): Promise<void> {
    if (user === "anon") {
      await this.db.query("set local role anon");
      await this.db.query("select set_config('request.jwt.claims', '', true)");
      return;
    }
    await this.db.query("set local role authenticated");
    await this.db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user.id, role: "authenticated" }),
    ]);
  }

  /** Server-side session (service role or database owner): bypasses RLS. */
  async asServer(): Promise<void> {
    await this.db.query("reset role");
    await this.db.query("select set_config('request.jwt.claims', '', true)");
  }

  /** Runs fn in a savepoint and always rolls it back. */
  async scenario(fn: () => Promise<void>): Promise<void> {
    await this.db.query("savepoint scenario");
    try {
      await fn();
    } finally {
      await this.db.query("rollback to savepoint scenario");
    }
  }

  /** Expects the statement to fail with a message matching pattern. */
  async expectError(sql: string, params: unknown[], pattern: RegExp): Promise<void> {
    await this.db.query("savepoint expect_error");
    let message = "";
    try {
      await this.db.query(sql, params);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      await this.db.query("rollback to savepoint expect_error");
    }
    expect(message, `expected failure for: ${sql}`).toMatch(pattern);
  }
}

export const RLS_DENIED = /row-level security/;
export const PERMISSION_DENIED = /permission denied/;
