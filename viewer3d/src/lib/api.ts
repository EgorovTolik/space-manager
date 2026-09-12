// Единственный HTTP-слой (ТЗ 01 §2.1): fetch /api/health.
// Будущие серверные эндпоинты не потребуют переделки UI — только дополнения сюда.

export interface HealthResponse {
  status: string;
  version: string;
}

/** GET /api/health → { status: 'ok', version }. Бросает Error при HTTP-ошибке. */
export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`/api/health: HTTP ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}
