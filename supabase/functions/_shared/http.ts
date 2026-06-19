export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init.headers ?? {})
    }
  });
}

export function errorJson(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

export function redirectWithParams(target: string, params: Record<string, string>): Response {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: url.toString()
    }
  });
}

