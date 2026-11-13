import { Fragment } from "react";
import { redirect } from "next/navigation";
import { PeopleTable } from "@/components/settings/people-table";
import { EmptyState } from "@/components/ui/empty-state";
import { getPool } from "@/db/client";
import { can, ROLE_NAMES, type Role } from "@/lib/access";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { identify } from "@/lib/identity";
import { listPeople, listRoleChanges, type RoleChange } from "@/lib/people";
import { relativeTime } from "@/lib/relative-time";
import { listRemovals, type Removal } from "@/lib/scan-removal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const ARTICLE: Record<Role, string> = { viewer: "a", editor: "an", admin: "an" };

const HISTORY_LENGTH = 20;

const ROLE_SUMMARY: ReadonlyArray<readonly [Role, string]> = [
  ["viewer", "Repos, packages, governance and shared charts"],
  ["editor", "Also uploads scans, makes charts, edits governance and tags"],
  ["admin", "Also manages people, every chart, scans and repos"],
];

function changeLine({ actorEmail, subjectEmail, toRole }: RoleChange): string {
  if (toRole === null) return `${actorEmail} removed ${subjectEmail}`;
  return `${actorEmail} made ${subjectEmail} ${ARTICLE[toRole]} ${ROLE_NAMES[toRole]}`;
}

function removalLine({ actorEmail, repoId, commitSha }: Removal): string {
  if (commitSha === null) return `${actorEmail} deleted ${repoId}`;
  return `${actorEmail} removed a scan of ${repoId} (${commitSha.slice(0, 7)})`;
}

export default async function SettingsPage() {
  const identity = await identify({ browser: true });
  if (identity?.kind === "guest") redirect("/repos");
  if (identity?.kind !== "person" || !can(identity, "manage-people")) {
    return <EmptyState titleAs="h1" title="Only Admins can see settings. Ask an Admin for access." />;
  }
  const [people, changes, removals] = await Promise.all([
    listPeople(identity.userId), listRoleChanges(HISTORY_LENGTH), listRemovals(getPool(), HISTORY_LENGTH),
  ]);
  const history = [
    ...changes.map((change) => ({ id: change.id, at: change.changedAt, line: changeLine(change) })),
    ...removals.map((removal) => ({ id: removal.id, at: removal.removedAt, line: removalLine(removal) })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, HISTORY_LENGTH);

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-semibold tracking-display">Settings</h1>

      <section aria-labelledby="people-title" className="space-y-3">
        <h2 id="people-title" className="text-base font-medium">People</h2>
        <dl className="grid max-w-prose grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          {ROLE_SUMMARY.map(([role, summary]) => (
            <Fragment key={role}>
              <dt className="font-medium">{ROLE_NAMES[role]}</dt>
              <dd className="text-muted-foreground">{summary}</dd>
            </Fragment>
          ))}
        </dl>
        <PeopleTable people={people} />
        <p className="max-w-prose text-sm text-muted-foreground">
          Removing someone signs them out everywhere. If your sign-in provider still lets them in, they come back as a Viewer.
        </p>
      </section>

      {history.length > 0 ? (
        <section aria-labelledby="history-title" className="space-y-3">
          <h2 id="history-title" className="text-base font-medium">History</h2>
          <ul className="space-y-1 text-sm">
            {history.map((entry) => (
              <li key={entry.id} className="wrap-anywhere">
                {entry.line}
                <span className="text-muted-foreground">
                  {" · "}
                  <span title={formatAbsoluteUtc(entry.at)} className="whitespace-nowrap">{relativeTime(entry.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
