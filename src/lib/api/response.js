export function ok(data = null, meta = {}, status = 200) {
  return Response.json(
    {
      ok: true,
      data,
      meta,
    },
    { status }
  );
}

export function fail(code, message, status = 400, detail = {}) {
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message,
        detail,
      },
    },
    { status }
  );
}