export type ComponentKind = "custom-element" | "react-component" | "vue-component";

export type ExternalSource = { type: "external"; package: string; publicEntry?: string };
type LocalSource = { type: "local"; filePath: string; exportName?: string };
/** Where a component comes from. Only a tag can be of unknown source: a React or Vue component has a package or a file. */
export type ComponentSource = ExternalSource | LocalSource | { type: "unknown" };

export type ComponentId =
  | { kind: "custom-element"; tagName: string; source: ComponentSource }
  | { kind: "react-component"; export: string; source: ExternalSource | LocalSource }
  | { kind: "vue-component"; export: string; source: ExternalSource | LocalSource };

function sourceSegment(source: ComponentSource): string {
  switch (source.type) {
    case "external":
      return `external:${source.package}`;
    case "local":
      return `local:${source.filePath}`;
    case "unknown":
      return "unknown";
  }
}

function identityPayload(id: ComponentId): string {
  switch (id.kind) {
    case "custom-element":
      return id.tagName;
    case "react-component":
    case "vue-component":
      return id.export;
  }
}

export function serialiseComponentId(id: ComponentId): string {
  return `${id.kind}:${sourceSegment(id.source)}::${identityPayload(id)}`;
}
