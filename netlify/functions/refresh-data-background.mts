import type { Context, Config } from '@netlify/functions';

// Daily EOD refresh for the 23-symbol universe. Runs on a Netlify
// schedule after the US market close, pulls the latest grouped-bars
// payload from Massive, and writes one row per symbol into the
// `daily_bars` Supabase table.
//
// Scheduled functions get a 30-second execution limit, but this is a
// background function (the `-background` suffix bypasses the 30-second
// scheduled budget and gets the 15-minute wall-clock budget instead).
// A scheduled wrapper triggers it; see netlify/functions/refresh-tick.mts
// for the wrapper. This split lets the heavy pull take its time
// without bumping into the scheduled-function ceiling.
//
// Scaffolding: the Massive pull and the Supabase write are stubbed.

export default async (_req: Request, _context: Context): Promise<void> => {
  const massiveKey = Netlify.env.get('MASSIVE_API_KEY');
  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const supabaseKey = Netlify.env.get('SUPABASE_SERVICE_KEY');

  if (!massiveKey || !supabaseUrl || !supabaseKey) {
    console.error('refresh-data-background: missing required env vars', {
      hasMassive: Boolean(massiveKey),
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseKey: Boolean(supabaseKey),
    });
    return;
  }

  // TODO: implement the actual pull. Reference:
  // - https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/{date}
  // - https://api.massive.com/v2/aggs/grouped/locale/us/market/indices/{date}
  //
  // Pull both grouped endpoints for the most recent trading date,
  // filter to the 23-symbol universe, and upsert into `daily_bars`.
  console.log('refresh-data-background: scaffold placeholder, no pull executed');
};

export const config: Config = {
  // No path needed; this is invoked by the refresh-tick scheduled
  // function via context.invokeFunction or directly via the function
  // URL. Leaving path unset means it remains accessible at
  // `/.netlify/functions/refresh-data-background` for testing.
};
