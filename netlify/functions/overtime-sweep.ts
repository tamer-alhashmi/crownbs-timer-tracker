export default async function overtimeSweep() {
  const siteUrl = process.env.URL ?? process.env.DEPLOY_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("Overtime sweep requires Netlify URL and CRON_SECRET environment variables.");
    return new Response("Overtime sweep is not configured.", { status: 503 });
  }

  const response = await fetch(new URL("/api/cron/overtime", siteUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    console.error("Scheduled overtime sweep failed:", response.status, body);
  }
  return new Response(response.ok ? "Overtime alerts processed." : "Overtime alert processing failed.", {
    status: response.status,
  });
}

export const config = { schedule: "*/15 * * * *" };
