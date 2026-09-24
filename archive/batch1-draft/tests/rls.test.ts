/**
 * Schema, trigger and Row Level Security tests.
 * Runs only when DATABASE_URL points at a database with migrations applied.
 * Use `npm run test:db` for a throwaway local Postgres.
 *
 * The whole suite runs inside one transaction that is rolled back at the end,
 * so it leaves no data behind. Each test runs inside its own savepoint.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;

type TestUser = { id: string; email: string };

describe.skipIf(!DATABASE_URL)("database: foundation schema and RLS", () => {
  const db = new Client({ connectionString: DATABASE_URL });

  let buyer: TestUser;
  let otherBuyer: TestUser;
  let admin: TestUser;

  async function createUser(meta: Record<string, unknown> = {}): Promise<TestUser> {
    const user = { id: randomUUID(), email: `test-${randomUUID()}@example.test` };
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
      [user.id, user.email, JSON.stringify(meta)],
    );
    return user;
  }

  async function actAs(user: TestUser | "anon"): Promise<void> {
    if (user === "anon") {
      await db.query("set local role anon");
      await db.query("select set_config('request.jwt.claims', '', true)");
      return;
    }
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user.id, role: "authenticated" }),
    ]);
  }

  async function actAsSuperuser(): Promise<void> {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claims', '', true)");
  }

  /** Runs fn in a savepoint and always rolls it back. */
  async function scenario(fn: () => Promise<void>): Promise<void> {
    await db.query("savepoint scenario");
    try {
      await fn();
    } finally {
      await db.query("rollback to savepoint scenario");
    }
  }

  /** Expects the statement to fail with a message matching pattern. */
  async function expectDbError(sql: string, params: unknown[], pattern: RegExp): Promise<void> {
    await db.query("savepoint expect_error");
    let message = "";
    try {
      await db.query(sql, params);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      await db.query("rollback to savepoint expect_error");
    }
    expect(message, `expected failure for: ${sql}`).toMatch(pattern);
  }

  beforeAll(async () => {
    await db.connect();
    await db.query("begin");
    buyer = await createUser({ full_name: "Ada Buyer", country_code: "gb" });
    otherBuyer = await createUser({ full_name: "Other Buyer" });
    admin = await createUser({ full_name: "Admin User" });
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin.id]);
  });

  afterAll(async () => {
    await db.query("rollback");
    await db.end();
  });

  describe("sign-up trigger", () => {
    it("creates a profile with cleaned metadata and the buyer role", async () => {
      const { rows } = await db.query(
        "select email, full_name, country_code, preferred_currency from public.profiles where id = $1",
        [buyer.id],
      );
      expect(rows[0]).toEqual({
        email: buyer.email,
        full_name: "Ada Buyer",
        country_code: "GB",
        preferred_currency: "GBP",
      });

      const roles = await db.query("select role from public.user_roles where user_id = $1", [buyer.id]);
      expect(roles.rows.map((r) => r.role)).toEqual(["buyer"]);
    });

    it("ignores unknown countries and trims long names", async () => {
      await scenario(async () => {
        const user = await createUser({ full_name: "x".repeat(500), country_code: "ZZ" });
        const { rows } = await db.query(
          "select full_name, country_code, preferred_currency from public.profiles where id = $1",
          [user.id],
        );
        expect(rows[0].full_name).toHaveLength(120);
        expect(rows[0].country_code).toBeNull();
        expect(rows[0].preferred_currency).toBe("NGN");
      });
    });

    it("falls back to NGN when the country's currency is not enabled", async () => {
      await scenario(async () => {
        const user = await createUser({ country_code: "AE" });
        const { rows } = await db.query(
          "select country_code, preferred_currency from public.profiles where id = $1",
          [user.id],
        );
        expect(rows[0]).toEqual({ country_code: "AE", preferred_currency: "NGN" });
      });
    });

    it("keeps profile email in sync with auth.users", async () => {
      await scenario(async () => {
        await db.query("update auth.users set email = 'new@example.test' where id = $1", [buyer.id]);
        const { rows } = await db.query("select email from public.profiles where id = $1", [buyer.id]);
        expect(rows[0].email).toBe("new@example.test");
      });
    });
  });

  describe("reference data", () => {
    it("lets anonymous visitors read active currencies only", async () => {
      await scenario(async () => {
        await actAs("anon");
        const { rows } = await db.query("select code from public.currencies order by code");
        expect(rows.map((r) => r.code)).toEqual(["CAD", "CNY", "EUR", "GBP", "NGN", "USD"]);
      });
    });

    it("has both launch corridors active", async () => {
      await scenario(async () => {
        await actAs("anon");
        const { rows } = await db.query(
          "select code, is_cross_border from public.corridors order by code",
        );
        expect(rows).toEqual([
          { code: "CN-NG", is_cross_border: true },
          { code: "NG-NG", is_cross_border: false },
        ]);
      });
    });

    it("blocks non-admins from changing reference data", async () => {
      await scenario(async () => {
        await actAs(buyer);
        await expectDbError(
          "insert into public.corridors (code, name, origin_country, destination_country) values ('GB-NG', 'UK to Nigeria', 'GB', 'NG')",
          [],
          /row-level security/,
        );
        const update = await db.query("update public.currencies set is_active = false where code = 'NGN'");
        expect(update.rowCount).toBe(0);
      });
    });

    it("lets admins add corridors and rejects codes that do not match the route", async () => {
      await scenario(async () => {
        await actAs(admin);
        const ok = await db.query(
          "insert into public.corridors (code, name, origin_country, destination_country) values ('GB-NG', 'UK to Nigeria', 'GB', 'NG')",
        );
        expect(ok.rowCount).toBe(1);
        await expectDbError(
          "insert into public.corridors (code, name, origin_country, destination_country) values ('US-GB', 'Wrong', 'US', 'NG')",
          [],
          /corridors_code_matches_route/,
        );
      });
    });
  });

  describe("profiles", () => {
    it("hides profiles from anonymous visitors", async () => {
      await scenario(async () => {
        await actAs("anon");
        await expectDbError("select * from public.profiles", [], /permission denied/);
      });
    });

    it("shows a user only their own profile", async () => {
      await scenario(async () => {
        await actAs(buyer);
        const { rows } = await db.query("select id from public.profiles");
        expect(rows.map((r) => r.id)).toEqual([buyer.id]);
      });
    });

    it("lets a user edit allowed fields on their own profile", async () => {
      await scenario(async () => {
        await actAs(buyer);
        const result = await db.query(
          "update public.profiles set full_name = 'Ada B', phone = '+447700900123' where id = $1",
          [buyer.id],
        );
        expect(result.rowCount).toBe(1);
      });
    });

    it("blocks edits to email and to other users' profiles", async () => {
      await scenario(async () => {
        await actAs(buyer);
        await expectDbError(
          "update public.profiles set email = 'x@example.test' where id = $1",
          [buyer.id],
          /permission denied/,
        );
        const other = await db.query("update public.profiles set full_name = 'Hacked' where id = $1", [
          otherBuyer.id,
        ]);
        expect(other.rowCount).toBe(0);
      });
    });

    it("rejects phone numbers that are not E.164", async () => {
      await scenario(async () => {
        await actAs(buyer);
        await expectDbError(
          "update public.profiles set phone = '08031234567' where id = $1",
          [buyer.id],
          /profiles_phone_check/,
        );
      });
    });

    it("lets admins read every profile", async () => {
      await scenario(async () => {
        await actAs(admin);
        const { rows } = await db.query("select id from public.profiles where id = any($1)", [
          [buyer.id, otherBuyer.id, admin.id],
        ]);
        expect(rows).toHaveLength(3);
      });
    });
  });

  describe("roles", () => {
    it("blocks users from granting themselves roles", async () => {
      await scenario(async () => {
        await actAs(buyer);
        await expectDbError(
          "insert into public.user_roles (user_id, role) values ($1, 'admin')",
          [buyer.id],
          /row-level security/,
        );
      });
    });

    it("shows users only their own roles", async () => {
      await scenario(async () => {
        await actAs(buyer);
        const { rows } = await db.query("select distinct user_id from public.user_roles");
        expect(rows.map((r) => r.user_id)).toEqual([buyer.id]);
      });
    });

    it("records who granted a role, ignoring any granted_by the client sends", async () => {
      await scenario(async () => {
        await actAs(admin);
        await db.query(
          "insert into public.user_roles (user_id, role, granted_by) values ($1, 'vendor', $1)",
          [buyer.id],
        );
        const role = await db.query(
          "select granted_by from public.user_roles where user_id = $1 and role = 'vendor'",
          [buyer.id],
        );
        expect(role.rows[0].granted_by).toBe(admin.id);

        const log = await db.query(
          "select action, actor_id from public.role_changes where user_id = $1 and role = 'vendor'",
          [buyer.id],
        );
        expect(log.rows).toEqual([{ action: "granted", actor_id: admin.id }]);
      });
    });

    it("hides the role audit log from non-admins", async () => {
      await scenario(async () => {
        await actAs(buyer);
        const { rows } = await db.query("select * from public.role_changes");
        expect(rows).toHaveLength(0);
      });
    });

    it("never removes the last admin", async () => {
      await scenario(async () => {
        await actAsSuperuser();
        // Remove any admins that already exist in this database, except ours.
        await db.query("alter table public.user_roles disable trigger user_roles_guard_last_admin");
        await db.query("delete from public.user_roles where role = 'admin' and user_id <> $1", [admin.id]);
        await db.query("alter table public.user_roles enable trigger user_roles_guard_last_admin");

        await actAs(admin);
        await expectDbError(
          "delete from public.user_roles where user_id = $1 and role = 'admin'",
          [admin.id],
          /last admin/,
        );

        await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [otherBuyer.id]);
        const removed = await db.query(
          "delete from public.user_roles where user_id = $1 and role = 'admin'",
          [otherBuyer.id],
        );
        expect(removed.rowCount).toBe(1);
      });
    });

    it("keeps the role audit log append-only, even for the database owner", async () => {
      await scenario(async () => {
        await actAsSuperuser();
        await expectDbError("update public.role_changes set action = 'revoked'", [], /append-only/);
        await expectDbError("delete from public.role_changes", [], /append-only/);
      });
    });
  });
});
