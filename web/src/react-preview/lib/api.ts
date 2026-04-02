export class RequestError extends Error {
  status: number;

  constructor(status: number, message = "request failed") {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

export class UnauthorizedError extends RequestError {
  constructor(message = "unauthorized") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiBase = `${basePath}/api/v1`;

export async function apiRequest<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  const text = await response.text();
  let payload: unknown = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `request failed: ${response.status}`;

    if (response.status === 401) {
      throw new UnauthorizedError(message);
    }

    throw new RequestError(response.status, message);
  }

  return payload as T;
}
