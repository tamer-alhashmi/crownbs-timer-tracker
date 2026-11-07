export default async function weeklyDigest() {
  const siteUrl = process.env.URL ?? process.env.DEPLOY_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("Weekly digest requires Netlify URL and CRON_SECRET environment variables.");
    return new Response("Weekly digest is not configured.", { status: 503 });
  }

  const response = await fetch(new URL("/api/cron/digests?cadence=weekly", siteUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
    cache: "no-store",
  });
  if (!response.ok) console.error("Scheduled weekly digest failed:", response.status, await response.text());
  return new Response(response.ok ? "Weekly digests dispatched." : "Weekly digest dispatch failed.", { status: response.status });
}

export const config = { schedule: "0 7 * * 1" };
