// Единственный HTTP-слой редактора (ТЗ 01 §2.1, ТЗ 03): GET /api/health.
// Будущие серверные эндпоинты добавляются здесь, без переделки UI (ТЗ 03 §1).

export interface HealthResponse {
  status: string;
  version: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`GET /api/health → HTTP ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}
