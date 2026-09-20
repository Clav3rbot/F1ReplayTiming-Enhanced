import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Sticky header shared by the /about and /features pages. */
export default function DocPageHeader({ title }: { title: string }) {
  return (
    <div className="glass-panel-heavy sticky top-0 z-40 border-b border-white/5">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex items-center gap-4">
        <Link
          href="/"
          aria-label="Back to session picker"
          className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-f1-muted hover:text-white hover:bg-white/10 hover:border-white/20 transition-colors group"
        >
          <ArrowLeft className="w-6 h-6 group-hover:-translate-x-0.5 transition-transform" strokeWidth={2.5} />
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h1>
      </div>
    </div>
  );
}
