"use client";
import { useId, useOptimistic, useRef, useState, useTransition } from "react";
import { changeRole, removeFromPeople } from "@/app/settings/people-actions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_NAMES, ROLES, type Role } from "@/lib/access";
import { actionErrorMessage } from "@/lib/action-error";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import type { PeopleResult, PersonListing } from "@/lib/people";
import { relativeTime } from "@/lib/relative-time";

const FIXED_ROLE = { install: "Admin (set at install)", group: "Admin (from SSO group)" } as const;

const STACKED_CELL = "max-md:block max-md:p-0";

/** The role `person` shows as text, or null when the signed-in Admin may change it. */
function fixedRole(person: PersonListing, currentUserId: string): string | null {
  if (person.userId === currentUserId) return ROLE_NAMES[person.role];
  if (person.roleSource !== "people") return FIXED_ROLE[person.roleSource];
  return null;
}

/**
 * Everyone who can sign in, with a role picker on each row the signed-in Admin may change and Remove on each row they
 * may remove. Below `md` each person is a stacked block instead of a table row.
 */
export function PeopleTable({ people, currentUserId }: { people: PersonListing[]; currentUserId: string }) {
  const [pending, startTransition] = useTransition();
  const [shown, showRole] = useOptimistic(people, (rows, change: { userId: string; role: Role }) =>
    rows.map((row) => (row.userId === change.userId ? { ...row, role: change.role } : row)));
  const [error, setError] = useState<string | null>(null);

  const report = (result: PeopleResult) => {
    if (!result.ok) setError(actionErrorMessage(result.error, "change roles", "Couldn't change the role. Try again."));
  };

  const pickRole = (userId: string, role: Role) => {
    setError(null);
    startTransition(async () => {
      showRole({ userId, role });
      report(await changeRole(userId, role));
    });
  };

  const remove = (userId: string) => {
    setError(null);
    startTransition(async () => {
      report(await removeFromPeople(userId));
    });
  };

  return (
    <div className="space-y-2">
      <div className="panel overflow-hidden">
        <Table className="max-md:block">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Last signed in</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:block">
            {shown.map((person) => {
              const fixed = fixedRole(person, currentUserId);
              const removable = person.userId !== currentUserId && person.roleSource !== "install";
              return (
                <TableRow
                  key={person.userId}
                  className="max-md:grid max-md:grid-cols-[1fr_auto] max-md:items-center max-md:gap-x-3 max-md:gap-y-1 max-md:px-3 max-md:py-3"
                >
                  <TableCell className={`${STACKED_CELL} max-md:col-span-2 whitespace-normal font-medium max-md:empty:hidden`}>
                    {person.name}
                  </TableCell>
                  <TableCell className={`${STACKED_CELL} max-md:col-span-2 whitespace-normal wrap-anywhere text-muted-foreground`}>
                    {person.email}
                  </TableCell>
                  <TableCell className={`${STACKED_CELL} max-md:col-span-2 text-muted-foreground max-md:text-xs`}>
                    <span className="md:hidden">Last signed in </span>
                    {person.lastSignedInAt ? (
                      <span title={formatAbsoluteUtc(person.lastSignedInAt)}>{relativeTime(person.lastSignedInAt)}</span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className={`${STACKED_CELL} max-md:pt-1`}>
                    {fixed ?? (
                      <select
                        aria-label={`Role for ${person.email}`}
                        value={person.role}
                        disabled={pending}
                        onChange={(e) => pickRole(person.userId, e.target.value as Role)}
                        className="h-7 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>{ROLE_NAMES[role]}</option>
                        ))}
                      </select>
                    )}
                  </TableCell>
                  <TableCell className={`${STACKED_CELL} max-md:pt-1 whitespace-normal max-md:empty:hidden`}>
                    {removable ? (
                      <RemoveButton email={person.email} pending={pending} onRemove={() => remove(person.userId)} />
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function RemoveButton({ email, pending, onRemove }: { email: string; pending: boolean; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const promptId = useId();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {confirming ? <span id={promptId} className="text-right text-[0.8rem] wrap-anywhere">{`Remove ${email}?`}</span> : null}
      <div className="flex items-center gap-2">
        <Button
          ref={removeRef}
          variant={confirming ? "destructive" : "ghost"}
          size="sm"
          disabled={pending}
          aria-describedby={confirming ? promptId : undefined}
          onClick={confirming ? onRemove : () => setConfirming(true)}
          className={confirming ? undefined : "text-muted-foreground hover:text-destructive"}
        >
          Remove
        </Button>
        {confirming ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setConfirming(false);
              removeRef.current?.focus();
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
