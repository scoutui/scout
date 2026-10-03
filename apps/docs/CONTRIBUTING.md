# Writing docs pages

This guide is for anyone writing or editing a page in `apps/docs/docs/`. It
lives outside that folder so it never becomes a page on the site.

## Who the pages are for

Write every page for someone **using the tool**: an engineer running
`scout scan` on their own repo, or a design-system author checking
how their components are used. Pages aren't for Scout maintainers,
so leave out:

- **Source-file paths and internal names** of functions, modules, symbols or
  seams (for example `emitReact`, `sfcOwnerRef`, `resolve(graph)`). Describe
  what the reader can observe, not the code that produces it.
- **Internal field names** that don't appear in the JSON artifact. Document
  only the fields readers see in their own output (for example
  `ownerComponentId`, not `rawOwnerComponentId`).
- **Internals that never reach the artifact**, such as a type that's declared
  but never populated.
- **History and roadmap** ("early versions did X", "not built yet"), and
  references to test suites or GitHub issues. They help maintainers, not
  readers.

Explaining *why the tool behaves a certain way* is fine on an explanation page
when it helps readers understand what they observe. How it's built, and why it
was built that way, don't belong on the site.

## One page, one type

The site follows the [Diátaxis](https://diataxis.fr/) framework. Every page is
exactly one of four types, and lives in the matching folder:

| Type | Folder | Its job |
| --- | --- | --- |
| Tutorial | `docs/tutorials/` | A lesson: teaches by doing |
| How-to guide | `docs/guides/` | A recipe: solves one named problem |
| Reference | `docs/reference/` | A dictionary: describes what a thing is |
| Explanation | `docs/explanation/` | A discussion: builds understanding |

A page that does two jobs at once, such as a how-to that also teaches concepts
or a reference page that walks through a workflow, doesn't work even when every
sentence is accurate. If the content spans two types, split it into two pages
and link them.

One allowance: a how-to guide may open with one or two sentences on what the
feature is for, so the reader knows they're on the right page. Anything longer
is teaching a concept; link to the explanation page instead.

Use the list for your page's type as a self-check before you open a pull
request.

### A good tutorial

A tutorial takes a newcomer from nothing to a working result.

- [ ] It's written as steps we take together ("we'll", "next we create…"),
      not as orders ("configure X").
- [ ] Someone who has never used the tool can follow it from start to finish
      and reach a concrete result.
- [ ] Every step says what the reader should see: file contents, terminal
      output or a UI state, not just the action.
- [ ] The steps follow one fixed order, with no branches or "choose your own
      path".
- [ ] It has no full tables of options, flags or config. When a step touches
      something with many options, it uses the one value it needs and links to
      the reference page.
- [ ] It doesn't stop to explain *why* at length. One line of reasoning is
      fine; a longer discussion links to an explanation page.

### A good how-to guide

A how-to guide solves one specific problem for a reader who already knows the
tool.

- [ ] The title names one specific goal (for example "How to add a custom
      resolver alias"), not a topic area.
- [ ] The steps are instructions ("Add `X` to `Y`") for a reader who knows the
      basics, with no onboarding and no "first, let's understand…".
- [ ] It covers one goal from start to finish. Two unrelated problems make two
      guides.
- [ ] It links to reference pages instead of repeating full flag lists, schema
      fields or output shapes.
- [ ] It links to explanation pages instead of teaching concepts or giving
      background.
- [ ] It assumes the setup already exists, or links to the tutorial that sets
      it up.

Dashboard feature pages (`docs/guides/dashboard/`) are how-to guides with a fixed
shape, 60 to 120 lines:

1. A short opener: what the area is for, with a concrete example using the
   invented names (`@acme/ui`, `storefront`, `Button`).
2. How to use it, as steps or short sections. UI labels are in **bold**, not
   backticks, spelled exactly as the screen shows them.
3. Screenshots where they help a reader find something on screen.
4. A short "How it's counted" or "Good to know" section, only if needed,
   linking to `/docs/explanation/dashboard/reading-the-numbers`.
5. A next step.

### A good reference page

A reference page is for looking things up.

- [ ] It describes *what is*: signatures, schemas, flags, fields, defaults and
      types. It never says how to do a task or why something was designed that
      way.
- [ ] It uses tables, lists and definitions, not first- or second-person
      walkthroughs.
- [ ] It's complete for its scope. If it documents a flag set, a config schema
      or an output shape, it lists every member, with no "and more".
- [ ] Every fact has been [checked against the code](#accuracy).
- [ ] Examples are short illustrations, such as one example value per field.
      A task-shaped walkthrough belongs in a how-to guide, linked from here.

### A good explanation page

An explanation page helps the reader understand, rather than act.

- [ ] It discusses concepts, design reasoning, trade-offs or how the pieces
      relate. The reader comes away understanding more, not with a finished
      task.
- [ ] It has no numbered procedure to follow. Short illustrative snippets are
      fine.
- [ ] Any command on the page illustrates a point; it isn't a "run this, then
      run that" sequence.
- [ ] It can compare approaches and give the reasoning behind a choice. This
      is where "why X and not Y" belongs.
- [ ] It links to reference pages for exact facts (schemas, flags,
      signatures) and to how-to guides for anything the reader should do.

## Style

The page type decides *what* a page says. These rules decide whether it's easy
to read, and they apply to every page.

- **Apply the cut test.** Keep a detail only if a reader would get stuck,
  misread the screen or lose work without it. Cut:
  - exact thresholds and timings that don't change what the reader does (for
    example "under 45 seconds")
  - singular and plural variants of messages, hover and tooltip text, UTC notes
  - exhaustive tables of every state, empty state or message; keep only the one
    or two a reader will actually meet
  - messages or states a reader can't trigger
  - differences in how frameworks or code paths work internally
  - suspected-bug notes (they go in the pull request, not on the page)
  - anything phrased as "the code does X"
- **Use callouts sparingly.** A gotcha, a "this is expected, not a bug"
  reassurance, or a trap the reader would miss in running prose goes in a
  Docusaurus admonition. Use `:::note` for an aside or a "this is expected"
  clarification, and `:::warning` for a trap that will cost the reader time. A
  collapsible `<details>` can hold a deeper "why" most readers can skip. Leave
  out `:::tip`, `:::info` and `:::danger`, and don't stack callouts: if
  everything is flagged, nothing stands out.
- **Put the fix next to the mistake.** When a page names a wrong or tempting
  approach (a mis-scoped glob, Plug'n'Play, a shallow clone), show the
  corrected version right beside it, ideally as "wrong" and "right" blocks side
  by side. Every "don't do X" comes with "do Y instead".
- **Say what's common and what's rare.** When a page lists many options of
  unequal importance (a flag table, a config schema), mark the ones most
  readers will rarely touch, so attention lands on the common path. Put
  advanced or rarely needed material towards the end, not mixed in with the
  basics.
- **Define terms on first use.** A term the tool coins or uses in its own way
  (*origin*, *grain*, *use*, *owner edge*, *enrichment*) gets a short
  definition in italics the first time it appears on a page. Link to the
  explanation page for the full discussion instead of teaching it again. A
  term the glossary defines links to its entry
  (`/docs/reference/glossary#use`) instead of being defined again.
- **Show complete, labelled examples.** An example the reader should
  understand as a whole appears in full, labelled with its file
  (```` ```json title="..." ````) or the exact command, and with the expected
  output where that helps. Use fragments only to show a shape, never for
  copying.
- **No em-dashes or en-dashes in prose.** Use a comma, a full stop, a colon or
  parentheses, or rephrase. If a comma would make a run-on sentence, split it
  instead. The one exception is a code or output block that quotes real tool
  output containing a dash: don't change real output.
- **Write plainly**, as if you were explaining to a capable colleague. Cut
  filler such as "It is worth noting that". Say what the tool does, not what
  you could imagine it doing, and never present something Scout can't do as a
  feature. If it comes up at all, describe it plainly as third-party tooling.
- **Keep paragraphs short.** Split a paragraph of three or more long sentences,
  or turn it into a list when it's a set of parallel points.

## Accuracy

When you document a fact on a reference or how-to page, check it against the
current code, and say in your pull request where it comes from (the file, and
the symbol or line where you can) so the reviewer can check it too. Keep those
source links off the page itself.

A fact the code contradicts is a bug, however well the page reads. If you start
from an older draft or page, check every fact in it again before you reuse it.

## Review

A maintainer reviews every page against this guide.
