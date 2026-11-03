import { getDocumentProxy } from "npm:unpdf@0.12";
import { strFromU8, unzipSync } from "npm:fflate@0.8";

export interface Extracted {
  kind: "pdf" | "docx" | "txt";
  text: string;
  links: string[];
  hiddenSignals: number; // tiny / white / vanished text runs
}

const startsWith = (b: Uint8Array, s: string) =>
  s.split("").every((c, i) => b[i] === c.charCodeAt(0));

export function detectKind(bytes: Uint8Array, filename: string): Extracted["kind"] {
  const ext = filename.split(".").pop()?.toLowerCase();
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  if (ext === "pdf" && (startsWith(bytes, "%PDF") || header.includes("%PDF"))) return "pdf";
  if (ext === "docx" && startsWith(bytes, "PK")) return "docx";
  if (ext === "txt" && !bytes.slice(0, 1024).includes(0)) return "txt";
  throw new Error("Unsupported or corrupted file. Use PDF, DOCX or TXT.");
}

export async function extractResume(bytes: Uint8Array, filename: string): Promise<Extracted> {
  const kind = detectKind(bytes, filename);
  if (kind === "pdf") return await extractPdf(bytes);
  if (kind === "docx") return extractDocx(bytes);
  return { kind, text: new TextDecoder().decode(bytes), links: [], hiddenSignals: 0 };
}

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes)); // copy: pdf.js detaches the buffer
  const links: string[] = [];
  let text = "";
  let hidden = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      if (typeof item.str !== "string") continue;
      const height = item.height || Math.abs(item.transform?.[3] ?? 0);
      if (item.str.trim() && height > 0 && height < 3) hidden++; // sub-3pt text
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    text += "\n";
    const annotations = (await page.getAnnotations().catch(() => [])) ?? [];
    for (const a of annotations as any[]) {
      const url = a.url ?? a.unsafeUrl ?? a.action?.uri;
      if (typeof url === "string" && url.startsWith("http")) links.push(url);
    }
  }
  return { kind: "pdf", text, links, hiddenSignals: hidden };
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function extractDocx(bytes: Uint8Array): Extracted {
  const files = unzipSync(bytes, {
    filter: (f) => f.name === "word/document.xml" || f.name === "word/_rels/document.xml.rels",
  });
  const doc = files["word/document.xml"];
  if (!doc) throw new Error("Invalid DOCX: document.xml missing");
  const xml = strFromU8(doc);

  const text = xml.split("</w:p>").map((p) =>
    [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)]
      .map((m) => (m[1] !== undefined ? decodeXml(m[1]) : " ")).join("")
  ).join("\n");

  const rels = files["word/_rels/document.xml.rels"];
  const links = rels
    ? [...strFromU8(rels).matchAll(/Target="(https?:\/\/[^"]+)"/g)].map((m) => decodeXml(m[1]))
    : [];

  const hidden =
    (xml.match(/<w:vanish\s*\/>/g) ?? []).length +
    (xml.match(/<w:color w:val="FFFFFF"/gi) ?? []).length +
    [...xml.matchAll(/<w:sz w:val="(\d+)"/g)].filter((m) => Number(m[1]) <= 4).length;

  return { kind: "docx", text, links, hiddenSignals: hidden };
}
