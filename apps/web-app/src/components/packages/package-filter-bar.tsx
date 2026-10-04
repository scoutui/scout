"use client";

import { DeprecatedFilterChip } from "@/components/deprecated-filter-chip";
import { FacetedFilterBar, tagFacet, tagPills, type Facet, type FilterPill } from "@/components/faceted-filter-bar";
import {
  emptyPackageFacets,
  isFilteringPackages,
  VERSIONS_LABEL,
  type PackageFacetOptions,
  type PackageFacetState,
  type VersionsValue,
} from "@/lib/package-facets";

export function PackageFilterBar({
  facets,
  onChange,
  options,
  resultCount,
  canEdit,
}: {
  facets: PackageFacetState;
  onChange: (next: PackageFacetState) => void;
  options: PackageFacetOptions;
  resultCount: number;
  canEdit: boolean;
}) {
  const setTags = (tags: string[]) => onChange({ ...facets, tags });

  // Deprecation is a status, not a facet: it is the DeprecatedFilterChip beside
  // the Filter menu.
  const facetList: Facet[] = [
    tagFacet(options.tags, facets.tags, setTags, canEdit),
    {
      key: "versions",
      label: "Versions",
      values: (["multi", "single", "unversioned"] as const).map((v) => ({ value: v, label: VERSIONS_LABEL[v], count: options.versions[v] })),
      selected: facets.versions !== null ? [facets.versions] : [],
      onSelect: ([versions]) => onChange({ ...facets, versions: (versions as VersionsValue | undefined) ?? null }),
      single: true,
      dropsWithOneValue: true,
    },
  ];

  const pills: FilterPill[] = [
    ...tagPills(options.tags, facets.tags, setTags),
    ...(facets.versions !== null
      ? [{ key: "versions", field: "versions", value: VERSIONS_LABEL[facets.versions].toLowerCase(), onRemove: () => onChange({ ...facets, versions: null }) }]
      : []),
    // Only `deprecated: false` gets a pill: `true` shows as the chip's pressed
    // state, while `false` arrives only from a pasted URL and needs a way to be
    // removed.
    ...(facets.deprecated === false
      ? [{ key: "deprecated", field: "deprecated", value: "no", onRemove: () => onChange({ ...facets, deprecated: null }) }]
      : []),
  ];

  return (
    <FacetedFilterBar
      search={{
        value: facets.text,
        onChange: (text) => onChange({ ...facets, text }),
        label: "Search packages by name",
        placeholder: `Search ${options.total.toLocaleString()} packages by name…`,
      }}
      chips={
        options.deprecatedMax > 0 || facets.deprecated === true ? (
          <DeprecatedFilterChip
            count={options.deprecatedCount}
            maxCount={options.deprecatedMax}
            total={isFilteringPackages({ ...facets, deprecated: null }) ? options.deprecatedMax : undefined}
            active={facets.deprecated === true}
            onToggle={() => onChange({ ...facets, deprecated: facets.deprecated === true ? null : true })}
          />
        ) : null
      }
      facets={facetList}
      count={
        isFilteringPackages(facets) ? (
          <>
            <span className="font-medium text-foreground">{resultCount.toLocaleString()}</span> of {options.total.toLocaleString()} packages
          </>
        ) : (
          <>
            {options.total.toLocaleString()} {options.total === 1 ? "package" : "packages"}
          </>
        )
      }
      pills={pills}
      onClearAll={() => onChange(emptyPackageFacets())}
    />
  );
}
