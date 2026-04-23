import { useAuthStore } from '../stores/auth';

export async function apiGet<T>(path: string): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token || ''}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || err.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token || ''}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || err.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(path, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token || ''}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || err.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function apiDelete<T>(path: string): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(path, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token || ''}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || err.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token || ''}`,
    },
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || err.message || `HTTP ${response.status}`);
  }
  return response.json();
}
