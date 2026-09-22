import { z } from "zod";

export const repository = "jslee124/forge";
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
export function parseVersion(value: string) {
  const match = versionPattern.exec(value);
  if (!match) throw new Error("Invalid desktop semantic version");
  return {
    core: [
      BigInt(match[1] ?? "0"),
      BigInt(match[2] ?? "0"),
      BigInt(match[3] ?? "0"),
    ],
    pre: match[4]?.split(".") ?? [],
  };
}
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a),
    y = parseVersion(b);
  for (let i = 0; i < 3; i++)
    if (x.core[i] !== y.core[i])
      return (x.core[i] ?? 0n) > (y.core[i] ?? 0n) ? 1 : -1;
  if (!x.pre.length || !y.pre.length)
    return x.pre.length ? -1 : y.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i],
      q = y.pre[i];
    if (p === q) continue;
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p),
      qn = /^\d+$/.test(q);
    if (pn && qn) return BigInt(p) > BigInt(q) ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    return p > q ? 1 : -1;
  }
  return 0;
}
const assetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string(),
  size: z.number().int().positive(),
});
export const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    body: z.string().nullable().optional(),
    assets: z.array(assetSchema),
  }),
);
export type Release = z.infer<typeof releasesSchema>[number];
export interface UpdateCandidate {
  version: string;
  notes: string;
  name: string;
  url: string;
  checksumUrl: string;
  size: number;
}
export function selectRelease(
  releases: Release[],
  current: string,
  channel: "stable" | "preview",
  arch: string,
): UpdateCandidate | undefined {
  if (arch !== "arm64" && arch !== "x64")
    throw new Error("Unsupported application architecture");
  const eligible = releases
    .filter((r) => {
      if (r.draft || !r.tag_name.startsWith("desktop-")) return false;
      try {
        const v = r.tag_name.slice(8);
        const parsed = parseVersion(v);
        return (
          (channel === "preview" || (!r.prerelease && !parsed.pre.length)) &&
          compareVersions(v, current) > 0
        );
      } catch {
        return false;
      }
    })
    .sort((a, b) => compareVersions(b.tag_name.slice(8), a.tag_name.slice(8)));
  const release = eligible[0];
  if (!release) return;
  const version = release.tag_name.slice(8);
  // Release contract: asset package version is the full identity's major.minor.patch.
  const name = `forge-desktop-${parseVersion(version).core.join(".")}-${arch}.dmg`;
  const dmg = release.assets.filter((a) => a.name === name);
  const sums = release.assets.filter((a) => a.name === "SHA256SUMS");
  const installer = dmg[0],
    checksum = sums[0];
  if (dmg.length !== 1 || sums.length !== 1 || !installer || !checksum)
    throw new Error(
      `Incomplete release ${version}: missing or duplicate ${arch} DMG / SHA256SUMS`,
    );
  for (const asset of [installer, checksum]) {
    const url = new URL(asset.browser_download_url);
    if (
      url.origin !== "https://github.com" ||
      url.pathname !==
        `/${repository}/releases/download/${release.tag_name}/${asset.name}` ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid release asset source");
  }
  return {
    version,
    notes: (release.body ?? "").slice(0, 16000),
    name,
    url: installer.browser_download_url,
    checksumUrl: checksum.browser_download_url,
    size: installer.size,
  };
}
export function readChecksum(text: string, name: string): string {
  const matches = text
    .split(/\r?\n/)
    .filter((line) => line.trimEnd().endsWith(name));
  if (matches.length !== 1) throw new Error("Missing or duplicate checksum");
  const match = /^([a-fA-F0-9]{64}) [ *](\S+)$/.exec(matches[0] ?? "");
  if (!match?.[1] || match[2] !== name) throw new Error("Invalid checksum");
  return match[1].toLowerCase();
}
