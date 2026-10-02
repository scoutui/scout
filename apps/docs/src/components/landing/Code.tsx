import type React from "react";
import clsx from "clsx";
import shared from "./shared.module.css";

/** An identifier (package, path, prop, value, repo or version): mono, and always left to right. */
export default function Code({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <code dir="ltr" className={clsx(shared.code, className)}>
      {children}
    </code>
  );
}
