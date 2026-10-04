import { PeopleTable } from "@/components/settings/people-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can, ROLE_NAMES, type Role } from "@/lib/access";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { identify } from "@/lib/identity";
import { listPeople, listRoleChanges, type RoleChange } from "@/lib/people";
import { relativeTime } from "@/lib/relative-time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const ARTICLE: Record<Role, string> = { viewer: "a", editor: "an", admin: "an" };

function changeLine({ actorEmail, subjectEmail, toRole }: RoleChange): string {
  if (toRole === null) return `${actorEmail} removed ${subjectEmail}`;
  return `${actorEmail} made ${subjectEmail} ${ARTICLE[toRole]} ${ROLE_NAMES[toRole]}`;
}

export default async function SettingsPage() {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person" || !can(identity, "manage-people")) {
    return <EmptyState titleAs="h1" title="Only Admins can see settings." />;
  }
  const [people, changes] = await Promise.all([listPeople(), listRoleChanges(20)]);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>

      <section aria-labelledby="people-title" className="space-y-3">
        <h2 id="people-title" className="text-base font-medium">People</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Viewers can look around. Editors can also upload scans and change charts, governance and tags. Admins can also set roles.
        </p>
        <PeopleTable people={people} currentUserId={identity.userId} />
        <p className="max-w-prose text-sm text-muted-foreground">
          Removing someone signs them out everywhere. If your sign-in provider still lets them in, they come back as a Viewer.
        </p>
      </section>

      {changes.length > 0 ? (
        <section aria-labelledby="history-title" className="space-y-3">
          <h2 id="history-title" className="text-base font-medium">History</h2>
          <ul className="space-y-1 text-sm">
            {changes.map((change) => (
              <li key={change.id} className="wrap-anywhere">
                {changeLine(change)}
                <span className="text-muted-foreground">
                  {" · "}
                  <span title={formatAbsoluteUtc(change.changedAt)}>{relativeTime(change.changedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
