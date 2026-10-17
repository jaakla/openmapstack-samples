import { readFileSync } from "node:fs";

const escapeHTML = (value) => String(value).replace(/[&<>"']/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function publicationMarkup(provenance, base = "/") {
  const project = provenance.project;
  if (!project?.author?.email || !project.generated_with?.url)
    throw new Error("Publication metadata is missing. Run the canonical pipeline before building.");
  const p = project, e = escapeHTML;
  const footer = `<footer id="project-attribution" class="publication-credit" aria-label="Project and data attribution">
    <div class="publication-line"><span><a href="mailto:${e(p.author.email)}">${e(p.author.name)}</a> · ${e(p.author.email)}</span><span class="publication-status">${e(p.status)} · Updated <time datetime="${e(p.updated_at)}">${e(p.updated_at.slice(0, 10))}</time></span><span>Generated with <a href="${e(p.generated_with.url)}" target="_blank" rel="noreferrer">${e(p.generated_with.tool)}</a></span></div>
    <div class="publication-sources"><span>© Helsingin kaupunkimittauspalvelut 2021 · LiDAR / imagery · modified · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · LoD2 © City of Helsinki · acquisition epoch unknown</span><span>© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors · ODbL</a> · UAV: Innerscene · CC0 · <a href="${e(base)}models/ATTRIBUTION.txt">Source credits</a> · <a href="${e(base)}licenses/coordinates.txt">Coordinate libraries</a></span></div>
  </footer>`;
  return { footer, tags: [
    { tag: "meta", attrs: { name: "author", content: p.author.name } },
    { tag: "meta", attrs: { name: "generator", content: p.generated_with.tool } },
    { tag: "meta", attrs: { name: "dcterms.modified", content: p.updated_at } },
    { tag: "meta", attrs: { name: "publication-status", content: p.status } },
    { tag: "script", attrs: { id: "project-metadata", type: "application/json" },
      children: JSON.stringify(project).replace(/</g, "\\u003c") },
  ] };
}

export function publicationAttribution() {
  let base = "/";
  return {
    name: "publication-attribution",
    configResolved(config) { base = config.base; },
    transformIndexHtml(html) {
      const provenance = JSON.parse(readFileSync(new URL("./public/data/provenance.json", import.meta.url), "utf8"));
      const { footer, tags } = publicationMarkup(provenance, base);
      return { html: html.replace("</body>", footer + "</body>"), tags };
    },
  };
}
