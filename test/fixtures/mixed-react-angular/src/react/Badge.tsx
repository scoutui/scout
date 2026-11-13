import { Component, h } from "@stencil/core";

/**
 * A Stencil component: decorated with `@Component`, same decorator name
 * `detectAngularComponents` looks for, but imported from Stencil, not
 * `@angular/core`. Proves the scan tells the two apart instead of treating
 * every `@Component(` as Angular.
 */
@Component({ tag: "ex-badge" })
export class Badge {
  render() {
    return <span>New</span>;
  }
}
