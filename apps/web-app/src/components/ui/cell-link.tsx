import Link from "next/link";
import { TableCell } from "@/components/ui/table";

/** A table cell whose entire area is a row-navigation link. Every cell after a
 *  row's first takes `tabIndex={-1}`: one Tab stop per row. */
export function CellLink({
  href, className, cellClassName, title, tabIndex, children,
}: {
  href: string;
  className?: string;
  cellClassName?: string;
  title?: string;
  tabIndex?: number;
  children: React.ReactNode;
}) {
  return (
    <TableCell className={`p-0 ${cellClassName ?? ""}`}>
      <Link href={href} title={title} tabIndex={tabIndex} className={`focus-inset block px-3 py-2 ${className ?? ""}`}>
        {children}
      </Link>
    </TableCell>
  );
}
