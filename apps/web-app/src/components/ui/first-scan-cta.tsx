/** The commands for a first scan, shown wherever no scan has been uploaded yet. */
export function FirstScanCta() {
  return (
    <div className="rounded-md border bg-muted/30 px-4 py-3 text-left font-mono text-xs leading-relaxed text-foreground">
      <div>scout auth login</div>
      <div>scout scan</div>
    </div>
  );
}
