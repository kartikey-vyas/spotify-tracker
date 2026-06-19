import { createServer } from 'node:http';
import { URL } from 'node:url';
import { optionalEnv, requireEnv } from './lib/env.js';

const SCOPES = [
  'user-read-recently-played',
  'user-read-playback-state',
  'user-read-currently-playing'
];

function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('SPOTIFY_CLIENT_ID'),
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri,
    state
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function waitForCallback(redirectUri: string, state: string): Promise<string> {
  const url = new URL(redirectUri);
  const port = Number(url.port || 80);
  const path = url.pathname;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', redirectUri);
        if (requestUrl.pathname !== path) {
          res.writeHead(404).end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        if (error) {
          res.writeHead(400).end('Spotify authorization failed. You can close this tab.');
          reject(new Error(`Spotify authorization failed: ${error}`));
          server.close();
          return;
        }

        if (requestUrl.searchParams.get('state') !== state) {
          res.writeHead(400).end('Invalid state. You can close this tab.');
          reject(new Error('Spotify authorization returned an invalid state'));
          server.close();
          return;
        }

        const code = requestUrl.searchParams.get('code');
        if (!code) {
          res.writeHead(400).end('Missing code. You can close this tab.');
          reject(new Error('Spotify authorization callback did not include a code'));
          server.close();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Spotify authorization complete. You can close this tab.');
        resolve(code);
        server.close();
      } catch (error) {
        reject(error);
        server.close();
      }
    });

    server.listen(port, url.hostname, () => {
      console.log(`Waiting for Spotify callback on ${redirectUri}`);
    });
  });
}

async function exchangeCode(code: string, redirectUri: string): Promise<void> {
  const clientId = requireEnv('SPOTIFY_CLIENT_ID');
  const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });

  if (!response.ok) {
    throw new Error(`Spotify code exchange failed with HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }

  const payload = (await response.json()) as {
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };

  if (!payload.refresh_token) {
    throw new Error('Spotify did not return a refresh token. Revoke the app grant and run auth again.');
  }

  console.log('\nAdd this value to GitHub Actions Secrets as SPOTIFY_REFRESH_TOKEN:');
  console.log(payload.refresh_token);
  console.log(`\nGranted scopes: ${payload.scope ?? SCOPES.join(' ')}`);
}

async function main(): Promise<void> {
  const redirectUri = optionalEnv('SPOTIFY_REDIRECT_URI') ?? 'http://127.0.0.1:5179/callback';
  const codeArgIndex = process.argv.indexOf('--code');
  const pastedCode = codeArgIndex >= 0 ? process.argv[codeArgIndex + 1] : undefined;

  if (pastedCode) {
    await exchangeCode(pastedCode, redirectUri);
    return;
  }

  const state = Math.random().toString(36).slice(2);
  const authUrl = buildAuthUrl(redirectUri, state);

  console.log('Open this Spotify authorization URL:');
  console.log(authUrl);
  console.log('\nThe redirect URI must be registered in the Spotify app settings.');

  const code = await waitForCallback(redirectUri, state);
  await exchangeCode(code, redirectUri);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
