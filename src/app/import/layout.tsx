import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export default function ImportLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_CSV_IMPORT_ENABLED !== "true") {
    notFound();
  }
  return <div className="min-h-screen bg-bg-primary text-text-primary">{children}</div>;
}
