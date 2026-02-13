#!/usr/bin/env python3
"""
Generate a styled PDF report from wide-research project reports.

Reads specs.json to discover reports and their order, builds a linked TOC,
and renders via weasyprint. Skips incomplete reports (stub marker present).

Usage:
    python3 generate_report.py <project-path>
    python3 generate_report.py <project-path> --output custom-name.pdf
"""

import argparse
import html as html_mod
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import markdown
from weasyprint import HTML

STUB_MARKER = "_Key findings will appear here_"

# ---------- CSS ----------

CSS = """
@page {
    size: A4;
    margin: 2cm 2.5cm;
    @top-center {
        content: string(doc-title);
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 8pt;
        color: #888;
    }
    @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 8pt;
        color: #888;
    }
}

body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.6;
    color: #1a1a1a;
}

.doc-title { string-set: doc-title content(); display: none; }

/* Cover */
.cover {
    page-break-after: always;
    text-align: center;
    padding-top: 30%;
}
.cover h1 { font-size: 28pt; color: #1a1a1a; border: none; page-break-before: avoid; }
.cover .subtitle { font-size: 14pt; color: #555; margin-bottom: 40px; }
.cover .meta { font-size: 10pt; color: #777; margin-top: 60px; }

/* TOC */
.toc { page-break-after: always; }
.toc h2 { color: #1a1a1a; border-bottom: 2px solid #333; page-break-before: avoid; }
.toc ul { list-style: none; padding-left: 0; margin: 0; }
.toc li { padding: 3px 0; border-bottom: 1px dotted #ddd; }
.toc li a { color: #1a1a1a; text-decoration: none; }
.toc li a:hover { color: #2563eb; }

/* Headings */
h1 {
    font-size: 20pt; color: #1a1a1a;
    border-bottom: 3px solid #2563eb;
    padding-bottom: 8px; margin-top: 30px;
    page-break-before: always;
}
h1:first-of-type { page-break-before: avoid; }
h2 { font-size: 15pt; color: #1e40af; border-bottom: 1px solid #dbeafe; padding-bottom: 5px; margin-top: 24px; }
h3 { font-size: 12pt; color: #1e3a5f; margin-top: 18px; }
h4 { font-size: 10.5pt; color: #374151; margin-top: 14px; }

/* Body */
p { margin: 8px 0; text-align: justify; }
a { color: #2563eb; text-decoration: none; }
strong { color: #111; }

blockquote {
    border-left: 3px solid #2563eb;
    padding: 8px 16px; margin: 12px 0;
    background: #f0f7ff; color: #1e3a5f; font-size: 9.5pt;
}

code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 9pt; font-family: 'Courier New', monospace; }
pre { background: #1e293b; color: #e2e8f0; padding: 12px 16px; border-radius: 6px; font-size: 8.5pt; line-height: 1.5; overflow-wrap: break-word; white-space: pre-wrap; }
pre code { background: none; color: inherit; padding: 0; }

table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9pt; }
th { background: #1e40af; color: white; padding: 8px 10px; text-align: left; font-weight: 600; }
td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
tr:nth-child(even) td { background: #f9fafb; }

ul, ol { margin: 8px 0; padding-left: 24px; }
li { margin: 3px 0; }
hr { border: none; border-top: 1px solid #d1d5db; margin: 30px 0; }

p, li { orphans: 3; widows: 3; }
h2, h3, h4 { page-break-after: avoid; }
"""


def slugify(text: str) -> str:
    """Convert heading text to a URL-safe anchor id."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[-\s]+", "-", text).strip("-")


def load_specs(project_dir: Path) -> dict:
    specs_file = project_dir / "specs.json"
    with open(specs_file, encoding="utf-8") as f:
        return json.load(f)


def collect_reports(specs: dict) -> list[tuple[str, str, Path]]:
    """Return list of (label, title, file_path) for completed reports."""
    entries = []
    for angle in specs["angles"]:
        report_path = Path(angle["report_path"])
        label = angle["label"]
        title = angle["title"]

        if not report_path.exists():
            print(f"  [SKIP] report-{label}.md — file missing")
            continue

        content = report_path.read_text(encoding="utf-8")
        if STUB_MARKER in content:
            print(f"  [SKIP] report-{label}.md — still a stub")
            continue

        # Extract title from first heading if present
        first_line = content.split("\n", 1)[0]
        if first_line.startswith("# "):
            title = re.sub(r"^#\s*", "", first_line).strip()

        entries.append((label, title, report_path))

    return entries


def build_cover(specs: dict) -> str:
    project = specs.get("project", "Research")
    description = specs.get("description", "")
    today = date.today().strftime("%B %Y")
    report_count = len(specs.get("angles", []))

    project = html_mod.escape(project)
    description = html_mod.escape(description)

    return f"""
<span class="doc-title">{project}</span>
<div class="cover">
    <h1>{project}</h1>
    <div class="subtitle">{description}</div>
    <div class="meta">
        <p>{report_count} Research Reports</p>
        <p>{today}</p>
    </div>
</div>
"""


def build_toc_html(entries: list[tuple[str, str, Path]]) -> str:
    lines = ['<div class="toc">', "<h2>Table of Contents</h2>", "<ul>"]
    for label, title, _ in entries:
        anchor = slugify(title)
        escaped_title = html_mod.escape(title)
        escaped_label = html_mod.escape(label)
        lines.append(f'<li><a href="#{anchor}">{escaped_label}. {escaped_title}</a></li>')
    lines.append("</ul></div>")
    return "\n".join(lines)


def build_markdown(entries: list[tuple[str, str, Path]]) -> str:
    parts = []
    for _, _, fpath in entries:
        parts.append(fpath.read_text(encoding="utf-8"))
        parts.append("\n---\n")
    return "\n".join(parts)


def inject_heading_ids(html: str, entries: list[tuple[str, str, Path]]) -> str:
    """Add id attributes to H1 tags so TOC links work."""
    slug_map = {}
    for _, title, _ in entries:
        slug_map[title] = slugify(title)

    def replace_h1(match):
        tag_content = match.group(1)
        plain = re.sub(r"<[^>]+>", "", tag_content).strip()
        slug = slug_map.get(plain)
        if not slug:
            for title, s in slug_map.items():
                if plain.startswith(title[:40]) or title.startswith(plain[:40]):
                    slug = s
                    break
        if not slug:
            slug = slugify(plain)
        return f'<h1 id="{slug}">{tag_content}</h1>'

    return re.sub(r"<h1>(.*?)</h1>", replace_h1, html, flags=re.DOTALL)


def main():
    parser = argparse.ArgumentParser(description="Generate research PDF report")
    parser.add_argument("project_path", help="Path to the research project directory")
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output filename (default: <project>-report.pdf)",
    )
    args = parser.parse_args()

    project_dir = Path(args.project_path).resolve()
    if not project_dir.is_dir():
        print(f"Error: not a directory: {project_dir}", file=sys.stderr)
        sys.exit(1)

    specs = load_specs(project_dir)
    project_name = specs.get("project", project_dir.name)

    # Collect completed reports
    print("Collecting reports...")
    entries = collect_reports(specs)

    if not entries:
        print("No completed reports found. Nothing to generate.")
        sys.exit(0)

    print(f"Found {len(entries)} completed reports")

    # Build markdown
    md_text = build_markdown(entries)
    print(f"Total markdown: {len(md_text):,} chars")

    # Convert to HTML
    extensions = ["tables", "fenced_code", "toc", "smarty"]
    html_body = markdown.markdown(md_text, extensions=extensions)

    # Inject heading IDs
    html_body = inject_heading_ids(html_body, entries)

    # Build TOC and cover
    toc_html = build_toc_html(entries)
    cover_html = build_cover(specs)

    output_name = args.output or f"{project_name}-report.pdf"
    out_pdf = project_dir / output_name

    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>{CSS}</style></head>
<body>
{cover_html}
{toc_html}
{html_body}
</body>
</html>"""

    # Render PDF
    print("Rendering PDF...")
    HTML(string=full_html).write_pdf(str(out_pdf))
    size_mb = out_pdf.stat().st_size / (1024 * 1024)
    print(f"Done: {out_pdf} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
