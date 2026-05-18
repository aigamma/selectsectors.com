import type { Context, Config } from '@netlify/functions';

// Simple smoke test that confirms the function runtime works and reports
// the current deploy's commit SHA. Useful as the first endpoint to hit
// when verifying a deploy or troubleshooting a configuration issue.

export default async (_req: Request, _context: Context): Promise<Response> => {
  const commit = Netlify.env.get('COMMIT_REF') ?? 'unknown';
  const deployId = Netlify.env.get('DEPLOY_ID') ?? 'unknown';
  return Response.json({
    status: 'ok',
    site: 'selectsectors.com',
    commit,
    deployId,
    timestamp: new Date().toISOString(),
  });
};

export const config: Config = {
  path: '/api/health',
};
