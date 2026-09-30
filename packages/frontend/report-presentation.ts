/** Presentation only: pass checksum-verified HTML from useReportState.
 * Preserve the original artifact for downloads, audit checks and snapshot identity.
 * No data replacement, scripts, remote assets, or extra iframe privileges.
 */
export const reportPreviewStyle = `<style data-report-preview="reading-v1">
:root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: #294b60; background: #f4f8fa; }
* { box-sizing: border-box; }
html { margin: 0; padding: 0; }
body { max-width: 860px; margin: 0 auto; padding: 18px; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
h1 { margin: 0 0 14px; padding-bottom: 12px; border-bottom: 2px solid #d5e5e7; font-size: 21px; line-height: 1.4; color: #225b67; }
h2 { margin: 24px 0 12px; font-size: 16px; line-height: 1.5; }
p { margin: 10px 0; }
body > p { padding: 10px 12px; border: 1px solid #e0eaed; border-radius: 10px; background: #fff; }
pre { margin: 0; max-width: 100%; padding: 14px; border: 1px solid #dbe7eb; border-radius: 12px; background: #fff; color: #476477; font: 12px/1.7 ui-monospace, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; tab-size: 2; }
img, table { max-width: 100%; }
@media(max-width: 360px) { body { padding: 12px; font-size: 13px; } h1 { font-size: 19px; } pre { padding: 10px; } }
</style>`;
export function reportPreviewHtml(verifiedHtml: string): string {
  if (!verifiedHtml) return '';
  // Only append fixed presentation CSS; retain every original artifact byte.
  return verifiedHtml + reportPreviewStyle;
}
