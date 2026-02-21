import type { ManDocumentPayload } from "./types";

const baseSections = [
  {
    heading: "NAME",
    lines: (topic: string) => [
      `${topic} - mock man page fallback for browser mode`,
    ],
  },
  {
    heading: "SYNOPSIS",
    lines: (topic: string) => [
      `${topic} [OPTION]... [FILE]...`,
      `${topic} --help`,
      `${topic} --version`,
    ],
  },
  {
    heading: "DESCRIPTION",
    lines: (topic: string) => [
      `This page is shown because the Tauri runtime is not active in the browser preview.`,
      `The desktop build uses system man output with col -bx normalization.`,
      `Use this fallback to test navigation, search, minimap, and zoom behavior.`,
      `Topic selected: ${topic}`,
      `Environment variables like PATH, MANPAGER, and PAGER are highlighted.`,
    ],
  },
  {
    heading: "OPTIONS",
    lines: () => {
      const options: string[] = [];
      const rows = [
        ["-a", "--all", "show all entries, including hidden sections"],
        ["-c", "--color", "force color output for headings and options"],
        ["-f", "--filter", "filter output to matching lines only"],
        ["-j", "--jump", "jump directly to section heading"],
        ["-n", "--line-number", "show absolute line numbers in the gutter"],
        ["-s", "--section", "open man section explicitly, e.g. 2 open"],
        ["-z", "--zoom", "set initial zoom factor"],
      ];

      for (let block = 0; block < 18; block += 1) {
        rows.forEach(([shortFlag, longFlag, description], index) => {
          options.push(
            `${shortFlag}, ${longFlag.padEnd(14)} ${description} (sample row ${block * rows.length + index + 1})`,
          );
        });
      }
      return options;
    },
  },
  {
    heading: "EXAMPLES",
    lines: (topic: string) => [
      `${topic} --filter open`,
      `${topic} --section 3 printf`,
      `${topic} --zoom 1.25`,
      `${topic} --jump OPTIONS`,
      `MANPAGER=cat ${topic} ls`,
      `command man ls  # bypass shell alias override`,
      `/usr/share/man/man1/${topic}.1.gz`,
    ],
  },
  {
    heading: "FILES",
    lines: () => [
      `/etc/man_db.conf`,
      `/usr/share/man`,
      `~/.local/share/man`,
      `~/.config/better-man-viewer/settings.json`,
    ],
  },
  {
    heading: "SEE ALSO",
    lines: () => [
      "man(1)",
      "col(1)",
      "less(1)",
      "groff(7)",
      "apropos(1)",
      "whatis(1)",
    ],
  },
];

export function createMockManpage(query: string): ManDocumentPayload {
  const normalizedQuery = query.trim() || "man";
  const topic = normalizedQuery.replace(/^man\s+/i, "");
  const compactMode = /\b(short|tiny|mini)\b/i.test(topic);
  const title = `${topic.toUpperCase()}(1)`;

  const lines: string[] = [title, "", "BROWSER FALLBACK", ""];

  const compactSkippedSections = new Set(["FILES", "SEE ALSO"]);

  baseSections.forEach((section) => {
    if (compactMode && compactSkippedSections.has(section.heading)) {
      return;
    }

    lines.push(section.heading);
    lines.push("");
    if (section.heading === "OPTIONS" && compactMode) {
      const compactOptions = section.lines(topic).slice(0, 3);
      lines.push(...compactOptions);
    } else if (section.heading === "EXAMPLES" && compactMode) {
      lines.push(...section.lines(topic).slice(0, 3));
    } else {
      lines.push(...section.lines(topic));
    }
    lines.push("");
  });

  if (compactMode) {
    lines.push("NOTES");
    lines.push("");
    lines.push("Compact fallback mode for short-document scrollbar testing.");
  } else {
    lines.push("NOTES");
    lines.push("");
    lines.push(
      "This mock document intentionally contains many repeated lines.",
    );
    lines.push(
      "It helps validate minimap rendering and virtualized scrolling behavior.",
    );
  }

  return {
    query: normalizedQuery,
    title,
    source: "system-man",
    rawText: `${lines.join("\n")}\n`,
    fetchedAt: `${Date.now()}`,
  };
}
