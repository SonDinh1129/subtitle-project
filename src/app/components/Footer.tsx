import { Link } from "react-router";
import { Captions, Twitter, Github, Linkedin, Youtube } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-gray-950 text-gray-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          {/* Brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                <Captions className="w-4 h-4 text-white" />
              </div>
              <span className="text-white tracking-tight">
                <span className="text-violet-400">Sub</span>AI
              </span>
            </div>
            <p className="text-sm leading-relaxed text-gray-500 max-w-xs">
              AI-powered English subtitle generation for creators, educators, and teams. Generate accurate captions in minutes.
            </p>
            <div className="flex items-center gap-3 mt-5">
              {[
                { icon: Twitter, label: "Twitter" },
                { icon: Github, label: "GitHub" },
                { icon: Linkedin, label: "LinkedIn" },
                { icon: Youtube, label: "YouTube" },
              ].map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  aria-label={label}
                  className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
                >
                  <Icon className="w-4 h-4 text-gray-400" />
                </button>
              ))}
            </div>
          </div>

          {/* Links */}
          {[
            {
              title: "Product",
              links: ["Features", "Pricing", "Changelog", "Roadmap"],
            },
            {
              title: "Resources",
              links: ["Documentation", "API Reference", "Blog", "Community"],
            },
            {
              title: "Company",
              links: ["About", "Privacy", "Terms", "Contact"],
            },
          ].map((col) => (
            <div key={col.title}>
              <h4 className="text-white text-sm mb-4">{col.title}</h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link}>
                    <Link
                      to="#"
                      className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {link}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-600">
            © 2026 SubAI. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link to="#" className="text-sm text-gray-600 hover:text-gray-400 transition-colors">Privacy Policy</Link>
            <Link to="#" className="text-sm text-gray-600 hover:text-gray-400 transition-colors">Terms of Service</Link>
            <Link to="#" className="text-sm text-gray-600 hover:text-gray-400 transition-colors">Cookie Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
