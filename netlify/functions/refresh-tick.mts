import type { Context, Config } from '@netlify/functions';

// Scheduled function that fires the daily refresh. Scheduled functions
// run under a 30-second budget, so this one just dispatches the heavy
// pull to the background function and returns. The background function
// gets the full 15-minute window to complete the Massive pulls and the
// Supabase upserts.
//
// Schedule: 21:30 UTC weekdays (after US equity market close). Aligned
// with the aigamma.com eod-downsample-background.mjs cadence so the
// two pipelines tick within the same window and both see the same
// "trading day complete" snapshot from Massive's grouped endpoints.

export default async (_req: Request, _context: Context): Promise<void> => {
  const siteUrl = Netlify.env.get('URL') ?? 'http://localhost:8888';
  const refreshUrl = `${siteUrl}/.netlify/functions/refresh-data-background`;

  // Fire-and-forget POST. Background functions return 202 immediately
  // so this returns within a few hundred ms even though the heavy
  // work continues for minutes after.
  await fetch(refreshUrl, { method: 'POST' });
};

export const config: Config = {
  schedule: '30 21 * * 1-5',
};
