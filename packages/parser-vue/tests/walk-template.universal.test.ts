import { describe, expect, it } from "vitest";
import { runVueScan } from "./test-utils.js";

/**
 * How the Vue template path records attribute values in an occurrence's
 * props: the written, reference and dynamic tiers (`classifyExprText` splits
 * reference from dynamic on bind expressions), a `v-bind="props"` spread as a
 * dynamic rest entry, and no attributes as an empty record.
 */

describe("parser-vue: tiered attribute tracking (engine output)", () => {
  function parseTemplate(template: string) {
    const source = `<template>
${template}
</template>
<script setup lang="ts">
import { Button } from "@example/unmapped-vue";
</script>`;
    return runVueScan({ source, file: "App.vue" });
  }

  it('static attribute → written tier', () => {
    const { occurrences } = parseTemplate(`  <Button foo="bar" />`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.props.foo).toEqual({ tier: "written", value: "bar" });
  });

  it(':foo="bar" (bare identifier expr) → reference tier', () => {
    const { occurrences } = parseTemplate(`  <Button :foo="bar" />`);
    expect(occurrences[0]!.props.foo).toEqual({ tier: "reference", ref: "bar" });
  });

  it(':foo="\'literal\'" (quoted string) → written tier, unquoted', () => {
    const { occurrences } = parseTemplate(`  <Button :foo="'literal'" />`);
    expect(occurrences[0]!.props.foo).toEqual({ tier: "written", value: "literal" });
  });

  it(':foo="1.5" (numeric) → written tier, numeric literal', () => {
    const { occurrences } = parseTemplate(`  <Button :foo="1.5" />`);
    expect(occurrences[0]!.props.foo).toEqual({ tier: "written", value: 1.5 });
  });

  it(':foo="true" (boolean) → written tier, boolean literal', () => {
    const { occurrences } = parseTemplate(`  <Button :foo="true" />`);
    expect(occurrences[0]!.props.foo).toEqual({ tier: "written", value: true });
  });

  it(':foo="a + b" (other expr) → dynamic tier', () => {
    const { occurrences } = parseTemplate(`  <Button :foo="a + b" />`);
    expect(occurrences[0]!.props.foo).toEqual({ tier: "dynamic" });
  });

  it('v-bind="props" (no arg) → "...rest" entry, dynamic tier', () => {
    const { occurrences } = parseTemplate(`  <Button v-bind="props" />`);
    expect(occurrences[0]!.props["...rest"]).toEqual({ tier: "dynamic" });
  });

  it("omitted props → empty props record", () => {
    const { occurrences } = parseTemplate("  <Button />");
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.props).toEqual({});
  });
});
