import type { Metadata } from "next";
import { RoleToggle } from "@/components/admin/role-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_USER_PAGE_SIZE, listUsersWithRoles } from "@/lib/admin/queries";
import { APP_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin: users and roles" };

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const admin = await requireRole("admin", "/admin");
  const { q } = await searchParams;
  const search = typeof q === "string" ? q : "";
  const users = await listUsersWithRoles(search);

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Users and roles</h1>
        <p className="text-sm text-muted-foreground">
          Every new account is a buyer. Give the vendor or admin role here. Changes are logged.
        </p>
      </div>

      <form className="flex gap-2" role="search">
        <Input name="q" defaultValue={search} placeholder="Search by email or name" aria-label="Search users" />
        <Button type="submit" variant="outline">Search</Button>
      </form>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users found.</p>
      ) : (
        <ul className="grid gap-3">
          {users.map((user) => (
            <li key={user.id} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {user.fullName || "No name"}
                  {user.id === admin.id ? <span className="text-muted-foreground"> (you)</span> : null}
                </p>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {APP_ROLES.map((role) => {
                  const has = user.roles.includes(role);
                  return <RoleToggle key={`${role}-${has}`} userId={user.id} role={role} hasRole={has} />;
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      {users.length === ADMIN_USER_PAGE_SIZE ? (
        <p className="text-xs text-muted-foreground">
          Showing the newest {ADMIN_USER_PAGE_SIZE} matches. Search to narrow the list.
        </p>
      ) : null}
    </div>
  );
}
