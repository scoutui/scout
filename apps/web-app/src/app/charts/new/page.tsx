import Link from "next/link";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import { chartBuilderOptions } from "@/lib/chart-builder-options";
import { ReadModelState } from "@/components/read-model-state";
import { DashboardBuilder } from "@/components/dashboards/dashboard-builder";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";

export const dynamic = "force-dynamic";
export const metadata = { title: "New chart" };

export default async function NewDashboardPage() {
  if (!can(await identify({ browser: true }), "edit")) {
    return <EmptyState titleAs="h1" title="Only Editors can change charts. Ask an Admin for access." />;
  }
  const page = await readModelPage(getStorage(), chartBuilderOptions);
  if (page.state !== "ready") return <ReadModelState {...page} />;
  const { libraryTags, repos, components, packages } = page.value;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/charts" className="transition-colors hover:text-foreground">
          Charts
        </Link>
        <span aria-hidden>/</span>
        <span>New chart</span>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New chart</h1>
      <DashboardBuilder libraryTags={libraryTags} repos={repos} components={components} packages={packages} />
    </div>
  );
}
