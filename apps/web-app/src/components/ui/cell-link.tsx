import Link from "next/link";
import { TableCell } from "@/components/ui/table";

/** A table cell whose entire area is a row-navigation link. */
export function CellLink({
  href, className, cellClassName, title, children,
}: {
  href: string;
  className?: string;
  cellClassName?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <TableCell className={`p-0 ${cellClassName ?? ""}`}>
      <Link href={href} title={title} className={`block px-3 py-2 ${className ?? ""}`}>
        {children}
      </Link>
    </TableCell>
  );
}
