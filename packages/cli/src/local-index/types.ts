import type { ComponentId } from "@scoutui/reference-graph";
import type { DeclaredPropApi } from "@scoutui/scan-format";

export type DetectorId =
  | "vue-sfc"
  | "vue-define-component"
  | "vue-functional"
  | "wc-decorator"
  | "wc-customelements-define";

export type LocalDefinition = {
  /** componentId.source is always { type: "local", filePath }. */
  componentId: ComponentId;
  /**
   * Local export identifier. For a Vue default export, this is the
   * component's name (e.g. "UserCard" for `user-card.vue` with no `name`
   * option); use `isDefault` to distinguish default from named-with-same-name.
   */
  exportName: string;
  /** True when emitted via `export default`. */
  isDefault: boolean;
  detector: DetectorId;
  /** Source position of the declaration site. Populated by detectors. */
  loc?: Loc;
  /** Source-derived declared prop API, when readable. Populated by detectors. */
  declared?: DeclaredPropApi;
};

export type LocalDefinitionIndex = {
  /** POSIX repo-relative filePath → definitions in that file. */
  byPath: Map<string, LocalDefinition[]>;
  /** Canonical custom-element tag → every local registration of it. */
  byTag: Map<string, LocalDefinition[]>;
};

export type Loc = {
  file: string;
  line: number;
  column: number;
};
