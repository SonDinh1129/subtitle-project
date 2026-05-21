import { Captions } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-gray-950 text-gray-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
              <Captions className="w-4 h-4 text-white" />
            </div>
            <span className="text-white tracking-tight">
              <span className="text-violet-400">Sub</span>AI
            </span>
          </div>
          <p className="text-sm leading-relaxed text-gray-500 max-w-2xl">
            SubAI helps creators and teams generate accurate English subtitles in minutes.
          </p>
          <p className="text-xs text-gray-600">© 2026 SubAI. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
