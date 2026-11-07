export default async function monthlyClosing() {
  const siteUrl = process.env.URL ?? process.env.DEPLOY_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("Monthly closing requires Netlify URL and CRON_SECRET environment variables.");
    return new Response("Monthly closing is not configured.", { status: 503 });
  }

  const response = await fetch(new URL("/api/cron/digests?cadence=monthly", siteUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
    cache: "no-store",
  });
  if (!response.ok) console.error("Scheduled monthly closing failed:", response.status, await response.text());
  return new Response(response.ok ? "Monthly closing reports dispatched." : "Monthly closing dispatch failed.", { status: response.status });
}

export const config = { schedule: "0 7 27 * *" };
