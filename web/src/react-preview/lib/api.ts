export class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
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

    throw new Error(message);
  }

  return payload as T;
}
